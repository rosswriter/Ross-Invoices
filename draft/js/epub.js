// RossDraft 1.5: EPUB e-books, opened to read (a read-only project: its chapters in the list, each on the page with
// its headings, italics, lists, tables, pictures and notes) and made into a project to edit (File ▸ Export
// Project…: a Ross Writer project, readable folders or a Scrivener project, from export.js).
//
// An EPUB is a zip: META-INF/container.xml names the package (.opf: the title and author, every file, the reading
// order or "spine"), the contents list (EPUB 3 nav.xhtml, or EPUB 2 toc.ncx) and the chapters (XHTML). Each file
// of the spine is an entry, titled from the contents list (or its first heading), nested as the contents nest; a
// chapter divided by second-level headings has them as its scenes. Notes linked from the text (epub:type
// noteref/footnote/endnote, or the common "#fn1" patterns) become the page's footnote and endnote marks.

import { ProjectStore, PNote } from "./project.js?v=1.9.20";
import * as md from "./md.js?v=1.9.20";
import * as wordio from "./wordio.js?v=1.8.3";

const dec = new TextDecoder();
const BLOCK = new Set(["p", "div", "section", "article", "header", "footer", "main", "figure", "figcaption", "aside", "nav",
  "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "pre", "table", "hr", "dl", "dt", "dd", "body", "center", "address"]);
const NOTE_TYPES = /\b(footnote|endnote|rearnote|note)\b/;
const NOTE_ID = /^(fn|ftn|note|footnote|endnote|en|n)[-_:.]?\d+/i;

function resolve(base, href) {
  if (!href) return "";
  const [path] = href.split("#");
  if (!path) return base;
  if (/^[a-z]+:/i.test(path)) return path;
  const parts = base.split("/").slice(0, -1);
  for (const p of decodeURIComponent(path).split("/")) {
    if (p === "..") parts.pop();
    else if (p && p !== ".") parts.push(p);
  }
  return parts.join("/");
}
const typeOf = (el) => (el.getAttribute && (el.getAttribute("epub:type") || el.getAttributeNS("http://www.idpf.org/2007/ops", "type") || el.getAttribute("role") || "")) || "";
const local = (el) => (el.localName || el.nodeName || "").toLowerCase();
function parseXml(text) {
  let doc = new DOMParser().parseFromString(text, "application/xhtml+xml");
  if (doc.getElementsByTagName("parsererror").length) doc = new DOMParser().parseFromString(text, "text/html");
  return doc;
}
const clean = (s) => s.replace(/[\s ]+/g, " ");

// ------------------------------------------------------------------ the book
export async function readEpub(bytes) {
  const files = new Map();
  for (const [name, got] of await wordio.unzip(bytes)) {
    if (name.endsWith("/")) continue;
    try { files.set(name, await got()); } catch (e) { /* a damaged file: left out */ }
  }
  const get = (p) => files.get(p) || files.get(decodeURIComponent(p)) || null;
  const text = (p) => { const b = get(p); return b ? dec.decode(b) : null; };
  const cont = text("META-INF/container.xml");
  if (!cont) throw new Error("This isn't an EPUB (it has no META-INF/container.xml).");
  const rootfile = new DOMParser().parseFromString(cont, "application/xml").getElementsByTagName("rootfile")[0];
  const opfPath = rootfile && rootfile.getAttribute("full-path");
  const opfText = opfPath && text(opfPath);
  if (!opfText) throw new Error("The e-book's package (.opf) is missing.");
  const opf = new DOMParser().parseFromString(opfText, "application/xml");
  const meta = (tag) => { const e = opf.getElementsByTagNameNS("http://purl.org/dc/elements/1.1/", tag)[0]; return e ? e.textContent.trim() : ""; };
  const title = meta("title"), author = meta("creator"), language = meta("language");
  const manifest = new Map();
  let navPath = null, ncxPath = null;
  for (const it of opf.getElementsByTagName("item")) {
    const href = resolve(opfPath, it.getAttribute("href"));
    const mt = it.getAttribute("media-type") || "";
    manifest.set(it.getAttribute("id"), { href, mt });
    if ((it.getAttribute("properties") || "").split(/\s+/).includes("nav")) navPath = href;
    if (mt === "application/x-dtbncx+xml") ncxPath = href;
  }
  const spineEl = opf.getElementsByTagName("spine")[0];
  if (!ncxPath && spineEl && spineEl.getAttribute("toc") && manifest.get(spineEl.getAttribute("toc"))) ncxPath = manifest.get(spineEl.getAttribute("toc")).href;
  const spine = [...opf.getElementsByTagName("itemref")].map((r) => manifest.get(r.getAttribute("idref")))
    .filter((m) => m && /x?html/.test(m.mt) && m.href !== navPath);
  // the contents list: [{ file, label, depth }]
  const toc = [];
  if (navPath && text(navPath)) {
    const nav = parseXml(text(navPath));
    const navs = [...nav.getElementsByTagName("nav")];
    const tocNav = navs.find((n) => /\btoc\b/.test(typeOf(n))) || navs[0];
    const walk = (ol, depth) => {
      for (const li of [...(ol ? ol.children : [])].filter((c) => local(c) === "li")) {
        const a = [...li.children].find((c) => local(c) === "a" || local(c) === "span");
        if (a) toc.push({ file: resolve(navPath, a.getAttribute("href") || ""), anchor: (a.getAttribute("href") || "").split("#")[1] || "", label: clean(a.textContent).trim(), depth });
        const sub = [...li.children].find((c) => local(c) === "ol" || local(c) === "ul");
        if (sub) walk(sub, depth + 1);
      }
    };
    if (tocNav) walk([...tocNav.children].find((c) => local(c) === "ol" || local(c) === "ul"), 0);
  }
  if (!toc.length && ncxPath && text(ncxPath)) {
    const ncx = new DOMParser().parseFromString(text(ncxPath), "application/xml");
    const walk = (parent, depth) => {
      for (const np of [...parent.children].filter((c) => local(c) === "navpoint")) {
        const lab = np.getElementsByTagName("text")[0], src = np.getElementsByTagName("content")[0];
        if (src) toc.push({ file: resolve(ncxPath, src.getAttribute("src") || ""), anchor: (src.getAttribute("src") || "").split("#")[1] || "", label: lab ? clean(lab.textContent).trim() : "", depth });
        walk(np, depth + 1);
      }
    };
    const map = ncx.getElementsByTagName("navMap")[0];
    if (map) walk(map, 0);
  }
  // every chapter's document, and the notes in them (id -> words, footnote or endnote)
  const docs = new Map();
  for (const s of spine) { const t = text(s.href); if (t != null) docs.set(s.href, parseXml(t)); }
  const notes = new Map();      // "file#id" -> { el, kind, words }
  const noteEl = (el) => NOTE_TYPES.test(typeOf(el)) && !/noteref/.test(typeOf(el));
  for (const [file, doc] of docs) {
    for (const el of doc.querySelectorAll("[id]")) {
      const t = typeOf(el);
      if (noteEl(el) || (NOTE_ID.test(el.getAttribute("id")) && /^(aside|li|div|p|section|dd)$/.test(local(el)) && !/noteref/.test(t))) {
        const kind = /endnote|rearnote/.test(t) ? "e" : /footnote/.test(t) ? "f" : null;
        // its words, without the number linking back
        const c = el.cloneNode(true);
        for (const a of c.querySelectorAll("a[href]")) if (/^\s*(\[?(\d+|[ivxlcdm]+)\]?|[↩↑^*†‡]|back)\s*\.?\s*$/i.test(a.textContent)) a.remove();
        const words = [...c.querySelectorAll("p")].length > 1 ? [...c.querySelectorAll("p")].map((p) => clean(p.textContent).trim()).filter(Boolean).join("\n")
          : clean(c.textContent).trim().replace(/^(\[?\d+\]?[.)]?\s+)/, "").replace(/^[.):\]\s]+/, "");
        notes.set(file + "#" + el.getAttribute("id"), { el, kind, words });
      }
    }
  }
  // the pictures, kept by their place in the book
  const media = new Map();
  for (const [, m] of manifest) if (/^image\//.test(m.mt) && get(m.href)) media.set(m.href, new File([get(m.href)], m.href.split("/").pop(), { type: m.mt, lastModified: 1 }));

  // ---------------------------------------------------------------- a chapter's lines (as wordio's, for the page)
  // the notes' own paragraphs are not the text's (they're its notes, wherever they stand)
  const used = new Set([...notes.values()].map((n) => n.el));
  const linesOf = (file, doc) => {
    const out = [];
    const ownNotes = new Map();     // "f3" -> words
    let next = { f: 0, e: 0 };
    let cur = null;
    const flush = () => { if (cur && (cur.runs.length || cur.kind)) out.push(cur); cur = null; };
    const line = (kind = null, extra = {}) => { flush(); cur = Object.assign({ kind, depth: 1, code: false, align: null, runs: [] }, extra); return cur; };
    const add = (run) => {
      if (!cur) line();
      const last = cur.runs[cur.runs.length - 1];
      if (last && !last.img && !run.img && last.href === run.href && [...last.f].sort().join() === [...run.f].sort().join()) last.t += run.t;
      else cur.runs.push(run);
    };
    const noteRef = (a) => {
      const href = a.getAttribute("href") || "";
      if (!href.includes("#")) return null;
      const key = resolve(file, href) + "#" + href.split("#")[1];
      const n = notes.get(key);
      if (!n && !/noteref/.test(typeOf(a))) return null;
      const kind = n && n.kind ? n.kind : (resolve(file, href) === file ? "f" : "e");
      next[kind] += 1;
      const id = next[kind];
      ownNotes.set(kind + id, n ? n.words : "");
      if (n) used.add(n.el);
      return wordio.noteToken(kind, id);
    };
    const inline = (node, f, href) => {
      for (const c of node.childNodes) {
        if (c.nodeType === 3) { const t = c.data.replace(/[\s ]+/g, (m) => (m.includes(" ") ? " " : " ")); if (t) add({ t, f: new Set(f), href }); continue; }
        if (c.nodeType !== 1 || used.has(c)) continue;
        const tag = local(c);
        if (BLOCK.has(tag)) { block(c); continue; }
        if (tag === "br") { line(cur ? cur.kind : null, cur ? { depth: cur.depth, align: cur.align } : {}); continue; }
        if (tag === "img" || tag === "image") {
          const src = resolve(file, c.getAttribute("src") || c.getAttribute("xlink:href") || c.getAttributeNS("http://www.w3.org/1999/xlink", "href") || "");
          if (media.has(src)) add({ t: "", f: new Set(), img: src });
          continue;
        }
        if (tag === "script" || tag === "style") continue;
        if (tag === "a" || (tag === "sup" && c.querySelector && c.querySelector("a[href*='#']") && c.textContent.trim().length <= 4)) {
          const a = tag === "a" ? c : c.querySelector("a[href*='#']");
          const tok = noteRef(a);
          if (tok) { add({ t: tok, f: new Set(), href: null }); continue; }
          if (tag === "a") { const h = c.getAttribute("href") || ""; inline(c, f, /^(https?:|mailto:)/i.test(h) ? h : href); continue; }
        }
        const g = new Set(f);
        if (tag === "b" || tag === "strong") g.add("b");
        if (tag === "i" || tag === "em" || tag === "cite" || tag === "dfn" || tag === "var") g.add("i");
        if (tag === "u" || tag === "ins") g.add("u");
        if (tag === "s" || tag === "strike" || tag === "del") g.add("s");
        if (tag === "mark") g.add("h");
        const st = (c.getAttribute("style") || "").toLowerCase(), cl = (c.getAttribute("class") || "").toLowerCase();
        if (/font-style:\s*italic/.test(st) || /\b(italic|ital|emph)\b/.test(cl)) g.add("i");
        if (/font-weight:\s*(bold|[6-9]00)/.test(st) || /\bbold\b/.test(cl)) g.add("b");
        inline(c, g, href);
      }
    };
    let listDepth = 0;
    const block = (el) => {
      if (used.has(el)) return;
      const tag = local(el);
      const t = typeOf(el);
      if (/\b(footnotes|endnotes|rearnotes)\b/.test(t) || /\b(footnotes|endnotes)\b/.test(el.getAttribute("class") || "")) return;     // a chapter's or the book's notes: taken as notes
      if (/^h[1-6]$/.test(tag)) { line("h" + tag[1]); inline(el, new Set(), null); flush(); return; }
      if (tag === "ul" || tag === "ol") {
        listDepth++;
        for (const li of [...el.children]) {
          if (local(li) !== "li") continue;
          line(tag, { depth: listDepth });
          inline(li, new Set(), null);
          flush();
        }
        listDepth--;
        return;
      }
      if (tag === "pre") { for (const ln of el.textContent.replace(/\n$/, "").split("\n")) { line(null, { code: true }); add({ t: ln, f: new Set(), href: null }); } flush(); return; }
      if (tag === "table") {
        const rows = [...el.querySelectorAll("tr")].map((tr) => [...tr.children].filter((c) => /^t[dh]$/.test(local(c))).map((c) => clean(c.textContent).trim().replace(/\|/g, "\\|")));
        if (!rows.length) return;
        const w = Math.max(...rows.map((r) => r.length));
        const row = (r) => "| " + Array.from({ length: w }, (_, k) => r[k] || "").join(" | ") + " |";
        [row(rows[0]), "| " + Array(w).fill("---").join(" | ") + " |", ...rows.slice(1).map(row)].forEach((s) => { line(null, { code: true }); add({ t: s, f: new Set(), href: null }); });
        flush();
        return;
      }
      if (tag === "hr") { line(null, { align: "center" }); add({ t: "* * *", f: new Set(), href: null }); flush(); return; }
      if (tag === "blockquote") { const before = out.length; for (const c of [...el.childNodes]) { if (c.nodeType === 1 && BLOCK.has(local(c))) block(c); else { if (!cur || cur.kind !== "quote") line("quote"); if (c.nodeType === 3) add({ t: clean(c.data), f: new Set(), href: null }); else inline({ childNodes: [c] }, new Set(), null); } } flush(); for (let k = before; k < out.length; k++) if (!out[k].kind) out[k].kind = "quote"; return; }
      // a paragraph, or a box holding paragraphs
      const hasBlocks = [...el.children].some((c) => BLOCK.has(local(c)) && !used.has(c));
      if (hasBlocks) {
        for (const c of [...el.childNodes]) {
          if (c.nodeType === 1 && BLOCK.has(local(c))) { flush(); block(c); }
          else if (c.nodeType === 3 ? c.data.trim() : c.nodeType === 1 && !used.has(c)) { if (!cur) line(); inline({ childNodes: [c] }, new Set(), null); }
        }
        flush();
        return;
      }
      const st = (el.getAttribute("style") || "").toLowerCase(), cl = (el.getAttribute("class") || "").toLowerCase();
      const align = /text-align:\s*center/.test(st) || /\b(center|centre|centered|centred|scene|break|separator|ornament)\b/.test(cl) ? "center"
        : /text-align:\s*right/.test(st) || /\bright\b/.test(cl) ? "right" : null;
      line(null, { align });
      inline(el, new Set(), null);
      flush();
    };
    const body = doc.body || doc.getElementsByTagName("body")[0] || doc.documentElement;
    block(body);
    flush();
    // tidy: no runs of empty lines, none at the ends; spaces trimmed at the ends of paragraphs
    for (const ln of out) {
      if (ln.code) continue;
      if (ln.runs.length && !ln.runs[0].img) ln.runs[0].t = ln.runs[0].t.replace(/^\s+/, "");
      const l = ln.runs[ln.runs.length - 1];
      if (l && !l.img) l.t = l.t.replace(/\s+$/, "");
      ln.runs = ln.runs.filter((r) => r.img || r.t);
    }
    const kept = out.filter((ln) => ln.kind || ln.code || ln.runs.length);
    return { lines: kept, notes: ownNotes };
  };

  // ---------------------------------------------------------------- the entries
  const tocFor = new Map();
  for (const t of toc) if (!tocFor.has(t.file)) tocFor.set(t.file, t);
  const entries = [];
  let lastDepth = 0;
  for (const s of spine) {
    const doc = docs.get(s.href);
    if (!doc) continue;
    const got = linesOf(s.href, doc);
    const tc = tocFor.get(s.href);
    let ttl = tc && tc.label;
    const firstHead = got.lines.findIndex((ln) => ln.kind && ln.kind[0] === "h");
    const headText = firstHead >= 0 ? got.lines[firstHead].runs.map((r) => r.t || "").join("").replace(wordio.NOTE_RE, "").trim() : "";
    if (!ttl) ttl = headText || clean((doc.querySelector("title") || { textContent: "" }).textContent).trim() || `Section ${entries.length + 1}`;
    // the chapter's own heading is its title: not again on the page
    if (firstHead >= 0 && firstHead <= 2 && headText && headText.toLowerCase() === ttl.toLowerCase()) got.lines.splice(firstHead, 1);
    // nothing left (a page of notes only, a blank page): no entry
    if (!got.lines.some((ln) => ln.runs.some((r) => r.img || (r.t || "").replace(wordio.NOTE_RE, "").trim()))) continue;
    const depth = tc ? tc.depth : lastDepth;
    lastDepth = depth;
    // divided by second-level headings (as RossDraft's own e-books are): those its scenes
    const hs = got.lines.map((ln, k) => (ln.kind === "h2" ? k : -1)).filter((k) => k >= 0);
    let children = [];
    if ((hs.length >= 2 && hs[0] <= 3) || (hs.length === 1 && hs[0] === 0)) {
      const own = got.lines.slice(0, hs[0]);
      children = hs.map((h, i) => ({ title: got.lines[h].runs.map((r) => r.t || "").join("").replace(wordio.NOTE_RE, "").trim() || `Scene ${i + 1}`,
        lines: got.lines.slice(h + 1, i + 1 < hs.length ? hs[i + 1] : got.lines.length), depth: depth + 1, children: [] }));
      got.lines = own;
    }
    entries.push({ title: ttl, lines: got.lines, notes: got.notes, depth, children });
  }
  // nested as the contents list nests them
  const roots = [], stack = [];
  for (const e of entries) {
    while (stack.length && stack[stack.length - 1].depth >= e.depth) stack.pop();
    (stack.length ? stack[stack.length - 1].children : roots).push(e);
    stack.push(e);
  }
  // the notes of a chapter divided into scenes: each scene keeps those it marks
  const share = (e) => { for (const c of e.children) { c.notes = new Map([...e.notes].filter(([k]) => c.lines.some((ln) => ln.runs.some((r) => (r.t || "").includes("" + k + ""))))); share(c); } };
  roots.forEach(share);
  return { title: title || "", author, language, roots, media };
}

// ------------------------------------------------------------------ an e-book opened to read
export class EpubStore extends ProjectStore {
  constructor(fileHandle) {
    super({ name: fileHandle.name }, fileHandle.name);
    this.fileHandle = fileHandle;
    this.isEpub = true;
    this.readOnlyAll = ["an e-book: read-only here (File ▸ Export Project… makes a project of it to edit)"];
    this.texts = new Map();
  }
  get label() { return this.bookTitle || this.fileName.replace(/\.epub$/i, ""); }

  async scan() {
    const f = await this.fileHandle.getFile();
    const book = await readEpub(new Uint8Array(await f.arrayBuffer()));
    this.bookTitle = book.title;
    this.author = book.author;
    this.modifiedAt = f.lastModified;
    for (const [path, file] of book.media) this.media.set("epub/" + path, file);
    let k = 0;
    const raws = (list) => list.map((e) => {
      const raw = { id: "e" + String(++k).padStart(4, "0"), title: e.title, flag: "", include: true, expanded: true };
      this.texts.set(raw.id, { lines: e.lines, notes: e.notes || new Map() });
      if (e.children.length) raw.children = raws(e.children);
      return raw;
    });
    this.data = { format: "epub", title: this.label, meta: {}, compile: { headings: true, scene_break: "* * *", chapter_page: true }, nodes: raws(book.roots) };
    const top = new PNote(null, null);
    const build = (parent, list) => { for (const raw of list) { const n = new PNote(parent, raw); parent.children.push(n); if (raw.children) build(n, raw.children); } };
    build(top, this.data.nodes);
    this.root = top;
    for (const n of this.all()) await this.load(n);
    return top;
  }
  async load(n) {
    const t = this.texts.get(n.raw.id) || { lines: [], notes: new Map() };
    n.fnotes = new Map(t.notes);
    n.comments = undefined;
    n.readOnly = this.readOnlyAll;
    n.modified = this.modifiedAt || 1;
    n.text = md.serialize([this.titleLine(n), ...wordio.toNoteLines(t.lines, (name) => ["media", "epub", name])], { dir: [] });
    return n.text;
  }
  async peek(n) { return { modified: n.modified, text: n.text }; }
  async write() { throw new Error(this.readOnlyAll[0]); }
  async saveProject() { /* nothing: an e-book is only read */ }
  async newNote() { throw new Error(this.readOnlyAll[0]); }
  async addNote() { throw new Error(this.readOnlyAll[0]); }
  async rename() { return false; }
  async move() { return false; }
  async delete() { throw new Error(this.readOnlyAll[0]); }
  async sceneFile() { return null; }
  async findTemplate() { return null; }
  async pdfFile() { return null; }
  async keepConflict() { /* nothing */ }
  compileTicked() { return true; }
}
