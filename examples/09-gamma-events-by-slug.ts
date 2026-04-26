// 场景：按 event slug 拉 Gamma 元数据（分类、标签、子市场），给前端或报告用。
// Problem: 单市场接口信息分散；events?slug= 聚合父级 event 信息。
// Run: npx tsx examples/09-gamma-events-by-slug.ts
// API: fetchGammaEventsBySlug — GET /events?slug=
// Notes: slug 来自市场对象 events[0].slug 或运营提供的 event 链接。

import { fetchGammaEventsBySlug, fetchGammaMarkets } from "../src/index.ts";

const markets = (await fetchGammaMarkets({ limit: 1, active: true })) as Array<{ events?: Array<{ slug?: string }> }>;
const slug = markets[0]?.events?.[0]?.slug;
if (!slug) throw new Error("No event slug");

const events = (await fetchGammaEventsBySlug(slug)) as Array<{ title?: string; category?: string }>;
console.log("slug:", slug);
console.log(JSON.stringify(events[0], null, 2)?.slice(0, 800));
