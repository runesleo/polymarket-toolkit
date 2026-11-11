"""Real-file cursor checkpoint regressions for precise PnL.

Only network responses are simulated. TemporaryDirectory and the production
Checkpoint implementation exercise atomic persistence and process-style reloads.
"""

from __future__ import annotations

import importlib.util
import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

import httpx


MODULE_PATH = Path(__file__).resolve().parents[1] / "skills" / "polymarket-pnl" / "compute_precise_pnl.py"
SPEC = importlib.util.spec_from_file_location("compute_precise_pnl_checkpoint_v2", MODULE_PATH)
pnl = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = pnl
SPEC.loader.exec_module(pnl)

ADDRESS = "0x" + "a1" * 20
OTHER_ADDRESS = "0x" + "b2" * 20
SCHEMA = "data-api-v2-cursor-v1"


def trade(amount, side="BUY", **extra):
    row = {
        "type": "TRADE", "side": side, "usdc_size": amount,
        "size": 10, "price": 0.5, "timestamp": 1_700_000_000,
        "transaction_hash": "0xsame-transaction", "token_id": "token",
        "proxy_wallet": ADDRESS, "condition_id": "0xcondition",
    }
    row.update(extra)
    return row


def page(rows, next_cursor=None):
    return {"data": rows, "pagination": {
        "limit": 500, "offset": 0,
        "has_more": next_cursor is not None, "next_cursor": next_cursor,
    }}


class CheckpointV2Test(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.sleep_patch = patch.object(pnl.time, "sleep", return_value=None)
        self.sleep_patch.start()
        self.addCleanup(self.sleep_patch.stop)

    def checkpoint(self, name="trade"):
        # Enormous auto-save thresholds ensure a successful persistence test is
        # proving the trade loop's explicit per-page save(), not a timer.
        return pnl.Checkpoint(
            name, state_dir=Path(self.tmp.name),
            auto_save_interval=1_000_000, auto_save_seconds=1_000_000,
        )

    def client(self, pages, requests, *, fail_cursors=()):
        def handler(request):
            requests.append(request)
            if len(requests) > 40:
                raise AssertionError("checkpoint pagination did not terminate")
            query = request.url.params
            if request.url.path == "/v2/activity/combos":
                return httpx.Response(200, json=page([]))
            endpoint = request.url.path.rsplit("/", 1)[-1]
            if endpoint == "positions":
                return httpx.Response(200, json=page([]))
            if endpoint != "activity":
                raise AssertionError(f"unexpected endpoint {request.url}")
            if query.get("type") != "TRADE":
                return httpx.Response(200, json=page([]))
            cursor = query.get("cursor")
            if cursor in fail_cursors:
                raise httpx.ReadError("simulated interruption after a persisted page", request=request)
            if cursor not in pages:
                raise AssertionError(f"unexpected trade cursor {cursor!r}")
            return httpx.Response(200, json=pages[cursor])

        return httpx.Client(transport=httpx.MockTransport(handler))

    def saved_state(self, checkpoint):
        return json.loads(checkpoint.state_file.read_text(encoding="utf-8"))["state"]

    def write_state(self, checkpoint, state):
        checkpoint.update(**state)
        checkpoint.save()

    @staticmethod
    def valid_state(**changes):
        state = {
            "schema": SCHEMA, "address": ADDRESS, "activity_type": "TRADE",
            "cursor": "resume", "consumed_cursors": [], "done": False,
            "total_buy": 5, "total_sell": 2, "trade_count": 2,
            "buy_count": 1, "sell_count": 1, "page": 1,
            "pagination_incomplete": False, "data_incomplete_reasons": [],
        }
        state.update(changes)
        return state

    def test_interrupted_run_resumes_from_saved_cursor_without_double_counting(self):
        checkpoint = self.checkpoint()
        first_requests = []
        with self.client(
            {None: page([trade("5"), trade("2", "SELL")], "resume")},
            first_requests, fail_cursors={"resume"},
        ) as client:
            with self.assertRaises(httpx.RequestError):
                pnl.compute_trade_cashflow_with_checkpoint(client, ADDRESS, checkpoint=checkpoint)

        self.assertTrue(checkpoint.state_file.exists(), "a processed page must be saved before requesting the next")
        state = self.saved_state(checkpoint)
        self.assertEqual(state["schema"], SCHEMA)
        self.assertEqual(state["cursor"], "resume")
        self.assertEqual(state["consumed_cursors"], [])
        self.assertFalse(state["done"])
        self.assertEqual(state["total_buy"], 5)
        self.assertEqual(state["total_sell"], 2)
        self.assertEqual(state["trade_count"], 2)
        self.assertEqual(state["page"], 1)

        # New Checkpoint instance models another process loading the disk file.
        resumed_checkpoint = self.checkpoint()
        resumed_requests = []
        with self.client({"resume": page([trade("3"), trade("7", "SELL")])}, resumed_requests) as client:
            result = pnl.compute_trade_cashflow_with_checkpoint(client, ADDRESS, checkpoint=resumed_checkpoint)
        self.assertEqual([request.url.params.get("cursor") for request in resumed_requests], ["resume"])
        self.assertEqual(result["total_buy"], 8)
        self.assertEqual(result["total_sell"], 9)
        self.assertEqual(result["trade_count"], 4)
        self.assertEqual(result["buy_count"], 2)
        self.assertEqual(result["sell_count"], 2)
        self.assertEqual(result["page"], 2)
        self.assertTrue(result["resumed"])
        self.assertFalse(result["pagination_incomplete"])
        final = self.saved_state(resumed_checkpoint)
        self.assertTrue(final["done"])
        self.assertIsNone(final["cursor"])
        self.assertEqual(final["consumed_cursors"], ["resume"])

    def test_terminal_checkpoint_does_not_request_the_first_page_again(self):
        checkpoint = self.checkpoint()
        first_requests = []
        with self.client({None: page([trade("4"), trade("6", "SELL")])}, first_requests) as client:
            first = pnl.compute_trade_cashflow_with_checkpoint(client, ADDRESS, checkpoint=checkpoint)
        self.assertFalse(first["resumed"])
        self.assertTrue(self.saved_state(checkpoint)["done"])

        resumed_requests = []
        with self.client({}, resumed_requests) as client:
            second = pnl.compute_trade_cashflow_with_checkpoint(client, ADDRESS, checkpoint=self.checkpoint())
        self.assertEqual(resumed_requests, [])
        self.assertEqual(second["total_buy"], 4)
        self.assertEqual(second["total_sell"], 6)
        self.assertEqual(second["trade_count"], 2)
        self.assertTrue(second["resumed"])

    def test_legacy_checkpoint_is_warned_about_and_recomputed_from_zero(self):
        checkpoint = self.checkpoint()
        self.write_state(checkpoint, {
            "address": ADDRESS, "activity_type": "TRADE", "next_end": 99,
            # Identity must be checked before parsing old financial state.
            "total_buy": "not-a-v2-total", "total_sell": 9999,
            "trade_count": 999, "buy_count": 998, "sell_count": 1, "page": 70,
            "pagination_incomplete": True,
        })
        requests = []
        stdout = io.StringIO()
        with self.client({None: page([trade("2"), trade("3", "SELL")])}, requests) as client, redirect_stdout(stdout):
            result = pnl.compute_trade_cashflow_with_checkpoint(client, ADDRESS, checkpoint=self.checkpoint())
        self.assertEqual([request.url.params.get("cursor") for request in requests], [None])
        self.assertEqual(result["total_buy"], 2)
        self.assertEqual(result["total_sell"], 3)
        self.assertEqual(result["trade_count"], 2)
        self.assertEqual(result["page"], 1)
        self.assertFalse(result["resumed"])
        self.assertFalse(result["pagination_incomplete"])
        self.assertIn("checkpoint", stdout.getvalue().lower())
        self.assertEqual(self.saved_state(checkpoint)["schema"], SCHEMA)

    def test_schema_address_and_activity_type_mismatches_are_never_reused(self):
        for name, changes in (
            ("schema", {"schema": "unknown-schema"}),
            ("address", {"address": OTHER_ADDRESS}),
            ("type", {"activity_type": "REDEEM"}),
        ):
            with self.subTest(name=name):
                checkpoint = self.checkpoint(name)
                self.write_state(checkpoint, self.valid_state(total_buy="must-not-be-parsed", done=True, **changes))
                requests = []
                stdout = io.StringIO()
                with self.client({None: page([trade("2")])}, requests) as client, redirect_stdout(stdout):
                    result = pnl.compute_trade_cashflow_with_checkpoint(client, ADDRESS, checkpoint=self.checkpoint(name))
                self.assertEqual([request.url.params.get("cursor") for request in requests], [None])
                self.assertEqual(result["total_buy"], 2)
                self.assertEqual(result["total_sell"], 0)
                self.assertEqual(result["trade_count"], 1)
                self.assertFalse(result["resumed"])
                self.assertIn("checkpoint", stdout.getvalue().lower())

    def test_corrupt_json_checkpoint_is_recomputed_without_old_totals(self):
        checkpoint = self.checkpoint()
        checkpoint.state_file.write_text("{broken json", encoding="utf-8")
        requests = []
        with self.client({None: page([trade("2")])}, requests) as client:
            result = pnl.compute_trade_cashflow_with_checkpoint(client, ADDRESS, checkpoint=self.checkpoint())
        self.assertEqual(result["total_buy"], 2)
        self.assertEqual(result["trade_count"], 1)
        self.assertFalse(result["resumed"])
        self.assertEqual(self.saved_state(checkpoint)["schema"], SCHEMA)

    def test_malformed_current_schema_cannot_reuse_untrusted_totals(self):
        cases = (
            {"cursor": 123},
            {"consumed_cursors": "resume"},
            {"done": "false"},
            {"total_buy": "NaN"},
            {"trade_count": 1.5},
        )
        for index, changes in enumerate(cases):
            with self.subTest(changes=changes):
                name = f"bad-{index}"
                checkpoint = self.checkpoint(name)
                self.write_state(checkpoint, self.valid_state(**changes))
                requests = []
                with self.client({None: page([trade("2")])}, requests) as client:
                    try:
                        result = pnl.compute_trade_cashflow_with_checkpoint(client, ADDRESS, checkpoint=self.checkpoint(name))
                    except (ValueError, RuntimeError):
                        continue
                # A safe implementation may explicitly invalidate corrupt
                # state and start over; reusing any of its totals is forbidden.
                self.assertEqual(result["total_buy"], 2)
                self.assertEqual(result["total_sell"], 0)
                self.assertEqual(result["trade_count"], 1)
                self.assertFalse(result["resumed"])

    def assert_checkpoint_rejected_before_requests(self, state, *, name):
        checkpoint = self.checkpoint(name)
        # Write the file envelope directly so non-dictionary state reaches the
        # real loader rather than being rejected by this test's save helper.
        checkpoint.state_file.write_text(json.dumps({
            "task_name": name, "status": "in_progress", "state": state,
        }), encoding="utf-8")
        requests = []
        with self.client({}, requests) as client:
            with self.assertRaises((ValueError, RuntimeError)):
                pnl.compute_trade_cashflow_with_checkpoint(client, ADDRESS, checkpoint=self.checkpoint(name))
        self.assertEqual(requests, [], "corrupt saved state must be rejected before making a history request")

    def test_non_dictionary_checkpoint_state_is_rejected_explicitly(self):
        for index, state in enumerate(([], [self.valid_state()], None, "not-a-map", 0, 42, True)):
            with self.subTest(state=state):
                self.assert_checkpoint_rejected_before_requests(state, name=f"non-map-{index}")

    def test_completed_checkpoint_cannot_have_a_nonterminal_cursor_without_partial_flag(self):
        state = self.valid_state(done=True, cursor="resume", pagination_incomplete=False)
        self.assert_checkpoint_rejected_before_requests(state, name="contradictory-done")

    def test_cycle_stopped_partial_checkpoint_remains_a_valid_terminal_state(self):
        # A detected cycle intentionally stops with a nonempty cursor. This is
        # different from a complete history falsely claiming to be terminal.
        checkpoint = self.checkpoint()
        self.write_state(checkpoint, self.valid_state(
            done=True, cursor="resume", consumed_cursors=["resume"],
            page=2, pagination_incomplete=True,
        ))
        requests = []
        with self.client({}, requests) as client:
            result = pnl.compute_trade_cashflow_with_checkpoint(client, ADDRESS, checkpoint=self.checkpoint())
        self.assertEqual(requests, [])
        self.assertEqual(result["total_buy"], 5)
        self.assertEqual(result["total_sell"], 2)
        self.assertEqual(result["trade_count"], 2)
        self.assertTrue(result["resumed"])
        self.assertTrue(result["pagination_incomplete"])

    def test_current_schema_requires_every_saved_accounting_and_cursor_field(self):
        # Identity keys retain their existing legacy/mismatch restart behavior.
        # Once identity matches, omitted state is corruption, not a zero value.
        required = (
            "cursor", "consumed_cursors", "done", "total_buy", "total_sell",
            "trade_count", "buy_count", "sell_count", "page",
            "pagination_incomplete", "data_incomplete_reasons",
        )
        for field in required:
            with self.subTest(field=field):
                state = self.valid_state(done=True, cursor=None)
                state.pop(field)
                self.assert_checkpoint_rejected_before_requests(state, name=f"missing-{field}")

    def test_invalid_checkpoint_data_reasons_cannot_be_coerced_into_a_list(self):
        invalid_values = (
            None, "", "combo_positions_not_replayed", {},
            {"reason": "combo_positions_not_replayed"},
            [None], [1], [True], [[]], [""], ["   "],
            ["combo_positions_not_replayed", None],
        )
        for index, reasons in enumerate(invalid_values):
            with self.subTest(reasons=reasons):
                state = self.valid_state(done=True, cursor=None, data_incomplete_reasons=reasons)
                self.assert_checkpoint_rejected_before_requests(state, name=f"bad-reasons-{index}")

    def test_checkpoint_trade_counts_must_equal_the_buy_and_sell_counts(self):
        for index, changes in enumerate((
            {"trade_count": 3}, {"buy_count": 2}, {"sell_count": 2},
        )):
            with self.subTest(changes=changes):
                state = self.valid_state(done=True, cursor=None, **changes)
                self.assert_checkpoint_rejected_before_requests(state, name=f"bad-counts-{index}")

    def test_input_address_is_normalized_for_persistence_and_resume(self):
        checkpoint = self.checkpoint()
        requests = []
        with self.client({None: page([trade("2")])}, requests) as client:
            pnl.compute_trade_cashflow_with_checkpoint(client, ADDRESS.upper(), checkpoint=checkpoint)
        self.assertEqual(self.saved_state(checkpoint)["address"], ADDRESS)
        self.assertTrue(all(request.url.params.get("user") == ADDRESS for request in requests))
        resumed_requests = []
        with self.client({}, resumed_requests) as client:
            result = pnl.compute_trade_cashflow_with_checkpoint(client, ADDRESS, checkpoint=self.checkpoint())
        self.assertEqual(resumed_requests, [])
        self.assertEqual(result["total_buy"], 2)
        self.assertTrue(result["resumed"])

    def test_consumed_cursor_cycle_is_detected_after_reloading_a_checkpoint(self):
        checkpoint = self.checkpoint()
        first_requests = []
        with self.client({
            None: page([trade("1")], "A"),
            "A": page([trade("2")], "B"),
        }, first_requests, fail_cursors={"B"}) as client:
            with self.assertRaises(httpx.RequestError):
                pnl.compute_trade_cashflow_with_checkpoint(client, ADDRESS, checkpoint=checkpoint)
        state = self.saved_state(checkpoint)
        self.assertEqual(state["cursor"], "B")
        self.assertEqual(state["consumed_cursors"], ["A"])
        self.assertEqual(state["total_buy"], 3)

        resumed_requests = []
        with self.client({"B": page([trade("7", "SELL")], "A")}, resumed_requests) as client:
            try:
                result = pnl.compute_trade_cashflow_with_checkpoint(client, ADDRESS, checkpoint=self.checkpoint())
            except (ValueError, RuntimeError):
                pass
            else:
                self.assertTrue(result["pagination_incomplete"])
        self.assertEqual([request.url.params.get("cursor") for request in resumed_requests], ["B"])

    def test_checkpoint_cashflow_preserves_identical_same_second_fills(self):
        duplicate = trade("1")
        requests = []
        with self.client({
            None: page([trade("5", timestamp=1_700_000_001), duplicate, duplicate], "A"),
            "A": page([duplicate, duplicate, duplicate], "B"),
            "B": page([duplicate]),
        }, requests) as client:
            result = pnl.compute_trade_cashflow_with_checkpoint(client, ADDRESS, checkpoint=self.checkpoint())
        self.assertEqual(result["total_buy"], 11)
        self.assertEqual(result["trade_count"], 7)
        self.assertEqual(result["buy_count"], 7)
        self.assertEqual(result["sell_count"], 0)
        self.assertFalse(result["pagination_incomplete"])
        self.assertEqual([request.url.params.get("cursor") for request in requests], [None, "A", "B"])

    def test_resumed_address_result_is_marked_as_a_mixed_snapshot(self):
        checkpoint = self.checkpoint()
        first_requests = []
        with self.client({None: page([trade("4"), trade("6", "SELL")])}, first_requests) as client:
            pnl.compute_trade_cashflow_with_checkpoint(client, ADDRESS, checkpoint=checkpoint)

        resumed_requests = []
        with self.client({}, resumed_requests) as client:
            result = pnl.compute_address_pnl(client, ADDRESS, trade_checkpoint=self.checkpoint())
        self.assertEqual(result.pnl, 2)
        self.assertFalse(result.complete)
        self.assertFalse(result.pagination_incomplete)
        self.assertIn("resumed_trade_checkpoint_requires_fresh_snapshot", result.data_incomplete_reasons)
        self.assertFalse(any(request.url.params.get("type") == "TRADE" for request in resumed_requests))

    def test_fresh_checkpoint_does_not_itself_make_an_address_incomplete(self):
        requests = []
        with self.client({None: page([trade("4"), trade("6", "SELL")])}, requests) as client:
            result = pnl.compute_address_pnl(client, ADDRESS, trade_checkpoint=self.checkpoint())
        self.assertEqual(result.pnl, 2)
        self.assertTrue(result.complete)
        self.assertNotIn("resumed_trade_checkpoint_requires_fresh_snapshot", result.data_incomplete_reasons or [])


if __name__ == "__main__":
    unittest.main()
