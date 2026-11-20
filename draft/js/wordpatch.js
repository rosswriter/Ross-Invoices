// Writing a Word file back into itself (a Ross Writer scene edited on the tablet).
//
// The scene's own package is kept: its styles, fonts, page setup, headers and everything else Ross
// Writer or Word put in it. Only the body is written again, and in the body every paragraph that's the
// same as it was (the same words, the same bold, italic... ) is the very paragraph it was, untouched:
// its indent, its alignment, its font, its bookmarks. A paragraph you changed keeps its paragraph's
// settings (indent, alignment, style) and the look of its first words (font, size, colour); a new
// paragraph takes the scene's usual look. So Ross Writer gets back the file it gave, with your words in it.
//
// Word comments are kept: a paragraph you didn't touch keeps its comment marks as they were; in one you
// changed they stay at the same words (moved with the words round them); a comment whose words you deleted
// goes, as in Word. readComments() gives them for the page's list.
//
// Scenes with things this can't keep (footnotes, tracked changes, tables...) aren't written
// at all: blockers() says which, and the tablet shows them read-only.
import { unzip, zip, imageSize, extOf, noteToken, splitNotes, noteParasXml, emptyNotesXml, NOTE_A, NOTE_STYLES } from "./wordio.js?v=1.8.3";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PR = "http://schemas.openxmlformats.org/package/2006/relationships";
const CT = "http://schemas.openxmlformats.org/package/2006/content-types";
const WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const A_ = "http://schemas.openxmlformats.org/drawingml/2006/main";
const PIC = "http://schemas.openxmlformats.org/drawingml/2006/picture";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/";
const OBJ = "￼";
const TEXT_WIDTH_EMU = 5760720;

// ------------------------------------------------------------------ what the tablet can't keep
const BLOCKERS = [
  // (RossDraft 1.2: footnotes and endnotes are kept and edited: their marks are in the page's words)
  [/<w:(ins|del|moveFrom|moveTo)\b|<w:(rPr|pPr|sectPr|tblPr|tcPr|trPr)Change\b/, "tracked changes"],
  [/<w:tbl\b/, "a table"],
  [/<w:txbxContent\b|<mc:AlternateContent\b|<w:object\b/, "a text box or shape"],
  [/<m:oMath/, "an equation"],
  [/<w:sdt\b/, "a content control"],
  [/<w:fldChar\b|<w:fldSimple\b|<w:instrText\b/, "a field"],
  [/<w:vanish\b(?![^>]*w:val="(0|false)")/, "hidden text"],
  [/<w:altChunk\b/, "embedded content"],
];

export function blockers(docText) {
  const out = [];
  for (const [re, what] of BLOCKERS) if (re.test(docText)) out.push(what);
  return out;
}

// ------------------------------------------------------------------ comparing lines
const FLAGS = "bisuh";
function sigOf(ln) {
  const runs = [];
  for (const r of ln.runs || []) {
    if (r.img) {
      runs.push(["", "", "", picName(r.img)]);
      continue;
    }
    const t = (r.t || "").split(OBJ).join("");
    if (!t) continue;
    const f = [...FLAGS].filter((k) => r.f && r.f.has(k)).join("");
    const h = r.href || "";
    const last = runs[runs.length - 1];
    if (last && !last[3] && last[1] === f && last[2] === h) last[0] += t;
    else runs.push([t, f, h, ""]);
  }
  const k = ln.kind || "";
  const sig = [k, k === "ul" || k === "ol" ? ln.depth || 1 : 0, ln.code ? 1 : 0, runs];
  if (ln.align && !ln.code) sig.push(ln.align);       // (unaligned lines' signatures as before 1.8.3)
  return JSON.stringify(sig);
}

// a picture's file name, wherever it's written from (wordio's name, or a note's picture)
export function picName(img) {
  if (typeof img === "string") return img;
  const s = (img.target && img.target.join ? img.target.join("/") : img.src || "") || "";
  let name = s.split("/").pop() || "";
  try { name = decodeURIComponent(name.replace(/^<|>$/g, "")); } catch (e) { /* as it is */ }
  return name;
}


// which new line is which old one: matched[j] = i, or -1 (common start and end, then the longest
// common run between; very big changes are paired in order instead)
function align(A, B) {
  const n = A.length, m = B.length;
  const matched = new Array(m).fill(-1), paired = new Array(m).fill(-1);
  let s = 0;
  while (s < n && s < m && A[s] === B[s]) { matched[s] = s; s++; }
  let e = 0;
  while (e < n - s && e < m - s && A[n - 1 - e] === B[m - 1 - e]) { matched[m - 1 - e] = n - 1 - e; e++; }
  const a0 = s, a1 = n - e, b0 = s, b1 = m - e;
  const na = a1 - a0, nb = b1 - b0;
  const pairs = [];   // [i, j] matched in the middle
  if (na && nb && na * nb <= 4e6) {
    const L = new Int32Array((na + 1) * (nb + 1));
    const at = (i, j) => i * (nb + 1) + j;
    for (let i = na - 1; i >= 0; i--) {
      for (let j = nb - 1; j >= 0; j--) {
        L[at(i, j)] = A[a0 + i] === B[b0 + j] ? L[at(i + 1, j + 1)] + 1 : Math.max(L[at(i + 1, j)], L[at(i, j + 1)]);
      }
    }
    let i = 0, j = 0;
    while (i < na && j < nb) {
      if (A[a0 + i] === B[b0 + j]) { pairs.push([a0 + i, b0 + j]); i++; j++; }
      else if (L[at(i + 1, j)] >= L[at(i, j + 1)]) i++;
      else j++;
    }
  }
  for (const [i, j] of pairs) matched[j] = i;
  // the gaps between: a changed line takes the place (and the look) of the old one there
  let pi = a0, pj = b0;
  const gap = (ia, ib, ja, jb) => { for (let k = 0; k < Math.min(ib - ia, jb - ja); k++) paired[ja + k] = ia + k; };
  for (const [i, j] of pairs) { gap(pi, i, pj, j); pi = i + 1; pj = j + 1; }
  gap(pi, a1, pj, b1);
  return { matched, paired };
}

// ------------------------------------------------------------------ XML helpers
const parse = (t) => new DOMParser().parseFromString(t, "application/xml");
const ser = (d) => new XMLSerializer().serializeToString(d);
const wkids = (el, local) => [...el.children].filter((c) => c.namespaceURI === W && (!local || c.localName === local));
const wkid = (el, local) => (el ? wkids(el, local)[0] || null : null);
const wval = (el, name = "val") => (el ? el.getAttributeNS(W, name) || el.getAttribute("w:" + name) : null);

// CT_RPr's order (Word wants it)
const RPR_ORDER = ["rStyle", "rFonts", "b", "bCs", "i", "iCs", "caps", "smallCaps", "strike", "dstrike", "outline",
  "shadow", "emboss", "imprint", "noProof", "snapToGrid", "vanish", "webHidden", "color", "spacing", "w", "kern",
  "position", "sz", "szCs", "highlight", "u", "effect", "bdr", "shd", "fitText", "vertAlign", "rtl", "cs", "em",
  "lang", "eastAsianLayout", "specVanish", "oMath"];
const OURS = new Set(["rStyle", "b", "bCs", "i", "iCs", "strike", "dstrike", "highlight", "u", "shd", "vanish",
  "specVanish", "webHidden", "rPrChange"]);

function sortRpr(rpr) {
  const rank = (c) => {
    if (c.namespaceURI !== W) return 1000;
    const k = RPR_ORDER.indexOf(c.localName);
    return k < 0 ? 999 : k;
  };
  const kids = [...rpr.children].map((c, k) => [rank(c), k, c]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  for (const [, , c] of kids) rpr.appendChild(c);
}

// CT_PPr's order, for what we put in
const PPR_ORDER = ["pStyle", "keepNext", "keepLines", "pageBreakBefore", "framePr", "widowControl", "numPr",
  "suppressLineNumbers", "pBdr", "shd", "tabs", "suppressAutoHyphens", "kinsoku", "wordWrap", "overflowPunct",
  "topLinePunct", "autoSpaceDE", "autoSpaceDN", "bidi", "adjustRightInd", "snapToGrid", "spacing", "ind",
  "contextualSpacing", "mirrorIndents", "suppressOverlap", "jc", "textDirection", "textAlignment",
  "textboxTightWrap", "outlineLvl", "divId", "cnfStyle", "rPr", "sectPr", "pPrChange"];
function sortPpr(ppr) {
  const rank = (c) => {
    if (c.namespaceURI !== W) return 1000;
    const k = PPR_ORDER.indexOf(c.localName);
    return k < 0 ? 999 : k;
  };
  const kids = [...ppr.children].map((c, k) => [rank(c), k, c]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  for (const [, , c] of kids) ppr.appendChild(c);
}

// ------------------------------------------------------------------ comments
const W14 = "http://schemas.microsoft.com/office/word/2010/wordml";
const W15 = "http://schemas.microsoft.com/office/word/2012/wordml";
const W16CID = "http://schemas.microsoft.com/office/word/2016/wordml/cid";
const W16CEX = "http://schemas.microsoft.com/office/word/2018/wordml/cex";
const isW = (e, local) => e.namespaceURI === W && e.localName === local;
const isRef = (e) => isW(e, "r") && !!wkid(e, "commentReference");

// a paragraph's words as the page has them (a picture one character, a tab a space), and where in them
// each comment mark sits: [{node, kind: "start"|"end"|"ref", id, off}]
function textAndMarks(p) {
  let text = "";
  const marks = [];
  const walk = (el) => {
    for (const c of el.children) {
      if (c.namespaceURI !== W) {
        if (c.localName === "AlternateContent") walk(c);
        continue;
      }
      const l = c.localName;
      if (l === "commentRangeStart" || l === "commentRangeEnd") {
        marks.push({ node: c, kind: l === "commentRangeStart" ? "start" : "end", id: wval(c, "id"), off: text.length });
      } else if (isRef(c)) {
        marks.push({ node: c, kind: "ref", id: wval(wkid(c, "commentReference"), "id"), off: text.length });
      } else if (l === "t") text += c.textContent;
      else if (l === "footnoteReference" || l === "endnoteReference") text += noteToken(l[0], wval(c, "id"));
      else if (l === "tab" || l === "noBreakHyphen") text += l === "tab" ? " " : "-";
      else if (l === "drawing" || l === "pict") text += OBJ;
      else if (l === "pPr" || l === "rPr" || l === "del" || l === "moveFrom") continue;
      else walk(c);
    }
  };
  walk(p);
  return { text, marks };
}

// the place in a new paragraph's words for a mark that was at off in the old words
function mapOffset(oldT, newT, off, kind) {
  let pre = 0;
  const mx = Math.min(oldT.length, newT.length);
  while (pre < mx && oldT[pre] === newT[pre]) pre++;
  let suf = 0;
  while (suf < mx - pre && oldT[oldT.length - 1 - suf] === newT[newT.length - 1 - suf]) suf++;
  if (off <= pre) return off;
  if (off >= oldT.length - suf) return newT.length - (oldT.length - off);
  // in the words that changed: a start before them, an end after them (the comment covers the change)
  return kind === "start" ? pre : newT.length - suf;
}

// a mark into a paragraph at offset off of its words: between runs, a run split there if need be (its pieces
// of text, tabs and pictures kept on either side). A run inside something else (a tracked change, a field) isn't
// split: the mark goes before it (a start) or after it (an end), so the comment covers it whole.
const runLen = (c) => (c.namespaceURI !== W ? 0 : c.localName === "t" ? c.textContent.length
  : c.localName === "footnoteReference" || c.localName === "endnoteReference" ? noteToken(c.localName[0], wval(c, "id")).length
  : ["tab", "noBreakHyphen", "drawing", "pict"].includes(c.localName) ? 1 : 0);

function placeAt(doc, p, off, node, kind = "start") {
  let at = 0;
  const runs = [...p.getElementsByTagNameNS(W, "r")].filter((r) => !isRef(r));
  for (const r of runs) {
    const len = [...r.children].reduce((n, c) => n + runLen(c), 0);
    const host = r.parentNode;
    const plain = host === p || isW(host, "hyperlink");
    let box = r;
    if (!plain) { while (box.parentNode && box.parentNode !== p && !isW(box.parentNode, "hyperlink")) box = box.parentNode; }
    if (off <= at) { box.parentNode.insertBefore(node, box); return; }
    if (off < at + len) {
      if (!plain) {
        if (kind === "start") box.parentNode.insertBefore(node, box);
        else box.parentNode.insertBefore(node, box.nextSibling);
        return;
      }
      // split the run at off - at
      let k = off - at;
      const second = r.cloneNode(false);
      const rpr = wkid(r, "rPr");
      if (rpr) second.appendChild(rpr.cloneNode(true));
      let moving = false;
      for (const c of [...r.children]) {
        if (isW(c, "rPr")) continue;
        if (moving) { second.appendChild(c); continue; }
        const l = runLen(c);
        if (k <= 0) { moving = true; second.appendChild(c); continue; }
        if (isW(c, "t") && k < l) {
          const t2 = c.cloneNode(false);
          t2.setAttribute("xml:space", "preserve");
          c.setAttribute("xml:space", "preserve");
          t2.textContent = c.textContent.slice(k);
          c.textContent = c.textContent.slice(0, k);
          second.appendChild(t2);
          moving = true;
          continue;
        }
        k -= l;
      }
      host.insertBefore(second, r.nextSibling);
      host.insertBefore(node, second);
      return;
    }
    at += len;
  }
  p.appendChild(node);
}

function partByType(rels, mainPart, type) {
  for (const r of rels.getElementsByTagNameNS(PR, "Relationship")) {
    if ((r.getAttribute("Type") || "").endsWith("/" + type)) return resolveTarget(mainPart, r.getAttribute("Target"));
  }
  return null;
}

// the scene's comments, for the list beside the page: [{id, author, initials, date, text, words, parent, done}]
export async function readComments(files) {
  const get = async (name) => (files.has(name) ? dec(await files.get(name)()) : null);
  const relsT = await get("word/_rels/document.xml.rels");
  if (!relsT) return [];
  const rels = parse(relsT);
  const cName = partByType(rels, "word/document.xml", "comments");
  const cT = cName && await get(cName);
  if (!cT) return [];
  const cdoc = parse(cT);
  const out = [], byPara = new Map();
  for (const c of cdoc.getElementsByTagNameNS(W, "comment")) {
    const paras = [...c.getElementsByTagNameNS(W, "p")];
    const text = paras.map((p) => textAndMarks(p).text.split(OBJ).join("")).join("\n").trim();
    const item = { id: wval(c, "id"), author: wval(c, "author") || "", initials: wval(c, "initials") || "",
      date: wval(c, "date") || "", text, words: "", parent: null, done: false };
    out.push(item);
    const last = paras[paras.length - 1];
    const pid = last && (last.getAttributeNS(W14, "paraId") || last.getAttribute("w14:paraId"));
    if (pid) byPara.set(pid, item);
  }
  const exName = partByType(rels, "word/document.xml", "commentsExtended");
  const exT = exName && await get(exName);
  if (exT) {
    for (const e of parse(exT).getElementsByTagNameNS(W15, "commentEx")) {
      const item = byPara.get(e.getAttributeNS(W15, "paraId") || e.getAttribute("w15:paraId"));
      if (!item) continue;
      const done = e.getAttributeNS(W15, "done") || e.getAttribute("w15:done");
      item.done = done === "1" || done === "true";
      const par = byPara.get(e.getAttributeNS(W15, "paraIdParent") || e.getAttribute("w15:paraIdParent"));
      if (par) item.parent = par.id;
    }
  }
  // the words each one is on
  const dT = await get("word/document.xml");
  if (dT) {
    const open = new Set(), words = new Map();
    const body = parse(dT).getElementsByTagNameNS(W, "body")[0];
    const walk = (el) => {
      for (const c of el.children) {
        if (c.namespaceURI !== W) { walk(c); continue; }
        const l = c.localName;
        if (l === "commentRangeStart") open.add(wval(c, "id"));
        else if (l === "commentRangeEnd") open.delete(wval(c, "id"));
        else if (l === "t" || l === "tab") {
          const t = l === "t" ? c.textContent : " ";
          for (const id of open) words.set(id, (words.get(id) || "") + t);
        } else if (l === "del" || l === "moveFrom" || l === "rPr" || l === "pPr") continue;
        else {
          walk(c);
          if (l === "p") for (const id of open) words.set(id, (words.get(id) || "") + "\n");
        }
      }
    };
    if (body) walk(body);
    for (const item of out) item.words = (words.get(item.id) || "").replace(/\s+/g, " ").trim();
  }
  return out;
}

// ------------------------------------------------------------------ the package
async function loadAll(files) {
  const out = new Map();
  for (const [name, get] of files) out.set(name, await get());
  return out;
}
const dec = (b) => (typeof b === "string" ? b : new TextDecoder().decode(b));

function relsPathFor(part) {   // word/document.xml -> word/_rels/document.xml.rels
  const k = part.lastIndexOf("/");
  return part.slice(0, k + 1) + "_rels/" + part.slice(k + 1) + ".rels";
}

function resolveTarget(base, target) {   // a relationship's target, as a part name
  if (target.startsWith("/")) return target.slice(1);
  const parts = base.split("/").slice(0, -1);
  for (const p of target.split("/")) {
    if (p === "..") parts.pop();
    else if (p !== ".") parts.push(p);
  }
  return parts.join("/");
}

// ------------------------------------------------------------------ the writing
// files: wordio.unzip()'s map of the scene; old: readDocx(.., {keep}) lines of it (each with .src);
// oldSigs: their signatures as the note shows them (or null: from old); lines: wordio lines to write;
// pictureBytes(img) -> Uint8Array|null for pictures that aren't in the scene already.
// notes (RossDraft 1.2): the scene's footnotes and endnotes, "f17" -> their words; those the text still marks are
// kept (rewritten only if their words changed, or all when forceNotes), new ones added, the rest dropped.
// Without notes, the Word file's notes are left as they are.
export async function patchDocx(files, old, oldSigs, lines, pictureBytes, notes = null, forceNotes = false) {
  const all = await loadAll(files);
  const mainPart = (() => {
    const rels = all.get("_rels/.rels");
    if (rels) {
      for (const r of parse(dec(rels)).getElementsByTagNameNS(PR, "Relationship")) {
        if ((r.getAttribute("Type") || "").endsWith("/officeDocument")) return resolveTarget("", r.getAttribute("Target"));
      }
    }
    return "word/document.xml";
  })();
  const doc = parse(dec(all.get(mainPart)));
  const body = doc.getElementsByTagNameNS(W, "body")[0];
  const kids = [...body.children];
  const sectPr = kids.length && kids[kids.length - 1].namespaceURI === W && kids[kids.length - 1].localName === "sectPr"
    ? kids[kids.length - 1] : null;
  const relsName = relsPathFor(mainPart);
  const relsDoc = all.has(relsName) ? parse(dec(all.get(relsName)))
    : parse(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PR}"/>`);
  const relsRoot = relsDoc.documentElement;
  const relEls = () => [...relsRoot.getElementsByTagNameNS(PR, "Relationship")];
  const ctDoc = parse(dec(all.get("[Content_Types].xml")));
  const ctRoot = ctDoc.documentElement;
  const partDir = mainPart.slice(0, mainPart.lastIndexOf("/") + 1);   // "word/"

  // --- styles: the ones the scene has, by name; ours added where it has none
  const stylesName = (() => {
    for (const r of relEls()) if ((r.getAttribute("Type") || "").endsWith("/styles")) return resolveTarget(mainPart, r.getAttribute("Target"));
    return null;
  })();
  const stylesDoc = stylesName && all.has(stylesName) ? parse(dec(all.get(stylesName))) : null;
  let stylesChanged = false;
  const styleIdByName = new Map(), styleIds = new Set();
  if (stylesDoc) {
    for (const st of stylesDoc.getElementsByTagNameNS(W, "style")) {
      const id = wval(st, "styleId");
      styleIds.add(id);
      const nm = (wval(wkid(st, "name")) || "").toLowerCase();
      if (nm && !styleIdByName.has(nm)) styleIdByName.set(nm, id);
    }
  }
  const OUR_STYLES = {
    Quote: '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/>' +
      '<w:pPr><w:ind w:left="567" w:right="284"/></w:pPr></w:style>',
    ListParagraph: '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/>' +
      '<w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="720"/></w:pPr></w:style>',
    Code: '<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/>' +
      '<w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="20"/></w:rPr></w:style>',
    Hyperlink: '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/>' +
      '<w:rPr><w:color w:val="1A5FB4"/><w:u w:val="single"/></w:rPr></w:style>',
  };
  for (const m of NOTE_STYLES.matchAll(/<w:style [^>]*w:styleId="(\w+)"[\s\S]*?<\/w:style>/g)) OUR_STYLES[m[1]] = m[0];
  for (let k = 1; k <= 6; k++) {
    OUR_STYLES["Heading" + k] = `<w:style w:type="paragraph" w:styleId="Heading${k}"><w:name w:val="heading ${k}"/>` +
      '<w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/>' +
      `<w:spacing w:before="${k < 3 ? 240 : 160}" w:after="80"/><w:outlineLvl w:val="${k - 1}"/></w:pPr>` +
      `<w:rPr><w:b/><w:sz w:val="${[40, 32, 28, 24, 24, 24][k - 1]}"/></w:rPr></w:style>`;
  }
  const styleFor = (names, ours) => {
    for (const n of names) if (styleIdByName.has(n)) return styleIdByName.get(n);
    if (!stylesDoc) return ours;
    if (!styleIds.has(ours)) {
      const el = parse(`<w:x xmlns:w="${W}">${OUR_STYLES[ours]}</w:x>`).documentElement.firstElementChild;
      stylesDoc.documentElement.appendChild(stylesDoc.importNode(el, true));
      styleIds.add(ours);
      styleIdByName.set(names[0], ours);
      stylesChanged = true;
    }
    return ours;
  };

  // --- numbering, for new lists that have none to follow
  let numDoc = null, numName = null, numChanged = false;
  for (const r of relEls()) {
    if ((r.getAttribute("Type") || "").endsWith("/numbering")) numName = resolveTarget(mainPart, r.getAttribute("Target"));
  }
  if (numName && all.has(numName)) numDoc = parse(dec(all.get(numName)));
  const newNum = (bullet) => {
    if (!numDoc) {
      numName = partDir + "numbering.xml";
      numDoc = parse(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="${W}"/>`);
      addRel("numbering", "numbering.xml");
      addOverride("/" + numName, "application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml");
    }
    const root = numDoc.documentElement;
    const ids = (tag, attr) => [...root.getElementsByTagNameNS(W, tag)].map((e) => +wval(e, attr) || 0);
    const aid = Math.max(0, ...ids("abstractNum", "abstractNumId")) + 1;
    const nid = Math.max(0, ...ids("num", "numId")) + 1;
    let lv = "";
    for (let k = 0; k < 9; k++) {
      const ind = 720 * (k + 1);
      lv += bullet
        ? `<w:lvl w:ilvl="${k}"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="${"•◦▪"[k % 3]}"/>` +
          `<w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${ind}" w:hanging="360"/></w:pPr></w:lvl>`
        : `<w:lvl w:ilvl="${k}"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%${k + 1}."/>` +
          `<w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${ind}" w:hanging="360"/></w:pPr></w:lvl>`;
    }
    const frag = parse(`<w:x xmlns:w="${W}"><w:abstractNum w:abstractNumId="${aid}"><w:multiLevelType w:val="hybridMultilevel"/>` +
      `${lv}</w:abstractNum><w:num w:numId="${nid}"><w:abstractNumId w:val="${aid}"/></w:num></w:x>`).documentElement;
    const [abs, num] = [...frag.children].map((c) => numDoc.importNode(c, true));
    const firstNum = wkid(root, "num");
    root.insertBefore(abs, firstNum || wkid(root, "numIdMacAtCleanup"));
    root.insertBefore(num, wkid(root, "numIdMacAtCleanup"));
    numChanged = true;
    return String(nid);
  };

  // --- relationships and content types
  let relN = 0;
  const takenIds = () => new Set(relEls().map((r) => r.getAttribute("Id")));
  function addRel(type, target, external) {
    const taken = takenIds();
    let id;
    do { relN += 1; id = "rIdRN" + relN; } while (taken.has(id));
    const el = relsDoc.createElementNS(PR, "Relationship");
    el.setAttribute("Id", id);
    el.setAttribute("Type", REL + type);
    el.setAttribute("Target", target);
    if (external) el.setAttribute("TargetMode", "External");
    relsRoot.appendChild(el);
    return id;
  }
  function addOverride(part, type) {
    for (const o of ctRoot.getElementsByTagNameNS(CT, "Override")) if (o.getAttribute("PartName") === part) return;
    const el = ctDoc.createElementNS(CT, "Override");
    el.setAttribute("PartName", part);
    el.setAttribute("ContentType", type);
    ctRoot.appendChild(el);
  }
  function addDefault(ext, type) {
    for (const d of ctRoot.getElementsByTagNameNS(CT, "Default")) if ((d.getAttribute("Extension") || "").toLowerCase() === ext) return;
    const el = ctDoc.createElementNS(CT, "Default");
    el.setAttribute("Extension", ext);
    el.setAttribute("ContentType", type);
    ctRoot.insertBefore(el, ctRoot.firstElementChild);
  }
  const linkIds = new Map();
  const linkRel = (href) => {
    if (!linkIds.has(href)) linkIds.set(href, addRel("hyperlink", href, true));
    return linkIds.get(href);
  };
  // pictures: the scene's own (by name) keep their relationship; others are added
  const picRels = new Map();
  for (const r of relEls()) {
    if ((r.getAttribute("Type") || "").endsWith("/image") && r.getAttribute("TargetMode") !== "External") {
      const name = resolveTarget(mainPart, r.getAttribute("Target")).split("/").pop();
      if (!picRels.has(name)) picRels.set(name, r.getAttribute("Id"));
    }
  }
  let docPrId = 0;
  for (const e of doc.getElementsByTagNameNS(WP, "docPr")) docPrId = Math.max(docPrId, +e.getAttribute("id") || 0);
  for (const e of doc.getElementsByTagNameNS(PIC, "cNvPr")) docPrId = Math.max(docPrId, +e.getAttribute("id") || 0);
  let mediaN = 0;
  const pictureXml = async (img) => {
    const name = picName(img);
    let rid = picRels.get(name), data = null;
    if (rid) {
      const r = relEls().find((x) => x.getAttribute("Id") === rid);
      data = all.get(resolveTarget(mainPart, r.getAttribute("Target"))) || null;
    }
    if (!data) {
      data = await pictureBytes(img);
      if (!data) return "";
      const [ext, type] = extOf(data);
      let part;
      do { mediaN += 1; part = `${partDir}media/rn-image${mediaN}.${ext}`; } while (all.has(part));
      all.set(part, data);
      addDefault(ext, type);
      rid = addRel("image", part.slice(partDir.length));
      picRels.set(name, rid);
    }
    const size = imageSize(data) || [800, 600];
    const share = { small: 1 / 3, medium: 0.6 }[img && img.size] || 1;
    const cx = Math.min(size[0] * 9525, Math.floor(TEXT_WIDTH_EMU * share));
    const cy = Math.floor(cx * size[1] / Math.max(1, size[0]));
    docPrId += 1;
    const n = docPrId;
    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>` +
      `<wp:docPr id="${n}" name="Picture ${n}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/>` +
      '</wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      `<pic:pic><pic:nvPicPr><pic:cNvPr id="${n}" name="${xa(name)}"/><pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/>` +
      "</a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>";
  };

  // --- the scene's usual look: the commonest plain paragraph settings and the commonest run look
  const srcEl = (i) => kids[old[i].src];
  const firstTextRpr = (p) => {
    for (const r of p.getElementsByTagNameNS(W, "r")) {
      if (r.getElementsByTagNameNS(W, "t").length) return wkid(r, "rPr");
    }
    return null;
  };
  const markRpr = (p) => wkid(wkid(p, "pPr"), "rPr");
  const plainOld = old.map((ln, i) => (ln.src != null && !ln.kind && !ln.code ? i : -1)).filter((i) => i >= 0);
  const common = (vals) => {
    const n = new Map();
    let best = null, bn = 0;
    for (const v of vals) {
      const k = v ? ser(v) : "";
      const c = (n.get(k) || 0) + 1;
      n.set(k, c);
      if (c > bn) { bn = c; best = v; }
    }
    return best;
  };
  const plainP = plainOld.map(srcEl).filter((p) => p && p.localName === "p");
  const textP = plainP.filter((p) => (p.textContent || "").trim());
  const usualPpr = common((textP.length ? textP : plainP).map((p) => {
    const ppr = wkid(p, "pPr");
    if (!ppr) return null;
    const c = ppr.cloneNode(true);
    for (const x of wkids(c)) if (["sectPr", "pPrChange", "numPr"].includes(x.localName)) c.removeChild(x);
    return c;
  }));
  const usualRpr = common(textP.map(firstTextRpr).filter(Boolean)) || common(plainP.map(markRpr).filter(Boolean));
  // the first old paragraph of a kind (a heading of that level, a quote, a list...): its settings for new ones
  const firstOfKind = new Map();
  old.forEach((ln, i) => {
    if (ln.src == null || ln.code) return;
    const k = ln.kind ? ln.kind + (ln.kind === "ul" || ln.kind === "ol" ? ":" + (ln.depth || 1) : "") : "p";
    if (!firstOfKind.has(k)) firstOfKind.set(k, srcEl(i));
    if ((ln.kind === "ul" || ln.kind === "ol") && !firstOfKind.has(ln.kind)) firstOfKind.set(ln.kind, srcEl(i));
  });

  const baseRpr = (from) => {
    // (an old paragraph with no look of its own keeps none: its style gives it)
    let r = from ? firstTextRpr(from) || markRpr(from) : usualRpr;
    if (!r) return null;
    const c = r.cloneNode(true);
    for (const x of [...c.children]) if (x.namespaceURI === W && OURS.has(x.localName)) c.removeChild(x);
    // the paragraph mark's own (pPr/rPr) can carry ins/del: not for runs
    for (const x of [...c.children]) if (x.namespaceURI === W && ["ins", "del", "moveFrom", "moveTo"].includes(x.localName)) c.removeChild(x);
    return c;
  };

  // ordered lists: each run of them its own numbering (as wordio writes)
  const numFor = new Map();   // line index -> numId for new lists with nothing to follow

  const cleanPpr = (el, keepSect) => {
    const o = el && wkid(el, "pPr");
    if (!o) return null;
    const c = o.cloneNode(true);
    for (const x of wkids(c)) if (x.localName === "pPrChange" || (x.localName === "sectPr" && !keepSect)) c.removeChild(x);
    return c;
  };
  const kindKey = (ln) => (ln.code ? "code" : ln.kind || "p");

  const buildP = async (ln, j, tmpl, oneToOne) => {
    if (ln.table) {
      const { tableXml } = await import("./wordio.js?v=1.9.20");
      const pgSz = sectPr && wkid(sectPr, "pgSz"), pgMar = sectPr && wkid(sectPr, "pgMar");
      const num = (el, a, d) => { const v = el && (el.getAttributeNS(W, a) || el.getAttribute("w:" + a)); return v ? parseInt(v, 10) : d; };
      const width = num(pgSz, "w", 11906) - num(pgMar, "left", 1417) - num(pgMar, "right", 1417);
      return parse(`<w:x xmlns:w="${W}">${tableXml(ln.table, width)}</w:x>`).documentElement.firstElementChild;
    }
    const kind = ln.code ? null : ln.kind || null;
    const p = doc.createElementNS(W, "w:p");
    const same = !!(tmpl && tmpl.el && tmpl.key === kindKey(ln));
    // the paragraph settings: the old paragraph's here if it was the same kind; else one like it in the
    // scene; else the scene's usual (plain text) or the style for it
    let ppr = null, likeEl = null;
    if (same) ppr = cleanPpr(tmpl.el, oneToOne);
    else if (ln.code) ppr = null;
    else if (!kind) ppr = usualPpr ? usualPpr.cloneNode(true) : null;
    else {
      likeEl = firstOfKind.get(kind === "ul" || kind === "ol" ? kind + ":" + (ln.depth || 1) : kind) ||
        (kind === "ul" || kind === "ol" ? firstOfKind.get(kind) : null);
      ppr = cleanPpr(likeEl, false);
    }
    const ensurePpr = () => { if (!ppr) ppr = doc.createElementNS(W, "w:pPr"); return ppr; };
    const setStyle = (id) => {
      const pp = ensurePpr();
      let ps = wkid(pp, "pStyle");
      if (!ps) { ps = doc.createElementNS(W, "w:pStyle"); pp.insertBefore(ps, pp.firstChild); }
      ps.setAttributeNS(W, "w:val", id);
    };
    const dropNum = () => { if (ppr) for (const x of wkids(ppr, "numPr")) ppr.removeChild(x); };
    if (ln.code) {
      setStyle(styleFor(["code", "html preformatted", "preformatted text", "source code"], "Code"));
    } else if (kind && kind[0] === "h") {
      if (!ppr || !wkid(ppr, "pStyle")) setStyle(styleFor(["heading " + kind[1]], "Heading" + kind[1]));
      dropNum();
    } else if (kind === "quote") {
      if (!ppr || !wkid(ppr, "pStyle")) setStyle(styleFor(["quote", "intense quote", "block text", "quotations"], "Quote"));
      dropNum();
    } else if (kind === "ul" || kind === "ol") {
      const lvl = Math.min(8, Math.max(0, (ln.depth || 1) - 1));
      let np = ppr && wkid(ppr, "numPr");
      if (!np && !(ppr && wkid(ppr, "pStyle"))) {
        setStyle(styleFor(["list paragraph"], "ListParagraph"));
        if (!numFor.has(j)) {
          const id = newNum(kind === "ul");
          for (let t = j; t < lines.length && lines[t].kind === kind && !lines[t].code; t++) numFor.set(t, id);
        }
        np = doc.createElementNS(W, "w:numPr");
        const ni = doc.createElementNS(W, "w:numId");
        ni.setAttributeNS(W, "w:val", numFor.get(j));
        np.append(doc.createElementNS(W, "w:ilvl"), ni);
        ensurePpr().appendChild(np);
      }
      if (np) {
        let il = wkid(np, "ilvl");
        if (!il) { il = doc.createElementNS(W, "w:ilvl"); np.insertBefore(il, np.firstChild); }
        il.setAttributeNS(W, "w:val", String(lvl));
      }
    } else dropNum();
    // alignment: the line's own, as Word's jc; a line put back to the left loses its centring
    if (!ln.code) {
      const jc = ppr && wkid(ppr, "jc");
      const want = ln.align === "justify" ? "both" : ln.align || null;
      if (want) {
        const j2 = jc || ensurePpr().appendChild(doc.createElementNS(W, "w:jc"));
        j2.setAttributeNS(W, "w:val", want);
      } else if (jc && ["center", "right", "end", "both", "distribute"].includes(jc.getAttributeNS(W, "val") || jc.getAttribute("w:val"))) {
        ppr.removeChild(jc);
      }
    }
    // RossDraft's Compile: a chapter on a new page
    if (ln.pageBreak && !(ppr && wkid(ppr, "pageBreakBefore"))) ensurePpr().appendChild(doc.createElementNS(W, "w:pageBreakBefore"));
    if (ppr) { sortPpr(ppr); if (ppr.children.length) p.appendChild(ppr); }
    // the look of the words: the old paragraph's, or one like it; headings and the like without one
    // take their style's own (no run look), plain text the scene's usual
    const base = same ? baseRpr(tmpl.el) : likeEl ? baseRpr(likeEl) : !kind && !ln.code ? baseRpr(null) : null;
    let xml = "";
    for (const r of ln.runs || []) {
      if (r.img) { xml += await pictureXml(r.img); continue; }
      const t = (r.t || "").split(OBJ).join("");
      if (!t) continue;
      const f = ln.code ? new Set() : r.f || new Set();
      const rp = base ? base.cloneNode(true) : doc.createElementNS(W, "w:rPr");
      const add = (tag, val) => {
        const e = doc.createElementNS(W, "w:" + tag);
        if (val) e.setAttributeNS(W, "w:val", val);
        rp.appendChild(e);
      };
      if (r.href && !ln.code) add("rStyle", styleFor(["hyperlink"], "Hyperlink"));
      if (f.has("b")) { add("b"); add("bCs"); }
      if (f.has("i")) { add("i"); add("iCs"); }
      if (f.has("s")) add("strike");
      if (f.has("h")) add("highlight", "yellow");
      if (f.has("u") && !r.href) add("u", "single");
      sortRpr(rp);
      const pieces = t.includes(NOTE_A) && !ln.code ? splitNotes(t) : [{ t }];
      for (const piece of pieces) {
        if (piece.note) {
          const k = piece.note[0] === "e" ? "endnote" : "footnote";
          const sid = styleFor([k + " reference"], k === "footnote" ? "FootnoteReference" : "EndnoteReference");
          xml += `<w:r><w:rPr><w:rStyle w:val="${sid}"/></w:rPr><w:${k}Reference w:id="${piece.note[1]}"/></w:r>`;
          continue;
        }
        const rx = (rp.children.length ? ser(rp) : "") + `<w:t xml:space="preserve">${xt(piece.t)}</w:t>`;
        if (r.href && !ln.code) xml += `<w:hyperlink r:id="${linkRel(r.href)}"><w:r>${rx}</w:r></w:hyperlink>`;
        else xml += `<w:r>${rx}</w:r>`;
      }
    }
    if (xml) {
      const frag = parse(`<w:x xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}" xmlns:a="${A_}" xmlns:pic="${PIC}">${xml}</w:x>`);
      for (const c of [...frag.documentElement.children]) p.appendChild(doc.importNode(c, true));
    }
    return p;
  };

  // --- the body, line by line
  const A = oldSigs && oldSigs.length === old.length ? oldSigs : old.map(sigOf);
  const B = lines.map(sigOf);
  const { matched, paired } = align(A, B);
  // the old lines of each paragraph
  const groupOf = new Map();
  old.forEach((ln, i) => {
    if (ln.src == null) return;
    if (!groupOf.has(ln.src)) groupOf.set(ln.src, []);
    groupOf.get(ln.src).push(i);
  });
  const used = new Set(), marked = new Set();
  const outEls = [];
  for (let j = 0; j < lines.length;) {
    if (lines[j].table) { outEls.push(await buildP(lines[j], j, null, false)); j++; continue; }   // (Compile's tables: always new)
    const i = matched[j];
    if (i >= 0 && old[i].src != null) {
      const g = groupOf.get(old[i].src);
      if (g[0] === i && !used.has(old[i].src) && g.every((ii, t) => matched[j + t] === ii)) {
        used.add(old[i].src);
        outEls.push(srcEl(i));
        j += g.length;
        continue;
      }
    }
    const pi = i >= 0 ? i : paired[j];
    const tmpl = pi >= 0 && old[pi].src != null ? { el: srcEl(pi), key: kindKey(old[pi]) } : null;
    const oneToOne = !!tmpl && !used.has(old[pi].src) && (groupOf.get(old[pi].src) || []).length === 1;
    if (oneToOne) used.add(old[pi].src);
    const np = await buildP(lines[j], j, tmpl, oneToOne);
    // the old paragraph's comment marks, at the same words in the changed one
    if (tmpl && !marked.has(old[pi].src)) {
      marked.add(old[pi].src);
      const was = textAndMarks(tmpl.el);
      if (was.marks.length) {
        const now = textAndMarks(np).text;
        // (marks add no words, so the places don't move); marks at one place keep their order: each goes
        // in after the ones before it there (a comment's end before its reference)
        const todo = was.marks.map((m, k) => [mapOffset(was.text, now, m.off, m.kind), k, m]);
        todo.sort((a, b) => a[1] - b[1]);
        for (const [off, , m] of todo) placeAt(doc, np, off, m.node.cloneNode(true), m.kind === "start" ? "start" : "end");
      }
    }
    outEls.push(np);
    j++;
  }
  for (const c of [...body.children]) body.removeChild(c);
  if (!outEls.length) {
    const p = doc.createElementNS(W, "w:p");
    if (usualPpr) p.appendChild(usualPpr.cloneNode(true));
    outEls.push(p);
  }
  for (const el of outEls) body.appendChild(el);
  if (sectPr) body.appendChild(sectPr);
  const commentsChanged = await fixComments(doc, body, all, mainPart, relsDoc);

  // --- the footnotes and endnotes (as Ross Writer's finish_notes): those the text marks kept, new ones added,
  // the rest dropped; a note's paragraphs rewritten only when its words changed
  const notesChanged = new Map();
  if (notes) {
    for (const [kind, k] of [["f", "footnote"], ["e", "endnote"]]) {
      const want = new Set([...body.getElementsByTagNameNS(W, k + "Reference")].map((e) => wval(e, "id")));
      let name = partByType(relsDoc, mainPart, k + "s");
      if (!want.size && !(name && all.has(name))) continue;
      let ndoc;
      if (name && all.has(name)) ndoc = parse(dec(all.get(name)));
      else {
        name = partDir + k + "s.xml";
        ndoc = parse(emptyNotesXml(kind));
        addRel(k + "s", k + "s.xml");
        addOverride("/" + name, `application/vnd.openxmlformats-officedocument.wordprocessingml.${k}s+xml`);
        // Word lists the separators in settings.xml
        const sName = partByType(relsDoc, mainPart, "settings");
        if (sName && all.has(sName)) {
          const sd = parse(dec(all.get(sName)));
          if (!sd.getElementsByTagNameNS(W, k + "Pr").length) {
            const el = parse(`<w:x xmlns:w="${W}"><w:${k}Pr><w:${k} w:id="-1"/><w:${k} w:id="0"/></w:${k}Pr></w:x>`).documentElement.firstElementChild;
            sd.documentElement.appendChild(sd.importNode(el, true));
            notesChanged.set(sName, sd);
          }
        }
      }
      const root = ndoc.documentElement;
      const have = new Map();
      let touched = false;
      for (const n of [...root.getElementsByTagNameNS(W, k)]) {
        const ty = wval(n, "type");
        if (ty === "separator" || ty === "continuationSeparator" || ty === "continuationNotice") continue;
        const id = wval(n, "id");
        if (!want.has(id)) { root.removeChild(n); touched = true; } else have.set(id, n);
      }
      const textOf = (n) => [...n.getElementsByTagNameNS(W, "p")].map((pp) => {
        let t = "";
        for (const el of pp.getElementsByTagNameNS(W, "*")) { if (el.localName === "t") t += el.textContent; else if (el.localName === "tab") t += " "; }
        return t;
      }).join("\n").replace(/^\s+/, "");
      const ids = [...want].sort((a, b) => (+a || 0) - (+b || 0));
      for (const id of ids) {
        const words = notes.has(kind + id) ? notes.get(kind + id) : null;
        let el = have.get(id);
        if (el && (words == null || (!forceNotes && textOf(el) === words))) continue;
        if (!el) { el = ndoc.createElementNS(W, "w:" + k); el.setAttributeNS(W, "w:id", id); root.appendChild(el); }
        while (el.firstChild) el.removeChild(el.firstChild);
        styleFor([k + " text"], k === "footnote" ? "FootnoteText" : "EndnoteText");
        styleFor([k + " reference"], k === "footnote" ? "FootnoteReference" : "EndnoteReference");
        const frag = parse(`<w:x xmlns:w="${W}">${noteParasXml(kind, words || "")}</w:x>`).documentElement;
        for (const c of [...frag.children]) el.appendChild(ndoc.importNode(c, true));
        touched = true;
      }
      if (touched) notesChanged.set(name, ndoc);
    }
  }

  // --- relationships nothing uses any more (pictures and links of paragraphs that went)
  const docXml = ser(doc);
  const usedIds = new Set();
  for (const m of docXml.matchAll(/\br:(?:id|embed|link|pict|href)="([^"]+)"/g)) usedIds.add(m[1]);
  for (const m of docXml.matchAll(/\b(?:id|embed|link)="(rId[^"]*)"/g)) usedIds.add(m[1]);
  const dropped = [];
  for (const r of relEls()) {
    const type = r.getAttribute("Type") || "";
    if ((type.endsWith("/image") || type.endsWith("/hyperlink")) && !usedIds.has(r.getAttribute("Id"))) {
      if (type.endsWith("/image") && r.getAttribute("TargetMode") !== "External") dropped.push(resolveTarget(mainPart, r.getAttribute("Target")));
      relsRoot.removeChild(r);
    }
  }
  // a picture file goes only if nothing else in the package points at it
  if (dropped.length) {
    const still = new Set();
    for (const [name, data] of all) {
      if (!name.endsWith(".rels")) continue;
      const owner = name.replace(/_rels\/([^/]+)\.rels$/, "$1");
      const rd = name === relsName ? relsDoc : parse(dec(data));
      for (const r of rd.getElementsByTagNameNS(PR, "Relationship")) {
        if (r.getAttribute("TargetMode") !== "External") still.add(resolveTarget(owner, r.getAttribute("Target") || ""));
      }
    }
    for (const part of dropped) if (!still.has(part)) all.delete(part);
  }

  // --- the package again
  all.set(mainPart, docXml);
  all.set(relsName, ser(relsDoc));
  all.set("[Content_Types].xml", ser(ctDoc));
  if (stylesChanged) all.set(stylesName, ser(stylesDoc));
  if (numChanged) all.set(numName, ser(numDoc));
  for (const [name, d] of commentsChanged) all.set(name, ser(d));
  for (const [name, d] of notesChanged) all.set(name, ser(d));
  const order = ["[Content_Types].xml", ...[...all.keys()].filter((k) => k !== "[Content_Types].xml")];
  return zip(order.map((name) => {
    const data = all.get(name);
    const media = /\.(png|jpe?g|gif|bmp|webp|tiff?|emf|wmf)$/i.test(name);
    return [name, typeof data === "string" ? withDecl(data) : data, !media];
  }));
}

// Every comment's marks whole again (a start without its end, an end without its reference: the missing ones
// put in its paragraph), and the comments whose words are all gone taken out of the comments parts.
async function fixComments(doc, body, all, mainPart, relsDoc) {
  const changed = new Map();
  const cName = partByType(relsDoc, mainPart, "comments");
  if (!cName || !all.has(cName)) return changed;
  const cdoc = parse(dec(all.get(cName)));
  const comments = [...cdoc.getElementsByTagNameNS(W, "comment")];
  const find = (local) => {
    const m = new Map();
    for (const e of body.getElementsByTagNameNS(W, local)) {
      const id = wval(e, "id");
      if (!m.has(id)) m.set(id, e);
    }
    return m;
  };
  const starts = find("commentRangeStart"), ends = find("commentRangeEnd"), refs = find("commentReference");
  const paraOf = (e) => { let x = e; while (x && !isW(x, "p")) x = x.parentNode; return x; };
  const mk = (local, id) => { const e = doc.createElementNS(W, "w:" + local); e.setAttributeNS(W, "w:id", id); return e; };
  const refRun = (id) => { const r = doc.createElementNS(W, "w:r"); r.appendChild(mk("commentReference", id)); return r; };
  const gone = new Set();
  for (const c of comments) {
    const id = wval(c, "id");
    const s0 = starts.get(id), e0 = ends.get(id), r0 = refs.get(id);
    if (!s0 && !e0 && !r0) { gone.add(id); continue; }
    if (s0 && !e0) {
      const p = paraOf(s0);
      const e = mk("commentRangeEnd", id);
      p.appendChild(e);
      if (!r0) p.appendChild(refRun(id));
    } else if (!s0 && e0) {
      const p = paraOf(e0);
      const ppr = wkid(p, "pPr");
      p.insertBefore(mk("commentRangeStart", id), ppr ? ppr.nextSibling : p.firstChild);
      if (!r0) e0.parentNode.insertBefore(refRun(id), e0.nextSibling);
    } else if (s0 && e0 && !r0) e0.parentNode.insertBefore(refRun(id), e0.nextSibling);
  }
  if (!gone.size) return changed;
  // out of comments.xml, and out of the parts Word keeps beside it (by the comment's paragraph ids)
  const paraIds = new Set();
  for (const c of comments) {
    if (!gone.has(wval(c, "id"))) continue;
    for (const p of c.getElementsByTagNameNS(W, "p")) {
      const pid = p.getAttributeNS(W14, "paraId") || p.getAttribute("w14:paraId");
      if (pid) paraIds.add(pid);
    }
    c.parentNode.removeChild(c);
  }
  changed.set(cName, cdoc);
  const attr = (e, ns, pre, name) => e.getAttributeNS(ns, name) || e.getAttribute(pre + ":" + name);
  const exName = partByType(relsDoc, mainPart, "commentsExtended");
  if (exName && all.has(exName)) {
    const d = parse(dec(all.get(exName)));
    for (const e of [...d.getElementsByTagNameNS(W15, "commentEx")]) if (paraIds.has(attr(e, W15, "w15", "paraId"))) e.parentNode.removeChild(e);
    changed.set(exName, d);
  }
  const durable = new Set();
  const idsName = partByType(relsDoc, mainPart, "commentsIds");
  if (idsName && all.has(idsName)) {
    const d = parse(dec(all.get(idsName)));
    for (const e of [...d.getElementsByTagNameNS(W16CID, "commentId")]) {
      if (paraIds.has(attr(e, W16CID, "w16cid", "paraId"))) { durable.add(attr(e, W16CID, "w16cid", "durableId")); e.parentNode.removeChild(e); }
    }
    changed.set(idsName, d);
  }
  const cexName = partByType(relsDoc, mainPart, "commentsExtensible");
  if (cexName && all.has(cexName) && durable.size) {
    const d = parse(dec(all.get(cexName)));
    for (const e of [...d.getElementsByTagNameNS(W16CEX, "commentExtensible")]) {
      if (durable.has(attr(e, W16CEX, "w16cex", "durableId"))) e.parentNode.removeChild(e);
    }
    changed.set(cexName, d);
  }
  return changed;
}

const xt = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const xa = (s) => xt(s).replace(/"/g, "&quot;");
const withDecl = (s) => (s.startsWith("<?xml") ? s : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + s);

// ------------------------------------------------------------------ comments added, changed, replied to,
// resolved and deleted (the tablet's own), in a scene's or a document's Word file as it is
const CT_COMMENTS = "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml";
const CT_COMMENTS_EX = "application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml";
const REL_COMMENTS_EX = "http://schemas.microsoft.com/office/2011/relationships/commentsExtended";
const MC = "http://schemas.openxmlformats.org/markup-compatibility/2006";

async function openPackage(files) {
  const all = await loadAll(files);
  let mainPart = "word/document.xml";
  if (all.has("_rels/.rels")) {
    for (const r of parse(dec(all.get("_rels/.rels"))).getElementsByTagNameNS(PR, "Relationship")) {
      if ((r.getAttribute("Type") || "").endsWith("/officeDocument")) mainPart = resolveTarget("", r.getAttribute("Target"));
    }
  }
  const doc = parse(dec(all.get(mainPart)));
  const relsName = relsPathFor(mainPart);
  const relsDoc = all.has(relsName) ? parse(dec(all.get(relsName)))
    : parse(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PR}"/>`);
  const ctDoc = parse(dec(all.get("[Content_Types].xml")));
  const pkg = { all, mainPart, doc, body: doc.getElementsByTagNameNS(W, "body")[0], relsName, relsDoc, ctDoc, parts: new Map() };
  pkg.part = (type, create) => {
    let name = partByType(relsDoc, mainPart, type);
    if (name && pkg.parts.has(name)) return pkg.parts.get(name);
    if (name && all.has(name)) { pkg.parts.set(name, parse(dec(all.get(name)))); return pkg.parts.get(name); }
    if (!create) return null;
    const dir = mainPart.slice(0, mainPart.lastIndexOf("/") + 1);
    name = dir + type + ".xml";
    const d = parse(create);
    pkg.parts.set(name, d);
    const ids = new Set([...relsDoc.getElementsByTagNameNS(PR, "Relationship")].map((r) => r.getAttribute("Id")));
    let k = 1;
    while (ids.has("rIdRNc" + k)) k++;
    const rel = relsDoc.createElementNS(PR, "Relationship");
    rel.setAttribute("Id", "rIdRNc" + k);
    rel.setAttribute("Type", type === "commentsExtended" ? REL_COMMENTS_EX : REL + type);
    rel.setAttribute("Target", type + ".xml");
    relsDoc.documentElement.appendChild(rel);
    const ov = ctDoc.createElementNS(CT, "Override");
    ov.setAttribute("PartName", "/" + name);
    ov.setAttribute("ContentType", type === "commentsExtended" ? CT_COMMENTS_EX : CT_COMMENTS);
    ctDoc.documentElement.appendChild(ov);
    return d;
  };
  pkg.save = () => {
    pkg.all.set(mainPart, ser(doc));
    pkg.all.set(relsName, ser(relsDoc));
    pkg.all.set("[Content_Types].xml", ser(ctDoc));
    for (const [name, d] of pkg.parts) pkg.all.set(name, ser(d));
    const order = ["[Content_Types].xml", ...[...pkg.all.keys()].filter((k) => k !== "[Content_Types].xml")];
    return zip(order.map((name) => {
      const data = pkg.all.get(name);
      const media = /\.(png|jpe?g|gif|bmp|webp|tiff?|emf|wmf)$/i.test(name);
      return [name, typeof data === "string" ? withDecl(data) : data, !media];
    }));
  };
  return pkg;
}

const commentsXml = () => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments xmlns:w="${W}" ` +
  `xmlns:w14="${W14}" xmlns:mc="${MC}" mc:Ignorable="w14"/>`;
const commentsExXml = () => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w15:commentsEx xmlns:w15="${W15}" ` +
  `xmlns:mc="${MC}" mc:Ignorable="w15"/>`;
const paraIdOf = (p) => p.getAttributeNS(W14, "paraId") || p.getAttribute("w14:paraId") || "";
const exAttr = (e, name) => e.getAttributeNS(W15, name) || e.getAttribute("w15:" + name) || "";
function newParaId(taken) {
  let id;
  do { id = Math.floor(Math.random() * 0x7fffffff).toString(16).toUpperCase().padStart(8, "0"); } while (taken.has(id));
  taken.add(id);
  return id;
}
export const wordNow = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");

// the paragraphs of a comment's text (each line one), the first with Word's annotation mark
function fillComment(cdoc, c, text, taken, lastId) {
  for (const x of [...c.children]) c.removeChild(x);
  const lines = String(text || "").split("\n");
  lines.forEach((line, k) => {
    const p = cdoc.createElementNS(W, "w:p");
    p.setAttributeNS(W14, "w14:paraId", k === lines.length - 1 && lastId ? lastId : newParaId(taken));
    p.setAttributeNS(W14, "w14:textId", "77777777");
    if (k === 0) {
      const r = cdoc.createElementNS(W, "w:r");
      r.appendChild(cdoc.createElementNS(W, "w:annotationRef"));
      p.appendChild(r);
    }
    if (line) {
      const r = cdoc.createElementNS(W, "w:r");
      const t = cdoc.createElementNS(W, "w:t");
      t.setAttribute("xml:space", "preserve");
      t.textContent = line;
      r.appendChild(t);
      p.appendChild(r);
    }
    c.appendChild(p);
  });
}

function commentState(pkg) {
  const cdoc = pkg.part("comments", commentsXml());
  const comments = [...cdoc.getElementsByTagNameNS(W, "comment")];
  const byId = new Map(comments.map((c) => [wval(c, "id"), c]));
  const taken = new Set();
  for (const d of [cdoc, pkg.doc]) for (const p of d.getElementsByTagNameNS(W, "p")) { const id = paraIdOf(p); if (id) taken.add(id); }
  const lastPara = (c) => { const ps = c.getElementsByTagNameNS(W, "p"); return ps[ps.length - 1] || null; };
  // a comment's paragraph id (made if it has none: Word needs one to resolve it or reply to it)
  const pidOf = (c) => {
    let p = lastPara(c);
    if (!p) { fillComment(cdoc, c, "", taken); p = lastPara(c); }
    let id = paraIdOf(p);
    if (!id) { id = newParaId(taken); p.setAttributeNS(W14, "w14:paraId", id); }
    return id;
  };
  const nextId = () => String(Math.max(-1, ...[...pkg.doc.getElementsByTagNameNS(W, "commentRangeStart")].map((e) => +wval(e, "id") || 0),
    ...[...pkg.doc.getElementsByTagNameNS(W, "commentReference")].map((e) => +wval(e, "id") || 0),
    ...comments.map((c) => +wval(c, "id") || 0)) + 1);
  const exFor = (pid, create) => {
    const ex = pkg.part("commentsExtended", create ? commentsExXml() : null);
    if (!ex) return null;
    for (const e of ex.getElementsByTagNameNS(W15, "commentEx")) if (exAttr(e, "paraId") === pid) return e;
    if (!create) return null;
    const e = ex.createElementNS(W15, "w15:commentEx");
    e.setAttributeNS(W15, "w15:paraId", pid);
    e.setAttributeNS(W15, "w15:done", "0");
    ex.documentElement.appendChild(e);
    return e;
  };
  return { cdoc, comments, byId, taken, pidOf, nextId, exFor };
}

const markEl = (doc, local, id) => { const e = doc.createElementNS(W, "w:" + local); e.setAttributeNS(W, "w:id", id); return e; };
function refRunEl(doc, id) {
  const r = doc.createElementNS(W, "w:r");
  r.appendChild(markEl(doc, "commentReference", id));
  return r;
}

// a new comment on the body's words from (paragraph sp, offset so) to (ep, eo); paragraphs as body children
function addComment(pkg, st, { sp, so, ep, eo, text, author, initials, date, parentId }) {
  const kids = [...pkg.body.children];
  const P1 = kids[sp], P2 = kids[ep];
  if (parentId == null && (!P1 || !P2 || !isW(P1, "p") || !isW(P2, "p"))) throw new Error("Those words can't take a comment here.");
  const id = st.nextId();
  const c = st.cdoc.createElementNS(W, "w:comment");
  c.setAttributeNS(W, "w:id", id);
  c.setAttributeNS(W, "w:author", author || "Ross Note");
  c.setAttributeNS(W, "w:date", date || wordNow());
  if (initials) c.setAttributeNS(W, "w:initials", initials);
  fillComment(st.cdoc, c, text, st.taken);
  st.cdoc.documentElement.appendChild(c);
  st.comments.push(c);
  st.byId.set(id, c);
  if (parentId != null) {
    // a reply: on the same words as the comment it answers, and marked as its reply
    const parent = st.byId.get(String(parentId));
    if (!parent) throw new Error("That comment isn't there any more.");
    const s0 = [...pkg.body.getElementsByTagNameNS(W, "commentRangeStart")].find((e) => wval(e, "id") === String(parentId));
    const e0 = [...pkg.body.getElementsByTagNameNS(W, "commentRangeEnd")].find((e) => wval(e, "id") === String(parentId));
    const r0 = [...pkg.body.getElementsByTagNameNS(W, "commentReference")].find((e) => wval(e, "id") === String(parentId));
    const after = (r0 && r0.parentNode) || e0;
    if (s0) s0.parentNode.insertBefore(markEl(pkg.doc, "commentRangeStart", id), s0.nextSibling);
    if (after) {
      const end = markEl(pkg.doc, "commentRangeEnd", id), ref = refRunEl(pkg.doc, id);
      after.parentNode.insertBefore(end, after.nextSibling);
      end.parentNode.insertBefore(ref, end.nextSibling);
    }
    const ppid = st.pidOf(parent);
    st.exFor(ppid, true);
    const ex = st.exFor(st.pidOf(c), true);
    ex.setAttributeNS(W15, "w15:paraIdParent", ppid);
    return id;
  }
  // the end first (placing the start can split a run in the same paragraph)
  const end = markEl(pkg.doc, "commentRangeEnd", id);
  placeAt(pkg.doc, P2, eo, end, "end");
  end.parentNode.insertBefore(refRunEl(pkg.doc, id), end.nextSibling);
  placeAt(pkg.doc, P1, so, markEl(pkg.doc, "commentRangeStart", id), "start");
  if (pkg.part("commentsExtended")) st.exFor(st.pidOf(c), true);
  return id;
}

// a comment and its replies out of the body and the comments parts
function dropComment(pkg, st, id) {
  const ids = new Set([String(id)]);
  const ex = pkg.part("commentsExtended");
  if (ex) {
    // its replies (and theirs)
    let grew = true;
    while (grew) {
      grew = false;
      for (const c of st.comments) {
        const cid = wval(c, "id");
        if (ids.has(cid)) continue;
        const e = st.exFor(paraIdOf([...c.getElementsByTagNameNS(W, "p")].pop() || c), false);
        const par = e && exAttr(e, "paraIdParent");
        if (par && [...ids].some((x) => st.byId.get(x) && paraIdOf([...st.byId.get(x).getElementsByTagNameNS(W, "p")].pop() || st.byId.get(x)) === par)) {
          ids.add(cid);
          grew = true;
        }
      }
    }
  }
  for (const local of ["commentRangeStart", "commentRangeEnd"]) {
    for (const e of [...pkg.body.getElementsByTagNameNS(W, local)]) if (ids.has(wval(e, "id"))) e.parentNode.removeChild(e);
  }
  for (const e of [...pkg.body.getElementsByTagNameNS(W, "commentReference")]) {
    if (!ids.has(wval(e, "id"))) continue;
    const r = e.parentNode;
    if (isW(r, "r") && [...r.children].every((x) => isW(x, "rPr") || x === e)) r.parentNode.removeChild(r);
    else r.removeChild(e);
  }
  const pids = new Set();
  for (const x of ids) {
    const c = st.byId.get(x);
    if (!c) continue;
    for (const p of c.getElementsByTagNameNS(W, "p")) { const pid = paraIdOf(p); if (pid) pids.add(pid); }
    c.parentNode.removeChild(c);
    st.byId.delete(x);
  }
  if (ex) for (const e of [...ex.getElementsByTagNameNS(W15, "commentEx")]) if (pids.has(exAttr(e, "paraId"))) e.parentNode.removeChild(e);
  const cid = pkg.part("commentsIds");
  const durable = new Set();
  if (cid) {
    for (const e of [...cid.getElementsByTagNameNS(W16CID, "commentId")]) {
      const pid = e.getAttributeNS(W16CID, "paraId") || e.getAttribute("w16cid:paraId");
      if (pids.has(pid)) { durable.add(e.getAttributeNS(W16CID, "durableId") || e.getAttribute("w16cid:durableId")); e.parentNode.removeChild(e); }
    }
  }
  const cex = pkg.part("commentsExtensible");
  if (cex && durable.size) {
    for (const e of [...cex.getElementsByTagNameNS(W16CEX, "commentExtensible")]) {
      if (durable.has(e.getAttributeNS(W16CEX, "durableId") || e.getAttribute("w16cex:durableId"))) e.parentNode.removeChild(e);
    }
  }
}

// One change to a Word file's comments; the file's words aren't touched.
//   {kind: "add", sp, so, ep, eo, text, author, initials}   (body paragraph index and offset in its words)
//   {kind: "reply", id, text, author, initials}   {kind: "edit", id, text}   {kind: "resolve", id, done}
//   {kind: "delete", id}
export async function commentEdit(files, op) {
  const pkg = await openPackage(files);
  const st = commentState(pkg);
  const c = op.id != null ? st.byId.get(String(op.id)) : null;
  if (op.kind !== "add" && !c) throw new Error("That comment isn't there any more.");
  if (op.kind === "add") {
    // the page's lines have no spaces at their starts: the paragraph's own count from its first word
    const kids = [...pkg.body.children];
    const lead = (k) => { const t = kids[k] && isW(kids[k], "p") ? textAndMarks(kids[k]).text : ""; return t.length - t.replace(/^\s+/, "").length; };
    addComment(pkg, st, { ...op, so: op.so + lead(op.sp), eo: op.eo + lead(op.ep) });
  }
  else if (op.kind === "reply") addComment(pkg, st, { ...op, parentId: op.id });
  else if (op.kind === "edit") {
    const ps = c.getElementsByTagNameNS(W, "p");
    fillComment(st.cdoc, c, op.text, st.taken, ps.length ? paraIdOf(ps[ps.length - 1]) : null);
  } else if (op.kind === "resolve") {
    const e = st.exFor(st.pidOf(c), true);
    e.setAttributeNS(W15, "w15:done", op.done ? "1" : "0");
  } else if (op.kind === "delete") dropComment(pkg, st, op.id);
  return pkg.save();
}

// Comments into a Word file made from notes (Export as Word): each found by its words in its note's part
// of the document (the parts in order, each starting at its title heading). groups: [{title, comments}]
export async function exportComments(buf, groups) {
  const files = await unzip(buf);
  const pkg = await openPackage(files);
  const st = commentState(pkg);
  const kids = [...pkg.body.children];
  const texts = kids.map((k) => (isW(k, "p") ? textAndMarks(k).text : null));
  const norm = (t) => t.split(OBJ).join(" ").replace(/\s/g, " ");
  // where each note's part begins: its title, in order
  let at = 0;
  const starts = groups.map((g) => {
    const want = norm(g.title || "").trim();
    for (let i = at; i < kids.length; i++) {
      if (texts[i] != null && norm(texts[i]).trim() === want) { at = i + 1; return i; }
    }
    return null;
  });
  let placed = 0;
  groups.forEach((g, gi) => {
    if (starts[gi] == null || !g.comments.length) return;
    let end = kids.length;
    for (let k = gi + 1; k < starts.length; k++) if (starts[k] != null) { end = starts[k]; break; }
    // the part's words, paragraph by paragraph, with where each paragraph starts in them
    const idx = [], offs = [];
    let all = "";
    for (let i = starts[gi]; i < end; i++) {
      if (texts[i] == null) continue;
      idx.push(i); offs.push(all.length);
      all += norm(texts[i]) + " ";
    }
    const loc = (o) => {
      let k = 0;
      while (k + 1 < offs.length && offs[k + 1] <= o) k++;
      return [idx[k], Math.min(o - offs[k], texts[idx[k]].length)];
    };
    const newIds = new Map();
    const tops = g.comments.filter((c) => !c.parent || !g.comments.some((o) => o.id === c.parent));
    const order = [...tops, ...g.comments.filter((c) => !tops.includes(c))];
    for (const c of order) {
      const base = { text: c.text, author: c.author, initials: c.initials, date: c.date };
      let id;
      if (c.parent && newIds.has(c.parent)) id = addComment(pkg, st, { ...base, parentId: newIds.get(c.parent) });
      else {
        const w = norm(c.words || "").replace(/ +/g, " ").trim();
        let k = w ? all.replace(/ +/g, " ").indexOf(w) : -1;
        let sp, so, ep, eo;
        if (k >= 0) {
          // back to places in the unsqueezed words
          const map = [];
          for (let i = 0, j = 0; i < all.length; i++) { if (all[i] === " " && all[i - 1] === " ") continue; map[j++] = i; }
          const a = map[k], b = map[k + w.length - 1] + 1;
          [sp, so] = loc(a);
          [ep, eo] = loc(b - 1);
          eo += 1;
        } else {
          // its words aren't there (changed since): on the note's title
          sp = ep = starts[gi]; so = 0; eo = texts[sp].length;
        }
        id = addComment(pkg, st, { ...base, sp, so, ep, eo });
      }
      newIds.set(c.id, id);
      if (c.done) st.exFor(st.pidOf(st.byId.get(id)), true).setAttributeNS(W15, "w15:done", "1");
      placed++;
    }
  });
  return placed ? pkg.save() : new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}

export { unzip, sigOf };
