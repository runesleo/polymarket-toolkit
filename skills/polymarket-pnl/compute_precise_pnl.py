#!/usr/bin/env python3
"""Precise Polymarket PnL via Data API cashflow method.

PnL(trading)  = SUM(SELL) + SUM(REDEEM) + SUM(MERGE) + SUM(REBATE)
               - SUM(BUY) - SUM(SPLIT) + unrealized_position_value
PnL(inclusive) = PnL(trading) + REWARD + REFERRAL_REWARD + CONVERSION

The original trading/inclusive formulas are preserved. `unrealized` is the
current value of held positions, not the API's unrealized profit. Completeness
is scoped to API-served data: unsupported economic events and cursor failures
are flagged; this is not a full-chain ledger audit. The v2 all-time leaderboard
is realized-only and is not an accuracy oracle for this marked-value formula.

Usage:
  # Single address
  python compute_precise_pnl.py --address 0x123...

  # Leaderboard Top 50 (auto-fetched)
  python compute_precise_pnl.py --leaderboard 50

  # From an address list (one 0x per line)
  python compute_precise_pnl.py --addresses-file addresses.txt

  # Benchmark mode: compare vs a local PnL JSONL with `address` + `pnl` fields
  python compute_precise_pnl.py --leaderboard 50 --benchmark local_pnl.jsonl
"""

from __future__ import annotations

import argparse
import json
import math
import ssl
import statistics
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable

import httpx

_LIB_DIR = Path(__file__).resolve().parent / "lib"
if str(_LIB_DIR.parent) not in sys.path:
    sys.path.insert(0, str(_LIB_DIR.parent))

from lib.checkpoint import Checkpoint  # noqa: E402
from lib import pm_http  # noqa: E402

# ── Constants ────────────────────────────────────────────────────────

DATA_API = "https://data-api.polymarket.com"
LEADERBOARD_API = f"{DATA_API}/v2/leaderboard"
ACTIVITY_API = f"{DATA_API}/v2/activity"
COMBO_ACTIVITY_API = f"{DATA_API}/v2/activity/combos"
POSITIONS_API = f"{DATA_API}/v2/positions"

PAGE_LIMIT = 500
REQUEST_DELAY = 0.2  # 200ms between requests (rate limit)
REQUEST_TIMEOUT = 20


# ── Data classes ─────────────────────────────────────────────────────


@dataclass
class CashFlow:
    total_buy: float = 0.0
    total_sell: float = 0.0
    total_redeem: float = 0.0
    total_merge: float = 0.0
    total_split: float = 0.0
    total_rebate: float = 0.0
    total_reward: float = 0.0
    total_referral: float = 0.0
    total_conversion: float = 0.0
    trade_count: int = 0
    redeem_count: int = 0
    merge_count: int = 0
    split_count: int = 0
    rebate_count: int = 0
    reward_count: int = 0
    referral_count: int = 0
    conversion_count: int = 0
    buy_count: int = 0
    sell_count: int = 0


@dataclass
class PrecisePnL:
    address: str
    pnl: float  # trading cashflow PnL only (excludes REWARD / REFERRAL / CONVERSION)
    pnl_inclusive: float  # trading PnL + platform credits
    total_buy: float
    total_sell: float
    total_redeem: float
    total_merge: float
    total_split: float
    total_rebate: float
    total_reward: float
    total_referral: float
    total_conversion: float
    unrealized: float
    open_positions: int
    trade_count: int
    computed_at: int  # unix timestamp
    complete: bool = True  # False if any data is incomplete/truncated
    positions_truncated: bool = False  # True if the position cursor walk was cut short
    pagination_incomplete: bool = False  # True if an activity cursor walk was cut short
    pagination_incomplete_types: list[str] | None = None
    data_incomplete_reasons: list[str] | None = None  # Unsupported/unavailable economics


# ── API helpers ──────────────────────────────────────────────────────

MAX_RETRIES = 3
RETRY_BASE_DELAY = 1.0  # seconds
ProgressCallback = Callable[[dict], None]


def _fetch_with_retry(
    client: httpx.Client,
    url: str,
    params: dict,
) -> httpx.Response:
    """GET with exponential backoff retry on transient HTTP and network failures."""
    for attempt in range(MAX_RETRIES):
        try:
            resp = client.get(url, params=params, timeout=REQUEST_TIMEOUT)
            if resp.status_code in {408, 429} or resp.status_code >= 500:
                if attempt < MAX_RETRIES - 1:
                    delay = RETRY_BASE_DELAY * (2 ** attempt)
                    print(f"  ⚠️ {resp.status_code} retry {attempt + 1}/{MAX_RETRIES} in {delay}s", flush=True)
                    time.sleep(delay)
                    continue
            resp.raise_for_status()
            return resp
        except (httpx.RequestError, ssl.SSLError) as e:
            if attempt < MAX_RETRIES - 1:
                delay = RETRY_BASE_DELAY * (2 ** attempt)
                print(f"  ⚠️ {type(e).__name__} retry {attempt + 1}/{MAX_RETRIES} in {delay}s", flush=True)
                time.sleep(delay)
            else:
                raise
    raise RuntimeError(f"Unreachable: max retries exceeded for {url}")


def _number(row: dict, key: str) -> float:
    """Require an available finite amount; v2 null/missing never means zero."""
    value = row.get(key)
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        raise ValueError(f"Unavailable or invalid {key}: {value!r}")
    try:
        number = float(value)
    except (ValueError, OverflowError) as exc:
        raise ValueError(f"Invalid {key}: {value!r}") from exc
    if not math.isfinite(number):
        raise ValueError(f"Non-finite {key}: {value!r}")
    return number


def _fetch_v2_page(client: httpx.Client, url: str, params: dict) -> tuple[list[dict], str | None]:
    body = _fetch_with_retry(client, url, params).json()
    if not isinstance(body, dict) or not isinstance(body.get("data"), list):
        raise ValueError(f"Invalid v2 data envelope from {url}")
    rows = body["data"]
    if any(not isinstance(row, dict) for row in rows):
        raise ValueError(f"Invalid v2 row from {url}")
    pagination = body.get("pagination")
    if not isinstance(pagination, dict):
        raise ValueError(f"Missing v2 pagination from {url}")
    has_more = pagination.get("has_more")
    if type(has_more) is not bool:
        raise ValueError(f"Missing/invalid v2 has_more from {url}")
    # OpenAPI permits omission of next_cursor only at an explicit terminal page.
    if "next_cursor" not in pagination and has_more:
        raise ValueError(f"Missing v2 next_cursor from {url}")
    cursor = pagination.get("next_cursor")
    if cursor is not None and (not isinstance(cursor, str) or not cursor.strip()):
        raise ValueError(f"Invalid v2 next_cursor from {url}")
    if has_more != (cursor is not None):
        raise ValueError(f"Inconsistent v2 pagination from {url}")
    return rows, cursor


def _v2_pages(
    client: httpx.Client,
    url: str,
    params: dict,
    progress_cb: ProgressCallback | None = None,
    *,
    label: str,
    cursor: str | None = None,
    consumed_cursors: set[str] | None = None,
    page: int = 0,
):
    """Walk opaque cursors, retaining identical fills and all short/empty pages."""
    consumed = consumed_cursors if consumed_cursors is not None else set()
    while True:
        query = dict(params)  # Feed cursors do not carry their filters.
        if cursor is not None:
            query["cursor"] = cursor
        rows, next_cursor = _fetch_v2_page(client, url, query)
        if cursor is not None:
            consumed.add(cursor)
        page += 1
        incomplete = next_cursor is not None and next_cursor in consumed
        if progress_cb is not None:
            progress_cb({
                "activity_type": label, "page": page, "rows": len(rows),
                "mode": "cursor", "cursor": cursor,
            })
        # A cycling page may repeat earlier cashflows. Keep only the known prefix.
        yield ([] if incomplete else rows), next_cursor, incomplete
        if incomplete or next_cursor is None:
            return
        cursor = next_cursor
        time.sleep(REQUEST_DELAY)


def _activity_params(address: str, activity_type: str, limit: int | None = None) -> dict:
    return {
        "user": address, "type": activity_type, "start": 1,
        "sort_direction": "ASC", "limit": PAGE_LIMIT if limit is None else limit,
    }


def _activity_row(row: dict, activity_type: str) -> dict:
    if row.get("type") != activity_type:
        raise ValueError(f"Unexpected activity type for {activity_type}: {row.get('type')!r}")
    if activity_type == "TRADE" and row.get("side") not in ("BUY", "SELL"):
        raise ValueError(f"Invalid TRADE side: {row.get('side')!r}")
    mapped = dict(row)  # Keep is_combo and any future provenance fields.
    for source, target in {
        "proxy_wallet": "proxyWallet", "condition_id": "conditionId",
        "transaction_hash": "transactionHash", "token_id": "asset",
        "outcome_index": "outcomeIndex", "event_slug": "eventSlug",
    }.items():
        if source in row:
            mapped[target] = row[source]
    mapped["usdcSize"] = _number(row, "usdc_size")
    return mapped


def fetch_activity_all(
    client: httpx.Client,
    address: str,
    activity_type: str,
    progress_cb: ProgressCallback | None = None,
) -> tuple[list[dict], bool]:
    """Fetch a full v2 activity stream; False means no cursor truncation detected."""
    items: list[dict] = []
    incomplete = False
    for rows, _, incomplete in _v2_pages(
        client, ACTIVITY_API, _activity_params(address, activity_type),
        progress_cb, label=activity_type,
    ):
        items.extend(_activity_row(row, activity_type) for row in rows)
    return items, incomplete


def fetch_activity_all_timestamp(
    client: httpx.Client, address: str, activity_type: str,
    progress_cb: ProgressCallback | None = None,
) -> tuple[list[dict], bool]:
    """Compatibility name; v2 uses lossless cursors, never timestamp subtraction."""
    return fetch_activity_all(client, address, activity_type, progress_cb)


def fetch_activity_all_offset(
    client: httpx.Client, address: str, activity_type: str,
    progress_cb: ProgressCallback | None = None,
) -> tuple[list[dict], bool, bool]:
    """Compatibility name; no offset requests/cap exist in v2."""
    rows, incomplete = fetch_activity_all(client, address, activity_type, progress_cb)
    return rows, incomplete, False


CHECKPOINT_SCHEMA = "data-api-v2-cursor-v1"


def compute_trade_cashflow_with_checkpoint(
    client: httpx.Client,
    address: str,
    *,
    checkpoint: Checkpoint | None = None,
    progress_cb: ProgressCallback | None = None,
) -> dict:
    """Resume TRADE cursor pages; v1 totals/cursors are never reused."""
    address = address.lower()
    try:
        saved = checkpoint.load() if checkpoint is not None else {}
    except (AttributeError, TypeError) as exc:
        raise ValueError("Invalid checkpoint document") from exc
    if not isinstance(saved, dict):
        raise ValueError("Invalid checkpoint state: expected an object")
    compatible = bool(saved) and (
        saved.get("schema") == CHECKPOINT_SCHEMA
        and saved.get("address") == address
        and saved.get("activity_type") == "TRADE"
    )
    if saved and not compatible:
        print("  WARNING: incompatible TRADE checkpoint; restarting from the first v2 page", flush=True)
    state = dict(saved) if compatible else {}
    required = {
        "total_buy", "total_sell", "trade_count", "buy_count", "sell_count",
        "page", "cursor", "consumed_cursors", "done", "pagination_incomplete",
        "data_incomplete_reasons",
    }
    if state and not required.issubset(state):
        raise ValueError("Incomplete v2 TRADE checkpoint state")
    reasons = state.get("data_incomplete_reasons", [])
    if (not isinstance(reasons, list)
            or any(not isinstance(reason, str) or not reason.strip() for reason in reasons)):
        raise ValueError("Invalid checkpoint data_incomplete_reasons")
    totals = {
        "total_buy": _number(state, "total_buy") if state else 0.0,
        "total_sell": _number(state, "total_sell") if state else 0.0,
        "trade_count": state.get("trade_count", 0),
        "buy_count": state.get("buy_count", 0),
        "sell_count": state.get("sell_count", 0),
        "page": state.get("page", 0),
        "pagination_incomplete": state.get("pagination_incomplete", False),
        "data_incomplete_reasons": list(reasons),
        "resumed": compatible,
    }
    for key in ("trade_count", "buy_count", "sell_count", "page"):
        if type(totals[key]) is not int or totals[key] < 0:
            raise ValueError(f"Invalid checkpoint {key}")
    if totals["trade_count"] != totals["buy_count"] + totals["sell_count"]:
        raise ValueError("Inconsistent checkpoint trade counts")
    cursor = state.get("cursor")
    done = state.get("done", False)
    consumed_list = state.get("consumed_cursors", [])
    if (type(done) is not bool or type(totals["pagination_incomplete"]) is not bool
            or not isinstance(consumed_list, list)
            or any(not isinstance(c, str) or not c for c in consumed_list)
            or (cursor is not None and (not isinstance(cursor, str) or not cursor))):
        raise ValueError("Invalid v2 TRADE checkpoint cursor state")
    consumed = set(consumed_list)
    if state and (not done and (cursor is None or cursor in consumed)):
        raise ValueError("Incomplete checkpoint has no valid next cursor")
    if (done and cursor is not None and not totals["pagination_incomplete"]):
        raise ValueError("Terminal checkpoint still has an unconsumed cursor")
    if totals["pagination_incomplete"] and not done:
        raise ValueError("Truncated checkpoint must be terminal")
    if done:
        return totals

    for rows, next_cursor, incomplete in _v2_pages(
        client, ACTIVITY_API, _activity_params(address, "TRADE"),
        progress_cb, label="TRADE", cursor=cursor,
        consumed_cursors=consumed, page=totals["page"],
    ):
        records = [_activity_row(row, "TRADE") for row in rows]
        # Validate the whole page before changing totals or the durable cursor.
        buys = [row for row in records if row["side"] == "BUY"]
        sells = [row for row in records if row["side"] == "SELL"]
        totals["total_buy"] += sum(row["usdcSize"] for row in buys)
        totals["total_sell"] += sum(row["usdcSize"] for row in sells)
        totals["buy_count"] += len(buys)
        totals["sell_count"] += len(sells)
        totals["trade_count"] += len(records)
        totals["page"] += 1
        totals["pagination_incomplete"] |= incomplete
        if any(row.get("is_combo") is True for row in records):
            totals["data_incomplete_reasons"] = ["combo_positions_not_replayed"]
        if checkpoint is not None:
            checkpoint.update(
                schema=CHECKPOINT_SCHEMA, address=address, activity_type="TRADE",
                cursor=next_cursor, consumed_cursors=sorted(consumed),
                done=next_cursor is None or incomplete,
                **{key: value for key, value in totals.items() if key != "resumed"},
            )
            checkpoint.save()
    return totals


def fetch_positions(
    client: httpx.Client,
    address: str,
    progress_cb: ProgressCallback | None = None,
) -> tuple[list[dict], bool]:
    """Fetch OPEN (including unredeemed) positions and preserve the v1 row keys."""
    items: list[dict] = []
    incomplete = False
    params = {
        "user": address, "status": "OPEN", "filter_type": "TOKENS",
        "filter_amount": 0, "include_archived": "true", "limit": PAGE_LIMIT,
    }
    for rows, _, incomplete in _v2_pages(
        client, POSITIONS_API, params, progress_cb, label="POSITIONS",
    ):
        for row in rows:
            size = _number(row, "current_size")
            price = _number(row, "current_price") if size > 0 else 0.0
            if size < 0 or price < 0:
                raise ValueError("Negative current position size/price")
            items.append({**row, "size": size, "curPrice": price})
    return items, incomplete


def fetch_leaderboard(client: httpx.Client, top_n: int) -> list[dict]:
    """Fetch the top N board rows across v2 cursors, retaining proxyWallet."""
    if type(top_n) is not int or top_n <= 0:
        raise ValueError("Leaderboard size must be a positive integer")
    items: list[dict] = []
    params = {
        "time_period": "all", "sort_by": "PNL", "category": "overall",
        "limit": min(top_n, PAGE_LIMIT),
    }
    for rows, _, incomplete in _v2_pages(client, LEADERBOARD_API, params, label="LEADERBOARD"):
        if incomplete:
            raise ValueError("Incomplete leaderboard: repeated cursor")
        for row in rows:
            wallet = row.get("user_id")
            if not isinstance(wallet, str) or not wallet:
                raise ValueError("Unavailable leaderboard user_id")
            mapped = {**row, "proxyWallet": wallet, "userName": row.get("user_name")}
            # Unavailable leaderboard PnL is a missing comparison, never zero.
            mapped["pnl"] = _number(row, "pnl") if row.get("pnl") is not None else None
            items.append(mapped)
            if len(items) == top_n:
                return items
    return items


# Do not invent accounting rules for v2 event types outside the original formula.
UNSUPPORTED_ACTIVITY_TYPES = (
    "MIGRATION", "YIELD", "TAKER_REBATE", "DIRECTIONAL_SPLIT",
    "DIRECTIONAL_MERGE", "THRESHOLD_COMPOSE", "THRESHOLD_DECOMPOSE", "TIP",
)


def _unsupported_activity(client: httpx.Client, address: str) -> list[str]:
    params = _activity_params(address, ",".join(UNSUPPORTED_ACTIVITY_TYPES), 1)
    for rows, _, incomplete in _v2_pages(client, ACTIVITY_API, params, label="UNSUPPORTED"):
        if incomplete:
            return ["unsupported_activity_probe_incomplete"]
        if rows:
            kind = rows[0].get("type")
            if kind not in UNSUPPORTED_ACTIVITY_TYPES:
                raise ValueError(f"Unexpected activity type in unsupported probe: {kind!r}")
            return [f"unsupported_activity:{kind}"]
    return []


def _combo_activity(client: httpx.Client, address: str) -> list[str]:
    # Combo lifecycle events can exist without a base TRADE marked is_combo.
    # This route has no start/sort parameters; presence alone limits coverage.
    params = {"user": address, "limit": 1}
    for rows, _, incomplete in _v2_pages(
        client, COMBO_ACTIVITY_API, params, label="COMBOS",
    ):
        if incomplete:
            return ["combo_activity_probe_incomplete"]
        if rows:
            return ["combo_positions_not_replayed"]
    return []


# ── Core computation ─────────────────────────────────────────────────


def compute_address_pnl(
    client: httpx.Client,
    address: str,
    verbose: bool = False,
    trade_checkpoint: Checkpoint | None = None,
) -> PrecisePnL:
    """Compute precise PnL for a single address via Data API cash flow."""
    addr_short = address[:10]
    any_pagination_incomplete = False
    incomplete_types: list[str] = []
    data_reasons: set[str] = set()

    def emit_progress(event: dict) -> None:
        if not verbose:
            return
        activity_type = event.get("activity_type", "unknown")
        page = event.get("page", "?")
        rows = event.get("rows", "?")
        mode = event.get("mode", "unknown")
        location = f"cursor={event.get('cursor')!r}"
        print(f"  {addr_short}... {activity_type} page={page} rows={rows} mode={mode} {location}", flush=True)

    # 1. Fetch TRADE activity (BUY + SELL)
    if trade_checkpoint is not None:
        trade_totals = compute_trade_cashflow_with_checkpoint(
            client,
            address,
            checkpoint=trade_checkpoint,
            progress_cb=emit_progress,
        )
        data_reasons.update(trade_totals["data_incomplete_reasons"])
        if trade_totals["resumed"]:
            data_reasons.add("resumed_trade_checkpoint_requires_fresh_snapshot")
        pi = bool(trade_totals["pagination_incomplete"])
        any_pagination_incomplete |= pi
        if pi:
            incomplete_types.append("TRADE")
        total_buy = float(trade_totals["total_buy"])
        total_sell = float(trade_totals["total_sell"])
        buy_count = int(trade_totals["buy_count"])
        sell_count = int(trade_totals["sell_count"])
        trade_count = int(trade_totals["trade_count"])
    else:
        trades, pi = fetch_activity_all(client, address, "TRADE", progress_cb=emit_progress)
        any_pagination_incomplete |= pi
        if any(t.get("is_combo") is True for t in trades):
            data_reasons.add("combo_positions_not_replayed")
        if pi:
            incomplete_types.append("TRADE")
        buys = [t for t in trades if t.get("side") == "BUY"]
        sells = [t for t in trades if t.get("side") == "SELL"]
        total_buy = sum(float(t.get("usdcSize", 0)) for t in buys)
        total_sell = sum(float(t.get("usdcSize", 0)) for t in sells)
        buy_count = len(buys)
        sell_count = len(sells)
        trade_count = len(trades)

    if verbose:
        print(f"  {addr_short}... TRADE: {trade_count} ({buy_count} BUY, {sell_count} SELL)", flush=True)

    time.sleep(REQUEST_DELAY)

    # 2. Fetch REDEEM activity
    redeems, pi = fetch_activity_all(client, address, "REDEEM", progress_cb=emit_progress)
    if any(r.get("is_combo") is True for r in redeems):
        data_reasons.add("combo_positions_not_replayed")
    any_pagination_incomplete |= pi
    if pi:
        incomplete_types.append("REDEEM")
    total_redeem = sum(float(r.get("usdcSize", 0)) for r in redeems)

    if verbose:
        print(f"  {addr_short}... REDEEM: {len(redeems)} records, ${total_redeem:,.2f}", flush=True)

    time.sleep(REQUEST_DELAY)

    # 3. Fetch MERGE activity (collateral returned from merging complementary tokens)
    merges, pi = fetch_activity_all(client, address, "MERGE", progress_cb=emit_progress)
    if any(r.get("is_combo") is True for r in merges):
        data_reasons.add("combo_positions_not_replayed")
    any_pagination_incomplete |= pi
    if pi:
        incomplete_types.append("MERGE")
    total_merge = sum(float(r.get("usdcSize", 0)) for r in merges)

    if verbose and merges:
        print(f"  {addr_short}... MERGE: {len(merges)} records, ${total_merge:,.2f}", flush=True)

    time.sleep(REQUEST_DELAY)

    # 4. Fetch SPLIT activity (collateral spent to mint complementary tokens)
    splits, pi = fetch_activity_all(client, address, "SPLIT", progress_cb=emit_progress)
    if any(r.get("is_combo") is True for r in splits):
        data_reasons.add("combo_positions_not_replayed")
    any_pagination_incomplete |= pi
    if pi:
        incomplete_types.append("SPLIT")
    total_split = sum(float(r.get("usdcSize", 0)) for r in splits)

    if verbose and splits:
        print(f"  {addr_short}... SPLIT: {len(splits)} records, ${total_split:,.2f}", flush=True)

    time.sleep(REQUEST_DELAY)

    # 5. Fetch MAKER_REBATE activity
    rebates, pi = fetch_activity_all(client, address, "MAKER_REBATE", progress_cb=emit_progress)
    if any(r.get("is_combo") is True for r in rebates):
        data_reasons.add("combo_positions_not_replayed")
    any_pagination_incomplete |= pi
    if pi:
        incomplete_types.append("MAKER_REBATE")
    total_rebate = sum(float(r.get("usdcSize", 0)) for r in rebates)

    if verbose and rebates:
        print(f"  {addr_short}... REBATE: {len(rebates)} records, ${total_rebate:,.2f}", flush=True)

    time.sleep(REQUEST_DELAY)

    # 5b. Fetch REWARD activity (platform rewards/airdrops — inflow)
    rewards, pi = fetch_activity_all(client, address, "REWARD", progress_cb=emit_progress)
    if any(r.get("is_combo") is True for r in rewards):
        data_reasons.add("combo_positions_not_replayed")
    any_pagination_incomplete |= pi
    if pi:
        incomplete_types.append("REWARD")
    total_reward = sum(float(r.get("usdcSize", 0)) for r in rewards)

    if verbose and rewards:
        print(f"  {addr_short}... REWARD: {len(rewards)} records, ${total_reward:,.2f}", flush=True)

    time.sleep(REQUEST_DELAY)

    # 5c. Fetch REFERRAL_REWARD activity (affiliate referral income — inflow)
    referrals, pi = fetch_activity_all(client, address, "REFERRAL_REWARD", progress_cb=emit_progress)
    if any(r.get("is_combo") is True for r in referrals):
        data_reasons.add("combo_positions_not_replayed")
    any_pagination_incomplete |= pi
    if pi:
        incomplete_types.append("REFERRAL_REWARD")
    total_referral = sum(float(r.get("usdcSize", 0)) for r in referrals)

    if verbose and referrals:
        print(f"  {addr_short}... REFERRAL: {len(referrals)} records, ${total_referral:,.2f}", flush=True)

    time.sleep(REQUEST_DELAY)

    # 5d. Fetch CONVERSION activity (token conversion — inflow)
    conversions, pi = fetch_activity_all(client, address, "CONVERSION", progress_cb=emit_progress)
    if any(r.get("is_combo") is True for r in conversions):
        data_reasons.add("combo_positions_not_replayed")
    any_pagination_incomplete |= pi
    if pi:
        incomplete_types.append("CONVERSION")
    total_conversion = sum(float(r.get("usdcSize", 0)) for r in conversions)
    if conversions:
        data_reasons.add("conversion_collateral_not_fully_represented")
    data_reasons.update(_unsupported_activity(client, address))
    data_reasons.update(_combo_activity(client, address))

    if verbose and conversions:
        print(f"  {addr_short}... CONVERSION: {len(conversions)} records, ${total_conversion:,.2f}", flush=True)

    time.sleep(REQUEST_DELAY)

    # 6. Fetch open positions for unrealized value
    positions, pos_truncated = fetch_positions(client, address, progress_cb=emit_progress)
    unrealized = 0.0
    open_count = 0
    for p in positions:
        size = float(p.get("size", 0))
        cur_price = p["curPrice"]  # Missing positive-position prices were rejected at intake.
        if size > 0:
            unrealized += size * cur_price
            open_count += 1

    # 7. Compute PnL
    # Trading PnL: only trading cash flows
    pnl = (
        total_sell + total_redeem + total_merge + total_rebate
        - total_buy - total_split
        + unrealized
    )
    # Inclusive PnL: trading + platform income (REWARD/REFERRAL/CONVERSION)
    pnl_inclusive = pnl + total_reward + total_referral + total_conversion

    # Completeness flags
    if not all(math.isfinite(value) for value in (pnl, pnl_inclusive, unrealized)):
        raise ValueError("Non-finite PnL aggregate")
    is_complete = not pos_truncated and not any_pagination_incomplete and not data_reasons

    if verbose:
        extras = ""
        if total_reward > 0:
            extras += f" + reward=${total_reward:,.2f}"
        if total_referral > 0:
            extras += f" + referral=${total_referral:,.2f}"
        if total_conversion > 0:
            extras += f" + conversion=${total_conversion:,.2f}"
        flags = ""
        if pos_truncated:
            flags += " [POSITIONS_TRUNCATED]"
        if any_pagination_incomplete:
            flags += " [PAGINATION_INCOMPLETE]"
        if data_reasons:
            flags += " [DATA_INCOMPLETE: " + ", ".join(sorted(data_reasons)) + "]"
        print(
            f"  {addr_short}... PnL: ${pnl:,.2f} (inclusive: ${pnl_inclusive:,.2f})"
            f"  sell=${total_sell:,.2f} + redeem=${total_redeem:,.2f}"
            f" + merge=${total_merge:,.2f} + rebate=${total_rebate:,.2f}{extras}"
            f" - buy=${total_buy:,.2f} - split=${total_split:,.2f}"
            f" + unrealized=${unrealized:,.2f}{flags}"
        , flush=True)

    if trade_checkpoint is not None:
        trade_checkpoint.clear()

    return PrecisePnL(
        address=address,
        pnl=pnl,
        pnl_inclusive=pnl_inclusive,
        total_buy=total_buy,
        total_sell=total_sell,
        total_redeem=total_redeem,
        total_merge=total_merge,
        total_split=total_split,
        total_rebate=total_rebate,
        total_reward=total_reward,
        total_referral=total_referral,
        total_conversion=total_conversion,
        unrealized=unrealized,
        open_positions=open_count,
        trade_count=trade_count,
        computed_at=int(time.time()),
        complete=is_complete,
        positions_truncated=pos_truncated,
        pagination_incomplete=any_pagination_incomplete,
        pagination_incomplete_types=incomplete_types or None,
        data_incomplete_reasons=sorted(data_reasons) or None,
    )


# ── Input sources ────────────────────────────────────────────────────


def load_addresses_from_pool(pool_path: Path) -> list[str]:
    """Load addresses from a JSONL pool file."""
    addresses = []
    with open(pool_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            rec = json.loads(line)
            # Accept `address` or leaderboard-shaped `proxyWallet` rows.
            addr = rec.get("address") or rec.get("proxyWallet") or ""
            if addr:
                addresses.append(addr.lower())
    return addresses


def load_local_pnl_index(path: Path) -> dict[str, float]:
    """Load address → pnl mapping from a JSONL file.

    Accepts `pnl` (documented schema) with `total_pnl` as a legacy fallback.
    """
    index: dict[str, float] = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            rec = json.loads(line)
            addr = rec.get("address", "")
            pnl = rec.get("pnl", rec.get("total_pnl", 0))
            if addr:
                index[addr.lower()] = float(pnl)
    return index


# ── Benchmark ────────────────────────────────────────────────────────


def run_benchmark(
    precise_results: list[PrecisePnL],
    leaderboard: list[dict] | None,
    local_pnl_index: dict[str, float] | None,
) -> None:
    """Compare complete replay rows only; leaderboard is a different PnL basis."""
    incomplete_count = sum(not res.complete for res in precise_results)
    if incomplete_count:
        print(f"\nExcluded {incomplete_count} INCOMPLETE result(s) from benchmark statistics.")
    precise_results = [res for res in precise_results if res.complete]
    if leaderboard:
        lb_by_addr = {
            r["proxyWallet"].lower(): _number(r, "pnl")
            for r in leaderboard if r.get("pnl") is not None
        }

        print("\n" + "=" * 80)
        print("Comparison: Cashflow replay vs v2 all-time leaderboard (realized-only; different basis)")
        print("=" * 80)

        differences = []
        for res in precise_results:
            lb_pnl = lb_by_addr.get(res.address)
            if lb_pnl is None:
                continue
            if abs(lb_pnl) < 1:
                continue
            err = abs(res.pnl - lb_pnl) / abs(lb_pnl)
            differences.append(err)
            print(
                f"  {res.address[:12]}... "
                f"precise=${res.pnl:>12,.2f}  leaderboard=${lb_pnl:>12,.2f}  "
                f"relative_difference={err:.1%}"
            )

        if differences:
            mean_difference = statistics.mean(differences)
            print(f"\n  Mean relative difference: {mean_difference:.1%} | compared: {len(differences)} (not an accuracy score)")

    if local_pnl_index:
        print("\n" + "=" * 80)
        print("Benchmark: Precise PnL vs Local Pipeline")
        print("=" * 80)

        local_errors = []
        for res in precise_results:
            local_pnl = local_pnl_index.get(res.address)
            if local_pnl is None:
                print(f"  -- {res.address[:12]}... not in local index")
                continue
            if abs(res.pnl) < 1:
                continue
            err = abs(local_pnl - res.pnl) / abs(res.pnl)
            local_errors.append(err)
            match = "✅" if err < 0.10 else "⚠️" if err < 0.30 else "❌"
            print(
                f"  {match} {res.address[:12]}... "
                f"local=${local_pnl:>12,.2f}  precise=${res.pnl:>12,.2f}  "
                f"err={err:.1%}"
            )

        if local_errors:
            mape = statistics.mean(local_errors)
            within_10 = sum(1 for e in local_errors if e < 0.10)
            within_30 = sum(1 for e in local_errors if e < 0.30)
            print(f"\n  MAPE: {mape:.1%} | <10%: {within_10}/{len(local_errors)} | <30%: {within_30}/{len(local_errors)}")


# ── Main ─────────────────────────────────────────────────────────────


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Compute precise Polymarket PnL via the Data API cashflow method"
    )
    parser.add_argument("--address", type=str, help="Single 0x address")
    parser.add_argument("--addresses-file", type=Path, help="Text file with one 0x address per line")
    parser.add_argument(
        "--pool", type=Path,
        help="JSONL pool file; each row must contain a `proxyWallet` or `address` field",
    )
    parser.add_argument(
        "--leaderboard", type=int, metavar="N",
        help="Compute for top N addresses on the Polymarket leaderboard",
    )
    parser.add_argument(
        "--benchmark", type=Path, metavar="JSONL",
        help="Local PnL JSONL file (address + pnl fields) for benchmark comparison",
    )
    parser.add_argument(
        "--output", "-o", type=Path,
        default=Path("precise_pnl.jsonl"),
        help="Output JSONL path (default: ./precise_pnl.jsonl)",
    )
    parser.add_argument("--verbose", "-v", action="store_true")

    args = parser.parse_args()

    # Determine addresses to compute
    addresses: list[str] = []
    leaderboard_data: list[dict] | None = None

    client = pm_http.create_pm_http_client(timeout=REQUEST_TIMEOUT)

    if args.address:
        addresses = [args.address.lower()]
    elif args.addresses_file:
        addresses = [
            line.strip().lower()
            for line in args.addresses_file.read_text().splitlines()
            if line.strip() and line.strip().startswith("0x")
        ]
    elif args.pool:
        addresses = load_addresses_from_pool(args.pool)
    elif args.leaderboard:
        print(f"[PrecisePnL] Fetching leaderboard top {args.leaderboard}...")
        leaderboard_data = fetch_leaderboard(client, args.leaderboard)
        addresses = [r["proxyWallet"].lower() for r in leaderboard_data]
        print(f"[PrecisePnL] Got {len(addresses)} addresses from leaderboard")
    else:
        print(
            "Error: no address source specified. "
            "Use --address, --addresses-file, --pool, or --leaderboard"
        )
        sys.exit(1)

    if not addresses:
        print("Error: no addresses to process")
        sys.exit(1)

    # Load local PnL for benchmark comparison
    local_pnl_index: dict[str, float] | None = None
    if args.benchmark and args.benchmark.exists():
        local_pnl_index = load_local_pnl_index(args.benchmark)
        print(f"[PrecisePnL] Loaded {len(local_pnl_index)} local PnL records for benchmark")

    # Compute (stream results to file as we go)
    print(f"\n[PrecisePnL] Computing precise PnL for {len(addresses)} addresses...\n", flush=True)
    results: list[PrecisePnL] = []
    failed: list[str] = []

    args.output.parent.mkdir(parents=True, exist_ok=True)
    out_f = open(args.output, "w", encoding="utf-8")

    for i, addr in enumerate(addresses, 1):
        try:
            print(f"[{i}/{len(addresses)}] {addr[:14]}...", flush=True)
            result = compute_address_pnl(client, addr, verbose=args.verbose)
            results.append(result)
            out_f.write(json.dumps(asdict(result), ensure_ascii=False) + "\n")
            out_f.flush()
            flags = ""
            if not result.complete:
                flags = " ⚠️ INCOMPLETE"
                if result.data_incomplete_reasons:
                    flags += " [" + ",".join(result.data_incomplete_reasons) + "]"
                if result.positions_truncated:
                    flags += " [pos_truncated]"
                if result.pagination_incomplete:
                    flags += " [pagination_incomplete]"
                    if result.pagination_incomplete_types:
                        flags += f"[{','.join(result.pagination_incomplete_types)}]"
            print(
                f"  → PnL: ${result.pnl:>12,.2f}  (inclusive: ${result.pnl_inclusive:>12,.2f})"
                f"  ({result.trade_count} trades, {result.open_positions} open){flags}",
                flush=True,
            )
        except Exception as e:
            print(f"  → ERROR: {e}", flush=True)
            failed.append(addr)
            time.sleep(1)  # back off on error

    out_f.close()
    client.close()

    print(f"\n{'=' * 60}")
    print(f"[PrecisePnL] Done: {len(results)} computed, {len(failed)} failed")
    print(f"[PrecisePnL] Output: {args.output}")

    incomplete = [r for r in results if not r.complete]
    if incomplete:
        print(f"[PrecisePnL] Incomplete: {len(incomplete)} addresses (pagination or economic coverage incomplete)")

    if failed:
        print(f"[PrecisePnL] Failed addresses: {', '.join(a[:12] for a in failed)}")

    # Summary
    if results:
        sorted_by_pnl = sorted((r for r in results if r.complete), key=lambda r: r.pnl, reverse=True)
        print("\n  Rankings include complete results only.")
        print(f"\n  Top 5:")
        for r in sorted_by_pnl[:5]:
            print(f"    {r.address[:14]}...  ${r.pnl:>12,.2f}")
        print(f"\n  Bottom 5:")
        for r in sorted_by_pnl[-5:]:
            print(f"    {r.address[:14]}...  ${r.pnl:>12,.2f}")

    # Benchmark
    if leaderboard_data or local_pnl_index:
        run_benchmark(results, leaderboard_data, local_pnl_index)

    # Exit code: non-zero if any failures or incomplete results
    if failed or incomplete:
        sys.exit(1)


if __name__ == "__main__":
    main()
