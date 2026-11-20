// RossDraft 1.0.2: RTF, read and written.
//
// readRtf(bytes) -> { lines, blockers, look, paras }
//   lines:    wordio lines ({ kind, depth, align, runs: [{ t, f: Set of b i u s h, href }], pageBreak }), as
//             readDocx gives them, so the page shows an RTF document just as it shows a Word one.
//   blockers: what this file holds that RossDraft can't write back faithfully (tables, pictures, footnotes,
//             tracked changes, comments, drawings, embedded objects). Any of these: the document opens read-only.
//   look:     the document's own font, size, spacing and page (the most common in its body), kept when saving.
//   paras:    each paragraph's spacing and indents, with a signature of its words, so an untouched paragraph
//             keeps its own look when the file is written again.
// writeRtf(lines, opts) -> a string of plain ASCII RTF (1.x), readable by Word, LibreOffice, WordPad, TextEdit,
//   WordPerfect and older word processors: Windows-1252 text as \'hh, anything else as \uN with a "?" fallback,
//   lists in the old \pn form with their numbers written out, pictures as PNG or JPEG.

const SKIP = new Set(["info", "header", "headerl", "headerr", "headerf", "footer", "footerl", "footerr", "footerf",
  "listtable", "listoverridetable", "rsidtbl", "generator", "themedata", "colorschememapping", "latentstyles",
  "datastore", "xmlnstbl", "mmathPr", "pgdsctbl", "fonttbl", "colortbl", "stylesheet", "listtext", "pntext",
  "pntxta", "pntxtb", "bkmkstart", "bkmkend", "nonshppict", "fldinst", "xe", "tc", "template", "revtbl",
  "userprops", "docvar", "ftnsep", "ftnsepc", "aftnsep", "aftnsepc", "ftncn", "aftncn", "wgrffmtfilter",
  "passwordhash", "defchp", "defpap", "pgptbl", "protusertbl", "fchars", "lchars", "blipuid", "panose",
  "falt", "fontemb", "fontfile", "objdata", "result", "background", "picprop", "shpinst", "sp", "sn", "sv",
  "atnid", "atnauthor", "atndate", "atnref", "atnparent", "annotation", "footnote", "pict", "object", "shp",
  "shptxt", "do", "pn", "keycode", "ud", "shppict", "shpgrp", "expandedcolortbl", "listpicture"]);
const BLOCK = { trowd: "a table", cell: "a table", pict: "a picture", footnote: "footnotes",
  revised: "tracked changes", deleted: "tracked changes", annotation: "comments", atrfstart: "comments",
  object: "an embedded object", shp: "a drawing", "do": "a drawing" };
const SYMBOL = { emdash: "—", endash: "–", lquote: "‘", rquote: "’", ldblquote: "“", rdblquote: "”",
  bullet: "•", tab: "\t", line: " ", emspace: " ", enspace: " ", qmspace: " ", zwj: "\u200d", zwnj: "\u200c",
  ltrmark: "", rtlmark: "", zwbo: "", zwnbo: "" };

function decoderFor(cp) {
  try { return new TextDecoder(cp === 65001 ? "utf-8" : "windows-" + cp); } catch (e) { return new TextDecoder("windows-1252"); }
}

const most = (m, dflt) => { let best = dflt, n = -1; for (const [k, v] of m) if (v > n) { best = k; n = v; } return best; };
const bump = (m, k, by = 1) => m.set(k, (m.get(k) || 0) + by);

// a paragraph's signature: its kind and words with their marks (as the page gives them back)
export function sigOf(ln) {
  return (ln.kind || "p") + "|" + (ln.runs || []).map((r) => (r.img ? "￼" : [...(r.f || [])].sort().join("") + ":" + (r.t || ""))).join("¦");
}

export function readRtf(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  if (!/^\s*\{\\rtf/.test(s)) throw new Error("this isn't an RTF file");
  let dec = decoderFor(1252);
  const blockers = new Set();
  const fonts = new Map(), styles = new Map();
  const lines = [], paras = [];
  const look = { font: "Times New Roman", fs: 24, paperw: 0, paperh: 0, margl: 0, margr: 0, margt: 0, margb: 0 };
  const fontCount = new Map(), fsCount = new Map();
  let deff = 0;
  const freshPara = () => ({ align: null, fi: 0, li: 0, ri: 0, sb: 0, sa: 0, sl: 0, slmult: 0, style: 0, outline: -1,
    ls: 0, ilvl: 0, pn: null, intbl: false });
  const freshChar = () => ({ b: false, i: false, u: false, s: false, h: false, f: deff, fs: 24 });
  let st = { dest: "body", uc: 1, skip: 0, ch: freshChar(), pa: freshPara(), href: null, field: null, grp: "" };
  const stack = [];
  let runs = [], listText = "", pageNext = false, pendingBytes = [];
  let entry = null;     // the font or style table entry being read

  const flushBytes = () => {
    if (!pendingBytes.length) return;
    const t = dec.decode(new Uint8Array(pendingBytes));
    pendingBytes = [];
    text(t, true);
  };
  function text(t, decoded = false) {
    if (!decoded) flushBytes();
    if (!t) return;
    if (st.skip > 0) {     // the fallback after a \uN
      const n = Math.min(st.skip, t.length);
      st.skip -= n;
      t = t.slice(n);
      if (!t) return;
    }
    if (st.dest === "fonttbl-entry" || st.dest === "style-entry") { if (entry) entry.name += t; return; }
    if (st.dest === "fldinst") { if (st.field) st.field.inst += t; return; }
    if (st.dest === "listtext") { listText += t; return; }
    if (st.dest !== "body") return;
    const c = st.ch;
    const f = new Set();
    if (c.b) f.add("b"); if (c.i) f.add("i"); if (c.u) f.add("u"); if (c.s) f.add("s"); if (c.h) f.add("h");
    const href = st.href || null;
    if (href) f.delete("u");     // a link's underline is its look, not the writer's
    const last = runs[runs.length - 1];
    if (last && last.href === href && [...last.f].sort().join("") === [...f].sort().join("")) last.t += t;
    else runs.push({ t, f, href });
    bump(fontCount, c.f, t.length);
    bump(fsCount, c.fs, t.length);
  }
  function endPara() {
    flushBytes();
    const pa = st.pa;
    let kind = null;
    const sty = styles.get(pa.style);
    const lvl = sty && sty.heading ? sty.heading : pa.outline >= 0 && pa.outline < 6 ? pa.outline + 1 : 0;
    if (lvl) kind = "h" + lvl;
    else if (pa.ls || pa.pn) {
      const lt = listText.replace(/\t/g, "").trim();
      kind = pa.pn === "ol" || (pa.pn !== "ul" && /^[\(\[]?([0-9]+|[a-z]{1,3}|[ivxlc]+)[.)\]]?$/i.test(lt) && /[0-9a-z]/i.test(lt)) ? "ol" : "ul";
    }
    // a list written as plain paragraphs ("•<tab>apple", "1.<tab>first" with a hanging indent), as pandoc does
    if (!kind && runs.length && pa.fi < 0) {
      const m = /^([•·▪◦‣–\-o]|\(?[0-9]{1,3}[.)])	/.exec(runs[0].t);
      if (m) { kind = /[0-9]/.test(m[1]) ? "ol" : "ul"; runs[0].t = runs[0].t.slice(m[0].length); if (!runs[0].t) runs.shift(); }
    }
    // a heading's bold is its style's (as Word's): the page shows it as a heading
    if (lvl) for (const r of runs) r.f.delete("b");
    const ln = { kind, depth: kind === "ul" || kind === "ol" ? (pa.ilvl || 0) + 1 : 1, code: false, align: pa.align, runs };
    if (pageNext) { ln.pageBreak = true; pageNext = false; }
    lines.push(ln);
    paras.push({ sig: sigOf(ln), fi: pa.fi, li: pa.li, ri: pa.ri, sb: pa.sb, sa: pa.sa, sl: pa.sl, slmult: pa.slmult, kind });
    runs = [];
    listText = "";
  }

  const n = s.length;
  let i = 0;
  while (i < n) {
    const c = s[i];
    if (c === "{") {
      flushBytes();
      stack.push(st);
      st = { ...st, ch: { ...st.ch }, pa: st.pa, grp: "", skip: 0, paOwn: false, starred: false };
      if (st.dest === "fonttbl-entry" || st.dest === "style-entry") st.dest = "skip";   // a font's \panose and the like
      // paragraph properties are group-scoped too: copied when first changed (see setPa)
      i++;
      continue;
    }
    if (c === "}") {
      flushBytes();
      if (st.dest === "fonttbl-entry" && entry && !(stack.length && stack[stack.length - 1].dest === "fonttbl-entry")) {
        fonts.set(entry.id, entry.name.replace(/;.*$/s, "").trim()); entry = null;
      }
      if (st.dest === "style-entry" && entry) {
        const nm = entry.name.replace(/;.*$/s, "").trim();
        const m = /^heading\s*([1-6])$/i.exec(nm);
        styles.set(entry.id, { name: nm, heading: m ? +m[1] : entry.outline >= 0 && entry.outline < 6 ? entry.outline + 1 : 0 });
        entry = null;
      }
      const field = st.field, wasField = st.grp === "field";
      st = stack.pop() || st;
      if (wasField && field) st.field = null;
      i++;
      continue;
    }
    if (c === "\r" || c === "\n") { i++; continue; }
    if (c !== "\\") {
      let j = i;
      while (j < n && !"\\{}\r\n".includes(s[j])) j++;
      text(s.slice(i, j));
      i = j;
      continue;
    }
    // a control word or symbol
    const d = s[i + 1];
    if (d === undefined) break;
    if (!/[a-zA-Z]/.test(d)) {
      i += 2;
      if (d === "'") {
        const b = parseInt(s.substr(i, 2), 16);
        i += 2;
        if (st.skip > 0) { st.skip--; continue; }
        if (!isNaN(b)) pendingBytes.push(b);
        continue;
      }
      if (d === "\\" || d === "{" || d === "}") { text(d); continue; }
      if (d === "~") { text("\u00a0"); continue; }
      if (d === "_") { text("\u2011"); continue; }
      if (d === "-") continue;
      if (d === "*") { st.starred = true; continue; }
      if (d === "\r" || d === "\n") { if (st.dest === "body") endPara(); continue; }
      continue;
    }
    let j = i + 1;
    while (j < n && /[a-zA-Z]/.test(s[j])) j++;
    const word = s.slice(i + 1, j);
    let k = j;
    if (s[k] === "-" || /[0-9]/.test(s[k] || "")) { k++; while (k < n && /[0-9]/.test(s[k])) k++; }
    const param = k > j ? parseInt(s.slice(j, k), 10) : null;
    if (s[k] === " ") k++;
    i = k;
    if (word !== "u") flushBytes();
    if (word === "shppict" || word === "shpgrp") blockers.add(word === "shppict" ? "a picture" : "a drawing");
    if (BLOCK[word] && st.dest !== "skip" && !(word === "pict" && st.inNonshp)) blockers.add(BLOCK[word]);
    const setPa = (key, v) => { if (!st.paOwn) { st.pa = { ...st.pa }; st.paOwn = true; } st.pa[key] = v; };
    // destinations
    if (word === "fonttbl") { st.dest = "fonttbl"; continue; }
    if (word === "stylesheet") { st.dest = "stylesheet"; continue; }
    if ((st.dest === "fonttbl" || st.dest === "fonttbl-entry") && word === "f") {
      // one entry after another, in braces or not (TextEdit writes them without)
      if (entry && st.dest === "fonttbl-entry") fonts.set(entry.id, entry.name.replace(/;.*$/s, "").trim());
      st.dest = "fonttbl-entry"; entry = { id: param, name: "" }; continue;
    }
    if (st.dest === "stylesheet" && (word === "s" || word === "cs" || word === "ds" || word === "ts")) {
      st.dest = "style-entry"; entry = { id: word === "s" ? param : -1 - (param || 0), name: "", outline: -1 }; continue;
    }
    if (st.dest === "stylesheet" && word !== "s") { /* the Normal style written without \s0 */ }
    if (st.dest === "style-entry") { if (word === "outlinelevel" && entry) entry.outline = param; continue; }
    if (st.dest === "fonttbl-entry" || st.dest === "fonttbl" || st.dest === "stylesheet") continue;
    if (word === "field") { st.grp = "field"; st.field = { inst: "" }; continue; }
    if (word === "fldinst") { st.dest = "fldinst"; continue; }
    if (word === "fldrslt") {
      st.dest = st.dest === "skip" ? "skip" : "body";
      const m = st.field && /HYPERLINK\s+(?:\\l\s+)?"([^"]+)"/i.exec(st.field.inst);
      if (m) st.href = m[1];
      continue;
    }
    if (word === "listtext" || word === "pntext") { st.dest = st.dest === "skip" ? "skip" : "listtext"; continue; }
    if (word === "nonshppict") { st.dest = "skip"; st.inNonshp = true; continue; }
    if (word === "pn") {
      // the old list form: \pnlvlblt a bullet, \pnlvlbody\pndec numbers (read in the group below)
      st.dest = "pn";
      continue;
    }
    if (st.dest === "pn") {
      if (word === "pnlvlblt") setPaUp("ul");
      else if (word === "pnlvlbody" || word === "pndec" || word === "pnlcltr" || word === "pnucltr" || word === "pnlcrm" || word === "pnucrm") setPaUp("ol");
      continue;
    }
    if (SKIP.has(word) || st.starred && st.dest !== "skip" && !["fldinst", "listtext"].includes(st.dest) && word !== "pn") {
      if (word === "footnote" || word === "annotation") { /* blocker noted above */ }
      st.dest = "skip";
      continue;
    }
    if (st.dest === "skip" || st.dest === "fldinst") continue;
    switch (word) {
      case "ansicpg": dec = decoderFor(param); break;
      case "deff": deff = param || 0; st.ch.f = deff; break;
      case "uc": st.uc = param == null ? 1 : param; break;
      case "u": {
        flushBytes();
        let cp = param < 0 ? param + 65536 : param;
        text(String.fromCharCode(cp), true);
        st.skip = st.uc;
        break;
      }
      case "par": if (st.dest === "body") endPara(); break;
      case "cell": case "nestcell": if (st.dest === "body") text("\t"); break;
      case "row": case "nestrow": if (st.dest === "body") endPara(); break;
      case "sect": case "page": pageNext = true; break;
      case "pagebb": pageNext = true; break;
      case "pard": st.pa = freshPara(); st.paOwn = true; break;
      case "plain": st.ch = freshChar(); break;
      case "b": st.ch.b = param !== 0; break;
      case "i": st.ch.i = param !== 0; break;
      case "ul": case "uld": case "uldb": case "ulw": case "ulth": case "uldash": case "ulwave": st.ch.u = param !== 0; break;
      case "ulnone": st.ch.u = false; break;
      case "strike": case "striked": st.ch.s = param !== 0; break;
      case "highlight": st.ch.h = !!param; break;
      case "f": st.ch.f = param; break;
      case "fs": st.ch.fs = param; break;
      case "ql": setPa("align", null); break;
      case "qc": setPa("align", "center"); break;
      case "qr": setPa("align", "right"); break;
      case "qj": case "qd": setPa("align", "justify"); break;
      case "fi": case "li": case "ri": case "sb": case "sa": case "sl": case "slmult": setPa(word, param || 0); break;
      case "s": setPa("style", param || 0); break;
      case "outlinelevel": setPa("outline", param); break;
      case "ls": setPa("ls", param || 0); break;
      case "ilvl": setPa("ilvl", param || 0); break;
      case "intbl": setPa("intbl", true); break;
      case "paperw": case "paperh": case "margl": case "margr": case "margt": case "margb": look[word] = param || 0; break;
      default: {
        const sym = SYMBOL[word];
        if (sym !== undefined && st.dest === "body") text(sym);
        else if (sym !== undefined && st.dest === "listtext") listText += sym;
      }
    }
  }
  function setPaUp(kind) {
    // a \pn group sets its paragraph's list (the group around it holds the paragraph's properties)
    const up = stack[stack.length - 1];
    if (up) { if (!up.paOwn) { up.pa = { ...up.pa }; up.paOwn = true; } up.pa.pn = kind; }
  }
  flushBytes();
  if (runs.length && runs.some((r) => r.t.trim())) endPara();
  // the look: the body's commonest font and size, and its paragraphs' commonest spacing
  look.font = fonts.get(most(fontCount, deff)) || fonts.get(deff) || look.font;
  look.fs = most(fsCount, 24) || 24;
  const body = paras.filter((p) => !p.kind);
  for (const key of ["fi", "sb", "sa", "sl", "slmult"]) {
    const m = new Map();
    for (const p of body) bump(m, p[key]);
    look[key] = most(m, 0);
  }
  return { lines, blockers: [...blockers], look, paras };
}

// ================================================================ writing
const HEAD_PT = { 1: 20, 2: 16, 3: 14, 4: 12, 5: 12, 6: 12 };
let CP1252 = null;
function cp1252() {
  if (CP1252) return CP1252;
  CP1252 = new Map();
  const dec = new TextDecoder("windows-1252");
  for (let b = 0x80; b <= 0xff; b++) {
    const ch = dec.decode(new Uint8Array([b]));
    if (ch && ch !== "\ufffd" && !CP1252.has(ch)) CP1252.set(ch, b);
  }
  return CP1252;
}

export function esc(t) {
  const map = cp1252();
  let out = "";
  for (const ch of t) {
    const c = ch.codePointAt(0);
    if (ch === "\\" || ch === "{" || ch === "}") out += "\\" + ch;
    else if (ch === "\t") out += "\\tab ";
    else if (ch === "\n") out += "\\line ";
    else if (ch === "\u00a0") out += "\\~";
    else if (c < 0x80) out += ch;
    else if (map.has(ch)) out += "\\'" + map.get(ch).toString(16).padStart(2, "0");
    else if (c > 0xffff) {
      const hi = 0xd800 + ((c - 0x10000) >> 10), lo = 0xdc00 + ((c - 0x10000) & 0x3ff);
      out += "\\u" + (hi - 65536) + "?\\u" + (lo - 65536) + "?";
    } else out += "\\u" + (c > 32767 ? c - 65536 : c) + "?";
  }
  return out;
}

function hex(u8) {
  let out = "";
  for (let k = 0; k < u8.length; k++) {
    out += (u8[k] < 16 ? "0" : "") + u8[k].toString(16);
    if (k % 64 === 63) out += "\n";
  }
  return out;
}

function pngSize(b) {
  if (b[0] === 0x89 && b[1] === 0x50) return [(b[16] << 24 | b[17] << 16 | b[18] << 8 | b[19]) >>> 0, (b[20] << 24 | b[21] << 16 | b[22] << 8 | b[23]) >>> 0];
  if (b[0] === 0xff && b[1] === 0xd8) {
    let p = 2;
    while (p < b.length) {
      if (b[p] !== 0xff) { p++; continue; }
      const m = b[p + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return [b[p + 7] << 8 | b[p + 8], b[p + 5] << 8 | b[p + 6]];
      p += 2 + (b[p + 2] << 8 | b[p + 3]);
    }
  }
  return null;
}

// opts: { look (readRtf's, or none for the standard one), indent (twips: body paragraphs' first line, not
//   noIndent ones), justify, header (text before the page number, top right), footer ("page", centred),
//   titlePage (nothing at the top or foot of page 1), headingsPlain (the manuscript look), paras (readRtf's, for untouched paragraphs' own
//   spacing), pictureBytes: async img -> Uint8Array | null, title }
export async function writeRtf(lines, opts = {}) {
  const look = Object.assign({ font: "Times New Roman", fs: 24, fi: 0, sb: 0, sa: 0, sl: 276, slmult: 1,
    paperw: 11906, paperh: 16838, margl: 1440, margr: 1440, margt: 1440, margb: 1440 }, opts.look || {});
  for (const k of ["paperw", "paperh", "margl", "margr", "margt", "margb"]) if (!look[k]) look[k] = { paperw: 11906, paperh: 16838 }[k] || 1440;
  const out = [];
  out.push("{\\rtf1\\ansi\\ansicpg1252\\deff0\\deflang2057\\uc1\n");
  out.push(`{\\fonttbl{\\f0\\froman\\fcharset0 ${esc(look.font)};}{\\f1\\fnil\\fcharset2 Symbol;}{\\f2\\fmodern\\fcharset0 Courier New;}}\n`);
  out.push("{\\colortbl;\\red0\\green0\\blue0;\\red255\\green255\\blue0;\\red26\\green95\\blue180;}\n");
  let sheet = `{\\stylesheet{\\f0\\fs${look.fs} Normal;}`;
  for (let k = 1; k <= 6; k++) sheet += `{\\s${k}\\sb${k < 3 ? 240 : 160}\\sa80\\keepn\\outlinelevel${k - 1}\\b\\f0\\fs${HEAD_PT[k] * 2}\\sbasedon0\\snext0 heading ${k};}`;
  out.push(sheet + "}\n");
  if (opts.title) out.push(`{\\info{\\title ${esc(opts.title)}}}\n`);
  out.push(`\\paperw${look.paperw}\\paperh${look.paperh}\\margl${look.margl}\\margr${look.margr}\\margt${look.margt}\\margb${look.margb}\\viewkind4\n`);
  if (lines.some((ln) => (ln.runs || []).some((r) => /\uE000e/.test(r.t || "")))) out.push("\\aenddoc\\aftnnrlc\n");   // endnotes: at the end, i, ii, iii
  if (opts.titlePage && (opts.header != null || opts.footer)) out.push("\\titlepg\n");
  if (opts.header != null) out.push(`{\\header\\pard\\plain\\qr\\f0\\fs${look.fs} ${esc(opts.header)}\\chpgn\\par}\n`);
  if (opts.footer) out.push(`{\\footer\\pard\\plain\\qc\\f0\\fs${Math.max(16, look.fs - 4)} \\chpgn\\par}\n`);
  if (opts.titlePage && opts.header != null) out.push("{\\headerf\\pard\\plain\\par}\n");
  if (opts.titlePage && opts.footer) out.push("{\\footerf\\pard\\plain\\par}\n");
  const textW = Math.max(2000, look.paperw - look.margl - look.margr);
  // untouched paragraphs keep their own spacing: matched in order by their words
  const paras = opts.paras || [];
  let at = 0, lastBody = null;
  const counters = [];
  let prevList = false;
  for (const ln of lines) {
    const sig = sigOf(ln);
    let own = null;
    for (let k = at; k < Math.min(paras.length, at + 60); k++) if (paras[k].sig === sig) { own = paras[k]; at = k + 1; break; }
    const kind = ln.kind;
    const heading = kind && kind[0] === "h";
    const list = kind === "ul" || kind === "ol";
    if (!list) { counters.length = 0; }
    if (ln.table) {
      const n = Math.max(1, ...ln.table.map((r) => r.length));
      const cw = Math.floor(textW / n);
      let t = "";
      for (const r of ln.table) {
        t += "\\trowd\\trgaph108\\trleft0";
        for (let k = 1; k <= n; k++) t += `\\clbrdrt\\brdrs\\brdrw10\\clbrdrl\\brdrs\\brdrw10\\clbrdrb\\brdrs\\brdrw10\\clbrdrr\\brdrs\\brdrw10\\cellx${cw * k}`;
        t += "\n\\pard\\plain\\intbl\\ql\\f0\\fs" + look.fs + " " + Array.from({ length: n }, (_, k) => esc(r[k] || "") + "\\cell ").join("") + "\\row\n";
      }
      out.push(t + "\\pard\n");
      continue;
    }
    if (ln.pageBreak) out.push("\\page\n");
    let p = "\\pard\\plain";
    if (heading && opts.headingsPlain) p += `\\s${kind[1]}\\keepn\\outlinelevel${+kind[1] - 1}${kind === "h1" ? "\\sb2880\\sa480" : "\\sb240\\sa240"}`;
    else if (heading) p += `\\s${kind[1]}\\sb${kind[1] < 3 ? 240 : 160}\\sa80\\keepn\\outlinelevel${+kind[1] - 1}`;
    if (ln.titlePage === "title") p += "\\sb4320\\sa240";
    else if (ln.titlePage) p += ln.titlePage === "words" ? "\\sb480" : "\\sb120";
    else if (ln.sceneBreak && !opts.headingsPlain) p += "\\sb240\\sa240";
    const sp = own || (!heading && !list ? lastBody : null) || look;
    if (!heading) {
      if (sp.sb) p += `\\sb${sp.sb}`;
      if (sp.sa) p += `\\sa${sp.sa}`;
    }
    if (ln.gapBefore && !heading) p += "\\sb240";
    if (sp.sl) p += `\\sl${sp.sl}\\slmult${sp.slmult ? 1 : 0}`;
    const bodyLine = !kind && !ln.code && !ln.sceneBreak && !ln.titlePage;
    const al = ln.align || ((kind === "h1" || kind === "h2") && opts.headingsPlain ? "center" : null) || (opts.justify && bodyLine ? "justify" : null);
    if (al === "center") p += "\\qc"; else if (al === "right") p += "\\qr"; else if (al === "justify") p += "\\qj";
    let lead = "";
    if (list) {
      const d = Math.max(1, ln.depth || 1);
      counters.length = d;
      counters[d - 1] = (counters[d - 1] || 0) + 1;
      p += `\\fi-360\\li${720 * d}`;
      if (kind === "ul") lead = "{\\pntext\\f1\\'b7\\tab}{\\*\\pn\\pnlvlblt\\pnf1\\pnindent360{\\pntxtb\\'b7}}";
      else lead = `{\\pntext\\f0 ${counters[d - 1]}.\\tab}{\\*\\pn\\pnlvlbody\\pndec\\pnstart1\\pnindent360{\\pntxta.}}`;
    } else if (kind === "quote") p += "\\li567\\ri284";
    else if (!heading && opts.indent != null && bodyLine) {
      if (opts.indent && !ln.noIndent && !ln.align) p += `\\fi${opts.indent}`;
    } else if (!heading) {
      const fi = own ? own.fi : (lastBody ? lastBody.fi : look.fi);
      if (fi) p += `\\fi${fi}`;
      if (own && own.li) p += `\\li${own.li}`;
      if (own && own.ri) p += `\\ri${own.ri}`;
    }
    p += heading && opts.headingsPlain ? `\\f0\\fs${look.fs} ` : heading ? `\\b\\f0\\fs${HEAD_PT[kind[1]] * 2} ` : ln.code ? "\\f2\\fs20 " :
      ln.titlePage === "title" ? `\\f0\\fs${opts.headingsPlain ? 28 : 48} ` : `\\f0\\fs${look.fs} `;
    let body = "";
    for (const r of ln.runs || []) {
      if (r.img) {
        const b = opts.pictureBytes ? await opts.pictureBytes(r.img) : null;
        const size = b && pngSize(b);
        if (b && size) {
          const kindTag = b[0] === 0x89 ? "\\pngblip" : "\\jpegblip";
          const share = { small: 1 / 3, medium: 0.6 }[r.img.size] || 1;
          const w = Math.min(size[0] * 15, Math.floor(textW * share));
          const h = Math.round(w * size[1] / Math.max(1, size[0]));
          body += `{\\pict${kindTag}\\picw${size[0]}\\pich${size[1]}\\picwgoal${w}\\pichgoal${h}\n${hex(b)}}`;
        } else body += "[picture]";
        continue;
      }
      if (!r.t) continue;
      if (r.t.includes("\uE000")) {
        // RossDraft 1.2: a note's mark: RTF's own footnote (an endnote: \ftnalt), its words with it
        for (const piece of r.t.split(/(\uE000[fe]-?\d+\uE001)/)) {
          if (!piece) continue;
          const m = /^\uE000([fe])(-?\d+)\uE001$/.exec(piece);
          if (!m) { body += esc(piece); continue; }
          const words = (opts.notes && opts.notes.get(m[1] + m[2])) || "";
          body += `{\\super\\chftn}{\\footnote${m[1] === "e" ? "\\ftnalt" : ""}\\pard\\plain\\f0\\fs${Math.max(16, look.fs - 4)} {\\super\\chftn} ` +
            words.split("\n").map(esc).join("\\par ") + "\\par}";
        }
        continue;
      }
      let fmt = "";
      if (r.f && r.f.has("b")) fmt += "\\b";
      if (r.f && r.f.has("i")) fmt += "\\i";
      if (r.f && r.f.has("u") && !r.href) fmt += "\\ul";
      if (r.f && r.f.has("s")) fmt += "\\strike";
      if (r.f && r.f.has("h")) fmt += "\\highlight2";
      const t = esc(r.t);
      if (r.href) body += `{\\field{\\*\\fldinst{HYPERLINK "${r.href.replace(/[\\"{}]/g, "")}"}}{\\fldrslt{\\ul\\cf3${fmt} ${t}}}}`;
      else body += fmt ? `{${fmt} ${t}}` : t;
    }
    out.push(p + lead + body + "\\par\n");
    if (!heading && !list && !ln.code) lastBody = own || lastBody;
    prevList = list;
  }
  out.push("}\n");
  return out.join("");
}
