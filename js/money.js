// Amounts, currencies and dates, written the British way — the same rules as
// the desktop program (money.py): exact decimals (never floating point), and
// amounts rounded to the penny half away from zero.

export const CURRENCIES = {
  GBP: ["£", "Pounds sterling (£)"],
  XCD: ["EC$", "Eastern Caribbean dollars (EC$)"],
  USD: ["US$", "US dollars (US$)"],
  EUR: ["€", "Euros (€)"],
  CAD: ["CA$", "Canadian dollars (CA$)"],
};

const SCALE = 10;                       // decimal places kept in working numbers
const ONE = 10n ** BigInt(SCALE);

// A number written as text ("1,250.50", "0.25", "-5", "") as a BigInt with
// SCALE decimal places.
export function units(x) {
  if (typeof x === "bigint") return x;
  let s = String(x ?? "").trim();
  if (s === "") return 0n;
  let neg = false;
  if (s.startsWith("-") || s.startsWith("−")) { neg = true; s = s.slice(1); }
  s = s.replace(/[^0-9.]/g, "");
  if (s === "" || s === ".") return 0n;
  const [a, b = ""] = s.split(".");
  const frac = (b + "0".repeat(SCALE)).slice(0, SCALE);
  const v = BigInt(a || "0") * ONE + BigInt(frac || "0");
  return neg ? -v : v;
}

// Divide, rounding half away from zero (Python's ROUND_HALF_UP).
function divRound(n, d) {
  const neg = (n < 0n) !== (d < 0n);
  n = n < 0n ? -n : n;
  d = d < 0n ? -d : d;
  let q = n / d;
  if ((n % d) * 2n >= d) q += 1n;
  return neg ? -q : q;
}

// Pence (cents): a BigInt count of hundredths.
export function cents(x) {                    // r2 of a number given as text or units
  return divRound(units(x), ONE / 100n);
}

export function lineAmount(qty, price) {       // r2(quantity × unit price), in pence
  return divRound(units(qty) * units(price), ONE * ONE / 100n);
}

export function taxOf(subCents, rate) {        // r2(subtotal × rate / 100), in pence
  return divRound(subCents * units(rate), ONE * 100n);
}

export function centsToText(c) {              // 1250n -> "12.50" (how amounts are stored)
  c = BigInt(c);
  const neg = c < 0n;
  if (neg) c = -c;
  const s = (c / 100n).toString() + "." + (c % 100n).toString().padStart(2, "0");
  return (neg ? "-" : "") + s;
}

export function symbol(code) {
  return (CURRENCIES[code] || [code + " "])[0];
}

// £2,236.40 (and −£5.00 for a negative amount). a: pence (BigInt) or text.
export function fmt(a, code = "GBP") {
  const c = typeof a === "bigint" ? a : cents(a);
  const neg = c < 0n;
  const abs = neg ? -c : c;
  const whole = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (neg ? "−" : "") + symbol(code) + whole + "." + (abs % 100n).toString().padStart(2, "0");
}

// 5, 1.5, 0.25 — no trailing zeros.
export function fmtQty(q) {
  let v = units(q);
  const neg = v < 0n;
  if (neg) v = -v;
  let s = (v / ONE).toString();
  let f = (v % ONE).toString().padStart(SCALE, "0").replace(/0+$/, "");
  if (f) s += "." + f;
  return (neg && s !== "0" ? "-" : "") + s;
}

// What someone typed in an amount box: "£1,250", "1250.5", "EC$ 40" -> text "1250.5"
export function parseAmount(text) {
  let t = String(text ?? "").replace(/[^0-9.\-]/g, "");
  if (["", "-", ".", "-."].includes(t)) return "0";
  const v = units(t);
  return fmtQty(v);
}

// ----------------------------------------------------------------- dates
export function todayIso() {
  const d = new Date();
  return isoOf(d);
}

export function isoOf(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" +
    String(d.getDate()).padStart(2, "0");
}

export function toDate(s) {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return isNaN(d) ? null : d;
}

export function addDays(iso, n) {
  const d = toDate(iso);
  if (!d) return "";
  d.setDate(d.getDate() + n);
  return isoOf(d);
}

export function daysBetween(a, b) {
  const x = toDate(a), y = toDate(b);
  if (!x || !y) return null;
  return Math.round((y - x) / 86400000);
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
  "October", "November", "December"];

export function longDate(s) {                 // 11 November 2026
  const d = toDate(s);
  return d ? `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : "";
}

export function shortDate(s) {                // 11 Nov 2026
  const d = toDate(s);
  return d ? `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}` : "";
}

// The UK tax year a date falls in, by its first year (6 April 2026 to 5 April 2027 is 2026).
export function taxYearOf(s) {
  const d = toDate(s);
  if (!d) return null;
  const m = d.getMonth() + 1, day = d.getDate();
  return (m > 4 || (m === 4 && day >= 6)) ? d.getFullYear() : d.getFullYear() - 1;
}

export function taxYearLabel(y) {
  return `${y}–${String((y + 1) % 100).padStart(2, "0")}`;
}

export function taxYearSpan(y) {
  return [`${y}-04-06`, `${y + 1}-04-05`];
}
