import test from "node:test";
import assert from "node:assert/strict";
import { classifyOutboundTransfers, PUSD_ADDRESS, type TransferLog } from "../src/cashflow.ts";

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const SENDER = "0xf418d3a1a941292f9c8707d62a14980c5beb95a3";
/** The CTF Exchange — where trade settlement actually goes. */
const EXCHANGE = "0xe111180000d2663c0091e4f400237545b87b996b";

function topic(address: string): string {
  return `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}`;
}

/** pUSD carries 6 decimals, so $1.00 is 1_000_000 base units. */
function amountData(usd: number): string {
  return `0x${BigInt(Math.round(usd * 1e6)).toString(16)}`;
}

let seq = 0;
function log(to: string, usd: number, block = 100): TransferLog {
  seq += 1;
  return {
    topics: [TRANSFER_TOPIC, topic(SENDER), topic(to)],
    data: amountData(usd),
    blockNumber: `0x${block.toString(16)}`,
    transactionHash: `0xtx${seq}`,
  };
}

test("a transfer to the pUSD contract is a cash-out", () => {
  const result = classifyOutboundTransfers([log(PUSD_ADDRESS, 1500)]);
  assert.equal(result.cashOuts.length, 1);
  assert.equal(result.cashOuts[0]?.amount, 1500);
  assert.equal(result.settlementTransfers, 0);
});

test("a transfer to any other recipient is settlement, not a cash-out", () => {
  const result = classifyOutboundTransfers([log(EXCHANGE, 250.5)]);
  assert.equal(result.cashOuts.length, 0);
  assert.equal(result.settlementTransfers, 1);
  assert.equal(result.settlementVolume, 250.5);
});

test("settlement volume does not leak into the cash-out total", () => {
  // Mirrors a real 7-day sample: a handful of cash-outs buried in thousands of fills.
  const logs = [
    log(EXCHANGE, 100),
    log(PUSD_ADDRESS, 5050),
    log(EXCHANGE, 200),
    log(PUSD_ADDRESS, 1900),
    log(EXCHANGE, 300),
  ];
  const result = classifyOutboundTransfers(logs);
  assert.equal(result.cashOuts.length, 2);
  assert.equal(
    result.cashOuts.reduce((s, c) => s + c.amount, 0),
    6950,
  );
  assert.equal(result.settlementTransfers, 3);
  assert.equal(result.settlementVolume, 600);
});

test("recipient matching is case-insensitive", () => {
  const upper: TransferLog = {
    topics: [TRANSFER_TOPIC, topic(SENDER), topic(PUSD_ADDRESS).toUpperCase().replace("0X", "0x")],
    data: amountData(42),
    blockNumber: "0x1",
    transactionHash: "0xcase",
  };
  const result = classifyOutboundTransfers([upper]);
  assert.equal(result.cashOuts.length, 1, "checksum-cased topics must still match");
});

test("cash-outs come back in block order", () => {
  const result = classifyOutboundTransfers([
    log(PUSD_ADDRESS, 1, 300),
    log(PUSD_ADDRESS, 2, 100),
    log(PUSD_ADDRESS, 3, 200),
  ]);
  assert.deepEqual(
    result.cashOuts.map((c) => c.blockNumber),
    [100, 200, 300],
  );
});

test("a log without a recipient topic is skipped rather than miscounted", () => {
  const malformed: TransferLog = {
    topics: [TRANSFER_TOPIC, topic(SENDER)],
    data: amountData(999),
    blockNumber: "0x1",
    transactionHash: "0xbad",
  };
  const result = classifyOutboundTransfers([malformed]);
  assert.equal(result.cashOuts.length, 0);
  assert.equal(result.settlementTransfers, 0);
  assert.equal(result.settlementVolume, 0);
});
