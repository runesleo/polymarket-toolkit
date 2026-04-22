#!/usr/bin/env python3
"""Precise Polymarket PnL via Data API cashflow method.

PnL(trading)  = SUM(SELL) + SUM(REDEEM) + SUM(MERGE) + SUM(REBATE)
               - SUM(BUY) - SUM(SPLIT) + unrealized_position_value
PnL(inclusive) = PnL(trading) + REWARD + REFERRAL_REWARD + CONVERSION

Note: whether REWARD / REFERRAL_REWARD / CONVERSION are counted by
Polymarket's official /profit endpoint varies per address. The primary
`pnl` field only reflects trading cashflow; `pnl_inclusive` adds all
platform credits for those who want the full picture.

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
LEADERBOARD_API = f"{DATA_API}/v1/leaderboard"
ACTIVITY_API = f"{DATA_API}/activity"
POSITIONS_API = f"{DATA_API}/positions"

PAGE_LIMIT = 500
REQUEST_DELAY = 0.2  # 200ms between requests (rate limit)
REQUEST_TIMEOUT = 20
ACTIVITY_OFFSET_CAP = 9500  # leave margin below undocumented 10k cap


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
    positions_truncated: bool = False  # True if positions hit API cap
    pagination_incomplete: bool = False  # True if same-second overflow detected
    pagination_incomplete_types: list[str] | None = None  # Which activity types hit pagination boundary


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


def fetch_activity_all_timestamp(
    client: httpx.Client,
    address: str,
    activity_type: str,
    progress_cb: ProgressCallback | None = None,
) -> tuple[list[dict], bool]:
    """Fetch activity records with end-timestamp pagination.

    Uses end=<oldest_ts-1> for pagination (exclusive cursor).

    Important: do NOT deduplicate same-tx/same-amount TRADE rows. Maker fills can
    legitimately produce multiple indistinguishable cash-flow records within the
    same second, and collapsing them understates true realized PnL.

    Trade-off: when a full page ends on a second that contains multiple records,
    the Data API cannot be paginated losslessly by timestamp alone. In that case
    we continue with an exclusive cursor and mark the result incomplete.

    Returns:
        (items, pagination_incomplete): items list and whether pagination may have missed records.
    """
    items: list[dict] = []
    end: int | None = None
    page = 0
    pagination_incomplete = False

    def fetch_exact_second(ts: int) -> list[dict] | None:
        """Attempt to fetch all activity rows at an exact second using bounded offset pagination.

        Returns `None` if the API does not appear to support the exact-second query for this address/type.
        """
        exact_items: list[dict] = []
        offset = 0
        seen_pages: set[str] = set()
        while True:
            params = {
                "user": address,
                "type": activity_type,
                "limit": PAGE_LIMIT,
                "start": ts,
                "end": ts,
                "offset": offset,
            }
            resp = _fetch_with_retry(client, ACTIVITY_API, params)
            records = resp.json()
            if not records:
                return exact_items if exact_items else None
            # Some users appear not to support exact-second replay consistently.
            # Treat mixed timestamps as unsupported instead of corrupting pagination.
            if any(r.get("timestamp") != ts for r in records):
                return None
            page_signature = json.dumps(records, sort_keys=True, separators=(",", ":"))
            if page_signature in seen_pages:
                return None
            seen_pages.add(page_signature)
            exact_items.extend(records)
            if len(records) < PAGE_LIMIT:
                return exact_items
            offset += len(records)
            if offset > ACTIVITY_OFFSET_CAP:
                return None
            time.sleep(REQUEST_DELAY)

    while True:
        params: dict = {
            "user": address,
            "type": activity_type,
            "limit": PAGE_LIMIT,
        }
        if end is not None:
            params["end"] = end

        resp = _fetch_with_retry(client, ACTIVITY_API, params)
        records = resp.json()
        if progress_cb is not None:
            progress_cb({
                "activity_type": activity_type,
                "page": page + 1,
                "rows": len(records),
                "mode": "timestamp",
                "boundary_end": end,
            })

        if not records:
            break

        items.extend(records)

        page += 1

        oldest = min(r["timestamp"] for r in records)
        oldest_count = sum(1 for r in records if r["timestamp"] == oldest)

        # Exclusive cursor avoids boundary duplication but means we may miss
        # additional same-second rows if the page filled exactly at the boundary.
        if len(records) == PAGE_LIMIT and oldest_count > 1:
            exact_second_records = fetch_exact_second(oldest)
            if exact_second_records is None:
                print(
                    f"  ⚠️ {activity_type} page boundary has {oldest_count} rows at ts={oldest}; "
                    "exact-second replay unsupported, result may be INCOMPLETE"
                , flush=True)
                pagination_incomplete = True
            elif len(exact_second_records) > oldest_count:
                missing_count = len(exact_second_records) - oldest_count
                print(
                    f"  ⚠️ {activity_type} page boundary at ts={oldest} had {len(exact_second_records)} rows; "
                    f"backfilling {missing_count} same-second records"
                , flush=True)
                seen_boundary = {
                    json.dumps(row, sort_keys=True, separators=(",", ":"))
                    for row in records
                    if row["timestamp"] == oldest
                }
                for row in exact_second_records:
                    if row["timestamp"] != oldest:
                        continue
                    row_key = json.dumps(row, sort_keys=True, separators=(",", ":"))
                    if row_key in seen_boundary:
                        continue
                    items.append(row)
            elif len(exact_second_records) < oldest_count:
                print(
                    f"  ⚠️ {activity_type} exact-second replay returned only {len(exact_second_records)} rows "
                    f"for boundary ts={oldest}; result may be INCOMPLETE"
                , flush=True)
                pagination_incomplete = True

        next_end = oldest - 1
        if next_end < 0:
            break
        end = next_end

        if len(records) < PAGE_LIMIT:
            break

        time.sleep(REQUEST_DELAY)

    return items, pagination_incomplete


def compute_trade_cashflow_with_checkpoint(
    client: httpx.Client,
    address: str,
    *,
    checkpoint: Checkpoint | None = None,
    progress_cb: ProgressCallback | None = None,
) -> dict:
    state = checkpoint.load() if checkpoint is not None else {}
    total_buy = float(state.get("total_buy", 0.0) or 0.0)
    total_sell = float(state.get("total_sell", 0.0) or 0.0)
    trade_count = int(state.get("trade_count", 0) or 0)
    buy_count = int(state.get("buy_count", 0) or 0)
    sell_count = int(state.get("sell_count", 0) or 0)
    page = int(state.get("page", 0) or 0)
    end = state.get("next_end")
    pagination_incomplete = bool(state.get("pagination_incomplete", False))

    if checkpoint is not None and (state.get("address") != address or state.get("activity_type") != "TRADE"):
        total_buy = total_sell = 0.0
        trade_count = buy_count = sell_count = 0
        page = 0
        end = None
        pagination_incomplete = False

    while True:
        params: dict = {
            "user": address,
            "type": "TRADE",
            "limit": PAGE_LIMIT,
        }
        if end is not None:
            params["end"] = end

        resp = _fetch_with_retry(client, ACTIVITY_API, params)
        records = resp.json()
        if progress_cb is not None:
            progress_cb({
                "activity_type": "TRADE",
                "page": page + 1,
                "rows": len(records),
                "mode": "timestamp",
                "boundary_end": end,
            })

        if not records:
            break

        buys = [t for t in records if t.get("side") == "BUY"]
        sells = [t for t in records if t.get("side") == "SELL"]
        total_buy += sum(float(t.get("usdcSize", 0)) for t in buys)
        total_sell += sum(float(t.get("usdcSize", 0)) for t in sells)
        trade_count += len(records)
        buy_count += len(buys)
        sell_count += len(sells)
        page += 1

        oldest = min(r["timestamp"] for r in records)
        oldest_count = sum(1 for r in records if r["timestamp"] == oldest)

        if len(records) == PAGE_LIMIT and oldest_count > 1:
            exact_params = {
                "user": address,
                "type": "TRADE",
                "limit": PAGE_LIMIT,
                "start": oldest,
                "end": oldest,
                "offset": 0,
            }
            exact_resp = _fetch_with_retry(client, ACTIVITY_API, exact_params)
            exact_records = exact_resp.json()
            if exact_records and all(r.get("timestamp") == oldest for r in exact_records):
                seen_boundary = {
                    json.dumps(row, sort_keys=True, separators=(",", ":"))
                    for row in records
                    if row["timestamp"] == oldest
                }
                missing_rows = []
                for row in exact_records:
                    row_key = json.dumps(row, sort_keys=True, separators=(",", ":"))
                    if row_key in seen_boundary:
                        continue
                    missing_rows.append(row)
                if missing_rows:
                    total_buy += sum(float(t.get("usdcSize", 0)) for t in missing_rows if t.get("side") == "BUY")
                    total_sell += sum(float(t.get("usdcSize", 0)) for t in missing_rows if t.get("side") == "SELL")
                    trade_count += len(missing_rows)
                    buy_count += sum(1 for t in missing_rows if t.get("side") == "BUY")
                    sell_count += sum(1 for t in missing_rows if t.get("side") == "SELL")
                    print(
                        f"  ⚠️ TRADE page boundary at ts={oldest} had {len(exact_records)} rows; "
                        f"backfilling {len(missing_rows)} same-second records",
                        flush=True,
                    )
            else:
                print(
                    f"  ⚠️ TRADE page boundary has {oldest_count} rows at ts={oldest}; "
                    "exact-second replay unsupported, result may be INCOMPLETE",
                    flush=True,
                )
                pagination_incomplete = True

        next_end = oldest - 1
        if checkpoint is not None:
            checkpoint.update(
                address=address,
                activity_type="TRADE",
                next_end=next_end,
                total_buy=round(total_buy, 10),
                total_sell=round(total_sell, 10),
                trade_count=trade_count,
                buy_count=buy_count,
                sell_count=sell_count,
                page=page,
                pagination_incomplete=pagination_incomplete,
            )
        if next_end < 0:
            break
        end = next_end

        if len(records) < PAGE_LIMIT:
            break

        time.sleep(REQUEST_DELAY)

    return {
        "total_buy": total_buy,
        "total_sell": total_sell,
        "trade_count": trade_count,
        "buy_count": buy_count,
        "sell_count": sell_count,
        "pagination_incomplete": pagination_incomplete,
        "page": page,
    }


def fetch_activity_all_offset(
    client: httpx.Client,
    address: str,
    activity_type: str,
    progress_cb: ProgressCallback | None = None,
) -> tuple[list[dict], bool, bool]:
    """Fetch activity records with offset pagination.

    This path is preferred when it can complete within the undocumented offset
    cap because it avoids same-second boundary loss.
    """
    items: list[dict] = []
    offset = 0
    pagination_incomplete = False
    hit_cap = False

    while True:
        params = {
            "user": address,
            "type": activity_type,
            "limit": PAGE_LIMIT,
            "offset": offset,
            "sortDirection": "ASC",
        }
        resp = _fetch_with_retry(client, ACTIVITY_API, params)
        records = resp.json()
        if progress_cb is not None:
            progress_cb({
                "activity_type": activity_type,
                "page": (offset // PAGE_LIMIT) + 1,
                "rows": len(records),
                "mode": "offset",
                "offset": offset,
            })
        if not records:
            break

        items.extend(records)

        if len(records) < PAGE_LIMIT:
            break

        offset += len(records)
        if offset >= ACTIVITY_OFFSET_CAP:
            pagination_incomplete = True
            hit_cap = True
            print(f"  ⚠️ {activity_type} offset {offset} hit API cap, result may be INCOMPLETE", flush=True)
            break

        time.sleep(REQUEST_DELAY)

    return items, pagination_incomplete, hit_cap


def fetch_activity_all(
    client: httpx.Client,
    address: str,
    activity_type: str,
    progress_cb: ProgressCallback | None = None,
) -> tuple[list[dict], bool]:
    """Fetch all activity records with the safest pagination mode per type."""
    if activity_type == "TRADE":
        return fetch_activity_all_timestamp(client, address, activity_type, progress_cb=progress_cb)
    items, pagination_incomplete, _ = fetch_activity_all_offset(client, address, activity_type, progress_cb=progress_cb)
    return items, pagination_incomplete


POSITIONS_OFFSET_CAP = 9500  # API cap is 10000, leave margin


def fetch_positions(
    client: httpx.Client,
    address: str,
    progress_cb: ProgressCallback | None = None,
) -> tuple[list[dict], bool]:
    """Fetch all open positions for an address.

    Returns:
        (items, truncated): items list and whether the result was truncated by API cap.
    """
    items: list[dict] = []
    offset = 0
    truncated = False

    while True:
        resp = _fetch_with_retry(client, POSITIONS_API, {
            "user": address,
            "sizeThreshold": 0,
            "limit": PAGE_LIMIT,
            "offset": offset,
        })
        records = resp.json()
        if progress_cb is not None:
            progress_cb({
                "activity_type": "POSITIONS",
                "page": (offset // PAGE_LIMIT) + 1,
                "rows": len(records),
                "mode": "offset",
                "offset": offset,
            })

        if not records:
            break

        items.extend(records)

        if len(records) < PAGE_LIMIT:
            break

        offset += len(records)
        if offset >= POSITIONS_OFFSET_CAP:
            # Was the last page full? If so, there are likely more records
            if len(records) == PAGE_LIMIT:
                truncated = True
                print(f"  ⚠️ positions offset {offset} hit API cap, result is TRUNCATED", flush=True)
            break
        time.sleep(REQUEST_DELAY)

    return items, truncated


def fetch_leaderboard(client: httpx.Client, top_n: int) -> list[dict]:
    """Fetch leaderboard top N."""
    resp = client.get(
        LEADERBOARD_API,
        params={
            "timePeriod": "all",
            "orderBy": "PNL",
            "category": "overall",
            "limit": top_n,
            "offset": 0,
        },
        timeout=REQUEST_TIMEOUT,
    )
    resp.raise_for_status()
    return resp.json()


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

    def emit_progress(event: dict) -> None:
        if not verbose:
            return
        activity_type = event.get("activity_type", "unknown")
        page = event.get("page", "?")
        rows = event.get("rows", "?")
        mode = event.get("mode", "unknown")
        location = f"offset={event['offset']}" if "offset" in event else f"end={event.get('boundary_end')}"
        print(f"  {addr_short}... {activity_type} page={page} rows={rows} mode={mode} {location}", flush=True)

    # 1. Fetch TRADE activity (BUY + SELL)
    if trade_checkpoint is not None:
        trade_totals = compute_trade_cashflow_with_checkpoint(
            client,
            address,
            checkpoint=trade_checkpoint,
            progress_cb=emit_progress,
        )
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
    any_pagination_incomplete |= pi
    if pi:
        incomplete_types.append("REDEEM")
    total_redeem = sum(float(r.get("usdcSize", 0)) for r in redeems)

    if verbose:
        print(f"  {addr_short}... REDEEM: {len(redeems)} records, ${total_redeem:,.2f}", flush=True)

    time.sleep(REQUEST_DELAY)

    # 3. Fetch MERGE activity (collateral returned from merging complementary tokens)
    merges, pi = fetch_activity_all(client, address, "MERGE", progress_cb=emit_progress)
    any_pagination_incomplete |= pi
    if pi:
        incomplete_types.append("MERGE")
    total_merge = sum(float(r.get("usdcSize", 0)) for r in merges)

    if verbose and merges:
        print(f"  {addr_short}... MERGE: {len(merges)} records, ${total_merge:,.2f}", flush=True)

    time.sleep(REQUEST_DELAY)

    # 4. Fetch SPLIT activity (collateral spent to mint complementary tokens)
    splits, pi = fetch_activity_all(client, address, "SPLIT", progress_cb=emit_progress)
    any_pagination_incomplete |= pi
    if pi:
        incomplete_types.append("SPLIT")
    total_split = sum(float(r.get("usdcSize", 0)) for r in splits)

    if verbose and splits:
        print(f"  {addr_short}... SPLIT: {len(splits)} records, ${total_split:,.2f}", flush=True)

    time.sleep(REQUEST_DELAY)

    # 5. Fetch MAKER_REBATE activity
    rebates, pi = fetch_activity_all(client, address, "MAKER_REBATE", progress_cb=emit_progress)
    any_pagination_incomplete |= pi
    if pi:
        incomplete_types.append("MAKER_REBATE")
    total_rebate = sum(float(r.get("usdcSize", 0)) for r in rebates)

    if verbose and rebates:
        print(f"  {addr_short}... REBATE: {len(rebates)} records, ${total_rebate:,.2f}", flush=True)

    time.sleep(REQUEST_DELAY)

    # 5b. Fetch REWARD activity (platform rewards/airdrops — inflow)
    rewards, pi = fetch_activity_all(client, address, "REWARD", progress_cb=emit_progress)
    any_pagination_incomplete |= pi
    if pi:
        incomplete_types.append("REWARD")
    total_reward = sum(float(r.get("usdcSize", 0)) for r in rewards)

    if verbose and rewards:
        print(f"  {addr_short}... REWARD: {len(rewards)} records, ${total_reward:,.2f}", flush=True)

    time.sleep(REQUEST_DELAY)

    # 5c. Fetch REFERRAL_REWARD activity (affiliate referral income — inflow)
    referrals, pi = fetch_activity_all(client, address, "REFERRAL_REWARD", progress_cb=emit_progress)
    any_pagination_incomplete |= pi
    if pi:
        incomplete_types.append("REFERRAL_REWARD")
    total_referral = sum(float(r.get("usdcSize", 0)) for r in referrals)

    if verbose and referrals:
        print(f"  {addr_short}... REFERRAL: {len(referrals)} records, ${total_referral:,.2f}", flush=True)

    time.sleep(REQUEST_DELAY)

    # 5d. Fetch CONVERSION activity (token conversion — inflow)
    conversions, pi = fetch_activity_all(client, address, "CONVERSION", progress_cb=emit_progress)
    any_pagination_incomplete |= pi
    if pi:
        incomplete_types.append("CONVERSION")
    total_conversion = sum(float(r.get("usdcSize", 0)) for r in conversions)

    if verbose and conversions:
        print(f"  {addr_short}... CONVERSION: {len(conversions)} records, ${total_conversion:,.2f}", flush=True)

    time.sleep(REQUEST_DELAY)

    # 6. Fetch open positions for unrealized value
    positions, pos_truncated = fetch_positions(client, address, progress_cb=emit_progress)
    unrealized = 0.0
    open_count = 0
    for p in positions:
        size = float(p.get("size", 0))
        cur_price = float(p.get("curPrice") or 0)  # handle null curPrice
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
    is_complete = not pos_truncated and not any_pagination_incomplete

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
    """Compare precise PnL against leaderboard and/or local pipeline."""
    if leaderboard:
        lb_by_addr = {r["proxyWallet"].lower(): float(r["pnl"]) for r in leaderboard}

        print("\n" + "=" * 80)
        print("Benchmark: Precise PnL vs Leaderboard (official /profit)")
        print("=" * 80)

        errors = []
        for res in precise_results:
            lb_pnl = lb_by_addr.get(res.address)
            if lb_pnl is None:
                continue
            if abs(lb_pnl) < 1:
                continue
            err = abs(res.pnl - lb_pnl) / abs(lb_pnl)
            errors.append(err)
            match = "✅" if err < 0.10 else "⚠️" if err < 0.30 else "❌"
            print(
                f"  {match} {res.address[:12]}... "
                f"precise=${res.pnl:>12,.2f}  leaderboard=${lb_pnl:>12,.2f}  "
                f"err={err:.1%}"
            )

        if errors:
            mape = statistics.mean(errors)
            within_10 = sum(1 for e in errors if e < 0.10)
            within_30 = sum(1 for e in errors if e < 0.30)
            print(f"\n  MAPE: {mape:.1%} | <10%: {within_10}/{len(errors)} | <30%: {within_30}/{len(errors)}")

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
        print(f"[PrecisePnL] Incomplete: {len(incomplete)} addresses (truncated or pagination-incomplete)")

    if failed:
        print(f"[PrecisePnL] Failed addresses: {', '.join(a[:12] for a in failed)}")

    # Summary
    if results:
        sorted_by_pnl = sorted(results, key=lambda r: r.pnl, reverse=True)
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
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
