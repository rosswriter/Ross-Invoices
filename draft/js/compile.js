// RossDraft 1.1: Compile — the chosen entries of a Ross Writer project as one book, as Ross Writer's own
// Compile makes it (project.compile_document): in the order of the list; each entry's title a heading when
// "headings" is on (depth 0 Heading 1, 1 Heading 2, 2 Heading 3; deeper entries have none); a top-level
// chapter on a new page when "chapter_page" is on; between scenes without titles, the scene break.
// The options are kept in the .rwproj's "compile" (shared with Ross Writer): headings, chapter_page,
// scene_break, comments; and RossDraft's own: layout ("own" | "manuscript" | "reading"), title_page, author.
//
// bookLines(entries, opts) -> wordio lines for the Word, RTF, print and e-book writers. Lines may carry:
//   pageBreak, sceneBreak, noIndent (the first paragraph after a heading or a scene break), titlePage
//   ("title" | "author" | "words"), part (the entry's index, for its comments).
// epubBlob(lines, meta, pictureBytes) -> an EPUB 3 (with an EPUB 2 table of contents), as Ross Writer's epubout.
// printHtml(lines, layout, meta) -> the book as HTML for the print view (and "Save as PDF").

import { zip, NOTE_RE } from "./wordio.js?v=1.9.20";

// RossDraft 1.2: the notes of several scenes in one book: each scene's marks given new ids, in order (footnotes
// 1, 2, 3…; endnotes 1, 2, 3…), so they never clash. parts: [{ lines, notes (Map "f17" -> words) }]
// -> { lines: [...each part's lines], notes: Map of the book's notes }
export function renumberNotes(parts) {
  const notes = new Map();
  const next = { f: 0, e: 0 };
  const out = parts.map(({ lines, notes: own }) => {
    const map = new Map();
    const fix = (t) => t.replace(NOTE_RE, (m0, k, id) => {
      const key = k + id;
      if (!map.has(key)) { next[k] += 1; map.set(key, k + next[k]); notes.set(k + next[k], (own && own.get(key)) || ""); }
      return "\uE000" + map.get(key) + "\uE001";
    });
    return (lines || []).map((ln) => (ln.runs || []).some((r) => (r.t || "").includes("\uE000"))
      ? Object.assign({}, ln, { runs: ln.runs.map((r) => (r.t && r.t.includes("\uE000") ? Object.assign({}, r, { t: fix(r.t) }) : r)) }) : ln);
  });
  return { lines: out, notes };
}
const ROMAN = (n) => { let r = ""; for (const [v, s] of [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]]) while (n >= v) { r += s; n -= v; } return r; };
export const noteLabel = (k, id) => (k === "e" ? ROMAN(+id) : String(id));

export const DEFAULT_COMPILE = { headings: true, scene_break: "* * *", chapter_page: true, comments: false,
  layout: "own", title_page: false, author: "" };

export const LAYOUTS = {
  own: { label: "The project's own look", what: "its Word files' fonts, styles and page, as Ross Writer compiles" },
  manuscript: { label: "Manuscript", what: "for submissions: Times New Roman 12 pt, double-spaced, indented, " +
    "your name, the title and the page number at the top of each page" },
  reading: { label: "Reading copy", what: "a clean book page: your typeface, justified, page numbers at the foot" },
};

// a table (kept in the page as Markdown: "| a | b |", "| --- | --- |", …) back into rows of cells
const ROW_RE = /^\s*\|.*\|\s*$/;
const SEP_RE = /^\s*\|(\s*:?-{3,}:?\s*\|)+\s*$/;
function cellsOf(t) {
  const inner = t.trim().replace(/^\|/, "").replace(/\|$/, "");
  const out = [];
  let cur = "";
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === "\\" && inner[i + 1] === "|") { cur += "|"; i++; continue; }
    if (inner[i] === "|") { out.push(cur.trim()); cur = ""; continue; }
    cur += inner[i];
  }
  out.push(cur.trim());
  return out;
}
const textOf = (ln) => (ln.runs || []).map((r) => r.t || "").join("");
export function groupTables(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (ln.code && ROW_RE.test(textOf(ln)) && lines[i + 1] && lines[i + 1].code && SEP_RE.test(textOf(lines[i + 1]))) {
      const rows = [cellsOf(textOf(ln))];
      let j = i + 2;
      while (j < lines.length && lines[j].code && ROW_RE.test(textOf(lines[j]))) { rows.push(cellsOf(textOf(lines[j]))); j++; }
      const w = Math.max(...rows.map((r) => r.length));
      for (const r of rows) while (r.length < w) r.push("");
      out.push({ kind: null, code: false, table: rows, runs: [], part: ln.part });
      i = j - 1;
      continue;
    }
    out.push(ln);
  }
  return out;
}

const isEmpty = (ln) => !ln.table && !ln.kind && !ln.code && !(ln.runs || []).some((r) => r.img || (r.t || "").trim());

// entries: [{ title, depth, hasChildren, lines (wordio lines of its text, its title not among them), comments }]
export function bookLines(entries, opts) {
  const o = Object.assign({}, DEFAULT_COMPILE, opts || {});
  const out = [];
  let first = true;
  if (o.title_page) {
    out.push({ kind: null, align: "center", titlePage: "title", runs: [{ t: o.title || "Untitled", f: new Set() }] });
    if (o.author) out.push({ kind: null, align: "center", titlePage: "author", runs: [{ t: "by " + o.author, f: new Set() }] });
    if (o.words) out.push({ kind: null, align: "center", titlePage: "words", runs: [{ t: o.words, f: new Set() }] });
  }
  const startsPage = () => o.title_page && first;
  entries.forEach((e, part) => {
    const body = groupTables((e.lines || []).slice());
    while (body.length && isEmpty(body[0])) body.shift();
    while (body.length && isEmpty(body[body.length - 1])) body.pop();
    const hasText = body.length > 0;
    const heading = o.headings && e.depth < 3 && (e.hasChildren || e.depth === 0 || hasText);
    if (!first && !heading && o.scene_break && hasText) {
      out.push({ kind: null, align: "center", sceneBreak: true, runs: [{ t: o.scene_break, f: new Set() }], part });
    }
    if (heading) {
      out.push({ kind: "h" + (e.depth + 1), runs: [{ t: e.title, f: new Set() }], part,
        pageBreak: startsPage() || (e.depth === 0 && !first && o.chapter_page) });
      first = false;
    }
    if (hasText) {
      body.forEach((ln, k) => {
        const l = Object.assign({}, ln, { part });
        if (k === 0) {
          l.noIndent = true;
          if (startsPage()) l.pageBreak = true;
        }
        out.push(l);
      });
      first = false;
    }
  });
  return out;
}

// the first paragraph after a heading, a scene break or an empty line: no first-line indent (book style)
export function markIndents(lines) {
  let prevBreak = true;
  for (const ln of lines) {
    if (ln.kind || ln.sceneBreak || ln.titlePage || ln.table || isEmpty(ln)) { prevBreak = true; continue; }
    if (prevBreak || (ln.runs || []).every((r) => r.img || !(r.t || "").trim())) ln.noIndent = true;   // (a picture: never indented)
    prevBreak = false;
  }
  return lines;
}

// ------------------------------------------------------------------ the e-book
const esc = (s) => String(s == null ? "" : s).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]/g, "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const EPUB_CSS = `@charset "utf-8";
body { margin: 0 5%; line-height: 1.4; }
h1 { font-size: 1.6em; text-align: center; margin: 3em 0 1.5em 0; page-break-before: always; font-weight: normal; }
h2 { font-size: 1.25em; text-align: center; margin: 2em 0 1em 0; font-weight: normal; }
h3 { font-size: 1.05em; margin: 1.5em 0 0.6em 0; font-weight: bold; }
p { margin: 0; text-indent: 1.5em; text-align: justify; }
p.first { text-indent: 0; }
p.c { text-align: center; text-indent: 0; }
p.r { text-align: right; text-indent: 0; }
p.scene { text-align: center; text-indent: 0; margin: 1em 0; }
p.blank { margin: 0; min-height: 1em; }
.u { text-decoration: underline; }
.s { text-decoration: line-through; }
img { max-width: 100%; }
div.pic { text-align: center; margin: 1em 0; }
ul, ol { margin: 0.5em 0 0.5em 1.5em; padding: 0; }
blockquote { margin: 1em 1.5em; }
table { border-collapse: collapse; margin: 1em auto; }
td { border: 1px solid #999; padding: 0.2em 0.5em; vertical-align: top; text-align: left; }
div.titlepage { text-align: center; margin-top: 30%; }
div.titlepage h1 { page-break-before: auto; font-size: 2em; margin: 0 0 1em 0; }
p.author { text-align: center; font-size: 1.2em; text-indent: 0; }
a.noteref { text-decoration: none; }
aside.note p, section[epub|type="endnotes"] p { text-indent: 0; text-align: left; margin-bottom: 0.5em; font-size: 0.9em; }
section.notes { margin-top: 2em; border-top: 1px solid #999; padding-top: 0.5em; }
`;

function xhtml(title, body, lang) {
  return '<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n' +
    `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${esc(lang)}" xml:lang="${esc(lang)}">\n` +
    `<head>\n<meta charset="utf-8"/>\n<title>${esc(title)}</title>\n<link rel="stylesheet" type="text/css" href="style.css"/>\n</head>\n` +
    `<body>\n${body}\n</body>\n</html>\n`;
}

function runsHtml(runs, picture, note) {
  let out = "";
  for (const r of runs || []) {
    if (r.img) { out += picture(r.img); continue; }
    if ((r.t || "").includes("\uE000")) {
      // a note's mark: a link to the note (the e-book), or its number (print)
      for (const piece of r.t.split(/(\uE000[fe]-?\d+\uE001)/)) {
        if (!piece) continue;
        const m = /^\uE000([fe])(-?\d+)\uE001$/.exec(piece);
        out += m ? (note ? note(m[1], m[2]) : `<sup>${noteLabel(m[1], m[2])}</sup>`) : runsHtml([Object.assign({}, r, { t: piece })], picture, note);
      }
      continue;
    }
    let t = esc((r.t || "").split("￼").join(""));
    if (!t) continue;
    const f = r.f || new Set();
    if (f.has("s")) t = `<span class="s">${t}</span>`;
    if (f.has("u") && !r.href) t = `<span class="u">${t}</span>`;
    if (f.has("i")) t = `<i>${t}</i>`;
    if (f.has("b")) t = `<b>${t}</b>`;
    if (r.href) t = `<a href="${esc(r.href)}">${t}</a>`;
    out += t;
  }
  return out;
}

const tableHtml = (rows) => `<table>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</table>`;
function sniff(b) {
  if (b[0] === 0x89 && b[1] === 0x50) return ["png", "image/png"];
  if (b[0] === 0xff && b[1] === 0xd8) return ["jpg", "image/jpeg"];
  if (b[0] === 0x47 && b[1] === 0x49) return ["gif", "image/gif"];
  if (b[0] === 0x52 && b[8] === 0x57) return ["webp", "image/webp"];
  return null;
}

// lines -> the body of chapters (each Heading 1 starts one; Heading 2s listed under it)
async function chaptersOf(lines, pictureBytes, images, notes, endnotes) {
  const chapters = [];
  let ch = null, list = null, sub = 0;
  const pics = [];
  const picture = (img) => { pics.push(img); return `\u0000PIC${pics.length - 1}\u0000`; };
  // footnotes at the end of their chapter, endnotes in a Notes section at the end (as Ross Writer's e-books)
  const note = (k, id) => {
    const nid = (k === "e" ? "en" : "fn") + id;
    if (k === "e") endnotes.push([nid, noteLabel(k, id), (notes && notes.get(k + id)) || "", ch.file]);
    else ch.notes.push([nid, noteLabel(k, id), (notes && notes.get(k + id)) || ""]);
    return `<a class="noteref" epub:type="noteref" id="ref-${nid}" href="${k === "e" ? "notes.xhtml" : ""}#${nid}"><sup>${noteLabel(k, id)}</sup></a>`;
  };
  const close = () => { if (list) { ch.parts.push(`</${list}>`); list = null; } };
  for (const ln of lines) {
    if (ln.titlePage) continue;
    if (ln.kind === "h1" || !ch) {
      close();
      ch = { title: ln.kind === "h1" ? (ln.runs || []).map((r) => r.t || "").join("").replace(/\uE000[fe]-?\d+\uE001/g, "").trim() || "Chapter" : "Start",
        file: `chapter${String(chapters.length + 1).padStart(3, "0")}.xhtml`, parts: [], subs: [], notes: [] };
      chapters.push(ch);
      if (ln.kind === "h1") { ch.parts.push(`<h1>${runsHtml(ln.runs, picture, note)}</h1>`); continue; }
    }
    const kind = ln.kind;
    if (kind !== "ul" && kind !== "ol") close();
    if (kind === "h2" || kind === "h3" || (kind && kind[0] === "h")) {
      const lvl = Math.min(3, +kind[1]);
      if (lvl === 2) { sub += 1; ch.subs.push(["s" + sub, (ln.runs || []).map((r) => r.t || "").join("")]); ch.parts.push(`<h2 id="s${sub}">${runsHtml(ln.runs, picture, note)}</h2>`); }
      else ch.parts.push(`<h${lvl}>${runsHtml(ln.runs, picture, note)}</h${lvl}>`);
      continue;
    }
    if (kind === "ul" || kind === "ol") {
      if (list !== kind) { close(); ch.parts.push(`<${kind}>`); list = kind; }
      ch.parts.push(`<li>${runsHtml(ln.runs, picture, note)}</li>`);
      continue;
    }
    if (ln.table) { ch.parts.push(tableHtml(ln.table)); continue; }
    if (ln.sceneBreak) { ch.parts.push(`<p class="scene">${esc((ln.runs || []).map((r) => r.t).join(""))}</p>`); continue; }
    if (isEmpty(ln)) { ch.parts.push('<p class="blank"> </p>'); continue; }
    const onlyPic = (ln.runs || []).length && ln.runs.every((r) => r.img || !(r.t || "").trim());
    const cls = onlyPic ? null : ln.align === "center" ? "c" : ln.align === "right" ? "r" : ln.noIndent ? "first" : null;
    const inner = runsHtml(ln.runs, picture, note);
    if (onlyPic) ch.parts.push(`<div class="pic">${inner}</div>`);
    else if (kind === "quote") ch.parts.push(`<blockquote><p class="first">${inner}</p></blockquote>`);
    else ch.parts.push(`<p${cls ? ` class="${cls}"` : ""}>${inner}</p>`);
  }
  close();
  // the pictures: into images/, each once
  const done = new Map();
  for (let k = 0; k < pics.length; k++) {
    let b = null;
    try { b = pictureBytes ? await pictureBytes(pics[k]) : null; } catch (e) { b = null; }
    const kind = b && sniff(b);
    let tag = "";
    if (kind) {
      const key = b.length + ":" + b[100] + ":" + b[b.length - 1];
      let name = done.get(key);
      if (!name) { name = `image${images.length + 1}.${kind[0]}`; images.push([name, b, kind[1]]); done.set(key, name); }
      tag = `<img src="images/${name}" alt=""/>`;
    }
    for (const c of chapters) c.parts = c.parts.map((p) => p.split(`\u0000PIC${k}\u0000`).join(tag));
  }
  return chapters;
}

export async function epubBlob(lines, meta, pictureBytes) {
  const title = (meta.title || "Untitled").trim();
  const author = (meta.author || "").trim();
  const lang = meta.language || "en-GB";
  const ident = meta.identifier || "urn:uuid:" + (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
  const images = [], endnotes = [];
  let chapters = await chaptersOf(lines, pictureBytes, images, meta.notes, endnotes);
  if (!chapters.length) chapters = [{ title, file: "chapter001.xhtml", parts: ["<p> </p>"], subs: [], notes: [] }];
  const noteText = (t) => esc(t).replace(/\n/g, "<br/>");
  const files = [];      // [href, id, media type, properties, content, in spine]
  if (meta.title_page !== false) {
    const tp = `<div class="titlepage"><h1>${esc(title)}</h1>${author ? `<p class="author">${esc(author)}</p>` : ""}</div>`;
    files.push(["title.xhtml", "titlepage", "application/xhtml+xml", "", xhtml(title, tp, lang), true]);
  }
  const items = chapters.map((c) => `<li><a href="${c.file}">${esc(c.title)}</a>${c.subs.length ?
    `\n<ol>${c.subs.map(([a, t]) => `<li><a href="${c.file}#${a}">${esc(t)}</a></li>`).join("")}</ol>` : ""}</li>`);
  const marks = [];
  if (endnotes.length) items.push('<li><a href="notes.xhtml">Notes</a></li>');
  if (meta.title_page !== false) marks.push('<li><a epub:type="titlepage" href="title.xhtml">Title page</a></li>');
  marks.push(`<li><a epub:type="bodymatter" href="${chapters[0].file}">Start of text</a></li>`);
  files.push(["nav.xhtml", "nav", "application/xhtml+xml", "nav", xhtml("Contents",
    `<nav epub:type="toc" id="toc">\n<h1>Contents</h1>\n<ol>\n${items.join("\n")}\n</ol>\n</nav>\n` +
    `<nav epub:type="landmarks" id="landmarks" hidden="">\n<ol>\n${marks.join("\n")}\n</ol>\n</nav>`, lang), false]);
  chapters.forEach((c, i) => files.push([c.file, "c" + String(i + 1).padStart(3, "0"), "application/xhtml+xml", "",
    xhtml(c.title, `<section epub:type="chapter">\n${c.parts.join("\n")}` + (c.notes.length ? `\n<section class="notes" epub:type="footnotes">\n` +
      c.notes.map(([nid, label, t]) => `<aside class="note" epub:type="footnote" id="${nid}"><p><a href="#ref-${nid}">${label}</a> ${noteText(t)}</p></aside>`).join("\n") +
      "\n</section>" : "") + `\n</section>`, lang), true]));
  if (endnotes.length) files.push(["notes.xhtml", "notes", "application/xhtml+xml", "", xhtml("Notes",
    `<section epub:type="endnotes"><h1>Notes</h1>\n` + endnotes.map(([nid, label, t, file]) =>
      `<aside epub:type="endnote" id="${nid}"><p><a href="${file}#ref-${nid}">${label}</a> ${noteText(t)}</p></aside>`).join("\n") + "\n</section>", lang), true]);
  for (const [name, data, mt] of images) files.push(["images/" + name, "img-" + name.split(".")[0], mt, "", data, false]);
  files.push(["style.css", "css", "text/css", "", EPUB_CSS, false]);
  let np = 0;
  const point = (label, src, inner = "") => { np += 1; return `<navPoint id="np${np}" playOrder="${np}"><navLabel><text>${esc(label)}</text></navLabel><content src="${src}"/>${inner}</navPoint>`; };
  const pts = chapters.map((c) => { np += 1; const me = np;
    const sub = c.subs.map(([a, t]) => point(t, `${c.file}#${a}`)).join("");
    return `<navPoint id="np${me}" playOrder="${me}"><navLabel><text>${esc(c.title)}</text></navLabel><content src="${c.file}"/>${sub}</navPoint>`; });
  const ncx = '<?xml version="1.0" encoding="utf-8"?>\n<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">' +
    `<head><meta name="dtb:uid" content="${esc(ident)}"/><meta name="dtb:depth" content="2"/>` +
    '<meta name="dtb:totalPageCount" content="0"/><meta name="dtb:maxPageNumber" content="0"/></head>' +
    `<docTitle><text>${esc(title)}</text></docTitle><navMap>${pts.join("")}</navMap></ncx>\n`;
  files.push(["toc.ncx", "ncx", "application/x-dtbncx+xml", "", ncx, false]);
  const modified = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const manifest = files.map(([h, i, mt, pr]) => `<item id="${i}" href="${h}" media-type="${mt}"${pr ? ` properties="${pr}"` : ""}/>`).join("\n");
  const spine = files.filter((f) => f[5]).map(([, i]) => `<itemref idref="${i}"/>`).join("\n");
  const opf = '<?xml version="1.0" encoding="utf-8"?>\n' +
    `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${esc(lang)}">\n` +
    '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n' +
    `<dc:identifier id="bookid">${esc(ident)}</dc:identifier>\n<dc:title>${esc(title)}</dc:title>\n` +
    (author ? `<dc:creator>${esc(author)}</dc:creator>\n` : "") +
    `<dc:language>${esc(lang)}</dc:language>\n<meta property="dcterms:modified">${modified}</meta>\n` +
    `</metadata>\n<manifest>\n${manifest}\n</manifest>\n<spine toc="ncx">\n${spine}\n</spine>\n</package>\n`;
  const container = '<?xml version="1.0" encoding="utf-8"?>\n' +
    '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">' +
    '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>\n';
  const bytes = await zip([
    ["mimetype", "application/epub+zip", false],
    ["META-INF/container.xml", container, true],
    ["OEBPS/content.opf", opf, true],
    ...files.map(([h, , mt, , data]) => ["OEBPS/" + h, data, !mt.startsWith("image/")]),
  ]);
  return new Blob([bytes], { type: "application/epub+zip" });
}

// ------------------------------------------------------------------ the print view (and Save as PDF)
export const PRINT_LOOK = {
  own: { font: 'Cambria, Caladea, "Liberation Serif", serif', size: "12pt", line: 1.15, indent: "0", justify: false, gap: "0" },
  manuscript: { font: '"Times New Roman", "Liberation Serif", Tinos, serif', size: "12pt", line: 2, indent: "0.5in", justify: false, gap: "0" },
  reading: { font: null, size: "11.5pt", line: 1.35, indent: "1.5em", justify: true, gap: "0" },
};

export function printHtml(lines, layout, meta) {
  const look = PRINT_LOOK[layout] || PRINT_LOOK.own;
  const picture = (img) => meta.pictureUrl ? `<img class="pic" src="${esc(meta.pictureUrl(img) || "")}" alt="">` : "";
  const out = [];
  // footnotes at the end of their chapter, endnotes at the end of the book (a printed page can't hold them at its foot)
  let fns = [];
  const ens = [];
  const note = (k, id) => { const t = (meta.notes && meta.notes.get(k + id)) || ""; (k === "e" ? ens : fns).push([noteLabel(k, id), t]); return `<sup>${noteLabel(k, id)}</sup>`; };
  const flushNotes = () => {
    if (!fns.length) return;
    out.push(`<div class="fns">${fns.map(([l, t]) => `<p><sup>${l}</sup> ${esc(t).replace(/\n/g, "<br>")}</p>`).join("")}</div>`);
    fns = [];
  };
  let list = null;
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const ln of lines) {
    const kind = ln.kind;
    if (kind !== "ul" && kind !== "ol") close();
    const pb = ln.pageBreak ? " pb" : "";
    if (ln.titlePage) { out.push(`<p class="tp-${ln.titlePage}">${runsHtml(ln.runs, picture, note)}</p>`); continue; }
    if (kind === "h1") flushNotes();
    if (kind && kind[0] === "h") { out.push(`<h${kind[1]} class="ch${pb}">${runsHtml(ln.runs, picture, note)}</h${kind[1]}>`); continue; }
    if (kind === "ul" || kind === "ol") {
      if (list !== kind) { close(); out.push(`<${kind}>`); list = kind; }
      out.push(`<li>${runsHtml(ln.runs, picture, note)}</li>`);
      continue;
    }
    if (ln.table) { out.push(tableHtml(ln.table)); continue; }
    if (ln.sceneBreak) { out.push(`<p class="scene">${esc((ln.runs || []).map((r) => r.t).join(""))}</p>`); continue; }
    if (isEmpty(ln)) { out.push('<p class="blank">&nbsp;</p>'); continue; }
    const cls = ["bp", ln.align ? "a-" + ln.align : "", ln.noIndent || layout === "own" ? "first" : "", pb.trim()].filter(Boolean).join(" ");
    if (kind === "quote") out.push(`<blockquote class="${cls}">${runsHtml(ln.runs, picture, note)}</blockquote>`);
    else out.push(`<p class="${cls}">${runsHtml(ln.runs, picture, note)}</p>`);
  }
  close();
  flushNotes();
  if (ens.length) out.push(`<h1 class="ch pb">Notes</h1><div class="ens">${ens.map(([l, t]) => `<p><sup>${l}</sup> ${esc(t).replace(/\n/g, "<br>")}</p>`).join("")}</div>`);
  const head = layout === "manuscript" && meta.header ? `@top-right { content: "${meta.header.replace(/["\\]/g, "")} / " counter(page); font: 10pt ${look.font}; }` : "";
  const foot = layout === "reading" ? `@bottom-center { content: counter(page); font: 9pt ${meta.font || look.font}; }` :
    layout === "own" ? `@bottom-center { content: counter(page); font: 9pt ${look.font}; }` : "";
  const css = `@page { size: A4; margin: 2.54cm; ${head} ${foot} }
@page :first { @top-right { content: none; } ${meta.titlePage ? "@bottom-center { content: none; }" : ""} }
body.print-joined #printdoc.book { font-family: ${look.font || meta.font}; font-size: ${look.size}; line-height: ${look.line}; color: #000; }
body.print-joined #printdoc.book p { margin: 0; ${look.justify ? "text-align: justify; hyphens: auto;" : ""} }
body.print-joined #printdoc.book p.bp { text-indent: ${look.indent}; }
body.print-joined #printdoc.book p.first, body.print-joined #printdoc.book p.a-center, body.print-joined #printdoc.book p.a-right { text-indent: 0; }
body.print-joined #printdoc.book p.a-center { text-align: center; } body.print-joined #printdoc.book p.a-right { text-align: right; }
body.print-joined #printdoc.book p.scene { text-align: center; text-indent: 0; margin: ${layout === "manuscript" ? "0" : "0.8em 0"}; }
body.print-joined #printdoc.book .pb { break-before: page; }
body.print-joined #printdoc.book h1 { font-size: ${layout === "manuscript" ? "12pt" : "1.6em"}; font-weight: ${layout === "manuscript" ? "normal" : "600"};
  text-align: center; margin: ${layout === "manuscript" ? "3in 0 1em" : "1.6in 0 1.2em"}; break-after: avoid; }
body.print-joined #printdoc.book h2 { font-size: ${layout === "manuscript" ? "12pt" : "1.25em"}; text-align: center; margin: 1.4em 0 0.8em; break-after: avoid; }
body.print-joined #printdoc.book h3 { font-size: 1em; margin: 1.2em 0 0.5em; break-after: avoid; }
body.print-joined #printdoc.book .tp-title { font-size: ${layout === "manuscript" ? "14pt" : "2em"}; text-align: center; margin-top: 3.2in; text-indent: 0; }
body.print-joined #printdoc.book .tp-author { font-size: 1.2em; text-align: center; margin-top: 1em; text-indent: 0; }
body.print-joined #printdoc.book .tp-words { text-align: center; margin-top: 2em; text-indent: 0; font-size: 0.95em; }
body.print-joined #printdoc.book img.pic { max-width: 100%; display: block; margin: 0.6em auto; }
body.print-joined #printdoc.book blockquote { margin: 0.6em 2em; }
body.print-joined #printdoc.book table { border-collapse: collapse; margin: 0.6em auto; }
body.print-joined #printdoc.book td { border: 0.5pt solid #555; padding: 2pt 6pt; vertical-align: top; }
body.print-joined #printdoc.book .fns { margin-top: 1.2em; padding-top: 0.4em; border-top: 0.5pt solid #777; font-size: 0.85em; line-height: 1.3; }
body.print-joined #printdoc.book .fns p, body.print-joined #printdoc.book .ens p { text-indent: 0; margin: 0 0 0.3em; }
body.print-joined #printdoc.book .ens { font-size: 0.9em; line-height: 1.35; }`;
  return { html: out.join("\n"), css };
}
