"""Offline contract regressions for the Python precise-PnL v2 migration.

All HTTP traffic goes through httpx.MockTransport. Tests exercise the existing
public fetch/compute/CLI functions, without replacing their pagination or
cashflow logic. The only other patches disable sleeps and inject the CLI client.
"""

from __future__ import annotations

import importlib.util
import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from dataclasses import asdict
from pathlib import Path
from unittest.mock import patch

import httpx


MODULE_PATH = Path(__file__).resolve().parents[1] / "skills" / "polymarket-pnl" / "compute_precise_pnl.py"
SPEC = importlib.util.spec_from_file_location("compute_precise_pnl_v2_contract", MODULE_PATH)
pnl = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = pnl
SPEC.loader.exec_module(pnl)

ADDRESS = "0x" + "a1" * 20
OTHER_ADDRESS = "0x" + "b2" * 20
ACTIVITY_TYPES = (
    "TRADE", "REDEEM", "MERGE", "SPLIT", "MAKER_REBATE",
    "REWARD", "REFERRAL_REWARD", "CONVERSION",
)
UNSUPPORTED_TYPES = "MIGRATION,YIELD,TAKER_REBATE,DIRECTIONAL_SPLIT,DIRECTIONAL_MERGE,THRESHOLD_COMPOSE,THRESHOLD_DECOMPOSE,TIP"
PUBLIC_KEYS = {
    "address", "pnl", "pnl_inclusive", "total_buy", "total_sell", "total_redeem",
    "total_merge", "total_split", "total_rebate", "total_reward", "total_referral",
    "total_conversion", "unrealized", "open_positions", "trade_count", "computed_at",
    "complete", "positions_truncated", "pagination_incomplete", "pagination_incomplete_types",
}


def activity(kind="TRADE", amount="1", side="BUY", **extra):
    row = {
        "type": kind,
        "usdc_size": amount,
        "timestamp": 1_700_000_000,
        "transaction_hash": "0xsame-transaction",
        "proxy_wallet": ADDRESS,
        "condition_id": "0xcondition",
        "token_id": "token",
    }
    if kind == "TRADE":
        row.update(side=side, size=10, price=0.5)
    row.update(extra)
    return row


def position(size=1, price=0.25, **extra):
    row = {
        "proxy_wallet": ADDRESS,
        "condition_id": "0xcondition",
        "token_id": "token",
        "current_size": size,
        "current_price": price,
    }
    row.update(extra)
    return row


def envelope(rows, next_cursor=None):
    return {"data": rows, "pagination": {
        "limit": 500, "offset": 0,
        "has_more": next_cursor is not None, "next_cursor": next_cursor,
    }}


class V2API:
    """Response fixtures only; production httpx does request serialization."""

    def __init__(self, *, activities=None, positions=None, leaderboard=None, combos=None, page_cap=1000, pages=None):
        self.activities = activities or {}
        self.positions = positions or []
        self.leaderboard = leaderboard or []
        self.combos = combos or []
        self.page_cap = page_cap
        self.pages = pages or {}
        self.requests = []

    def handle(self, request):
        self.requests.append(request)
        if len(self.requests) > 80:
            raise AssertionError("pagination did not terminate within the fixture request bound")
        endpoint = request.url.path.rsplit("/", 1)[-1]
        query = request.url.params
        kind = query.get("type", "") if endpoint == "activity" else ""
        scripted = self.pages.get((endpoint, kind))
        cursor = query.get("cursor")
        if scripted is not None:
            if cursor not in scripted:
                raise AssertionError(f"unexpected cursor {cursor!r} for {endpoint}/{kind}")
            return httpx.Response(200, json=scripted[cursor])
        if endpoint == "activity":
            rows = self.activities.get(kind, [])
        elif endpoint == "positions":
            rows = self.positions
        elif endpoint == "leaderboard":
            rows = self.leaderboard
        elif endpoint == "combos":
            rows = self.combos
        else:
            raise AssertionError(f"unexpected API endpoint {request.url}")
        offset = 0 if cursor is None else int(cursor.removeprefix("v2-"))
        limit = min(int(query.get("limit", 500)), self.page_cap)
        end = min(offset + limit, len(rows))
        next_cursor = f"v2-{end}" if end < len(rows) else None
        return httpx.Response(200, json=envelope(rows[offset:end], next_cursor))

    def client(self):
        return httpx.Client(transport=httpx.MockTransport(self.handle))


def golden_api(*, include_conversion=True):
    activities = {
        "TRADE": [
            activity(amount="100.50", size=200, price=0.5, fee_usdc=99),
            activity(amount=25.25, size=100, price=0.25, fee_usdc=99),
            activity(amount="50.25", side="SELL", size=100, price=0.5, fee_usdc=99),
        ],
        "REDEEM": [activity("REDEEM", "40")],
        "MERGE": [activity("MERGE", "30")],
        "SPLIT": [activity("SPLIT", "20.50")],
        "MAKER_REBATE": [activity("MAKER_REBATE", "1.25")],
        "REWARD": [activity("REWARD", "2")],
        "REFERRAL_REWARD": [activity("REFERRAL_REWARD", "3.50")],
        "CONVERSION": [activity("CONVERSION", "4.25")],
    }
    positions = [
        position(100, 0.4, current_value=40, entry_cost_usdc=10, unrealized_pnl=30, realized_pnl=5000),
        position(10, 1, current_value=10, entry_cost_usdc=9, unrealized_pnl=1, realized_pnl=1000),
        # No price is needed for a position that holds no shares.
        position(0, None),
    ]
    if not include_conversion:
        activities["CONVERSION"] = []
    return V2API(activities=activities, positions=positions)


class PrecisePnLV2Test(unittest.TestCase):
    def setUp(self):
        self.sleep_patch = patch.object(pnl.time, "sleep", return_value=None)
        self.sleep_patch.start()
        self.addCleanup(self.sleep_patch.stop)

    def assert_v2_contract(self, api):
        self.assertTrue(api.requests)
        forbidden = {"offset", "sizeThreshold", "timePeriod", "orderBy", "sortDirection"}
        for request in api.requests:
            query = request.url.params
            endpoint = request.url.path.rsplit("/", 1)[-1]
            resource = "activity/combos" if endpoint == "combos" else endpoint
            self.assertEqual(str(request.url.copy_with(query=None)), f"https://data-api.polymarket.com/v2/{resource}")
            self.assertFalse(forbidden.intersection(query.keys()), str(request.url))
            self.assertGreater(int(query["limit"]), 0)
            self.assertLessEqual(int(query["limit"]), 1000)
            if endpoint == "activity":
                self.assertEqual(query.get("user"), ADDRESS)
                self.assertIn(query.get("type"), (*ACTIVITY_TYPES, UNSUPPORTED_TYPES))
                self.assertEqual(query.get("start"), "1", "every cursor request must retain the full-history start")
                self.assertEqual(query.get("sort_direction"), "ASC")
            elif endpoint == "positions":
                self.assertEqual(query.get("user"), ADDRESS)
                self.assertEqual(query.get("filter_type"), "TOKENS")
                self.assertEqual(float(query["filter_amount"]), 0)
                self.assertEqual(query.get("status"), "OPEN")
                self.assertEqual(query.get("include_archived"), "true")
            elif endpoint == "leaderboard":
                self.assertEqual(query.get("time_period"), "all")
                self.assertEqual(query.get("sort_by"), "PNL")
                self.assertEqual(query.get("category"), "overall")
            elif endpoint == "combos":
                self.assertEqual(query.get("user"), ADDRESS)
                self.assertEqual(query.get("limit"), "1")
                expected_keys = {"user", "limit"}
                if query.get("cursor") is not None:
                    expected_keys.add("cursor")
                self.assertEqual(set(query.keys()), expected_keys, "combo presence must not inherit base-activity filters")

    def test_cashflow_and_public_fields_keep_existing_accounting_semantics(self):
        api = golden_api()
        with api.client() as client:
            result = pnl.compute_address_pnl(client, ADDRESS)
        expected = {
            "total_buy": 125.75, "total_sell": 50.25, "total_redeem": 40,
            "total_merge": 30, "total_split": 20.5, "total_rebate": 1.25,
            "total_reward": 2, "total_referral": 3.5, "total_conversion": 4.25,
            "unrealized": 50, "pnl": 25.25, "pnl_inclusive": 35,
        }
        for field, value in expected.items():
            with self.subTest(field=field):
                self.assertAlmostEqual(getattr(result, field), value, places=10)
        self.assertEqual(result.trade_count, 3)
        self.assertEqual(result.open_positions, 2)
        # Preserve conversion arithmetic without claiming its economic meaning
        # has been established by an endpoint-format migration.
        self.assertFalse(result.complete)
        self.assertTrue(result.data_incomplete_reasons)
        self.assertFalse(result.positions_truncated)
        self.assertFalse(result.pagination_incomplete)
        self.assertIsNone(result.pagination_incomplete_types)
        self.assertTrue(PUBLIC_KEYS.issubset(asdict(result)))
        self.assert_v2_contract(api)

    def test_cursor_preserves_indistinguishable_fills_and_follows_short_pages(self):
        duplicate = activity(amount="1")
        rows = [activity(amount="5", timestamp=1_700_000_001)] + [duplicate] * 6
        api = V2API(activities={"TRADE": rows}, page_cap=3)
        with api.client() as client:
            records, incomplete = pnl.fetch_activity_all(client, ADDRESS, "TRADE")
        self.assertEqual(len(records), 7)
        self.assertEqual(sum(float(row["usdcSize"]) for row in records), 11)
        self.assertFalse(incomplete)
        self.assertEqual([r.url.params.get("cursor") for r in api.requests], [None, "v2-3", "v2-6"])
        self.assert_v2_contract(api)

    def test_empty_page_with_a_next_cursor_is_not_the_end_of_history(self):
        api = V2API(pages={
            ("activity", "TRADE"): {
                None: envelope([], "after-empty"),
                "after-empty": envelope([activity(amount="7")]),
            },
        })
        with api.client() as client:
            rows, incomplete = pnl.fetch_activity_all(client, ADDRESS, "TRADE")
        self.assertEqual(len(rows), 1)
        self.assertEqual(float(rows[0]["usdcSize"]), 7)
        self.assertFalse(incomplete)
        self.assertEqual(len(api.requests), 2)

    def test_full_terminal_page_does_not_trigger_timestamp_replay(self):
        api = V2API(activities={"TRADE": [activity()] * pnl.PAGE_LIMIT})
        with api.client() as client:
            rows, incomplete = pnl.fetch_activity_all(client, ADDRESS, "TRADE")
        self.assertEqual(len(rows), pnl.PAGE_LIMIT)
        self.assertFalse(incomplete)
        self.assertEqual(len(api.requests), 1)

    def test_has_more_false_allows_an_omitted_terminal_cursor(self):
        terminal = {"data": [activity(amount="7")], "pagination": {
            "limit": 500, "offset": 0, "has_more": False,
        }}
        api = V2API(pages={("activity", "TRADE"): {None: terminal}})
        with api.client() as client:
            rows, incomplete = pnl.fetch_activity_all(client, ADDRESS, "TRADE")
        self.assertEqual(len(rows), 1)
        self.assertEqual(float(rows[0]["usdcSize"]), 7)
        self.assertFalse(incomplete)
        self.assertEqual(len(api.requests), 1)

    def test_trade_history_can_exceed_the_old_5000_offset_cap(self):
        api = V2API(activities={"TRADE": [activity()] * 6501})
        with api.client() as client:
            rows, incomplete = pnl.fetch_activity_all(client, ADDRESS, "TRADE")
        self.assertEqual(len(rows), 6501)
        self.assertEqual(sum(float(row["usdcSize"]) for row in rows), 6501)
        self.assertFalse(incomplete)
        self.assertGreater(len(api.requests), 6)
        self.assert_v2_contract(api)

    def test_positions_can_exceed_the_old_9500_cap(self):
        api = V2API(positions=[position()] * 10001)
        with api.client() as client:
            result = pnl.compute_address_pnl(client, ADDRESS)
        self.assertEqual(result.open_positions, 10001)
        self.assertEqual(result.unrealized, 2500.25)
        self.assertEqual(result.pnl, 2500.25)
        self.assertTrue(result.complete)
        self.assertFalse(result.positions_truncated)
        self.assert_v2_contract(api)

    def test_leaderboard_paginates_and_keeps_proxy_wallet_row_contract(self):
        rows = [
            {"rank": i + 1, "user_id": f"0x{i:040x}", "user_name": f"user-{i}", "pnl": 2000 - i, "volume": 10000 + i}
            for i in range(1300)
        ]
        api = V2API(leaderboard=rows)
        with api.client() as client:
            result = pnl.fetch_leaderboard(client, 1105)
        self.assertEqual(len(result), 1105)
        self.assertEqual(result[0]["proxyWallet"], rows[0]["user_id"])
        self.assertEqual(result[-1]["proxyWallet"], rows[1104]["user_id"])
        self.assertEqual(float(result[0]["pnl"]), 2000)
        self.assert_v2_contract(api)

    def test_bad_envelopes_are_errors_not_empty_complete_histories(self):
        bad_bodies = [
            [], None, {}, {"data": None}, {"data": {}}, {"data": "bad"},
            {"data": [], "pagination": "bad"},
            {"data": [], "pagination": {"next_cursor": 123}},
            {"data": [], "pagination": {"next_cursor": True}},
            {"data": [], "pagination": {"next_cursor": None}},
            {"data": [], "pagination": {"has_more": True, "next_cursor": None}},
            {"data": [], "pagination": {"has_more": False, "next_cursor": "contradiction"}},
            {"data": [], "pagination": {"has_more": True}},
            {"data": [], "pagination": {"has_more": "false", "next_cursor": None}},
            envelope([None]), envelope([1]), envelope([[]]),
        ]
        for body in bad_bodies:
            with self.subTest(body=body):
                with httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(200, json=body))) as client:
                    with self.assertRaises((ValueError, RuntimeError)):
                        pnl.fetch_activity_all(client, ADDRESS, "TRADE")

    def test_missing_and_invalid_cash_amounts_cannot_become_zero(self):
        for value in ("MISSING", None, "", "bad", "NaN", "Infinity", True, []):
            with self.subTest(value=value):
                row = activity()
                if value == "MISSING":
                    row.pop("usdc_size")
                else:
                    row["usdc_size"] = value
                api = V2API(activities={"TRADE": [row]})
                with api.client() as client:
                    with self.assertRaises((ValueError, RuntimeError)):
                        pnl.compute_address_pnl(client, ADDRESS)

    def test_missing_and_invalid_trade_sides_cannot_disappear_from_cashflow(self):
        for side in ("MISSING", None, "HOLD", 123):
            with self.subTest(side=side):
                row = activity()
                if side == "MISSING":
                    row.pop("side")
                else:
                    row["side"] = side
                api = V2API(activities={"TRADE": [row]})
                with api.client() as client:
                    with self.assertRaises((ValueError, RuntimeError)):
                        pnl.compute_address_pnl(client, ADDRESS)

    def test_non_trade_cashflows_also_require_available_finite_amounts(self):
        for kind in ACTIVITY_TYPES[1:]:
            for value in (None, "NaN"):
                with self.subTest(kind=kind, value=value):
                    api = V2API(activities={kind: [activity(kind, value)]})
                    with api.client() as client:
                        with self.assertRaises((ValueError, RuntimeError)):
                            pnl.compute_address_pnl(client, ADDRESS)

    def test_unhandled_activity_presence_is_flagged_without_inventing_cashflow(self):
        # Presence alone is enough: no cash amount can be assumed for a type
        # whose accounting is not supported by this calculator.
        unknown = {"type": "MIGRATION", "timestamp": 1_700_000_000, "usdc_size": None}
        api = V2API(activities={UNSUPPORTED_TYPES: [unknown] * 50})
        with api.client() as client:
            result = pnl.compute_address_pnl(client, ADDRESS)
        self.assertEqual(result.pnl, 0)
        self.assertEqual(result.pnl_inclusive, 0)
        self.assertFalse(result.complete)
        self.assertTrue(result.data_incomplete_reasons)
        probe_requests = [r for r in api.requests if r.url.params.get("type") == UNSUPPORTED_TYPES]
        self.assertEqual(len(probe_requests), 1, "a presence probe can stop at its first unsupported row")
        self.assertEqual(probe_requests[0].url.params["limit"], "1")
        self.assert_v2_contract(api)

    def test_unhandled_activity_probe_follows_an_empty_page_cursor(self):
        api = V2API(pages={
            ("activity", UNSUPPORTED_TYPES): {
                None: envelope([], "probe-next"),
                "probe-next": envelope([{"type": "YIELD", "timestamp": 1_700_000_000}]),
            },
        })
        with api.client() as client:
            result = pnl.compute_address_pnl(client, ADDRESS)
        self.assertFalse(result.complete)
        self.assertTrue(result.data_incomplete_reasons)
        self.assertEqual(len([r for r in api.requests if r.url.params.get("type") == UNSUPPORTED_TYPES]), 2)

    def test_combo_trade_preserves_amount_but_marks_the_accounting_limit(self):
        api = V2API(activities={"TRADE": [activity(amount="2", is_combo=True)]})
        with api.client() as client:
            result = pnl.compute_address_pnl(client, ADDRESS)
        self.assertEqual(result.total_buy, 2)
        self.assertEqual(result.pnl, -2)
        self.assertEqual(result.trade_count, 1)
        self.assertFalse(result.complete)
        self.assertTrue(result.data_incomplete_reasons)

    def test_combo_only_lifecycle_marks_incomplete_without_adding_cashflow(self):
        # No base activity row carries is_combo. Presence in the separate feed
        # is sufficient; its amounts must not acquire invented accounting rules.
        api = V2API(combos=[{
            "transaction_hash": "0xcombo-only", "timestamp": 1_700_000_000,
            "usdc_size": "9999",
        }])
        with api.client() as client:
            result = pnl.compute_address_pnl(client, ADDRESS)
        self.assertEqual(result.pnl, 0)
        self.assertEqual(result.pnl_inclusive, 0)
        self.assertTrue(all(value == 0 for key, value in asdict(result).items() if key.startswith("total_")))
        self.assertFalse(result.complete)
        self.assertIn("combo_positions_not_replayed", result.data_incomplete_reasons)
        self.assertEqual(len([r for r in api.requests if r.url.path == "/v2/activity/combos"]), 1)
        self.assert_v2_contract(api)

    def test_combo_presence_probe_follows_empty_page_cursor_to_an_event(self):
        api = V2API(pages={
            ("combos", ""): {
                None: envelope([], "combo-next"),
                "combo-next": envelope([{"transaction_hash": "0xcombo-later", "timestamp": 1_700_000_000}]),
            },
        })
        with api.client() as client:
            result = pnl.compute_address_pnl(client, ADDRESS)
        self.assertEqual(result.pnl, 0)
        self.assertEqual(result.pnl_inclusive, 0)
        self.assertFalse(result.complete)
        self.assertIn("combo_positions_not_replayed", result.data_incomplete_reasons)
        combo_requests = [r for r in api.requests if r.url.path == "/v2/activity/combos"]
        self.assertEqual([r.url.params.get("cursor") for r in combo_requests], [None, "combo-next"])
        self.assert_v2_contract(api)

    def test_bad_combo_envelopes_are_not_an_empty_complete_history(self):
        bad_bodies = (
            [], {"data": None},
            {"data": [], "pagination": {"has_more": True, "next_cursor": None}},
        )
        for body in bad_bodies:
            with self.subTest(body=body):
                api = V2API(pages={("combos", ""): {None: body}})
                with api.client() as client:
                    with self.assertRaises((ValueError, RuntimeError)):
                        pnl.compute_address_pnl(client, ADDRESS)
                self.assert_v2_contract(api)

    def test_cyclic_combo_presence_probe_cannot_claim_completeness(self):
        api = V2API(pages={
            ("combos", ""): {
                None: envelope([], "combo-loop"),
                "combo-loop": envelope([], "combo-loop"),
            },
        })
        with api.client() as client:
            result = pnl.compute_address_pnl(client, ADDRESS)
        self.assertEqual(result.pnl, 0)
        self.assertEqual(result.pnl_inclusive, 0)
        self.assertFalse(result.complete)
        self.assertIn("combo_activity_probe_incomplete", result.data_incomplete_reasons)
        combo_requests = [r for r in api.requests if r.url.path == "/v2/activity/combos"]
        self.assertEqual([r.url.params.get("cursor") for r in combo_requests], [None, "combo-loop"])
        self.assert_v2_contract(api)

    def test_missing_and_invalid_position_values_are_unavailable_not_zero(self):
        for field in ("current_size", "current_price"):
            for value in ("MISSING", None, "", "bad", "NaN", "Infinity", True, []):
                with self.subTest(field=field, value=value):
                    row = position()
                    if value == "MISSING":
                        row.pop(field)
                    else:
                        row[field] = value
                    api = V2API(positions=[row])
                    with api.client() as client:
                        with self.assertRaises((ValueError, RuntimeError)):
                            pnl.compute_address_pnl(client, ADDRESS)

    def test_real_zero_amounts_and_prices_are_valid_values(self):
        api = V2API(
            activities={
                "TRADE": [activity(amount=0, size=1, price=0)],
                "REDEEM": [activity("REDEEM", 0)],
            },
            positions=[position(2, 0)],
        )
        with api.client() as client:
            result = pnl.compute_address_pnl(client, ADDRESS)
        self.assertEqual(result.total_buy, 0)
        self.assertEqual(result.total_redeem, 0)
        self.assertEqual(result.unrealized, 0)
        self.assertEqual(result.pnl, 0)
        self.assertEqual(result.trade_count, 1)
        self.assertEqual(result.open_positions, 1)
        self.assertTrue(result.complete)

    @staticmethod
    def cyclic_api():
        return V2API(pages={
            ("activity", "TRADE"): {
                None: envelope([activity(amount="2")], "repeat"),
                "repeat": envelope([activity(amount="3")], "repeat"),
            },
        })

    def test_cyclic_cursor_terminates_and_never_claims_completeness(self):
        api = self.cyclic_api()
        with api.client() as client:
            try:
                _, incomplete = pnl.fetch_activity_all(client, ADDRESS, "TRADE")
            except (ValueError, RuntimeError):
                pass
            else:
                self.assertTrue(incomplete)
        self.assertLessEqual(len(api.requests), 3, "a repeated cursor must be detected before repeated cashflow is accumulated")

    def run_cli(self, api, output_path, address=ADDRESS):
        stdout = io.StringIO()
        exit_code = 0
        argv = ["compute_precise_pnl.py", "--address", address, "--output", str(output_path)]
        with patch.object(sys, "argv", argv), patch.object(
            pnl.pm_http, "create_pm_http_client", side_effect=lambda **kwargs: api.client()
        ), redirect_stdout(stdout):
            try:
                pnl.main()
            except SystemExit as exc:
                exit_code = exc.code
        text = output_path.read_text(encoding="utf-8") if output_path.exists() else ""
        return exit_code, [json.loads(line) for line in text.splitlines() if line.strip()], stdout.getvalue()

    def test_cli_writes_compatible_jsonl_and_lowercases_the_address(self):
        api = golden_api(include_conversion=False)
        with tempfile.TemporaryDirectory() as tmp:
            exit_code, rows, _ = self.run_cli(api, Path(tmp) / "pnl.jsonl", ADDRESS.upper())
        self.assertEqual(exit_code, 0)
        self.assertEqual(len(rows), 1)
        self.assertTrue(PUBLIC_KEYS.issubset(rows[0]))
        self.assertEqual(rows[0]["address"], ADDRESS)
        self.assertEqual(rows[0]["pnl"], 25.25)
        self.assertEqual(rows[0]["pnl_inclusive"], 30.75)
        self.assertTrue(rows[0]["complete"])
        self.assert_v2_contract(api)

    def test_cli_rejects_bad_data_without_a_precise_output_record(self):
        api = V2API(pages={("activity", "TRADE"): {None: {"data": None}}})
        with tempfile.TemporaryDirectory() as tmp:
            exit_code, rows, output = self.run_cli(api, Path(tmp) / "pnl.jsonl")
        self.assertNotEqual(exit_code, 0)
        self.assertEqual(rows, [])
        self.assertIn("failed", output.lower())
        self.assert_v2_contract(api)

    def test_cli_cannot_exit_successfully_with_a_cyclic_partial_history(self):
        api = self.cyclic_api()
        with tempfile.TemporaryDirectory() as tmp:
            exit_code, rows, _ = self.run_cli(api, Path(tmp) / "pnl.jsonl")
        self.assertNotEqual(exit_code, 0)
        self.assertTrue(all(row.get("complete") is False for row in rows))
        self.assertLessEqual(len([r for r in api.requests if r.url.params.get("type") == "TRADE"]), 3)
        self.assert_v2_contract(api)

    def test_benchmark_excludes_incomplete_results_from_both_comparisons(self):
        def result(address, amount, complete):
            values = dict.fromkeys((key for key in PUBLIC_KEYS if key.startswith("total_")), 0.0)
            return pnl.PrecisePnL(
                address=address, pnl=amount, pnl_inclusive=amount, unrealized=0,
                open_positions=0, trade_count=0, computed_at=1, complete=complete,
                pagination_incomplete=not complete,
                pagination_incomplete_types=None if complete else ["TRADE"],
                **values,
            )
        results = [result(ADDRESS, 100, True), result(OTHER_ADDRESS, 1000, False)]
        leaderboard = [{"proxyWallet": ADDRESS, "pnl": 100}, {"proxyWallet": OTHER_ADDRESS, "pnl": 100}]
        local = {ADDRESS: 100, OTHER_ADDRESS: 100}
        stdout = io.StringIO()
        with redirect_stdout(stdout):
            pnl.run_benchmark(results, leaderboard, local)
        output = stdout.getvalue()
        self.assertEqual(output.count("MAPE: 0.0%"), 1)
        self.assertEqual(output.count("<10%: 1/1"), 1)
        self.assertIn("Mean relative difference: 0.0% | compared: 1 (not an accuracy score)", output)
        self.assertIn("different basis", output.lower())
        self.assertIn("incomplete", output.lower())


if __name__ == "__main__":
    unittest.main()
