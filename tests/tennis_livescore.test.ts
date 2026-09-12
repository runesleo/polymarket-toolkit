import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveBreakPoint,
  findLiveMatchForTitle,
  matchesEventTitle,
  overlayFromPayload,
  surnameTokens,
  type LiveTennisMatch,
  type LiveTennisScore,
} from "../src/tennis-livescore.ts";

// ---------------------------------------------------------------------------
// deriveBreakPoint
// ---------------------------------------------------------------------------

function score(points: Array<string | null>, server: 1 | 2 | null, extra: Partial<LiveTennisScore> = {}): LiveTennisScore {
  return { sets: [6, 4], points, server, is_tiebreak: false, ...extra };
}

test("deriveBreakPoint: missing or null score is null, never a guess", () => {
  assert.equal(deriveBreakPoint(undefined), null);
  assert.equal(deriveBreakPoint(null), null);
  assert.equal(deriveBreakPoint({}), null);
  assert.equal(deriveBreakPoint({ points: null, server: 1 }), null);
  assert.equal(deriveBreakPoint({ points: ["40"], server: 1 }), null);
});

test("deriveBreakPoint: null server or a null point is null", () => {
  assert.equal(deriveBreakPoint(score(["30", "40"], null)), null);
  assert.equal(deriveBreakPoint(score([null, "40"], 1)), null);
  assert.equal(deriveBreakPoint(score(["30", null], 1)), null);
});

test("deriveBreakPoint: tiebreak is always null even when the points look like a break point", () => {
  assert.equal(deriveBreakPoint(score(["6", "5"], 1, { is_tiebreak: true })), null);
  assert.equal(deriveBreakPoint(score(["30", "40"], 1, { is_tiebreak: true })), null);
  assert.equal(deriveBreakPoint(score(["AD", "40"], 1, { is_tiebreak: true })), null);
});

test("deriveBreakPoint: receiver at AD is a break point for the receiver", () => {
  assert.equal(deriveBreakPoint(score(["40", "AD"], 1)), 2);
  assert.equal(deriveBreakPoint(score(["AD", "40"], 2)), 1);
});

test("deriveBreakPoint: receiver at 40 vs server at 0/15/30 is a break point for the receiver", () => {
  for (const serverPoint of ["0", "15", "30"]) {
    assert.equal(deriveBreakPoint(score([serverPoint, "40"], 1)), 2, `server 1 at ${serverPoint}`);
    assert.equal(deriveBreakPoint(score(["40", serverPoint], 2)), 1, `server 2 at ${serverPoint}`);
  }
});

test("deriveBreakPoint: deuce (40-40) is not a break point", () => {
  assert.equal(deriveBreakPoint(score(["40", "40"], 1)), null);
  assert.equal(deriveBreakPoint(score(["40", "40"], 2)), null);
});

test("deriveBreakPoint: server at AD is not a break point", () => {
  assert.equal(deriveBreakPoint(score(["AD", "40"], 1)), null);
  assert.equal(deriveBreakPoint(score(["40", "AD"], 2)), null);
});

test("deriveBreakPoint: server ahead or level below 40 is not a break point", () => {
  assert.equal(deriveBreakPoint(score(["40", "30"], 1)), null);
  assert.equal(deriveBreakPoint(score(["15", "15"], 1)), null);
  assert.equal(deriveBreakPoint(score(["0", "30"], 1)), null);
});

// ---------------------------------------------------------------------------
// surname matching
// ---------------------------------------------------------------------------

function live(p1: string, p2: string, rest: Partial<LiveTennisMatch> = {}): LiveTennisMatch {
  return { players: { p1: { name: p1 }, p2: { name: p2 } }, score: null, event_status: null, ...rest };
}

test("surnameTokens: everything after the given name, hyphens split, diacritics folded", () => {
  assert.deepEqual(surnameTokens("Jannik Sinner"), ["sinner"]);
  assert.deepEqual(surnameTokens("Botic van de Zandschulp"), ["van", "de", "zandschulp"]);
  assert.deepEqual(surnameTokens("Pablo Carreño Busta"), ["carreno", "busta"]);
  assert.deepEqual(surnameTokens("Felix Auger-Aliassime"), ["auger", "aliassime"]);
  assert.deepEqual(surnameTokens("Sinner"), ["sinner"]);
  assert.deepEqual(surnameTokens(""), []);
  assert.deepEqual(surnameTokens(null), []);
});

test("matchesEventTitle: both surnames must appear", () => {
  const m = live("Carlos Alcaraz", "Jannik Sinner");
  assert.equal(matchesEventTitle("Alcaraz vs. Sinner", m), true);
  assert.equal(matchesEventTitle("US Open Final: Carlos Alcaraz vs Jannik Sinner", m), true);
  assert.equal(matchesEventTitle("Sinner v. Alcaraz", m), true);
  assert.equal(matchesEventTitle("Alcaraz vs. Djokovic", m), false);
  assert.equal(matchesEventTitle("Will Sinner win the US Open?", m), false);
});

test("matchesEventTitle: substrings are not matches (Lee vs Leech)", () => {
  const lee = live("Hyeon Lee", "Jannik Sinner");
  assert.equal(matchesEventTitle("Leech vs Sinner", lee), false);
  assert.equal(matchesEventTitle("Lee vs Sinner", lee), true);
  const leech = live("Tom Leech", "Jannik Sinner");
  assert.equal(matchesEventTitle("Lee vs Sinner", leech), false);
  assert.equal(matchesEventTitle("Zverev vs Sinner", live("Alexander Zverev", "Jannik Sinnerman")), false);
});

test("matchesEventTitle: same surname on the live side needs two occurrences in the title", () => {
  const brothers = live("Alexander Zverev", "Mischa Zverev");
  assert.equal(matchesEventTitle("Zverev vs Sinner", brothers), false);
  assert.equal(matchesEventTitle("Zverev vs Zverev", brothers), true);
});

test("matchesEventTitle: a conflicting written initial rejects a same-surname player", () => {
  const m = live("Alexander Zverev", "Jannik Sinner");
  assert.equal(matchesEventTitle("M. Zverev vs J. Sinner", m), false);
  assert.equal(matchesEventTitle("A. Zverev vs J. Sinner", m), true);
  // A full first name that differs is left to the reader — titles are free text and the docs say to confirm.
  assert.equal(matchesEventTitle("Zverev vs Sinner", m), true);
});

test("matchesEventTitle: multi-word and hyphenated surnames match as a whole", () => {
  const vdz = live("Botic van de Zandschulp", "Carlos Alcaraz");
  assert.equal(matchesEventTitle("Van de Zandschulp vs. Alcaraz", vdz), true);
  assert.equal(matchesEventTitle("Zandschulp vs. Alcaraz", vdz), false);

  const pcb = live("Pablo Carreno Busta", "Casper Ruud");
  assert.equal(matchesEventTitle("Carreño Busta vs Ruud", pcb), true);
  assert.equal(matchesEventTitle("Busta vs Ruud", pcb), false);

  const faa = live("Felix Auger-Aliassime", "Daniil Medvedev");
  assert.equal(matchesEventTitle("Auger-Aliassime vs Medvedev", faa), true);
  assert.equal(matchesEventTitle("Auger Aliassime vs Medvedev", faa), true);
  assert.equal(matchesEventTitle("Aliassime vs Medvedev", faa), false);
});

test("matchesEventTitle: missing names never match", () => {
  assert.equal(matchesEventTitle("Alcaraz vs Sinner", { players: { p1: { name: "Carlos Alcaraz" } } }), false);
  assert.equal(matchesEventTitle("Alcaraz vs Sinner", { players: { p1: { name: "" }, p2: { name: "Jannik Sinner" } } }), false);
  assert.equal(matchesEventTitle("Alcaraz vs Sinner", {}), false);
  assert.equal(matchesEventTitle("Alcaraz vs Sinner", null), false);
});

test("findLiveMatchForTitle: one candidate is returned, zero or two is null", () => {
  const a = live("Carlos Alcaraz", "Jannik Sinner");
  const b = live("Novak Djokovic", "Casper Ruud");
  assert.equal(findLiveMatchForTitle("Alcaraz vs Sinner", [b, a]), a);
  assert.equal(findLiveMatchForTitle("Alcaraz vs Ruud", [a, b]), null);
  assert.equal(findLiveMatchForTitle("Alcaraz vs Sinner", [a, live("C. Alcaraz", "J. Sinner")]), null);
  assert.equal(findLiveMatchForTitle("Alcaraz vs Sinner", [null, undefined, a]), a);
});

// ---------------------------------------------------------------------------
// overlayFromPayload — the failure path the example prints as "overlay unavailable"
// ---------------------------------------------------------------------------

test("overlayFromPayload: {data:{}} and other non-array data are unavailable, not thrown", () => {
  for (const payload of [{ data: {} }, { data: null }, { data: "x" }, { data: 3 }, {}]) {
    const r = overlayFromPayload(payload, "Alcaraz vs Sinner");
    assert.equal(r.ok, false, JSON.stringify(payload));
    if (!r.ok) assert.match(r.reason, /payload\.data is/);
  }
});

test("overlayFromPayload: non-object bodies are unavailable", () => {
  for (const payload of [null, undefined, "not json", 42, [], [{ data: [] }]]) {
    const r = overlayFromPayload(payload, "Alcaraz vs Sinner");
    assert.equal(r.ok, false, JSON.stringify(payload));
    if (!r.ok) assert.match(r.reason, /payload is/);
  }
});

test("overlayFromPayload: a well-formed body yields the live list and the matched row", () => {
  const a = live("Carlos Alcaraz", "Jannik Sinner", { score: score(["30", "40"], 1) });
  const r = overlayFromPayload({ data: [a, "junk", null, live("Novak Djokovic", "Casper Ruud")] }, "Alcaraz vs. Sinner");
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.live.length, 2);
    assert.equal(r.matched, a);
    assert.equal(deriveBreakPoint(r.matched?.score), 2);
  }
});

test("overlayFromPayload: an empty live list is available with no match", () => {
  const r = overlayFromPayload({ data: [] }, "Alcaraz vs Sinner");
  assert.deepEqual(r, { ok: true, live: [], matched: null });
});
