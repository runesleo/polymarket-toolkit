// 场景：当你需要调用尚未封装进命名函数的公开端点时，复用统一超时与错误处理。
// Problem: 直接 fetch 易漏超时；pmGetJson 提供最小公共层。
// Run: npx tsx examples/14-pm-get-json-raw.ts
// API: pmGetJson — 任意绝对 URL 的 GET JSON。
// Notes: 仅用于 GET；POST 签名下单等不在本工具包范围。

import { GAMMA_API_BASE, pmGetJson } from "../src/index.ts";

const url = new URL(`${GAMMA_API_BASE}/markets`);
url.searchParams.set("limit", "1");
url.searchParams.set("active", "true");
const data = await pmGetJson<unknown[]>(url);
console.log(Array.isArray(data), "keys", data[0] && Object.keys(data[0] as object).slice(0, 6));
