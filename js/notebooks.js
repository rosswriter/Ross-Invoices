// Whole notebooks from other note programs, read into a tree of notes, the
// same way as the laptop's notebooks.py (and notesio.html_to_markdown).
// NoteCase Pro (.ncdb) is an SQLite file: read with sql.js, loaded only here.
// FeatherNotes (.fnx) is XML with each note's words as Qt rich text (HTML).
import * as md from "./md.js?v=2.1.2";

const OBJ = md.OBJ;
const NC_TAGS = { 1: "b", 3: "i", 5: "u" };
const NC_FONT = 17, NC_BACKGROUND = 15;

export function kindOf(bytes) {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 200));
  if (head.startsWith("SQLite format 3")) return "ncdb";
  if (head.includes("<feathernotes")) return "fnx";
  return null;
}

let SQL = null;
async function sqlite() {
  if (SQL) return SQL;
  if (!window.initSqlJs) {
    await new Promise((ok, bad) => {
      const s = document.createElement("script");
      s.src = "vendor/sqljs/sql-wasm.js";
      s.onload = ok;
      s.onerror = () => bad(new Error("couldn't load the database reader (no connection the first time?)"));
      document.head.appendChild(s);
    });
  }
  SQL = await window.initSqlJs({ locateFile: (f) => "vendor/sqljs/" + f });
  return SQL;
}

const yellowish = (col) => {
  const m = /#?([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})/.exec(col || "");
  if (!m) return false;
  const [r, g, b] = m.slice(1).map((x) => parseInt(x, 16));
  return r > 200 && g > 170 && b < 160;
};

function rows(db, sql) {
  const out = [];
  const st = db.prepare(sql);
  while (st.step()) out.push(st.get());
  st.free();
  return out;
}

// {tree, pictures: Map(name -> Uint8Array)}
export async function readNcdb(bytes) {
  const S = await sqlite();
  let db;
  try { db = new S.Database(bytes); } catch (e) { throw new Error("it isn't a NoteCase Pro notebook, or it's locked with a password"); }
  try {
    let cols;
    try { cols = new Set(rows(db, "pragma table_info(notes)").map((r) => r[1])); } catch (e) {
      throw new Error("it isn't a NoteCase Pro notebook, or it's locked with a password");
    }
    for (const c of ["note_id", "note_title", "note_text", "note_pid", "note_pos"]) {
      if (!cols.has(c)) throw new Error("it isn't a NoteCase Pro notebook");
    }
    const notes = new Map();
    for (const [nid, pid, pos, title, text] of rows(db, "select note_id, note_pid, note_pos, note_title, note_text from notes")) {
      notes.set(nid, { id: nid, pid: pid || "", pos: pos || 0, title: (title || "").trim(), text: text || "", kids: [] });
    }
    for (const d of notes.values()) if (notes.has(d.pid)) notes.get(d.pid).kids.push(d);
    const tables = new Set(rows(db, "select name from sqlite_master where type='table'").map((r) => r[0]));
    const imgs = new Map(), fmts = new Map(), links = new Map(), pictures = new Map();
    const add = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
    if (tables.has("images")) {
      rows(db, "select note_id, note_offset, image_title, image_data, is_png from images order by note_offset")
        .forEach(([nid, off, title, data, png], k) => {
          if (!data || !data.length) return;
          const base = String(title || "picture").split(/[\\/]/).pop();
          let name = `${k + 1} ` + base.replace(/[^\w.\- ]/gu, "_").slice(0, 60);
          if (!/\.[^.]+$/.test(name)) name += png ? ".png" : ".jpg";
          pictures.set(name, data);
          add(imgs, nid, [off || 0, name]);
        });
    }
    if (tables.has("formatting")) {
      for (const [nid, off, tag, col, font] of rows(db,
        "select note_id, note_offset, fmt_tag, fmt_color, fmt_font from formatting order by note_id, note_offset, fmt_id")) {
        add(fmts, nid, [off || 0, tag || 0, col || "", font || ""]);
      }
    }
    if (tables.has("links")) {
      for (const [nid, off, ln, url] of rows(db, "select note_id, note_offset, lnk_length, target_url from links")) {
        if (url && ln && /^(https?|mailto|ftp|file):/.test(url)) add(links, nid, [off || 0, ln, url]);
      }
    }
    const linesOf = (d) => {
      const text = [...d.text];       // characters, as NoteCase counts them
      const places = (imgs.get(d.id) || []).map(([o]) => o);
      const at = (off) => {
        let before = 0;
        while (before < places.length && places[before] < off) before++;
        return Math.max(0, Math.min(text.length, off - before));
      };
      const flags = Array.from({ length: text.length + 1 }, () => new Set());
      const hrefs = Array(text.length + 1).fill(null);
      const opened = new Map();
      for (const [off, tag, col, font] of fmts.get(d.id) || []) {
        if (tag % 2) { opened.set(tag, [at(off), col, font]); continue; }
        const start = opened.get(tag - 1);
        if (!start) continue;
        opened.delete(tag - 1);
        const [a, c, f] = start;
        const b = at(off);
        const addf = new Set();
        if (NC_TAGS[tag - 1]) addf.add(NC_TAGS[tag - 1]);
        else if (tag - 1 === NC_FONT) {
          if (/\bbold\b/i.test(f)) addf.add("b");
          if (/\b(italic|oblique)\b/i.test(f)) addf.add("i");
        } else if (tag - 1 === NC_BACKGROUND && yellowish(c)) addf.add("h");
        for (let k = a; k < b; k++) for (const x of addf) flags[k].add(x);
      }
      for (const [off, ln, url] of links.get(d.id) || []) {
        const a = at(off);
        for (let k = a; k < Math.min(text.length, a + ln); k++) hrefs[k] = url;
      }
      const pics = new Map();
      for (const [off, name] of imgs.get(d.id) || []) add(pics, at(off), name);
      const lines = [];
      let runs = [];
      const push = (t, f, h) => {
        const last = runs[runs.length - 1];
        if (last && !last.img && sameSet(last.f, f) && (last.href || null) === (h || null)) last.t += t;
        else runs.push({ t, f: new Set(f), href: h });
      };
      [...text, "\n"].forEach((ch, k) => {
        for (const name of pics.get(k) || []) runs.push({ t: OBJ, f: new Set(), img: name });
        if (ch === "\n") { lines.push({ kind: null, depth: 1, code: false, runs }); runs = []; return; }
        push(ch === "\t" || ch === " " ? " " : ch, flags[k], hrefs[k]);
      });
      return startWithTitle(d.title, text.length ? lines : []);
    };
    const tree = (kids) => kids.slice().sort((a, b) => a.pos - b.pos)
      .map((d) => ({ title: d.title || "Untitled", lines: linesOf(d), children: tree(d.kids) }));
    return { tree: tree([...notes.values()].filter((d) => !notes.has(d.pid))), pictures };
  } finally {
    db.close();
  }
}

const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
const words = (ln) => ln.runs.filter((r) => !r.img).map((r) => r.t).join("");

function startWithTitle(title, lines) {
  const out = [];
  for (const ln of lines) {
    const empty = !words(ln).trim() && !ln.runs.some((r) => r.img);
    if (empty && (!out.length || out[out.length - 1]._e)) continue;
    for (const r of ln.runs) if (!r.img) r.t = r.t.replace(/\r+$/, "");
    ln._e = empty;
    out.push(ln);
  }
  while (out.length && out[out.length - 1]._e) out.pop();
  for (const ln of out) delete ln._e;
  const firstLn = out.find((ln) => words(ln).trim());
  const first = firstLn ? words(firstLn).trim() : "";
  if (title && first !== title.trim()) out.unshift({ kind: null, depth: 1, code: false, runs: [{ t: title, f: new Set() }] });
  return out;
}

export function readFnx(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const root = doc.documentElement;
  if (!root || root.nodeName !== "feathernotes" || doc.getElementsByTagName("parsererror").length) {
    throw new Error("it isn't a FeatherNotes file, or it's locked with a password");
  }
  const tree = (el) => [...el.children].filter((c) => c.nodeName === "node").map((n) => ({
    title: (n.getAttribute("name") || "Untitled").trim(),
    html: [...n.childNodes].filter((c) => c.nodeType === 3 || c.nodeType === 4).map((c) => c.data).join(""),
    children: tree(n),
  }));
  return { tree: tree(root), pictures: new Map() };
}

export function count(tree) { return tree.reduce((a, n) => a + 1 + count(n.children), 0); }

// ------------------------------------------------------------------ Qt rich text -> lines (as Qt reads it)
// images: (src) -> target parts (or null) for <img src>
export async function qtHtmlLines(html, picture) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const pre = /white-space\s*:\s*pre-wrap/.test(html);
  const lines = [];
  let cur = null;
  const sizeOf = (st) => {
    const m = /font-size\s*:\s*([^;"]+)/i.exec(st || "");
    if (!m) return null;
    const v = m[1].trim().toLowerCase();
    if (v === "xx-large" || v === "xxx-large") return 3;
    if (v === "x-large") return 2;
    if (v === "large") return 1;
    const pt = /([\d.]+)\s*pt/.exec(v);
    if (pt) return +pt[1] >= 20 ? 3 : +pt[1] >= 15 ? 2 : 0;
    const px = /([\d.]+)\s*px/.exec(v);
    if (px) { const p = +px[1] * 0.75; return p >= 20 ? 3 : p >= 15 ? 2 : 0; }
    return 0;
  };
  const newLine = (kind, depth) => { cur = { kind: kind || null, depth: depth || 1, runs: [], sizes: [] }; lines.push(cur); };
  const pending = [];
  const walk = async (n, st) => {
    for (const c of n.childNodes) {
      if (c.nodeType === 3) {
        let t = c.data;
        if (!pre) t = t.replace(/\s+/g, " ");
        if (!t) continue;
        if (!cur) { if (!t.trim()) continue; newLine(st.kind, st.depth); }
        cur.runs.push({ t, f: new Set(st.f), href: st.href });
        if (t.trim()) cur.sizes.push(st.size || 0);
        continue;
      }
      if (c.nodeType !== 1) continue;
      const tag = c.tagName;
      if (["SCRIPT", "STYLE", "HEAD", "TITLE", "META"].includes(tag)) continue;
      if (tag === "BR") { if (cur) cur.runs.push({ t: " ", f: new Set(st.f), href: st.href }); continue; }
      if (tag === "IMG") {
        const target = await picture(c.getAttribute("src") || "");
        if (target) { if (!cur) newLine(st.kind, st.depth); cur.runs.push({ t: OBJ, f: new Set(), img: { src: "", size: "", target } }); }
        continue;
      }
      const s2 = { ...st, f: new Set(st.f) };
      const style = c.getAttribute("style") || "";
      if (tag === "B" || tag === "STRONG") s2.f.add("b");
      if (tag === "I" || tag === "EM") s2.f.add("i");
      if (tag === "U") s2.f.add("u");
      if (tag === "S" || tag === "STRIKE" || tag === "DEL") s2.f.add("s");
      const fw = /font-weight\s*:\s*(bold|\d+)/i.exec(style);
      if (fw) { if (fw[1] === "bold" || +fw[1] >= 600) s2.f.add("b"); else s2.f.delete("b"); }
      if (/font-style\s*:\s*italic/i.test(style)) s2.f.add("i");
      if (/text-decoration[^;]*underline/i.test(style)) s2.f.add("u");
      if (/text-decoration[^;]*line-through/i.test(style)) s2.f.add("s");
      if (/background-color\s*:\s*(?!transparent)[^;"]+/i.test(style)) s2.f.add("h");
      const sz = sizeOf(style);
      if (sz != null) s2.size = sz;
      if (tag === "A" && c.getAttribute("href")) s2.href = c.getAttribute("href");
      if (/^H[1-6]$/.test(tag)) s2.kind = "h" + tag[1];
      if (tag === "UL" || tag === "OL") { s2.list = tag === "UL" ? "ul" : "ol"; s2.listDepth = (st.listDepth || 0) + 1; }
      if (tag === "LI") { s2.kind = st.list || "ul"; s2.depth = st.listDepth || 1; }
      if (tag === "BLOCKQUOTE") s2.kind = s2.kind || null;
      const block = ["P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "PRE", "BLOCKQUOTE", "TR"].includes(tag);
      if (block) {
        newLine(s2.kind, s2.depth);
        await walk(c, s2);
        cur = null;
      } else await walk(c, s2);
    }
  };
  await walk(doc.body, { f: new Set(), href: null, kind: null, depth: 1, size: 0 });
  await Promise.all(pending);
  for (const ln of lines) {
    if (ln.kind === "ul" || ln.kind === "ol") {
      if (ln.depth > 1) {
        const lead = "  ".repeat(ln.depth - 1);
        ln.mark = ln.kind === "ul" ? "ul:" + lead + "- " : "ol:" + lead + "\u0000. ";
      }
    }
    // very large text: a heading
    if (!ln.kind && ln.sizes.length && Math.min(...ln.sizes) > 0 && Math.min(...ln.sizes) >= 2) ln.kind = Math.min(...ln.sizes) >= 3 ? "h1" : "h2";
    if (ln.kind && ln.kind[0] === "h") for (const r of ln.runs) r.f.delete("b");
    for (const r of ln.runs) if (r.href) r.f.delete("u");     // a link's underline is how links look
    if (!pre && ln.runs.length && !ln.runs[0].img) ln.runs[0].t = ln.runs[0].t.replace(/^ +/, "");
    if (!pre && ln.runs.length && !ln.runs[ln.runs.length - 1].img) ln.runs[ln.runs.length - 1].t = ln.runs[ln.runs.length - 1].t.replace(/ +$/, "");
    delete ln.sizes;
    delete ln.depth;
  }
  return lines;
}

// as notesio.html_to_markdown: the note's Markdown, empty lines tidied, the title as the first line
export function tidyNote(text, title) {
  text = text.replace(/^[ \t ]+$/gm, "");
  text = text.replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "");
  if (title && md.titleOf(text).trim() !== title.trim()) text = title + "\n" + text;
  return text.trim() ? text.replace(/\n+$/, "") + "\n" : (title || "") + "\n";
}
