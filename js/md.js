// Ross Note's Markdown, read and written exactly as the desktop program does
// (src/ross_note/md.py), so a note can go back and forth between the laptop
// and the tablet without changing.
//
// A note is a list of lines. Each line is one paragraph:
//   { kind: null | "h1".."h6" | "ul" | "ol" | "quote",
//     mark: the list marker from the file when it isn't the plain one ("ul:* ", "ol:  \u0000) "),
//     runs: [{ t, f: Set of b i u s h, href, img: {src, size, orig} }],
//     raw: the line as it was (a line Ross Note can't write back exactly; kept as it was),
//     code: true for code, tables and rules (shown in monospace, always written as typed) }

export const OBJ = "￼";
const ESC_CHARS = "\\*_~=<`#";
const URL_RE = /(?:https?|file|ftp):\/\/[^\s<>\]\["]+|www\.[^\s<>\]\["]+\.[^\s<>\]\["]+|mailto:[^\s<>]+/y;
const DEST = String.raw`((?:[^()\s]|\([^()\s]*\))+)`;      // balanced ( ) in a name: "photo (2).jpg"
const IMG_RE = new RegExp(String.raw`!\[([^\]\n]*)\]\(` + DEST + String.raw`\)`, "y");
const LINK_RE = new RegExp(String.raw`\[([^\]\n]+)\]\(` + DEST + String.raw`\)`, "y");
const LINK_AT = LINK_RE;
const BLOCK_RE = /^(#{1,6})\s+(.*)$|^(\s*)([-*+])(\s+)(.*)$|^(\s*)(\d+)([.)]\s+)(.*)$/s;
const QUOTE_RE = /^>\s?(.*)$/s;
const FENCE_RE = /^\s{0,3}(```|~~~)/;
const LIST_ITEM_RE = /^\s*([-*+]|\d+[.)])\s+\S/;
const RULE_RE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const ALNUM = /[\p{L}\p{N}_]/u;     // Python's isalnum() (and "_" never matters here)

function isalnum(c) { return !!c && /[\p{L}\p{N}]/u.test(c); }

function stickyMatch(re, text, i) {
  re.lastIndex = i;
  return re.exec(text);
}

export function urlSpan(text, i) {
  const m = stickyMatch(URL_RE, text, i);
  if (!m) return null;
  let end = i + m[0].length;
  while (end > i && ".,;:!?'’”".includes(text[end - 1])) end -= 1;
  const span = text.slice(i, end);
  if (text[end - 1] === ")" && (span.match(/\(/g) || []).length < (span.match(/\)/g) || []).length) end -= 1;
  return end;
}

export function hrefOf(url) { return url.startsWith("www.") ? "http://" + url : url; }

// ------------------------------------------------------------------ inline
export function inlineRuns(text) {
  const out = [];
  const state = new Set();
  let buf = [];
  let i = 0;
  const n = text.length;
  const flush = () => {
    if (buf.length) { out.push({ t: buf.join(""), f: new Set(state) }); buf = []; }
  };
  const closes = (marker, start) => text.indexOf(marker, start) !== -1;
  while (i < n) {
    const c = text[i];
    if (c === "!" && text[i + 1] === "[") {
      const m = stickyMatch(IMG_RE, text, i);
      if (m) {
        flush();
        out.push({ t: OBJ, f: new Set(), img: { src: m[2], size: m[1], orig: m[0] } });
        i += m[0].length;
        continue;
      }
    }
    if (c === "[") {
      const m = stickyMatch(LINK_RE, text, i);
      if (m) {
        flush();
        out.push({ t: m[1], f: new Set(state), href: m[2] });
        i += m[0].length;
        continue;
      }
    }
    if ("hfwmH".includes(c) && (i === 0 || !isalnum(text[i - 1]))) {
      const end = urlSpan(text, i);
      if (end) {
        flush();
        const url = text.slice(i, end);
        out.push({ t: url, f: new Set(state), href: hrefOf(url) });
        i = end;
        continue;
      }
    }
    if (c === "\\" && i + 1 < n && (ESC_CHARS + "[").includes(text[i + 1])) {
      buf.push(text[i + 1]);
      i += 2;
      continue;
    }
    const two = text.slice(i, i + 2);
    const low3 = text.slice(i, i + 3).toLowerCase();
    if (low3 === "<u>" && (state.has("u") || closes("</u>", i + 3) || closes("</U>", i + 3))) {
      flush(); state.add("u"); i += 3; continue;
    }
    if (text.slice(i, i + 4).toLowerCase() === "</u>" && state.has("u")) {
      flush(); state.delete("u"); i += 4; continue;
    }
    if (text.slice(i, i + 6).toLowerCase() === "<mark>" && closes("</mark>", i + 6)) {
      flush(); state.add("h"); i += 6; continue;
    }
    if (text.slice(i, i + 7).toLowerCase() === "</mark>" && state.has("h")) {
      flush(); state.delete("h"); i += 7; continue;
    }
    if (two === "**" || two === "__" || two === "~~" || two === "==") {
      const key = { "**": "b", "__": "b", "~~": "s", "==": "h" }[two];
      if (state.has(key) || closes(two, i + 2)) {
        if (two === "__" && !state.has(key) && i > 0 && isalnum(text[i - 1])) {
          buf.push(two); i += 2; continue;
        }
        flush();
        if (state.has(key)) state.delete(key); else state.add(key);
        i += 2;
        continue;
      }
    }
    if ((c === "*" || c === "_") && text.slice(i, i + 2) !== c + c) {
      if (state.has("i") || closes(c, i + 1)) {
        if (c === "_" && !state.has("i") && i > 0 && isalnum(text[i - 1])) { buf.push(c); i += 1; continue; }
        if (c === "_" && state.has("i") && i + 1 < n && isalnum(text[i + 1])) { buf.push(c); i += 1; continue; }
        flush();
        if (state.has("i")) state.delete("i"); else state.add("i");
        i += 1;
        continue;
      }
    }
    buf.push(c);
    i += 1;
  }
  flush();
  return out;
}

// ------------------------------------------------------------------ pictures
// Python's urllib.parse.quote(rel, safe="/._-~()!,'")
export function quotePath(s) {
  let out = "";
  for (const ch of s) {
    if (/[A-Za-z0-9_.\-~/()!,']/.test(ch)) { out += ch; continue; }
    for (const b of new TextEncoder().encode(ch)) out += "%" + b.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

export function unquote(s) {
  try { return decodeURIComponent(s.replace(/%(?![0-9A-Fa-f]{2})/g, "%25")); } catch (e) { return s; }
}

// a picture's src, from a note in folder `dir` (path parts from the notes folder): parts from the top
export function resolvePicture(src, dir) {
  if (/^[a-z]+:\/\//.test(src) && !src.startsWith("file://")) return null;     // on the web
  let p = unquote(src.startsWith("file://") ? src.slice(7) : src);
  if (p.startsWith("/")) return null;                                         // elsewhere on a computer
  const parts = dir.slice();
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") { if (!parts.length) return null; parts.pop(); } else parts.push(seg);
  }
  return parts;
}

export function relativePicture(target, dir) {
  // target, dir: path parts from the notes folder
  let k = 0;
  while (k < dir.length && k < target.length - 1 && dir[k] === target[k]) k++;
  const up = dir.length - k;
  return [...Array(up).fill(".."), ...target.slice(k)].join("/");
}

export function pictureMarkdown(target, size, dir) {
  return "![" + (size || "") + "](" + quotePath(relativePicture(target, dir)) + ")";
}

// ------------------------------------------------------------------ reading a note
export function parse(text) {
  let lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  if (!lines.length) lines = [""];
  const out = [];
  const lists = new ListState();
  let fence = null;
  for (const line of lines) {
    let code = false;
    const fm = FENCE_RE.exec(line);
    if (fence !== null) {
      code = true;
      if (fm && fm[1] === fence) fence = null;
    } else if (fm) {
      fence = fm[1]; code = true;
    } else if (line.trimStart().startsWith("|") ||
               (line.startsWith("    ") || line.startsWith("\t")) && line.trim() && !LIST_ITEM_RE.test(line) ||
               RULE_RE.test(line)) {
      code = true;
    }
    if (code) {
      out.push({ kind: null, runs: [{ t: line, f: new Set() }], raw: line, code: true });
      lists.reset();
      continue;
    }
    const ln = parseLine(line);
    const { number } = lists.step(ln);
    // a line that wouldn't be written back exactly is kept as it was
    if (line.trim() && lineMarkdown(ln, number, { asLoaded: true }) !== line) {
      out.push({ kind: null, runs: [{ t: line, f: new Set() }], raw: line, code: false });
      lists.reset();
    } else {
      delete ln.src;
      out.push(ln);
    }
  }
  return out;
}

function parseLine(line) {
  let m = BLOCK_RE.exec(line);
  let kind = null, body = line, mark = null;
  const q = QUOTE_RE.exec(line);
  if (q) { kind = "quote"; body = q[1]; m = null; }
  if (m) {
    if (m[1]) { kind = "h" + m[1].length; body = m[2]; }
    else if (m[4]) {
      kind = "ul"; body = m[6];
      const prefix = m[3] + m[4] + m[5];
      if (prefix !== "- ") mark = "ul:" + prefix;
    } else {
      kind = "ol"; body = m[10];
      if (m[7] || m[9] !== ". ") mark = "ol:" + m[7] + "\u0000" + m[9];
    }
  }
  return { kind, mark, runs: inlineRuns(body), src: line };
}

export function leadOf(ln) {
  if (!ln.mark) return "";
  const body = ln.mark.slice(3);
  if (ln.kind === "ul") return body.match(/^\s*/)[0];
  return body.split("\u0000")[0];
}

// depth (1, 2, ...) of each list line, and the number of each numbered line,
// worked out as the desktop does (a list per depth; any other line ends them all)
export class ListState {
  constructor() { this.reset(); }
  reset() { this.depths = []; this.lists = new Map(); }
  step(ln) {
    if (!isList(ln) || ln.code || ln.raw != null) { this.reset(); return { depth: 0, number: null }; }
    const width = leadOf(ln).replace(/\t/g, "    ").length;
    const depths = this.depths, lists = this.lists;
    while (depths.length && width < depths[depths.length - 1]) depths.pop();
    if (!depths.length || width > depths[depths.length - 1]) depths.push(width);
    const depth = depths.length;
    for (const key of [...lists.keys()]) if (+key.split("|")[1] > depth) lists.delete(key);
    const key = ln.kind + "|" + depth;
    if (!lists.has(key)) {
      for (const k2 of [...lists.keys()]) if (+k2.split("|")[1] === depth) lists.delete(k2);
      lists.set(key, 0);
    }
    lists.set(key, lists.get(key) + 1);
    return { depth, number: lists.get(key) };
  }
}

export function listLayout(lines) {
  const st = new ListState();
  const depthOf = [], numbers = [];
  for (const ln of lines) {
    const r = st.step(ln);
    depthOf.push(r.depth);
    numbers.push(r.number);
  }
  return { depthOf, numbers };
}

function isList(ln) { return ln.kind === "ul" || ln.kind === "ol"; }
export function listNumbers(lines) { return listLayout(lines).numbers; }

// ------------------------------------------------------------------ writing a note
const OPEN = { b: "**", i: "*", s: "~~", h: "==", u: "<u>" };
const CLOSE = { b: "**", i: "*", s: "~~", h: "==", u: "</u>" };
const ORDER = ["u", "h", "s", "b", "i"];

function escape(t, atStart) {
  let s = "";
  for (let k = 0; k < t.length; k++) {
    const c = t[k];
    if (c === "[" && stickyMatch(LINK_AT, t, k)) s += "\\";
    if ("\\*_~=<`".includes(c)) {
      if ("*_~=".includes(c) || c === "\\" || (c === "<" && /^<\/?(u|mark)>/i.test(t.slice(k, k + 7))) || c === "`") s += "\\";
    }
    s += c;
  }
  if (atStart && (/^#{1,6}\s/.test(s) || /^[-+]\s/.test(s) || /^\d+[.)]\s/.test(s) || s.startsWith(">"))) s = "\\" + s;
  return s;
}

function sameFlags(a, b) {
  if (a.f.size !== b.f.size) return false;
  for (const x of a.f) if (!b.f.has(x)) return false;
  return (a.href || null) === (b.href || null);
}

// opts: { dir: the note's folder (parts), asLoaded }
export function lineMarkdown(ln, number, opts = {}) {
  if (ln.raw != null) {
    const text = ln.runs.map((r) => r.t).join("");
    if (text === ln.raw || ln.code) return text;
  }
  const kind = ln.kind;
  const heading = !!kind && kind[0] === "h";
  const merged = [];
  for (const r0 of ln.runs) {
    if (r0.img) { merged.push(r0); continue; }
    const t = r0.t.replace(/ /g, " ").split(OBJ).join("");
    if (!t) continue;
    const r = { t, f: heading ? new Set([...r0.f].filter((x) => x !== "b")) : r0.f, href: r0.href || null };
    const last = merged[merged.length - 1];
    if (last && !last.img && sameFlags(last, r)) last.t += r.t; else merged.push(r);
  }
  const out = [];
  const openNow = [];
  let pending = "";
  for (const r of merged) {
    if (r.img) {
      while (openNow.length) out.push(CLOSE[openNow.pop()]);
      out.push(pending);
      pending = "";
      out.push(pictureOut(r.img, opts));
      continue;
    }
    const t = r.t;
    const core = t.replace(/^ +| +$/g, "");
    const lead = t.slice(0, t.length - t.replace(/^ +/, "").length);
    const trail = core ? t.slice(t.replace(/ +$/, "").length) : "";
    if (!core) { pending += t; continue; }
    if ([...openNow].some((k) => !r.f.has(k))) {
      while (openNow.length && [...openNow].some((k) => !r.f.has(k))) out.push(CLOSE[openNow.pop()]);
    }
    out.push(pending + lead);
    pending = "";
    for (const k of ORDER) if (r.f.has(k) && !openNow.includes(k)) { out.push(OPEN[k]); openNow.push(k); }
    const link = r.href;
    if (link == null) out.push(escape(core, !out.join("").trim()));
    else if (hrefOf(core) === link && urlSpan(core, 0) === core.length) out.push(core);
    else out.push("[" + escape(core, false).replace(/]/g, "\\]") + "](" + link.replace(/\)/g, "%29").replace(/ /g, "%20") + ")");
    pending = trail;
  }
  while (openNow.length) out.push(CLOSE[openNow.pop()]);
  out.push(pending);
  const body = out.join("");
  const mark = ln.mark;
  if (kind === "quote") return "> " + body;
  if (heading) return "#".repeat(+kind.slice(1)) + " " + body;
  if (kind === "ul") return (mark && mark.startsWith("ul:") ? mark.slice(3) : "- ") + body;
  if (kind === "ol") {
    if (mark && mark.startsWith("ol:")) {
      const [lead, tail] = mark.slice(3).split("\u0000");
      return lead + (number || 1) + tail + body;
    }
    return (number || 1) + ". " + body;
  }
  return body;
}

function pictureOut(img, opts) {
  // as it was in the file, unless its size changed or it no longer points at the picture from here
  if (img.orig && (opts.asLoaded || (!img.changed && (!img.target || !opts.dir ||
      samePath(resolvePicture(img.src, opts.dir), img.target))))) {
    return img.orig;
  }
  if (img.target && opts.dir) return pictureMarkdown(img.target, img.size, opts.dir);
  return "![" + (img.size || "") + "](" + img.src + ")";
}

function samePath(a, b) { return !!a && !!b && a.length === b.length && a.every((x, k) => x === b[k]); }

export function serialize(lines, opts = {}) {
  const numbers = listNumbers(lines);
  const out = lines.map((ln, k) => lineMarkdown(ln, numbers[k], opts));
  while (out.length > 1 && out[out.length - 1] === "") out.pop();
  return out.join("\n") + "\n";
}

// ------------------------------------------------------------------ titles and names
export function titleOf(text, limit = 80) {
  for (const line of text.split("\n")) {
    let s = line.trim();
    const m = BLOCK_RE.exec(s);
    if (m) s = (m[1] ? m[2] : m[4] ? m[6] : m[10]) || "";
    const q = QUOTE_RE.exec(s);
    if (q) s = q[1];
    s = inlineRuns(s).map((r) => r.t).join("").split(OBJ).join("").trim();
    if (s) return s.slice(0, limit);
  }
  return "";
}

export function titleOfLines(lines, limit = 80) {
  for (const ln of lines) {
    const s = ln.runs.map((r) => (r.img ? "" : r.t)).join("").trim();
    if (s) return s.slice(0, limit);
  }
  return "";
}

// store.safe_name
export function safeName(title) {
  let t = (title || "").replace(/[\x00-\x1f/\\:*?"<>|]/g, " ");
  t = t.replace(/\s+/g, " ").trim().replace(/^\.+|\.+$/g, "");
  if (t.length > 80) t = t.slice(0, 80).trimEnd();
  return t || "Untitled";
}

export function longDate(withTime = false) {
  const d = new Date();
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
    "October", "November", "December"];
  let s = `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
  if (withTime) s += ", " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  return s;
}

// a note's Markdown with its title (its first line with words) made a heading (the laptop's notesio.title_as_heading)
const MARKER = /^(#{1,6}\s+|\s*[-*+]\s+|\s*\d+[.)]\s+|>\s?)/;
export function titleAsHeading(text, level) {
  const lines = text.split("\n");
  for (let k = 0; k < lines.length; k++) {
    const line = lines[k];
    if (line.trim()) {
      const body = line.trimStart().startsWith("|") ? line.trim() : line.replace(MARKER, "").trim();
      lines[k] = "#".repeat(Math.max(1, Math.min(6, level))) + " " + body;
      // the note's own headings go down with it (not inside code)
      let fence = null;
      for (let j = k + 1; j < lines.length; j++) {
        const f = FENCE_RE.exec(lines[j]);
        if (fence) { if (f && f[1] === fence) fence = null; continue; }
        if (f) { fence = f[1]; continue; }
        const h = /^(#{1,6})\s/.exec(lines[j]);
        if (h && level > 1) lines[j] = "#".repeat(Math.min(6, h[1].length + level - 1)) + lines[j].slice(h[1].length);
      }
      return lines.slice(k).join("\n").replace(/\n+$/, "") + "\n";
    }
  }
  return "";
}
