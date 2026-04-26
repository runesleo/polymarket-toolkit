import importlib.util
import sys
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "skills" / "polymarket-pnl" / "compute_precise_pnl.py"
SPEC = importlib.util.spec_from_file_location("compute_precise_pnl", MODULE_PATH)
compute_precise_pnl = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = compute_precise_pnl
SPEC.loader.exec_module(compute_precise_pnl)


class FakeResponse:
    def __init__(self, rows):
        self.rows = rows
        self.status_code = 200

    def json(self):
        return self.rows

    def raise_for_status(self):
        return None


class FakeClient:
    def __init__(self, page_limit):
        self.page_limit = page_limit
        self.calls = []

    def get(self, url, params, timeout):
        self.calls.append(dict(params))
        if params.get("start") == 100 and params.get("end") == 100:
            rows = [
                self.trade(100, "a", 1),
                self.trade(100, "b", 2),
                self.trade(100, "c", 3),
                self.trade(100, "d", 4),
            ]
            offset = int(params.get("offset", 0))
            return FakeResponse(rows[offset : offset + self.page_limit])
        if params.get("end") == 99:
            return FakeResponse([])
        return FakeResponse([
            self.trade(200, "newer", 5),
            self.trade(100, "a", 1),
            self.trade(100, "b", 2),
        ])

    @staticmethod
    def trade(timestamp, tx, usdc_size):
        return {
            "timestamp": timestamp,
            "transactionHash": tx,
            "side": "BUY",
            "usdcSize": str(usdc_size),
        }


class FakeDuplicateClient(FakeClient):
    def get(self, url, params, timeout):
        self.calls.append(dict(params))
        duplicate = self.trade(100, "duplicate", 1)
        if params.get("start") == 100 and params.get("end") == 100:
            rows = [duplicate, duplicate, duplicate, duplicate]
            offset = int(params.get("offset", 0))
            return FakeResponse(rows[offset : offset + self.page_limit])
        if params.get("end") == 99:
            return FakeResponse([])
        return FakeResponse([
            self.trade(200, "newer", 5),
            duplicate,
            duplicate,
        ])


class FakeFullPageDuplicateClient(FakeClient):
    def get(self, url, params, timeout):
        self.calls.append(dict(params))
        duplicate = self.trade(100, "duplicate", 1)
        if params.get("start") == 100 and params.get("end") == 100:
            rows = [duplicate, duplicate, duplicate, duplicate, duplicate, duplicate]
            offset = int(params.get("offset", 0))
            return FakeResponse(rows[offset : offset + self.page_limit])
        if params.get("end") == 99:
            return FakeResponse([])
        return FakeResponse([
            self.trade(200, "newer", 5),
            duplicate,
            duplicate,
        ])


class ComputeTradeCashflowCheckpointTest(unittest.TestCase):
    def test_timestamp_pagination_preserves_duplicate_full_exact_second_pages(self):
        old_page_limit = compute_precise_pnl.PAGE_LIMIT
        old_delay = compute_precise_pnl.REQUEST_DELAY
        try:
            compute_precise_pnl.PAGE_LIMIT = 3
            compute_precise_pnl.REQUEST_DELAY = 0
            client = FakeFullPageDuplicateClient(page_limit=3)

            records, pagination_incomplete = compute_precise_pnl.fetch_activity_all_timestamp(
                client,
                "0xabc",
                "TRADE",
            )

            self.assertEqual(len(records), 7)
            self.assertEqual(sum(float(record["usdcSize"]) for record in records), 11)
            self.assertFalse(pagination_incomplete)
            exact_offsets = [
                call["offset"]
                for call in client.calls
                if call.get("start") == 100 and call.get("end") == 100
            ]
            self.assertEqual(exact_offsets, [0, 3, 6])
        finally:
            compute_precise_pnl.PAGE_LIMIT = old_page_limit
            compute_precise_pnl.REQUEST_DELAY = old_delay

    def test_checkpoint_trade_boundary_paginates_exact_second_overflow(self):
        old_page_limit = compute_precise_pnl.PAGE_LIMIT
        old_delay = compute_precise_pnl.REQUEST_DELAY
        try:
            compute_precise_pnl.PAGE_LIMIT = 3
            compute_precise_pnl.REQUEST_DELAY = 0
            client = FakeClient(page_limit=3)

            result = compute_precise_pnl.compute_trade_cashflow_with_checkpoint(
                client,
                "0xabc",
                checkpoint=None,
            )

            self.assertEqual(result["trade_count"], 5)
            self.assertEqual(result["buy_count"], 5)
            self.assertEqual(result["total_buy"], 15)
            self.assertFalse(result["pagination_incomplete"])
            exact_offsets = [
                call["offset"]
                for call in client.calls
                if call.get("start") == 100 and call.get("end") == 100
            ]
            self.assertEqual(exact_offsets, [0, 3])
        finally:
            compute_precise_pnl.PAGE_LIMIT = old_page_limit
            compute_precise_pnl.REQUEST_DELAY = old_delay

    def test_checkpoint_trade_boundary_preserves_duplicate_exact_second_rows(self):
        old_page_limit = compute_precise_pnl.PAGE_LIMIT
        old_delay = compute_precise_pnl.REQUEST_DELAY
        try:
            compute_precise_pnl.PAGE_LIMIT = 3
            compute_precise_pnl.REQUEST_DELAY = 0
            client = FakeDuplicateClient(page_limit=3)

            result = compute_precise_pnl.compute_trade_cashflow_with_checkpoint(
                client,
                "0xabc",
                checkpoint=None,
            )

            self.assertEqual(result["trade_count"], 5)
            self.assertEqual(result["buy_count"], 5)
            self.assertEqual(result["total_buy"], 9)
            self.assertFalse(result["pagination_incomplete"])
        finally:
            compute_precise_pnl.PAGE_LIMIT = old_page_limit
            compute_precise_pnl.REQUEST_DELAY = old_delay

    def test_checkpoint_trade_boundary_preserves_duplicate_full_exact_second_pages(self):
        old_page_limit = compute_precise_pnl.PAGE_LIMIT
        old_delay = compute_precise_pnl.REQUEST_DELAY
        try:
            compute_precise_pnl.PAGE_LIMIT = 3
            compute_precise_pnl.REQUEST_DELAY = 0
            client = FakeFullPageDuplicateClient(page_limit=3)

            result = compute_precise_pnl.compute_trade_cashflow_with_checkpoint(
                client,
                "0xabc",
                checkpoint=None,
            )

            self.assertEqual(result["trade_count"], 7)
            self.assertEqual(result["buy_count"], 7)
            self.assertEqual(result["total_buy"], 11)
            self.assertFalse(result["pagination_incomplete"])
            exact_offsets = [
                call["offset"]
                for call in client.calls
                if call.get("start") == 100 and call.get("end") == 100
            ]
            self.assertEqual(exact_offsets, [0, 3, 6])
        finally:
            compute_precise_pnl.PAGE_LIMIT = old_page_limit
            compute_precise_pnl.REQUEST_DELAY = old_delay


if __name__ == "__main__":
    unittest.main()
