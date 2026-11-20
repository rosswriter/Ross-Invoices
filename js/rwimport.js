// Ross Writer projects, brought in as notes (File ▸ Import a Ross Writer Project…). Loaded only then.
// A project is a folder holding <name>.rwproj (JSON: the tree of chapters and scenes, their titles and order)
// and Scenes/<id>.docx, a Word file for each entry. Nothing in the project is changed: it's only read.
import { unzip } from "./wordio.js?v=1.8.3";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const W14 = "http://schemas.microsoft.com/office/word/2010/wordml";
const W15 = "http://schemas.microsoft.com/office/word/2012/wordml";

export const EXT = ".rwproj";

// the .rwproj files in a folder
export async function projectFiles(dir) {
  const out = [];
  for await (const [name, h] of dir.entries()) {
    if (h.kind === "file" && name.toLowerCase().endsWith(EXT) && !name.startsWith(".")) out.push(name);
  }
  return out.sort();
}

export async function readProject(dir, fileName) {
  const f = await (await dir.getFileHandle(fileName)).getFile();
  let text = (await f.text()).replace(/^﻿/, "").trim();
  if (!text) throw new Error("the project file is empty (your sync app may not have finished copying it)");
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error("the project file can't be read (" + e.message + ")"); }
  if (!data || typeof data !== "object" || !Array.isArray(data.nodes)) throw new Error("this isn't a Ross Writer project file");
  return data;
}

export function countEntries(nodes) {
  let n = 0;
  const walk = (lst) => { for (const x of lst || []) if (x && typeof x === "object") { n++; walk(x.children); } };
  walk(nodes);
  return n;
}

// an entry's Word file (bytes), or null if it isn't there
export async function sceneBytes(dir, raw) {
  const parts = String(raw.file || "").split(/[\\/]+/).filter(Boolean);
  if (!parts.length) return null;
  try {
    let d = dir;
    for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p);
    return await (await (await d.getFileHandle(parts[parts.length - 1])).getFile()).arrayBuffer();
  } catch (e) { return null; }
}

const xml = (s) => new DOMParser().parseFromString(s, "application/xml");
const wa = (el, name) => el.getAttributeNS(W, name) ?? el.getAttribute("w:" + name);

// the comments in a Word file: [{id, author, date, text, words, reply}], in the order they're in the text
export async function readComments(buf) {
  const files = await unzip(buf);
  const text = async (p) => (files.has(p) ? new TextDecoder().decode(await files.get(p)()) : null);
  const cx = await text("word/comments.xml");
  if (!cx) return [];
  const cdoc = xml(cx);
  const byId = new Map(), paraOf = new Map();
  for (const c of cdoc.getElementsByTagNameNS(W, "comment")) {
    const id = wa(c, "id");
    const paras = [...c.getElementsByTagNameNS(W, "p")];
    const body = paras.map((p) => [...p.getElementsByTagNameNS(W, "t")].map((t) => t.textContent).join("")).join(" ").trim();
    byId.set(id, { id, author: wa(c, "author") || "", date: wa(c, "date") || "", text: body, words: "", reply: false });
    const last = paras[paras.length - 1];
    const pid = last && (last.getAttributeNS(W14, "paraId") || last.getAttribute("w14:paraId"));
    if (pid) paraOf.set(pid.toUpperCase(), id);
  }
  // replies (Word's commentsExtended: a comment whose paragraph names a parent paragraph)
  const ext = await text("word/commentsExtended.xml");
  if (ext) {
    for (const e of xml(ext).getElementsByTagNameNS(W15, "commentEx")) {
      const pid = (e.getAttributeNS(W15, "paraId") || e.getAttribute("w15:paraId") || "").toUpperCase();
      const parent = e.getAttributeNS(W15, "paraIdParent") || e.getAttribute("w15:paraIdParent");
      const done = e.getAttributeNS(W15, "done") || e.getAttribute("w15:done");
      const c = byId.get(paraOf.get(pid));
      if (!c) continue;
      if (parent) c.reply = true;
      if (done === "1") c.done = true;
    }
  }
  // the words each one is on (the text between its marks; deleted text left out), and its place in the text
  const dx = await text("word/document.xml");
  const order = [];
  if (dx) {
    const doc = xml(dx);
    const open = new Set();
    const walker = doc.createTreeWalker(doc.documentElement, NodeFilter.SHOW_ELEMENT);
    let el = walker.currentNode, lastP = null;
    while (el) {
      if (el.namespaceURI === W) {
        const t = el.localName;
        if (t === "commentRangeStart") { const id = wa(el, "id"); open.add(id); if (!order.includes(id)) order.push(id); }
        else if (t === "commentRangeEnd") open.delete(wa(el, "id"));
        else if (t === "commentReference") { const id = wa(el, "id"); if (!order.includes(id)) order.push(id); }
        else if (t === "t" && open.size) { for (const id of open) { const c = byId.get(id); if (c) c.words += el.textContent; } }
        else if (t === "tab" && open.size) { for (const id of open) { const c = byId.get(id); if (c) c.words += " "; } }
        else if (t === "p") {
          if (lastP && open.size) for (const id of open) { const c = byId.get(id); if (c && c.words && !c.words.endsWith(" ")) c.words += " "; }
          lastP = el;
        }
      }
      el = walker.nextNode();
    }
  }
  const out = [];
  for (const id of order) if (byId.has(id)) out.push(byId.get(id));
  for (const [id, c] of byId) if (!order.includes(id)) out.push(c);
  for (const c of out) c.words = c.words.replace(/\s+/g, " ").trim();
  return out;
}

// "12 Nov 2026" from Word's date
export function shortDate(iso) {
  const d = new Date(iso);
  if (!iso || isNaN(d)) return "";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// the comments as lines for the end of a note (Word lines: kind, depth, runs)
export function commentLines(cs) {
  if (!cs.length) return [];
  const t = (s, f = []) => ({ t: s, f: new Set(f) });
  const out = [{ kind: null, depth: 1, runs: [] }, { kind: "h3", depth: 1, runs: [t("Comments")] }];
  for (const c of cs) {
    const who = [c.author, shortDate(c.date)].filter(Boolean).join(", ");
    const runs = [];
    if (c.reply) runs.push(t("Reply: "));
    else if (c.words) runs.push(t("“" + (c.words.length > 120 ? c.words.slice(0, 117) + "…" : c.words) + "”", ["i"]), t(": "));
    runs.push(t(c.text || "(no words)"));
    if (who || c.done) runs.push(t(" — " + [who, c.done ? "resolved" : ""].filter(Boolean).join(", ")));
    out.push({ kind: "ul", depth: c.reply ? 2 : 1, runs });
  }
  return out;
}
