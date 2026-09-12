/**
 * Tennis live-score helpers behind `examples/23-tennis-event-livescore.ts` — pure functions only.
 *
 * Nothing in this module fetches, logs, or reads the environment. The field names follow the
 * Live Tennis API free tier (`GET /matches?status=live`, https://docs.livetennisapi.com): the
 * live overlay in the example is vendor-authored (the author runs that API), read-only, and
 * never a resolution source.
 */

export type LiveTennisPlayer = { name?: string | null };

export type LiveTennisScore = {
  sets?: number[] | null;
  /** Current-game points per player, e.g. ["40", "AD"]; null entries while the feed has no point. */
  points?: Array<string | null> | null;
  /** Who is serving: 1 or 2; null between games / when unknown. */
  server?: 1 | 2 | null;
  is_tiebreak?: boolean | null;
};

export type LiveTennisMatch = {
  players?: { p1?: LiveTennisPlayer | null; p2?: LiveTennisPlayer | null } | null;
  score?: LiveTennisScore | null;
  event_status?: string | null;
};

export type TennisOverlay =
  | { ok: true; live: LiveTennisMatch[]; matched: LiveTennisMatch | null }
  | { ok: false; reason: string };

const BREAK_POINT_SERVER_POINTS = new Set(["0", "15", "30"]);

/**
 * Which player (1|2) holds a break point, or null.
 *
 * A break point is the receiver at AD, or the receiver at 40 while the server is at 0/15/30.
 * It is never derived in a tiebreak, and never when the score, the server, or either point
 * is missing — a guess here would be worse than silence.
 */
export function deriveBreakPoint(score: LiveTennisScore | null | undefined): 1 | 2 | null {
  if (!score || score.is_tiebreak) return null;
  const server = score.server;
  if (server !== 1 && server !== 2) return null;
  const points = score.points;
  if (!Array.isArray(points) || points.length < 2) return null;
  const receiver: 1 | 2 = server === 1 ? 2 : 1;
  const serverPoint = points[server - 1];
  const receiverPoint = points[receiver - 1];
  if (typeof serverPoint !== "string" || typeof receiverPoint !== "string") return null;
  if (receiverPoint === "AD") return receiver;
  if (receiverPoint === "40" && BREAK_POINT_SERVER_POINTS.has(serverPoint)) return receiver;
  return null;
}

/** Lower-case, strip diacritics, and turn hyphens/apostrophes into spaces so both sides tokenize alike. */
function normalizeName(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[-‐-―'’]/g, " ");
}

type NameToken = { word: string; initial: boolean };

/**
 * Whitespace tokens with punctuation stripped. A token is flagged `initial` when it was written as
 * a single letter followed by a period ("A."), which is the only form we trust as a given-name initial.
 */
function tokenize(text: string): NameToken[] {
  const out: NameToken[] = [];
  for (const raw of normalizeName(text).split(/\s+/)) {
    const word = raw.replace(/[^a-z0-9]/g, "");
    if (!word) continue;
    // "v." is the versus connector ("Zverev v. Sinner"), never an initial.
    out.push({ word, initial: /^[a-z]\.$/.test(raw) && word !== "v" });
  }
  return out;
}

/**
 * Surname tokens of a feed-style full name ("Botic van de Zandschulp" → ["van", "de", "zandschulp"],
 * "Felix Auger-Aliassime" → ["auger", "aliassime"]). The first token is treated as the given name
 * whenever there are at least two; a single-token name is taken as the surname itself.
 */
export function surnameTokens(fullName: string | null | undefined): string[] {
  if (typeof fullName !== "string") return [];
  const words = tokenize(fullName).map((t) => t.word);
  if (words.length <= 1) return words;
  return words.slice(1);
}

function givenNameInitial(fullName: string): string | null {
  const words = tokenize(fullName).map((t) => t.word);
  return words.length >= 2 ? words[0][0] : null;
}

/** Start positions where `needle` occurs as a contiguous whole-word run inside `haystack`. */
function occurrences(haystack: NameToken[], needle: string[]): number[] {
  const hits: number[] = [];
  if (needle.length === 0) return hits;
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j].word !== needle[j]) continue outer;
    }
    hits.push(i);
  }
  return hits;
}

/**
 * Whole-word positions where a player's surname appears in the title. An occurrence written with a
 * conflicting given-name initial ("M. Zverev" against "Alexander Zverev") is not counted; any other
 * preceding word (a full first name, "vs", a tournament) is left alone because titles are free text.
 */
function surnamePositions(title: NameToken[], fullName: string): { start: number; end: number }[] {
  const surname = surnameTokens(fullName);
  const initial = givenNameInitial(fullName);
  const spans: { start: number; end: number }[] = [];
  for (const start of occurrences(title, surname)) {
    const before = start > 0 ? title[start - 1] : null;
    if (before?.initial && initial && before.word !== initial) continue;
    spans.push({ start, end: start + surname.length });
  }
  return spans;
}

/**
 * True when BOTH players' surnames occur in the event title as whole words, at non-overlapping
 * positions. Substrings never count ("Lee" does not match "Leech"); a live match whose two players
 * share a surname needs two separate occurrences in the title.
 */
export function matchesEventTitle(title: string, match: LiveTennisMatch | null | undefined): boolean {
  const p1 = match?.players?.p1?.name;
  const p2 = match?.players?.p2?.name;
  if (typeof p1 !== "string" || typeof p2 !== "string") return false;
  if (surnameTokens(p1).length === 0 || surnameTokens(p2).length === 0) return false;
  const tokens = tokenize(title);
  const spans1 = surnamePositions(tokens, p1);
  const spans2 = surnamePositions(tokens, p2);
  for (const a of spans1) {
    for (const b of spans2) {
      if (a.end <= b.start || b.end <= a.start) return true;
    }
  }
  return false;
}

/**
 * The single live match whose players are both named in the title, or null when none — or more
 * than one — qualifies. Two candidates means the title cannot tell them apart, and a wrong overlay
 * is worse than none.
 */
export function findLiveMatchForTitle(
  title: string,
  matches: ReadonlyArray<LiveTennisMatch | null | undefined>,
): LiveTennisMatch | null {
  let found: LiveTennisMatch | null = null;
  for (const m of matches) {
    if (!matchesEventTitle(title, m)) continue;
    if (found) return null;
    found = m as LiveTennisMatch;
  }
  return found;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Turn an already-parsed `GET /matches?status=live` body into an overlay, or an explicit
 * `unavailable` marker when the body is not shaped like one (`{data:{}}`, a string, null, ...).
 * Never throws; rows that are not objects are dropped rather than trusted.
 */
export function overlayFromPayload(payload: unknown, eventTitle: string): TennisOverlay {
  if (!isRecord(payload)) {
    return { ok: false, reason: `payload is ${payload === null ? "null" : typeof payload}, expected an object` };
  }
  const data = payload.data;
  if (!Array.isArray(data)) {
    return { ok: false, reason: `payload.data is ${data === null ? "null" : typeof data}, expected an array` };
  }
  const live = data.filter(isRecord) as LiveTennisMatch[];
  return { ok: true, live, matched: findLiveMatchForTitle(eventTitle, live) };
}
