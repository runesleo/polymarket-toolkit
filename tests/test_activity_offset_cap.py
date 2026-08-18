"""Regression tests for the /activity offset cap.

Measured 2026-08-18: /activity rejects offset > 5000 with a 400, and the cap is
on `offset` alone — offset=5000&limit=500 is fine, offset=5001&limit=499 is not,
offset=0&limit=5501 is fine. /positions does not share the cap (offset=9000
returns 200), which is why POSITIONS_OFFSET_CAP stays at 9500.

The bug these pin down: the constant was 9500, and the cap was checked only
after `offset += len(records)`, so the first over-cap offset was still sent. A
400 is in neither the retry set nor a fallback path, so a wallet with more than
5000 rows of one activity type failed the whole address instead of degrading to
the timestamp cursor.
"""

import importlib.util
import sys
import unittest
from pathlib import Path

import httpx


MODULE_PATH = Path(__file__).resolve().parents[1] / "skills" / "polymarket-pnl" / "compute_precise_pnl.py"
SPEC = importlib.util.spec_from_file_location("compute_precise_pnl_offset", MODULE_PATH)
compute_precise_pnl = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = compute_precise_pnl
SPEC.loader.exec_module(compute_precise_pnl)


CAP = compute_precise_pnl.ACTIVITY_OFFSET_CAP
PAGE = compute_precise_pnl.PAGE_LIMIT


class FakeResponse:
    def __init__(self, rows):
        self.rows = rows
        self.status_code = 200

    def json(self):
        return self.rows

    def raise_for_status(self):
        return None


class CappedClient:
    """Serves REDEEM rows the way the real API does: 400 past the offset cap."""

    def __init__(self, total_rows, cap=CAP):
        self.total_rows = total_rows
        self.cap = cap
        self.offsets = []

    def get(self, url, params, timeout):
        offset = int(params.get("offset", 0))
        self.offsets.append(offset)
        if offset > self.cap:
            request = httpx.Request("GET", url)
            response = httpx.Response(400, request=request)
            raise httpx.HTTPStatusError("Bad Request", request=request, response=response)
        limit = int(params["limit"])
        rows = [
            {"timestamp": 1_700_000_000 + i, "usdcSize": "1", "conditionId": f"c{i}"}
            for i in range(offset, min(offset + limit, self.total_rows))
        ]
        return FakeResponse(rows)


class ActivityOffsetCapTest(unittest.TestCase):
    def setUp(self):
        self._sleep = compute_precise_pnl.time.sleep
        compute_precise_pnl.time.sleep = lambda *_: None

    def tearDown(self):
        compute_precise_pnl.time.sleep = self._sleep

    def test_cap_matches_measured_api_limit(self):
        self.assertEqual(CAP, 5000)
        # /positions really does serve offset=9000, so it must NOT be lowered
        # along with the activity cap.
        self.assertEqual(compute_precise_pnl.POSITIONS_OFFSET_CAP, 9500)

    def test_never_sends_an_over_cap_offset(self):
        client = CappedClient(total_rows=CAP + 3 * PAGE)
        compute_precise_pnl.fetch_activity_all_offset(client, "0xabc", "REDEEM")
        self.assertTrue(client.offsets, "expected at least one request")
        self.assertLessEqual(
            max(client.offsets), CAP,
            f"sent offset {max(client.offsets)} past the cap of {CAP}",
        )

    def test_reaching_the_cap_reports_hit_cap_instead_of_raising(self):
        client = CappedClient(total_rows=CAP + 3 * PAGE)
        items, incomplete, hit_cap = compute_precise_pnl.fetch_activity_all_offset(
            client, "0xabc", "REDEEM"
        )
        self.assertTrue(hit_cap)
        self.assertTrue(incomplete)
        self.assertLessEqual(len(items), CAP + PAGE)

    def test_a_400_below_our_cap_degrades_rather_than_failing(self):
        # Defence in depth: if the API lowers the cap under us, the address must
        # still complete via the fallback rather than raising.
        client = CappedClient(total_rows=CAP + 3 * PAGE, cap=1500)
        _, _, hit_cap = compute_precise_pnl.fetch_activity_all_offset(client, "0xabc", "REDEEM")
        self.assertTrue(hit_cap)

    def test_non_400_errors_still_propagate(self):
        class ServerErrorClient(CappedClient):
            def get(self, url, params, timeout):
                request = httpx.Request("GET", url)
                raise httpx.HTTPStatusError(
                    "Forbidden", request=request, response=httpx.Response(403, request=request)
                )

        with self.assertRaises(httpx.HTTPStatusError):
            compute_precise_pnl.fetch_activity_all_offset(
                ServerErrorClient(total_rows=10), "0xabc", "REDEEM"
            )

    def test_short_history_never_reaches_the_fallback(self):
        client = CappedClient(total_rows=1200)
        items, incomplete, hit_cap = compute_precise_pnl.fetch_activity_all_offset(
            client, "0xabc", "REDEEM"
        )
        self.assertEqual(len(items), 1200)
        self.assertFalse(hit_cap)
        self.assertFalse(incomplete)

    def test_hitting_the_cap_falls_back_to_timestamp_pagination(self):
        client = CappedClient(total_rows=CAP + 3 * PAGE)
        called = {}

        def fake_timestamp(_client, address, activity_type, progress_cb=None):
            called["args"] = (address, activity_type)
            return [{"usdcSize": "42"}], False

        original = compute_precise_pnl.fetch_activity_all_timestamp
        compute_precise_pnl.fetch_activity_all_timestamp = fake_timestamp
        try:
            items, incomplete = compute_precise_pnl.fetch_activity_all(client, "0xabc", "REDEEM")
        finally:
            compute_precise_pnl.fetch_activity_all_timestamp = original

        self.assertEqual(called.get("args"), ("0xabc", "REDEEM"))
        self.assertEqual(items, [{"usdcSize": "42"}])
        self.assertFalse(
            incomplete,
            "the cursor path is complete, so the truncation flag must not leak through",
        )


if __name__ == "__main__":
    unittest.main()
