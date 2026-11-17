// Word documents (.docx) in and out, the same way as the laptop's wordio.py.
// In: a .docx becomes lines (md.js's line model); out: lines become a .docx.
// Only loaded when you import or export, so the app stays quick to open.
import * as md from "./md.js?v=2.1.2";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const A_ = "http://schemas.openxmlformats.org/drawingml/2006/main";
const V = "urn:schemas-microsoft-com:vml";
const PR = "http://schemas.openxmlformats.org/package/2006/relationships";
const DC = "http://purl.org/dc/elements/1.1/";
const OBJ = md.OBJ;

// ================================================================ zip
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

async function inflate(bytes) {
  const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
async function deflate(bytes) {
  const s = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

// name -> async () => Uint8Array
export async function unzip(buf) {
  const b = new Uint8Array(buf);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let e = b.length - 22;
  while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error("not a zip file");
  const count = dv.getUint16(e + 10, true);
  let p = dv.getUint32(e + 16, true);
  const out = new Map();
  const dec = new TextDecoder();
  for (let k = 0; k < count; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    const lnlen = dv.getUint16(local + 26, true), lxlen = dv.getUint16(local + 28, true);
    const start = local + 30 + lnlen + lxlen;
    const data = b.subarray(start, start + csize);
    out.set(name, method === 0 ? async () => data : async () => inflate(data));
  }
  return out;
}

export async function zip(files) {   // [[name, Uint8Array|string, compress]]
  const enc = new TextEncoder();
  const parts = [], central = [];
  let offset = 0;
  for (const [name, content, compress] of files) {
    const raw = typeof content === "string" ? enc.encode(content) : content;
    const crc = crc32(raw);
    const data = compress ? await deflate(raw) : raw;
    const nb = enc.encode(name);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true);
    h.setUint16(8, compress ? 8 : 0, true); h.setUint16(10, 0, true); h.setUint16(12, 0x21, true);
    h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, raw.length, true);
    h.setUint16(26, nb.length, true); h.setUint16(28, 0, true);
    parts.push(new Uint8Array(h.buffer), nb, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint16(10, compress ? 8 : 0, true); c.setUint16(12, 0, true); c.setUint16(14, 0x21, true);
    c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, raw.length, true);
    c.setUint16(28, nb.length, true); c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), nb);
    offset += 30 + nb.length + data.length;
  }
  const csize = central.reduce((a, x) => a + x.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, csize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)],
    { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}

// ================================================================ reading
const kids = (el, local) => [...el.children].filter((c) => c.namespaceURI === W && (!local || c.localName === local));
const kid = (el, local) => el && kids(el, local)[0] || null;
const wv = (el, name = "val") => el ? el.getAttributeNS(W, name) || el.getAttribute("w:" + name) : null;

function on(rpr, tag) {
  const e = kid(rpr, tag);
  if (!e) return null;
  const v = wv(e);
  return !["0", "false", "off", "none"].includes(v);
}

class Styles {
  constructor(doc) {
    this.byId = new Map();
    if (!doc) return;
    for (const s of kids(doc.documentElement, "style")) {
      const ppr = kid(s, "pPr"), rpr = kid(s, "rPr");
      let outline = null, num = null;
      if (ppr) {
        const o = kid(ppr, "outlineLvl");
        if (o && /^\d+$/.test(wv(o) || "")) outline = +wv(o);
        const np = kid(ppr, "numPr");
        if (np && kid(np, "numId")) num = [wv(kid(np, "numId")), kid(np, "ilvl") ? +wv(kid(np, "ilvl")) || 0 : 0];
      }
      const sid = wv(s, "styleId");
      this.byId.set(sid, {
        name: (wv(kid(s, "name")) || sid || "").toLowerCase(), based: kid(s, "basedOn") ? wv(kid(s, "basedOn")) : null,
        outline, num, b: on(rpr, "b"), i: on(rpr, "i"),
      });
    }
  }
  chain(sid) {
    const seen = [];
    while (sid && this.byId.has(sid) && !seen.includes(sid)) { seen.push(sid); sid = this.byId.get(sid).based; }
    return seen.map((s) => this.byId.get(s));
  }
  kind(sid) {
    if (!sid) return null;
    for (const st of this.chain(sid)) {
      const n = st.name;
      const m = /^heading\s*(\d)$/.exec(n);
      if (m) return "h" + Math.min(6, Math.max(1, +m[1]));
      if (n === "title") return "title";
      if (n === "subtitle") return "h2";
      if (["quote", "intense quote", "block text", "quotations", "block quotation"].includes(n)) return "quote";
      if (n.startsWith("list bullet")) return "ul";
      if (n.startsWith("list number")) return "ol";
      if (["html preformatted", "code", "preformatted text", "source code", "macro text"].includes(n)) return "code";
      if (st.outline != null && st.outline < 6) return "h" + (st.outline + 1);
    }
    const m = /^heading(\d)$/.exec(sid.toLowerCase());
    return m ? "h" + +m[1] : null;
  }
  listDepth(sid) {
    for (const st of this.chain(sid)) {
      const m = /^list (bullet|number)\s*(\d)$/.exec(st.name);
      if (m) return +m[2];
    }
    return 1;
  }
  num(sid) { for (const st of this.chain(sid)) if (st.num) return st.num; return null; }
  flags(sid) {
    const f = new Set();
    for (const st of this.chain(sid).reverse()) {
      for (const k of ["b", "i"]) { if (st[k] === true) f.add(k); else if (st[k] === false) f.delete(k); }
    }
    return f;
  }
}

class Numbering {
  constructor(doc) {
    this.abstract = new Map();
    this.nums = new Map();
    if (!doc) return;
    for (const a of kids(doc.documentElement, "abstractNum")) {
      const lv = new Map();
      for (const l of kids(a, "lvl")) lv.set(+(wv(l, "ilvl") || 0), kid(l, "numFmt") ? wv(kid(l, "numFmt")) : "bullet");
      this.abstract.set(wv(a, "abstractNumId"), lv);
    }
    for (const n of kids(doc.documentElement, "num")) {
      if (kid(n, "abstractNumId")) this.nums.set(wv(n, "numId"), wv(kid(n, "abstractNumId")));
    }
  }
  kind(id, ilvl) {
    if (id == null || id === "0") return null;
    const lv = this.abstract.get(this.nums.get(id)) || new Map();
    const fmt = lv.has(ilvl) ? lv.get(ilvl) : lv.get(0) || "bullet";
    return fmt === "bullet" || fmt === "none" ? "ul" : "ol";
  }
}

const xml = (text) => new DOMParser().parseFromString(text, "application/xml");

async function relsOf(files, path) {
  const out = new Map();
  if (!files.has(path)) return out;
  const d = xml(new TextDecoder().decode(await files.get(path)()));
  for (const r of d.getElementsByTagNameNS(PR, "Relationship")) out.set(r.getAttribute("Id"), [r.getAttribute("Target"), r.getAttribute("TargetMode")]);
  return out;
}

function tidyRuns(runs) {
  const out = [];
  for (const r of runs) {
    const last = out[out.length - 1];
    if (last && !r.img && !last.img && sameSet(last.f, r.f) && (last.href || null) === (r.href || null)) last.t += r.t;
    else out.push({ ...r, f: new Set(r.f) });
  }
  if (out.length && !out[0].img) out[0].t = out[0].t.replace(/^\s+/, "");
  if (out.length && !out[out.length - 1].img) out[out.length - 1].t = out[out.length - 1].t.replace(/\s+$/, "");
  return out.filter((r) => r.t || r.img);
}
const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

// {lines (wordio's: kind, depth, runs, code, title), media: Map(name -> Uint8Array), title}
// opts.keep (a Ross Writer scene): every line as it is (no empty lines taken out), each with .src, the
// place of its paragraph in the body, so a scene can be written back with the untouched paragraphs as they were
export async function readDocx(buf, opts = {}) {
  const files = opts.files || await unzip(buf);
  const text = async (p) => (files.has(p) ? new TextDecoder().decode(await files.get(p)()) : null);
  const docText = await text("word/document.xml");
  if (!docText) throw new Error("not a Word document");
  const doc = xml(docText);
  const stylesText = await text("word/styles.xml"), numText = await text("word/numbering.xml");
  const styles = new Styles(stylesText ? xml(stylesText) : null);
  const numbering = new Numbering(numText ? xml(numText) : null);
  const rels = await relsOf(files, "word/_rels/document.xml.rels");
  let title = "";
  const core = await text("docProps/core.xml");
  if (core) { const t = xml(core).getElementsByTagNameNS(DC, "title")[0]; title = t ? t.textContent.trim() : ""; }
  const media = new Map();
  const lines = [];
  const pending = [];

  const picture = (rid) => {
    const rel = rels.get(rid);
    if (!rel || rel[1] === "External" || !rel[0]) return null;
    let name = rel[0].startsWith("/") ? rel[0].slice(1) : "word/" + rel[0];
    name = name.replace(/[^/]+\/\.\.\//g, "");
    if (!files.has(name)) return null;
    const base = name.split("/").pop();
    pending.push(files.get(name)().then((d) => media.set(base, d)));
    return base;
  };

  const runsOf = (p, paraFlags, heading, out) => {
    const run = (r, href) => {
      const rpr = kid(r, "rPr");
      const f = new Set(paraFlags);
      if (rpr) {
        const rs = kid(rpr, "rStyle");
        if (rs) {
          const cs = wv(rs) || "";
          const nm = (styles.byId.get(cs) || {}).name || cs.toLowerCase();
          if (nm === "strong" || nm === "bold" || styles.flags(cs).has("b")) f.add("b");
          if (nm === "emphasis" || nm === "italic" || styles.flags(cs).has("i")) f.add("i");
        }
        for (const [k, tag] of [["b", "b"], ["i", "i"], ["s", "strike"], ["s", "dstrike"]]) {
          const v = on(rpr, tag);
          if (v === true) f.add(k);
          else if (v === false && (tag === "b" || tag === "i")) f.delete(k);
        }
        const u = kid(rpr, "u");
        if (u && !["none", "0"].includes(wv(u) || "single") && !href) f.add("u");
        const hl = kid(rpr, "highlight");
        if (hl && !["none", "white"].includes(wv(hl) || "none")) f.add("h");
        const shd = kid(rpr, "shd");
        if (shd && !["auto", "ffffff", "none", ""].includes((wv(shd, "fill") || "auto").toLowerCase())) f.add("h");
        const va = kid(rpr, "vanish");
        if (va && !["0", "false"].includes(wv(va) || "true")) return;
      }
      if (heading) f.delete("b");
      for (const c of r.children) {
        if (c.namespaceURI === W) {
          const t = c.localName;
          if (t === "t") { if (c.textContent) out.push({ t: c.textContent, f: new Set(f), href }); }
          else if (t === "tab" || t === "ptab") out.push({ t: " ", f: new Set(f), href });
          else if (t === "br" || t === "cr") { if (wv(c, "type") !== "page") out.push(null); }
          else if (t === "noBreakHyphen") out.push({ t: "-", f: new Set(f), href });
          else if (t === "drawing") {
            for (const b of c.getElementsByTagNameNS(A_, "blip")) {
              const name = picture(b.getAttributeNS(R, "embed"));
              if (name) out.push({ t: OBJ, f: new Set(), img: name });
            }
          } else if (t === "pict" || t === "object") {
            for (const im of c.getElementsByTagNameNS(V, "imagedata")) {
              const name = picture(im.getAttributeNS(R, "id"));
              if (name) out.push({ t: OBJ, f: new Set(), img: name });
            }
          }
        }
      }
    };
    const walk = (el, href) => {
      for (const c of el.children) {
        if (c.namespaceURI !== W) continue;
        const t = c.localName;
        if (t === "r") run(c, href);
        else if (t === "hyperlink") {
          const rid = c.getAttributeNS(R, "id");
          const h = rid && rels.get(rid) ? rels.get(rid)[0] : null;
          walk(c, h || href);
        } else if (["ins", "smartTag", "fldSimple", "customXml"].includes(t)) walk(c, href);
        else if (t === "sdt") { const sc = kid(c, "sdtContent"); if (sc) walk(sc, href); }
      }
    };
    walk(p, null);
  };

  const paragraph = (p) => {
    const ppr = kid(p, "pPr");
    let sid = null, num = null;
    if (ppr) {
      sid = kid(ppr, "pStyle") ? wv(kid(ppr, "pStyle")) : null;
      const np = kid(ppr, "numPr");
      if (np && kid(np, "numId")) num = [wv(kid(np, "numId")), kid(np, "ilvl") ? +wv(kid(np, "ilvl")) || 0 : 0];
    }
    let kind = styles.kind(sid);
    if (num == null && sid) num = styles.num(sid);
    let depth = kind === "ul" || kind === "ol" ? styles.listDepth(sid) : 1;
    if (num != null) {
      const lk = numbering.kind(num[0], num[1]);
      if (lk && !(kind && kind[0] === "h" || kind === "title")) {
        depth = Math.max(num[1] + 1, kind === "ul" || kind === "ol" ? depth : 1);
        kind = lk;
      }
    }
    const isTitle = kind === "title";
    if (isTitle) kind = "h1";
    const heading = !!kind && kind[0] === "h";
    const code = kind === "code";
    if (code) kind = null;
    const out = [];
    runsOf(p, sid && !heading && kind !== "quote" ? styles.flags(sid) : new Set(), heading, out);
    const parts = [[]];
    for (const r of out) { if (r === null) parts.push([]); else parts[parts.length - 1].push(r); }
    return parts.map((runs, k) => ({
      kind: k === 0 || kind === "quote" ? kind : (kind === "ul" || kind === "ol" || heading ? null : kind),
      depth, runs: tidyRuns(runs), code, title: isTitle && k === 0,
    }));
  };

  const table = (tb) => {
    const rows = [];
    for (const tr of kids(tb, "tr")) {
      const cells = [];
      for (const tc of kids(tr, "tc")) {
        const txt = [];
        for (const p of tc.getElementsByTagNameNS(W, "p")) {
          for (const ln of paragraph(p)) {
            const t = ln.runs.filter((r) => !r.img).map((r) => r.t).join("").trim();
            if (t) txt.push(t);
          }
        }
        cells.push(txt.join(" ").replace(/\|/g, "\\|"));
      }
      rows.push(cells);
    }
    if (!rows.length) return;
    const width = Math.max(...rows.map((r) => r.length));
    rows.forEach((r, k) => {
      r = [...r, ...Array(width - r.length).fill("")];
      lines.push({ kind: null, depth: 1, runs: [{ t: "| " + r.join(" | ") + " |", f: new Set() }], code: true });
      if (k === 0) lines.push({ kind: null, depth: 1, runs: [{ t: "|" + Array(width).fill(" --- ").join("|") + "|", f: new Set() }], code: true });
    });
  };

  const block = (el, top) => {
    [...el.children].forEach((c, idx) => {
      if (c.namespaceURI !== W) return;
      if (c.localName === "p") {
        const ls = paragraph(c);
        if (top) ls.forEach((ln) => { ln.src = idx; });
        lines.push(...ls);
      } else if (c.localName === "tbl") table(c);
      else if (c.localName === "sdt") { const sc = kid(c, "sdtContent"); if (sc) block(sc); }
      else if (c.localName === "ins" || c.localName === "customXml") block(c);
    });
  };
  const body = kid(doc.documentElement, "body");
  if (body) block(body, true);
  await Promise.all(pending);
  if (opts.keep) return { lines, media, title, files, docText };
  const tidy = [];
  for (const ln of lines) {
    const empty = !ln.runs.some((r) => r.t.trim()) && !ln.kind;
    if (empty && (!tidy.length || tidy[tidy.length - 1]._empty)) continue;
    ln._empty = empty;
    tidy.push(ln);
  }
  while (tidy.length && tidy[tidy.length - 1]._empty) tidy.pop();
  for (const ln of tidy) delete ln._empty;
  return { lines: tidy, media, title };
}

export function splitSections(lines) {
  const levels = lines.filter((l) => l.kind && l.kind[0] === "h" && !l.title).map((l) => +l.kind[1]);
  if (!levels.length) return { pre: lines, secs: [] };
  const top = "h" + Math.min(...levels);
  const pre = [], secs = [];
  for (const ln of lines) {
    if (ln.kind === top && !ln.title) secs.push([ln]);
    else if (secs.length) secs[secs.length - 1].push(ln);
    else pre.push(ln);
  }
  return { pre, secs };
}

// wordio lines -> md.js lines (lists deeper than one get a marker with their indent)
export function toNoteLines(lines, picture) {
  return lines.map((ln) => {
    if (ln.code) {
      const t = ln.runs.map((r) => r.t).join("");
      return { kind: null, runs: [{ t, f: new Set() }], raw: t, code: true };
    }
    const out = { kind: ln.kind, mark: null, runs: [] };
    if ((ln.kind === "ul" || ln.kind === "ol") && ln.depth > 1) {
      const lead = "  ".repeat(ln.depth - 1);
      out.mark = ln.kind === "ul" ? "ul:" + lead + "- " : "ol:" + lead + "\u0000. ";
    }
    for (const r of ln.runs) {
      if (r.img) { const target = picture(r.img); if (target) out.runs.push({ t: OBJ, f: new Set(), img: { src: "", size: "", target } }); continue; }
      out.runs.push({ t: r.t.replace(/\n/g, " "), f: new Set(r.f), href: r.href || null });
    }
    return out;
  });
}

// md.js lines -> wordio lines
export function fromNoteLines(lines) {
  const { depthOf } = md.listLayout(lines);
  return lines.map((ln, k) => {
    if (ln.raw != null && (ln.code || ln.runs.map((r) => r.t).join("") === ln.raw)) {
      return { kind: null, depth: 1, code: !!ln.code, runs: [{ t: ln.runs.map((r) => r.t).join(""), f: new Set() }] };
    }
    const heading = !!ln.kind && ln.kind[0] === "h";
    return {
      kind: ln.kind, depth: depthOf[k] || 1, code: false,
      runs: ln.runs.map((r) => (r.img ? { t: OBJ, f: new Set(), img: r.img }
        : { t: r.t.split(OBJ).join(""), f: heading ? new Set([...r.f].filter((x) => x !== "b")) : r.f, href: r.href || null })),
    };
  });
}

// ================================================================ writing
const TEXT_WIDTH_EMU = 5760720;
const HEAD_PT = { 1: 20, 2: 16, 3: 14, 4: 12, 5: 12, 6: 12 };
const x = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const xa = (s) => x(s).replace(/"/g, "&quot;");

function stylesXml(font) {
  const f = xa(font);
  let heads = "";
  for (let k = 1; k <= 6; k++) {
    heads += `<w:style w:type="paragraph" w:styleId="Heading${k}"><w:name w:val="heading ${k}"/><w:basedOn w:val="Normal"/>` +
      `<w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="${k < 3 ? 240 : 160}" w:after="80"/>` +
      `<w:outlineLvl w:val="${k - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${HEAD_PT[k] * 2}"/><w:szCs w:val="${HEAD_PT[k] * 2}"/></w:rPr></w:style>`;
  }
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<w:styles xmlns:w="${W}">` +
    `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${f}" w:hAnsi="${f}" w:eastAsia="${f}" w:cs="${f}"/>` +
    '<w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault>' +
    '<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    heads +
    '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/>' +
    '<w:pPr><w:ind w:left="567" w:right="284"/></w:pPr><w:rPr><w:color w:val="6B6145"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/>' +
    '<w:qFormat/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/>' +
    '<w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="20"/></w:rPr></w:style>' +
    '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/>' +
    '<w:rPr><w:color w:val="1A5FB4"/><w:u w:val="single"/></w:rPr></w:style>' +
    "</w:styles>";
}

function numberingXml(nOrdered) {
  const lvls = (bullet) => {
    let out = "";
    for (let k = 0; k < 9; k++) {
      const ind = 720 * (k + 1);
      out += bullet
        ? `<w:lvl w:ilvl="${k}"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="${"•◦▪"[k % 3]}"/>` +
          `<w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${ind}" w:hanging="360"/></w:pPr></w:lvl>`
        : `<w:lvl w:ilvl="${k}"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%${k + 1}."/>` +
          `<w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${ind}" w:hanging="360"/></w:pPr></w:lvl>`;
    }
    return out;
  };
  let nums = '<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>';
  for (let k = 0; k < nOrdered; k++) {
    let ov = "";
    for (let i = 0; i < 9; i++) ov += `<w:lvlOverride w:ilvl="${i}"><w:startOverride w:val="1"/></w:lvlOverride>`;
    nums += `<w:num w:numId="${k + 2}"><w:abstractNumId w:val="2"/>${ov}</w:num>`;
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="${W}">` +
    `<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${lvls(true)}</w:abstractNum>` +
    `<w:abstractNum w:abstractNumId="2"><w:multiLevelType w:val="hybridMultilevel"/>${lvls(false)}</w:abstractNum>${nums}` +
    "</w:numbering>";
}

export function rpr(f, link) {
  let p = "";
  if (link) p += '<w:rStyle w:val="Hyperlink"/>';
  if (f.has("b")) p += "<w:b/><w:bCs/>";
  if (f.has("i")) p += "<w:i/><w:iCs/>";
  if (f.has("s")) p += "<w:strike/>";
  if (f.has("h")) p += '<w:highlight w:val="yellow"/>';   // highlight before u: Word's order
  if (f.has("u") && !link) p += '<w:u w:val="single"/>';
  return p ? `<w:rPr>${p}</w:rPr>` : "";
}

export function imageSize(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  try {
    if (b[0] === 0x89 && b[1] === 0x50) return [dv.getUint32(16), dv.getUint32(20)];
    if (b[0] === 0x47 && b[1] === 0x49) return [dv.getUint16(6, true), dv.getUint16(8, true)];
    if (b[0] === 0x42 && b[1] === 0x4D) return [dv.getInt32(18, true), Math.abs(dv.getInt32(22, true))];
    if (b[0] === 0x52 && b[8] === 0x57) {
      const ch = String.fromCharCode(b[12], b[13], b[14], b[15]);
      if (ch === "VP8X") return [1 + (b[24] | b[25] << 8 | b[26] << 16), 1 + (b[27] | b[28] << 8 | b[29] << 16)];
      if (ch === "VP8 ") return [dv.getUint16(26, true) & 0x3FFF, dv.getUint16(28, true) & 0x3FFF];
      if (ch === "VP8L") { const v = dv.getUint32(21, true); return [(v & 0x3FFF) + 1, ((v >> 14) & 0x3FFF) + 1]; }
    }
    if (b[0] === 0xFF && b[1] === 0xD8) {
      let i = 2;
      while (i < b.length - 9) {
        if (b[i] !== 0xFF) { i++; continue; }
        const m = b[i + 1];
        if ([0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF].includes(m)) {
          return [dv.getUint16(i + 7), dv.getUint16(i + 5)];
        }
        if (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { i += 2; continue; }
        i += 2 + dv.getUint16(i + 2);
      }
    }
  } catch (e) { /* not one we know */ }
  return null;
}

export function extOf(b) {
  if (b[0] === 0x89 && b[1] === 0x50) return ["png", "image/png"];
  if (b[0] === 0x47 && b[1] === 0x49) return ["gif", "image/gif"];
  if (b[0] === 0x42 && b[1] === 0x4D) return ["bmp", "image/bmp"];
  if (b[0] === 0x52 && b[8] === 0x57) return ["webp", "image/webp"];
  return ["jpeg", "image/jpeg"];
}

// lines (wordio's) -> a .docx Blob. pictureBytes(img) -> Promise<Uint8Array|null>
export async function writeDocx(lines, pictureBytes, title = "", font = "Cambria") {
  const body = [], rels = [], media = [];
  const links = new Map();
  let nOrdered = 0, runId = null;
  const orderedIds = lines.map((ln) => {
    if (ln.kind === "ul" || ln.kind === "ol") {
      if (runId == null) { nOrdered += 1; runId = nOrdered + 1; }
      return runId;
    }
    runId = null;
    return null;
  });
  let picId = 0;
  const rel = (target, type, external) => {
    const rid = "rId" + (rels.length + 10);
    rels.push(`<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" ` +
      `Target="${xa(target)}"${external ? ' TargetMode="External"' : ""}/>`);
    return rid;
  };
  const pictureXml = async (img) => {
    const data = await pictureBytes(img);
    if (!data) return "";
    const size = imageSize(data) || [800, 600];
    const [ext] = extOf(data);
    picId += 1;
    const name = `image${picId}.${ext}`;
    media.push([name, data]);
    const rid = rel("media/" + name, "image");
    const share = { small: 1 / 3, medium: 0.6 }[img && img.size] || 1;
    const cx = Math.min(size[0] * 9525, Math.floor(TEXT_WIDTH_EMU * share));
    const cy = Math.floor(cx * size[1] / Math.max(1, size[0]));
    const n = picId;
    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>` +
      `<wp:docPr id="${n}" name="Picture ${n}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/>` +
      '</wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      `<pic:pic><pic:nvPicPr><pic:cNvPr id="${n}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/>` +
      "</a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>";
  };
  for (let k = 0; k < lines.length; k++) {
    const ln = lines[k];
    const kind = ln.kind;
    let ppr = "";
    if (ln.code) ppr += '<w:pStyle w:val="Code"/>';
    else if (kind && kind[0] === "h") ppr += `<w:pStyle w:val="Heading${kind[1]}"/>`;
    else if (kind === "quote") ppr += '<w:pStyle w:val="Quote"/>';
    else if (kind === "ul" || kind === "ol") {
      ppr += `<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="${Math.min(8, Math.max(0, (ln.depth || 1) - 1))}"/>` +
        `<w:numId w:val="${kind === "ul" ? 1 : orderedIds[k]}"/></w:numPr>`;
    }
    if (ln.pageBreak) ppr += "<w:pageBreakBefore/>";
    else if (ln.gapBefore) ppr += '<w:spacing w:before="360"/>';
    let out = "<w:p>" + (ppr ? `<w:pPr>${ppr}</w:pPr>` : "");
    for (const r of ln.runs || []) {
      if (r.img) { out += await pictureXml(r.img); continue; }
      const t = r.t.split(OBJ).join("");
      if (!t) continue;
      const f = ln.code ? new Set() : r.f || new Set();
      const href = r.href;
      if (href && !ln.code) {
        let rid = links.get(href);
        if (!rid) { rid = rel(href, "hyperlink", true); links.set(href, rid); }
        out += `<w:hyperlink r:id="${rid}"><w:r>${rpr(f, true)}<w:t xml:space="preserve">${x(t)}</w:t></w:r></w:hyperlink>`;
      } else out += `<w:r>${rpr(f, false)}<w:t xml:space="preserve">${x(t)}</w:t></w:r>`;
    }
    body.push(out + "</w:p>");
  }
  const document = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<w:document xmlns:w="${W}" xmlns:r="${R}" ` +
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
    `xmlns:a="${A_}" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<w:body>${body.join("") || "<w:p/>"}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>` +
    '<w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/>' +
    "</w:sectPr></w:body></w:document>";
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PR}">` +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>' +
    rels.join("") + "</Relationships>";
  const exts = [...new Map(media.map(([, d]) => { const e = extOf(d); return [e[0], e]; })).values()].sort();
  const types = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    exts.map(([e, t]) => `<Default Extension="${e}" ContentType="${t}"/>`).join("") +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    "</Types>";
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PR}">` +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    "</Relationships>";
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const core = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
    `xmlns:dc="${DC}" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
    `<dc:title>${x(title)}</dc:title><dc:creator>Ross Note</dc:creator>` +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>` +
    `<dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
  return zip([
    ["[Content_Types].xml", types, true], ["_rels/.rels", rootRels, true], ["docProps/core.xml", core, true],
    ["word/document.xml", document, true], ["word/styles.xml", stylesXml(font), true],
    ["word/numbering.xml", numberingXml(nOrdered), true], ["word/_rels/document.xml.rels", docRels, true],
    ...media.map(([n, d]) => ["word/media/" + n, d, false]),
  ]);
}

// ================================================================ a note for an email (as the laptop's notesio)
function runText(r) {
  const t = r.t.split(OBJ).join("");
  const h = r.href;
  if (h && t && t !== h && md.hrefOf(t) !== h) return `${t} (${h})`;
  return t;
}

export function plainText(lines) {
  const out = [];
  let counters = new Map();
  for (const ln of lines) {
    const kind = ln.kind;
    const text = ln.runs.filter((r) => !r.img).map(runText).join("");
    const d = ln.depth || 1;
    if (kind === "ol") {
      counters = new Map([...counters].filter(([k]) => k <= d));
      counters.set(d, (counters.get(d) || 0) + 1);
    } else if (kind !== "ul") counters = new Map();
    if (!text.trim() && ln.runs.length && ln.runs.every((r) => r.img)) continue;
    if (kind === "ul") out.push("  ".repeat(d - 1) + "• " + text);
    else if (kind === "ol") out.push("  ".repeat(d - 1) + counters.get(d) + ". " + text);
    else if (kind === "quote") out.push("> " + text);
    else out.push(text);
  }
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out.join("\n") + "\n";
}

export function htmlText(lines) {
  const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const out = [];
  let counters = new Map();
  for (const ln of lines) {
    const kind = ln.kind;
    let body = "";
    for (const r of ln.runs) {
      if (r.img) continue;
      let t = esc(r.t.split(OBJ).join(""));
      if (!t) continue;
      const f = r.f || new Set();
      if (f.has("b")) t = `<b>${t}</b>`;
      if (f.has("i")) t = `<i>${t}</i>`;
      if (f.has("u")) t = `<u>${t}</u>`;
      if (f.has("s")) t = `<s>${t}</s>`;
      if (f.has("h")) t = `<span style="background-color:#ffd54f">${t}</span>`;
      if (r.href) t = `<a href="${esc(r.href).replace(/"/g, "&quot;")}">${t}</a>`;
      body += t;
    }
    if (!body && ln.runs.length && ln.runs.every((r) => r.img)) continue;
    const d = ln.depth || 1;
    if (kind === "ol") {
      counters = new Map([...counters].filter(([k]) => k <= d));
      counters.set(d, (counters.get(d) || 0) + 1);
    } else if (kind !== "ul") counters = new Map();
    if (ln.code) out.push(`<div style="font-family:monospace">${body || "&nbsp;"}</div>`);
    else if (kind && kind[0] === "h") { const h = Math.min(3, +kind[1]); out.push(`<h${h}>${body}</h${h}>`); }
    else if (kind === "ul") out.push(`<div style="margin-left:${d}em">• ${body}</div>`);
    else if (kind === "ol") out.push(`<div style="margin-left:${d}em">${counters.get(d)}. ${body}</div>`);
    else if (kind === "quote") out.push(`<blockquote style="margin:0 0 0 2em;color:#555">${body}</blockquote>`);
    else out.push(`<div>${body || "<br>"}</div>`);
  }
  return `<html><body>${out.join("\n")}</body></html>`;
}
