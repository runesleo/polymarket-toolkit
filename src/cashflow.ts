/**
 * On-chain cash-flow tracking for a Polymarket address.
 *
 * Polymarket balances are denominated in **pUSD** on Polygon. Cashing out unwraps
 * pUSD back into USDC, which appears on-chain as an ERC-20 Transfer whose recipient
 * is the pUSD contract itself. Every other outbound pUSD transfer is trade
 * settlement with a counterparty.
 *
 * Two traps this module exists to remove:
 *
 * 1. Querying USDC or USDC.e returns a zero balance for every Polymarket account,
 *    because the collateral is pUSD. Reading those tokens makes an active trader
 *    look like an empty wallet.
 * 2. Outbound pUSD transfers are dominated by settlement. In one 7-day sample of an
 *    active trader, 19,959 outbound transfers contained only 6 actual cash-outs —
 *    treating all outflow as withdrawal overstates it by more than 30x.
 *
 * Read-only: public RPC, no API key, no signing.
 */

/** pUSD — the collateral token Polymarket balances are denominated in. */
export const PUSD_ADDRESS = "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB";

/** keccak256("Transfer(address,address,uint256)") */
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/**
 * Public Polygon RPC that answers archive log queries without a key.
 * Alternatives observed 2026-08: publicnode requires an archive token, and
 * drpc caps free-tier ranges at 10k blocks.
 */
export const DEFAULT_RPC = "https://polygon.gateway.tenderly.co";

/** Polygon produces roughly one block every 2 seconds. */
const BLOCKS_PER_DAY = 43_200;

/** Stay under the 10k-block ceiling common to free RPC tiers. */
const MAX_BLOCK_SPAN = 9_000;

const PUSD_DECIMALS = 6;

export interface CashOut {
  /** Unix seconds. Absent when the block timestamp could not be fetched. */
  timestamp?: number;
  blockNumber: number;
  transactionHash: string;
  /** pUSD amount, scaled out of base units. */
  amount: number;
}

export interface CashflowReport {
  address: string;
  days: number;
  fromBlock: number;
  toBlock: number;
  /** pUSD unwrapped back to USDC — the actual cash-outs. */
  cashOuts: CashOut[];
  totalCashOut: number;
  /** Outbound transfers that were trade settlement, not cash-out. */
  settlementTransfers: number;
  settlementVolume: number;
  /** Current pUSD balance, when requested. */
  balance?: number;
  /** Set when some block ranges failed; totals are then a lower bound. */
  partial?: boolean;
}

/** Minimal shape of an ERC-20 Transfer log, as returned by eth_getLogs. */
export interface TransferLog {
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
}

export interface ClassifiedTransfers {
  cashOuts: CashOut[];
  settlementTransfers: number;
  settlementVolume: number;
}

/**
 * Splits outbound pUSD transfers into cash-outs and trade settlement.
 *
 * The single rule that separates them: a transfer whose recipient is the pUSD
 * contract itself is an unwrap back to USDC — the cash-out. Everything else went
 * to a counterparty and is settlement. Getting this wrong inflates the reported
 * withdrawal figure by orders of magnitude on any active account.
 */
export function classifyOutboundTransfers(logs: readonly TransferLog[]): ClassifiedTransfers {
  const pusdTopic = toTopicAddress(PUSD_ADDRESS);
  const cashOuts: CashOut[] = [];
  let settlementTransfers = 0;
  let settlementVolume = 0;

  for (const log of logs) {
    const recipient = log.topics[2];
    if (!recipient) continue;
    const amount = scaleAmount(log.data);
    if (recipient.toLowerCase() === pusdTopic) {
      cashOuts.push({
        blockNumber: Number.parseInt(log.blockNumber, 16),
        transactionHash: log.transactionHash,
        amount,
      });
    } else {
      settlementTransfers += 1;
      settlementVolume += amount;
    }
  }

  cashOuts.sort((a, b) => a.blockNumber - b.blockNumber);
  return { cashOuts, settlementTransfers, settlementVolume };
}

async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`RPC ${method} failed: HTTP ${res.status}`);
  const body = (await res.json()) as { result?: T; error?: { message?: string } };
  if (body.error) throw new Error(`RPC ${method} failed: ${body.error.message ?? "unknown error"}`);
  if (body.result === undefined) throw new Error(`RPC ${method} returned no result`);
  return body.result;
}

/** Left-pads an address into the 32-byte form used by indexed log topics. */
function toTopicAddress(address: string): string {
  return `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}`;
}

function scaleAmount(data: string): number {
  return Number(BigInt(data)) / 10 ** PUSD_DECIMALS;
}

export async function fetchLatestBlock(rpcUrl = DEFAULT_RPC): Promise<number> {
  return Number.parseInt(await rpc<string>(rpcUrl, "eth_blockNumber", []), 16);
}

async function fetchBlockTimestamp(rpcUrl: string, blockNumber: number): Promise<number | undefined> {
  try {
    const block = await rpc<{ timestamp: string } | null>(rpcUrl, "eth_getBlockByNumber", [
      `0x${blockNumber.toString(16)}`,
      false,
    ]);
    return block ? Number.parseInt(block.timestamp, 16) : undefined;
  } catch {
    return undefined;
  }
}

/** Current pUSD balance. Zero here is real; a zero USDC balance would not be. */
export async function fetchPusdBalance(address: string, rpcUrl = DEFAULT_RPC): Promise<number> {
  const data = `0x70a08231${"0".repeat(24)}${address.slice(2).toLowerCase()}`;
  const result = await rpc<string>(rpcUrl, "eth_call", [{ to: PUSD_ADDRESS, data }, "latest"]);
  return result && result !== "0x" ? scaleAmount(result) : 0;
}

/**
 * Scans outbound pUSD transfers and separates cash-outs from trade settlement.
 *
 * Timestamps cost one extra RPC call per cash-out. Cash-outs are rare — single
 * digits per week even for very active traders — so they are fetched by default.
 */
export async function fetchCashflow(
  address: string,
  options: {
    days?: number;
    rpcUrl?: string;
    withTimestamps?: boolean;
    withBalance?: boolean;
  } = {},
): Promise<CashflowReport> {
  const { days = 7, rpcUrl = DEFAULT_RPC, withTimestamps = true, withBalance = true } = options;
  const from = address.toLowerCase();
  const toBlock = await fetchLatestBlock(rpcUrl);
  const fromBlock = Math.max(0, toBlock - days * BLOCKS_PER_DAY);

  const collected: TransferLog[] = [];
  let partial = false;

  for (let start = fromBlock; start <= toBlock; start += MAX_BLOCK_SPAN + 1) {
    const end = Math.min(start + MAX_BLOCK_SPAN, toBlock);
    try {
      collected.push(
        ...(await rpc<TransferLog[]>(rpcUrl, "eth_getLogs", [
          {
            fromBlock: `0x${start.toString(16)}`,
            toBlock: `0x${end.toString(16)}`,
            address: PUSD_ADDRESS,
            topics: [TRANSFER_TOPIC, toTopicAddress(from)],
          },
        ])),
      );
    } catch {
      partial = true;
    }
  }

  const { cashOuts, settlementTransfers, settlementVolume } = classifyOutboundTransfers(collected);

  if (withTimestamps) {
    for (const c of cashOuts) {
      c.timestamp = await fetchBlockTimestamp(rpcUrl, c.blockNumber);
    }
  }

  const report: CashflowReport = {
    address: from,
    days,
    fromBlock,
    toBlock,
    cashOuts,
    totalCashOut: cashOuts.reduce((sum, c) => sum + c.amount, 0),
    settlementTransfers,
    settlementVolume,
  };
  if (withBalance) {
    try {
      report.balance = await fetchPusdBalance(from, rpcUrl);
    } catch {
      // Balance is supplementary; a failure here should not void the scan.
    }
  }
  if (partial) report.partial = true;
  return report;
}
