// Ross Note's own spelling check (British English), the same dictionary the laptop uses (Debian's
// hunspell-en-gb), as a plain list of every word form: quick to load and to look up on a tablet.
// Your own words live in "Ross Note dictionary.txt" in the RossNotes folder, shared with the laptop.

let words = null;          // Set of every word form
let rank = null;           // Map word -> how common (0 = commonest)
const own = new Set();     // the dictionary file's words
const ignored = new Set(); // "Ignore" (until Ross Note is closed)
let loading = null;

export const ready = () => words !== null;

export function load(base = "vendor/dict/") {
  if (loading) return loading;
  loading = (async () => {
    const [w, c] = await Promise.all([
      fetch(base + "en-GB.words").then((r) => { if (!r.ok) throw new Error("the dictionary couldn't be loaded"); return r.text(); }),
      fetch(base + "en-GB.common").then((r) => (r.ok ? r.text() : "")).catch(() => ""),
    ]);
    const set = new Set();
    let prev = "";
    let i = 0;
    const n = w.length;
    while (i < n) {
      let j = w.indexOf("\n", i);
      if (j < 0) j = n;
      if (j > i) {
        const keep = w.charCodeAt(i) - 48;
        prev = prev.slice(0, keep) + w.slice(i + 1, j);
        set.add(prev);
      }
      i = j + 1;
    }
    words = set;
    rank = new Map();
    c.split("\n").forEach((x, k) => { if (x) rank.set(x, k); });
    return true;
  })();
  loading.catch(() => { loading = null; });
  return loading;
}

const norm = (w) => w.replace(/[’‘]/g, "'");

// the words of a line of text: [start, end, word]
const WORD = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu;
const SKIP = /(?:https?:\/\/|www\.|mailto:)\S+|\S+@\S+\.\S+/g;
export function wordsIn(text) {
  const clean = text.replace(SKIP, (m) => " ".repeat(m.length));
  const out = [];
  for (const m of clean.matchAll(WORD)) out.push([m.index, m.index + m[0].length, m[0]]);
  return out;
}

function known(w) {
  if (words.has(w) || own.has(w)) return true;
  const lower = w.toLowerCase();
  if (own.has(lower)) return true;
  // "Colour" at the start of a sentence; "COLOUR" in capitals
  if (w[0] !== lower[0] && w.slice(1) === lower.slice(1) && words.has(lower)) return true;
  if (w === w.toUpperCase()) {
    if (words.has(lower)) return true;
    const cap = lower[0].toUpperCase() + lower.slice(1);
    if (words.has(cap)) return true;
  }
  return false;
}

export function ok(word) {
  if (!words) return true;
  const w = norm(word);
  if (w.length < 2 || ignored.has(w)) return true;
  if (/^[\p{Lu}]+$/u.test(w) && w.length <= 5) return true;    // initials, acronyms: BBC, NHS
  if (known(w)) return true;
  // a possessive or a contraction of a known word: Ross's, Jacob's
  const m = /^(.+)'s$/i.exec(w);
  if (m && known(m[1])) return true;
  return false;
}

// spelling suggestions, likeliest first
export function suggest(word, max = 6) {
  if (!words) return [];
  const w = norm(word);
  const lower = w.toLowerCase();
  const isCap = w[0] !== lower[0] && w.slice(1) === lower.slice(1);
  const isUpper = w.length > 1 && w === w.toUpperCase();
  const shape = (s) => (isUpper ? s.toUpperCase() : isCap ? s[0].toUpperCase() + s.slice(1) : s);
  const letters = "abcdefghijklmnopqrstuvwxyz'";
  const edits = (s) => {
    const out = new Set();
    for (let i = 0; i <= s.length; i++) {
      const a = s.slice(0, i), b = s.slice(i);
      if (b) out.add(a + b.slice(1));                                    // a letter too many
      if (b.length > 1) out.add(a + b[1] + b[0] + b.slice(2));            // two swapped
      for (const c of letters) {
        if (b) out.add(a + c + b.slice(1));                              // a wrong letter
        out.add(a + c + b);                                              // a letter missing
      }
    }
    // two words run together
    for (let i = 1; i < s.length; i++) out.add(s.slice(0, i) + " " + s.slice(i));
    out.delete(s);
    return out;
  };
  const real = (s) => {
    if (s.includes(" ")) return s.split(" ").every((p) => p.length > 1 && (words.has(p) || own.has(p)) || p === "a" || p === "I");
    return words.has(s) || own.has(s) || words.has(s[0].toUpperCase() + s.slice(1));
  };
  const asIn = (s) => (s.includes(" ") || words.has(s) || own.has(s) ? s : s[0].toUpperCase() + s.slice(1));
  const rankOf = (s) => (rank.has(s) ? rank.get(s) : rank.has(s.toLowerCase()) ? rank.get(s.toLowerCase()) : 40000);
  const score = (s, d) => {
    // two words run together ("alot"): as likely as its rarer word, a little less than a one-word fix
    if (s.includes(" ")) return d * 100000 + Math.max(...s.split(" ").map(rankOf)) + 5000;
    let v = d * 100000 + rankOf(s);
    if (s[0] !== lower[0]) v += 20000;                                  // people rarely get the first letter wrong
    return v;
  };
  const found = new Map();
  const one = edits(lower);
  for (const s of one) if (real(s)) found.set(asIn(s), score(s, 1));
  if (found.size < max && lower.length > 2 && lower.length < 16) {
    for (const s1 of one) {
      if (s1.includes(" ")) continue;
      for (const s of edits(s1)) {
        if (s.includes(" ") || found.has(s) || s === lower) continue;
        if (real(s)) found.set(asIn(s), Math.min(found.get(asIn(s)) ?? Infinity, score(s, 2)));
      }
    }
  }
  return [...found.entries()].sort((a, b) => a[1] - b[1]).slice(0, max).map(([s]) => (/^[\p{Lu}]/u.test(s) ? s : shape(s)));
}

// your own words (from the dictionary file)
export function setOwn(list) {
  own.clear();
  for (const x of list) { const w = norm(x.trim()); if (w) own.add(w); }
}
export const ownWords = () => [...own].sort((a, b) => a.localeCompare(b));
export function addOwn(word) { own.add(norm(word)); }
export function ignore(word) { ignored.add(norm(word)); }
