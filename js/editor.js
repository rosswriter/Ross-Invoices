// The page: one <div class="ln"> per line of the note, with the formatting as
// ordinary elements. Read back to lines (md.js) to save.
import * as md from "./md.js";

const HL = "#ffd54f";

// ------------------------------------------------------------------ lines -> page
export function renderLines(page, lines) {
  page.textContent = "";
  for (const ln of lines) page.appendChild(lineElement(ln));
  if (!page.firstChild) page.appendChild(lineElement({ kind: null, runs: [] }));
}

export function lineElement(ln) {
  const div = document.createElement("div");
  div.className = "ln";
  if (ln.kind) div.dataset.kind = ln.kind;
  if (ln.mark) div.dataset.mark = ln.mark;
  if (ln.raw != null) div.dataset.raw = ln.raw;
  if (ln.code) div.dataset.code = "1";
  for (const r of ln.runs) {
    if (r.img) { div.appendChild(pictureElement(r.img)); continue; }
    if (!r.t) continue;
    let node = document.createTextNode(r.t);
    const wrap = (tag, style) => {
      const e = document.createElement(tag);
      if (style) e.setAttribute("style", style);
      e.appendChild(node);
      node = e;
    };
    if (r.f.has("i")) wrap("i");
    if (r.f.has("b")) wrap("b");
    if (r.f.has("s")) wrap("strike");
    if (r.f.has("h")) wrap("span", "background-color: " + HL + ";");
    if (r.f.has("u")) wrap("u");
    if (r.href) {
      const a = document.createElement("a");
      a.href = r.href;
      a.appendChild(node);
      node = a;
    }
    div.appendChild(node);
  }
  if (!div.firstChild) div.appendChild(document.createElement("br"));
  return div;
}

export function pictureElement(img) {
  const e = document.createElement("img");
  e.className = "pic";
  e.alt = "";
  e.draggable = false;
  e.dataset.src = img.src || "";
  if (img.orig) e.dataset.orig = img.orig;
  e.dataset.size = ["small", "medium"].includes(img.size) ? img.size : "";
  if (img.size && !["small", "medium"].includes(img.size)) e.dataset.alt = img.size;
  if (img.target) e.dataset.target = img.target.join("/");
  if (img.changed) e.dataset.changed = "1";
  return e;
}

// ------------------------------------------------------------------ page -> lines
function hasBackground(el) {
  const bg = el.style && el.style.backgroundColor;
  return !!bg && bg !== "transparent" && !/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(bg) && bg !== "initial" && bg !== "inherit";
}

function flagsOf(node, line, heading) {
  const f = new Set();
  let href = null;
  for (let e = node.parentNode; e && e !== line; e = e.parentNode) {
    const t = e.tagName;
    if (t === "B" || t === "STRONG") f.add("b");
    else if (t === "I" || t === "EM") f.add("i");
    else if (t === "U" || t === "INS") f.add("u");
    else if (t === "S" || t === "STRIKE" || t === "DEL") f.add("s");
    else if (t === "MARK") f.add("h");
    else if (t === "A" && e.getAttribute("href") && href == null) href = e.getAttribute("href");
    const st = e.style;
    if (st) {
      if (st.fontWeight === "bold" || +st.fontWeight >= 600) f.add("b");
      if (st.fontStyle === "italic") f.add("i");
      const td = st.textDecoration || st.textDecorationLine || "";
      if (td.includes("underline")) f.add("u");
      if (td.includes("line-through")) f.add("s");
      if (hasBackground(e)) f.add("h");
    }
  }
  if (heading) f.delete("b");
  return { f, href };
}

export function readLine(div) {
  const kind = div.dataset.kind || null;
  const ln = { kind, mark: div.dataset.mark || null, runs: [] };
  if (div.dataset.raw != null) ln.raw = div.dataset.raw;
  if (div.dataset.code) ln.code = true;
  const heading = !!kind && kind[0] === "h";
  const walk = (n) => {
    for (const c of n.childNodes) {
      if (c.nodeType === 3) {
        const t = c.data.replace(/[\n\r]/g, " ").replace(/​/g, "");
        if (!t) continue;
        if (ln.code || ln.raw != null) { ln.runs.push({ t, f: new Set() }); continue; }
        const { f, href } = flagsOf(c, div, heading);
        ln.runs.push({ t, f, href });
      } else if (c.nodeType === 1) {
        if (c.tagName === "IMG" && c.classList.contains("pic")) {
          ln.runs.push({ t: md.OBJ, f: new Set(), img: {
            src: c.dataset.src, orig: c.dataset.orig || null,
            size: c.dataset.size || c.dataset.alt || "",
            target: c.dataset.target ? c.dataset.target.split("/") : null,
            changed: !!c.dataset.changed } });
        } else if (c.tagName !== "BR") walk(c);
      }
    }
  };
  walk(div);
  return ln;
}

export function readLines(page) {
  return [...page.children].filter((d) => d.classList.contains("ln")).map(readLine);
}

// ------------------------------------------------------------------ keeping the page tidy
// The browser's editing can leave text outside the lines, or a line inside a
// line: put everything back into one level of lines.
export function tidy(page) {
  let changed = false;
  let pending = null;
  for (const n of [...page.childNodes]) {
    if (n.nodeType === 1 && n.classList.contains("ln") && n.tagName === "DIV") {
      pending = null;
      // a line inside a line (pasting, or the browser's own Enter)
      const inner = [...n.children].filter((c) => c.tagName === "DIV" || c.tagName === "P");
      if (inner.length) {
        changed = true;
        let after = n;
        for (const c of inner) {
          const nl = document.createElement("div");
          nl.className = "ln";
          if (c.dataset && c.dataset.kind) nl.dataset.kind = c.dataset.kind;
          while (c.firstChild) nl.appendChild(c.firstChild);
          c.remove();
          after.after(nl);
          after = nl;
        }
      }
      if (!n.firstChild) { n.appendChild(document.createElement("br")); }
      continue;
    }
    if (n.nodeType === 3 && !n.data.trim() && !pending) { n.remove(); continue; }
    changed = true;
    if (n.nodeType === 1 && (n.tagName === "DIV" || n.tagName === "P")) {
      n.classList.add("ln");
      if (n.tagName === "P") {
        const d = document.createElement("div");
        d.className = "ln";
        while (n.firstChild) d.appendChild(n.firstChild);
        n.replaceWith(d);
      }
      pending = null;
      continue;
    }
    if (!pending) {
      pending = document.createElement("div");
      pending.className = "ln";
      n.before(pending);
    }
    pending.appendChild(n);
  }
  if (!page.firstChild) { page.appendChild(lineElement({ kind: null, runs: [] })); changed = true; }
  return changed;
}

// ------------------------------------------------------------------ where the caret is
export function lineOf(node, page) {
  while (node && node.parentNode !== page) node = node.parentNode;
  return node && node.nodeType === 1 && node.classList.contains("ln") ? node : null;
}

// characters before (node, offset) within its line; a picture counts as one
export function offsetIn(line, node, offset) {
  const r = document.createRange();
  r.setStart(line, 0);
  try { r.setEnd(node, offset); } catch (e) { return 0; }
  return textLen(r.cloneContents());
}

function textLen(n) {
  let k = 0;
  const walk = (x) => {
    for (const c of x.childNodes) {
      if (c.nodeType === 3) k += c.data.length;
      else if (c.tagName === "IMG") k += 1;
      else walk(c);
    }
  };
  walk(n);
  return k;
}

export function lineText(line) {
  let s = "";
  const walk = (x) => {
    for (const c of x.childNodes) {
      if (c.nodeType === 3) s += c.data;
      else if (c.tagName === "IMG") s += md.OBJ;
      else walk(c);
    }
  };
  walk(line);
  return s;
}

// (node, offset) for a character position in a line
export function pointAt(line, pos) {
  let k = 0;
  let last = null;
  const walk = (x) => {
    for (const c of x.childNodes) {
      if (c.nodeType === 3) {
        if (k + c.data.length >= pos) return [c, pos - k];
        k += c.data.length;
        last = [c, c.data.length];
      } else if (c.tagName === "IMG") {
        if (k + 1 > pos) return [c.parentNode, [...c.parentNode.childNodes].indexOf(c)];
        k += 1;
        last = [c.parentNode, [...c.parentNode.childNodes].indexOf(c) + 1];
      } else if (c.tagName !== "BR") {
        const got = walk(c);
        if (got) return got;
      }
    }
    return null;
  };
  return walk(line) || last || [line, 0];
}

export function caret(page) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  const line = lineOf(r.startContainer, page);
  if (!line) return null;
  const lines = [...page.children];
  const a = { line: lines.indexOf(line), pos: offsetIn(line, r.startContainer, r.startOffset) };
  const endLine = lineOf(r.endContainer, page) || line;
  const b = { line: lines.indexOf(endLine), pos: offsetIn(endLine, r.endContainer, r.endOffset) };
  return { a, b };
}

export function setCaret(page, c) {
  if (!c) return;
  const lines = [...page.children];
  const la = lines[Math.min(c.a.line, lines.length - 1)];
  const lb = lines[Math.min(c.b.line, lines.length - 1)];
  if (!la) return;
  const [n1, o1] = pointAt(la, c.a.pos);
  const [n2, o2] = pointAt(lb, c.b.pos);
  const r = document.createRange();
  r.setStart(n1, o1);
  r.setEnd(n2, o2);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}

export function placeCaret(node, offset) {
  const r = document.createRange();
  r.setStart(node, offset);
  r.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}

// the lines the selection touches
export function selectedLines(page) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return [];
  const r = sel.getRangeAt(0);
  const a = lineOf(r.startContainer, page), b = lineOf(r.endContainer, page);
  if (!a) return [];
  const all = [...page.children];
  const i = all.indexOf(a), j = b ? all.indexOf(b) : i;
  return all.slice(Math.min(i, j), Math.max(i, j) + 1);
}

// ------------------------------------------------------------------ list numbers, depths, the title
export function relayout(page) {
  const lines = [...page.children];
  const st = new md.ListState();
  let titled = false;
  for (const div of lines) {
    const ln = { kind: div.dataset.kind || null, mark: div.dataset.mark || null,
      raw: div.dataset.raw != null ? div.dataset.raw : null, code: !!div.dataset.code };
    const { depth, number } = st.step(ln);
    if (depth) div.dataset.depth = depth; else delete div.dataset.depth;
    if (number != null && ln.kind === "ol") {
      let label = number + ".";
      if (ln.mark && ln.mark.startsWith("ol:")) label = number + ln.mark.split("\u0000")[1].trim();
      div.dataset.n = label;
    } else delete div.dataset.n;
    const has = !titled && lineText(div).replace(md.OBJ, "").trim();
    div.classList.toggle("title", !!has && !(ln.kind && ln.kind[0] === "h"));
    if (has) titled = true;
  }
}

// ------------------------------------------------------------------ text pasted or dropped in
// HTML from another program or a web page: lines, keeping bold, italic,
// underline, strikethrough, highlight, links, headings, lists and quotes
export function linesFromHtml(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const out = [];
  let cur = null;
  const BLOCKS = new Set(["P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "BLOCKQUOTE", "PRE", "TR",
    "SECTION", "ARTICLE", "HEADER", "FOOTER", "UL", "OL", "TABLE", "TBODY", "DD", "DT", "FIGURE"]);
  const newLine = (kind) => { cur = { kind: kind || null, runs: [] }; out.push(cur); };
  const walk = (n, f, href, kind) => {
    for (const c of n.childNodes) {
      if (c.nodeType === 3) {
        const t = c.data.replace(/\s+/g, " ");
        if (!t.trim() && (!cur || !cur.runs.length)) continue;
        if (!cur) newLine(kind);
        cur.runs.push({ t, f: new Set(f), href });
        continue;
      }
      if (c.nodeType !== 1) continue;
      const t = c.tagName;
      if (t === "SCRIPT" || t === "STYLE" || t === "HEAD" || t === "TITLE" || t === "META") continue;
      if (t === "BR") { newLine(kind === "ul" || kind === "ol" ? null : kind === "quote" ? "quote" : null); continue; }
      if (t === "IMG") continue;
      const f2 = new Set(f);
      let href2 = href, kind2 = kind;
      if (t === "B" || t === "STRONG") f2.add("b");
      if (t === "I" || t === "EM") f2.add("i");
      if (t === "U") f2.add("u");
      if (t === "S" || t === "STRIKE" || t === "DEL") f2.add("s");
      if (t === "MARK") f2.add("h");
      const st = c.getAttribute("style") || "";
      if (/font-weight\s*:\s*(bold|[6-9]00)/i.test(st)) f2.add("b");
      if (/font-style\s*:\s*italic/i.test(st)) f2.add("i");
      if (/text-decoration[^;]*underline/i.test(st)) f2.add("u");
      if (/text-decoration[^;]*line-through/i.test(st)) f2.add("s");
      if (/background(-color)?\s*:\s*(?!transparent|rgba\(0,\s*0,\s*0,\s*0\)|#fff\b|#ffffff|white|initial|inherit|none)/i.test(st)) f2.add("h");
      if (t === "A" && c.getAttribute("href") && /^(https?|mailto|file|ftp):/i.test(c.getAttribute("href"))) href2 = c.getAttribute("href");
      if (/^H[1-6]$/.test(t)) kind2 = "h" + Math.min(3, +t[1]);
      if (t === "LI") kind2 = c.parentNode && c.parentNode.tagName === "OL" ? "ol" : "ul";
      if (t === "BLOCKQUOTE") kind2 = "quote";
      if (BLOCKS.has(t)) {
        if (t !== "UL" && t !== "OL" && t !== "TABLE" && t !== "TBODY") newLine(kind2);
        walk(c, f2, href2, kind2);
        cur = null;
      } else walk(c, f2, href2, kind2);
    }
  };
  walk(doc.body, new Set(), null, null);
  // tidy: no empty lines from markup, spaces trimmed at the ends
  const lines = out.filter((ln) => ln.runs.some((r) => r.t.trim()));
  for (const ln of lines) {
    if (ln.runs.length) {
      ln.runs[0].t = ln.runs[0].t.replace(/^\s+/, "");
      ln.runs[ln.runs.length - 1].t = ln.runs[ln.runs.length - 1].t.replace(/\s+$/, "");
    }
    if (ln.kind && ln.kind[0] === "h") for (const r of ln.runs) r.f.delete("b");
  }
  return lines;
}

export { HL };
