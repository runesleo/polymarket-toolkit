"""Regressions for the former offset-cap failure, now using v2 cursor walks.

The old 5000-row activity cap and timestamp fallback must never reappear.
Compatibility helper names remain callable but issue cursor requests only.
"""
import unittest
from unittest.mock import patch

import httpx

from test_precise_pnl_v2 import ADDRESS, V2API, activity, envelope, pnl


class ActivityCursorRegressionTest(unittest.TestCase):
    def setUp(self):
        self.sleep = patch.object(pnl.time, "sleep", return_value=None)
        self.sleep.start()
        self.addCleanup(self.sleep.stop)

    def test_non_trade_streams_exceed_former_cap_without_losing_same_second_rows(self):
        for kind in ("REDEEM", "MERGE", "SPLIT"):
            with self.subTest(kind=kind):
                api = V2API(activities={kind: [activity(kind, 1)] * 6501})
                with api.client() as client:
                    rows, incomplete = pnl.fetch_activity_all(client, ADDRESS, kind)
                self.assertEqual(len(rows), 6501)
                self.assertEqual(sum(row["usdcSize"] for row in rows), 6501)
                self.assertFalse(incomplete)
                self.assertTrue(all("offset" not in r.url.params for r in api.requests))
                self.assertTrue(all(r.url.params["sort_direction"] == "ASC" for r in api.requests))
                self.assertEqual(len(api.requests), 14)

    def test_legacy_helper_names_use_v2_without_offset_or_timestamp_backfill(self):
        api = V2API(activities={"MERGE": [activity("MERGE", 3)] * 3}, page_cap=2)
        with api.client() as client:
            rows, incomplete, hit_cap = pnl.fetch_activity_all_offset(client, ADDRESS, "MERGE")
        self.assertEqual(sum(row["usdcSize"] for row in rows), 9)
        self.assertFalse(incomplete)
        self.assertFalse(hit_cap)
        api2 = V2API(activities={"TRADE": [activity(amount=2)] * 3}, page_cap=2)
        with api2.client() as client:
            trades, incomplete = pnl.fetch_activity_all_timestamp(client, ADDRESS, "TRADE")
        self.assertEqual(sum(row["usdcSize"] for row in trades), 6)
        self.assertFalse(incomplete)
        for request in api.requests + api2.requests:
            self.assertEqual(request.url.path, "/v2/activity")
            self.assertNotIn("offset", request.url.params)
            self.assertNotIn("end", request.url.params)

    def test_400_is_a_real_v2_error_and_does_not_trigger_an_offset_fallback(self):
        calls = []
        def handler(request):
            calls.append(request)
            return httpx.Response(400, json={"error": "invalid cursor"})
        with httpx.Client(transport=httpx.MockTransport(handler)) as client:
            with self.assertRaises(httpx.HTTPStatusError):
                pnl.fetch_activity_all(client, ADDRESS, "MERGE")
        self.assertEqual(len(calls), 1)

    def test_failure_after_one_page_never_returns_a_complete_prefix(self):
        calls = []
        def handler(request):
            calls.append(request)
            if "cursor" not in request.url.params:
                return httpx.Response(200, json=envelope([activity("REDEEM", 10)], "later"))
            return httpx.Response(503, json={"error": "unavailable"})
        with httpx.Client(transport=httpx.MockTransport(handler)) as client:
            with self.assertRaises(httpx.HTTPStatusError):
                pnl.fetch_activity_all(client, ADDRESS, "REDEEM")
        self.assertEqual(len(calls), 4)

    def test_nonadjacent_cursor_cycle_keeps_only_the_known_prefix(self):
        api = V2API(pages={("activity", "SPLIT"): {
            None: envelope([activity("SPLIT", 1)], "A"),
            "A": envelope([activity("SPLIT", 2)], "B"),
            "B": envelope([activity("SPLIT", 1000)], "A"),
        }})
        with api.client() as client:
            rows, incomplete = pnl.fetch_activity_all(client, ADDRESS, "SPLIT")
        self.assertTrue(incomplete)
        self.assertEqual(sum(row["usdcSize"] for row in rows), 3)
        self.assertEqual(len(api.requests), 3)


if __name__ == "__main__":
    unittest.main()
