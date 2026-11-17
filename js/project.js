// A Ross Writer project, worked on as Ross Note's notes.
//
// A project is a folder holding <name>.rwproj (JSON: the tree, titles, flags, Include, compile settings)
// and Scenes/<id>.docx, one Word file for each entry. Ross Writer makes and keeps them; the tablet reads
// and writes them in place, the way Ross Writer does:
//   - the tree, titles and order go into the .rwproj; everything else in it (flags, Include, synopsis,
//     tags, attachments, compile settings, things a later Ross Writer adds) is kept as it was
//   - a scene you edit is written back into its own Word file (wordpatch.js): the paragraphs you didn't
//     touch stay exactly as they were, so the scene keeps Ross Writer's look
//   - a scene with comments, footnotes, tracked changes, tables... is shown but never written (read-only)
//   - a deleted entry's files go to the project's Trash folder, as Ross Writer does it
//
// For the rest of Ross Note an entry looks like a note: its text is "# Title" and the scene as Markdown,
// with the scene's pictures as media/<id>/<name> (kept in memory, never written as files).
import * as md from "./md.js?v=2.1.2";
import * as wordio from "./wordio.js?v=2.1.2";
import { blockers, patchDocx, sigOf, readComments, commentEdit } from "./wordpatch.js?v=2.1.2";

export const PROJECT_EXT = ".rwproj";
const FORMAT = "ross-writer-project";
const SCENES = "Scenes";
const TRASH = "Trash";

export const FLAG_COLOURS = { red: "#d64541", orange: "#ec8a2f", yellow: "#e6c229", green: "#43a047",
  blue: "#3d7fd6", purple: "#8e5bc2" };

function nowIso() {
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function stamp() { return nowIso().replace("T", " ").replace(/:/g, "."); }
function newId() {
  const b = new Uint8Array(6);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}
// Ross Writer's project.safe_name
export function rwSafeName(s) {
  s = (s || "").replace(/[\\/:*?"<>|\x00-\x1f]+/g, " ").trim();
  return (s.slice(0, 80) || "Untitled").replace(/[. ]+$/, "");
}

async function writeFile(dir, name, data) {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(data);
  await w.close();
  return fh;
}

// an entry, as the app sees notes
export class PNote {
  constructor(parent, raw) {
    this.parent = parent;
    this.raw = raw;               // its object in the .rwproj, changed in place
    this.name = raw ? raw.id : "";
    this.children = [];
    this.text = null;
    this.modified = 0;
    this.readOnly = null;         // what keeps it from being written: ["tracked changes", ...], or null
    this.comments = [];           // its Word comments (wordpatch.readComments), for the list beside the page
  }
  isRoot() { return this.parent === null; }
  folderParts() { return []; }
  childParts() { return []; }
  ancestors() {
    const out = [];
    let p = this.parent;
    while (p && !p.isRoot()) { out.push(p); p = p.parent; }
    return out;
  }
  key() { return [...this.ancestors().reverse().map((a) => a.name), this.name].join("/"); }
  *walk() { for (const c of this.children) { yield c; yield* c.walk(); } }
  title() { return (this.raw && this.raw.title) || "Untitled"; }
  flag() { return (this.raw && this.raw.flag) || ""; }
}

export async function findProjectFiles(dir) {
  const out = [];
  for await (const [name, h] of dir.entries()) if (h.kind === "file" && name.toLowerCase().endsWith(PROJECT_EXT)) out.push(name);
  return out.sort();
}

export class ProjectStore {
  constructor(dirHandle, fileName) {
    this.isProject = true;
    this.handle = dirHandle;
    this.fileName = fileName;
    this.root = new PNote(null, null);
    this.data = null;
    this.scenes = new Map();      // id -> {mtime, lines, sigs, files, trailing, text, readOnly}
    this.media = new Map();       // "id/name" -> File
    this.template = null;         // a scene's {files, lines} to make new scenes like it
    this.jsonModified = 0;
  }

  get label() { return (this.data && this.data.title) || this.fileName.replace(/\.rwproj$/i, ""); }

  // ------------------------------------------------------------ reading
  async scan() {
    const fh = await this.handle.getFileHandle(this.fileName);
    const f = await fh.getFile();
    // (a byte-order mark or spaces a sync app or editor put round it don't matter)
    const text = (await f.text()).replace(/^\uFEFF/, "").trim();
    if (!text) {
      throw new Error("The project file is empty on this device (0 bytes): your sync app may not have finished copying it. " +
        "Wait a moment, then try again.");
    }
    let data;
    try { data = JSON.parse(text); } catch (e) {
      throw new Error(`Ross Note couldn't read the project file (${f.size} bytes): ${e.message}\n\nIt begins: ` +
        JSON.stringify(text.slice(0, 120)));
    }
    if (!data || typeof data !== "object" || (data.format !== FORMAT && !Array.isArray(data.nodes))) {
      throw new Error("This isn't a Ross Writer project file. It begins: " + JSON.stringify(text.slice(0, 120)));
    }
    if (!Array.isArray(data.nodes)) data.nodes = [];
    this.data = data;
    this.jsonModified = f.lastModified;
    const root = new PNote(null, null);
    const build = async (parent, list) => {
      for (const raw of list) {
        if (!raw || typeof raw !== "object") continue;
        if (!raw.id) raw.id = newId();
        const n = new PNote(parent, raw);
        parent.children.push(n);
        await this.load(n);
        if (Array.isArray(raw.children)) await build(n, raw.children);
      }
    };
    await build(root, data.nodes);
    this.root = root;
    return root;
  }

  sceneParts(raw) { return String(raw.file || "").split(/[\\/]+/).filter(Boolean); }

  async sceneFile(raw, create = false) {
    const parts = this.sceneParts(raw);
    if (!parts.length) return null;
    let d = this.handle;
    for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create });
    return [d, parts[parts.length - 1]];
  }

  titleLine(n) { return { kind: "h1", mark: null, runs: [{ t: n.title(), f: new Set() }] }; }

  // the entry's text (and what's needed to write it back), read again only if its file changed
  async load(n, force = false) {
    const raw = n.raw;
    if (raw.pdf) {
      n.readOnly = ["a PDF"];
      n.text = md.serialize([this.titleLine(n), { kind: null, mark: null, runs: [] },
        { kind: null, mark: null, runs: [{ t: "A PDF: " + String(raw.pdf).split(/[\\/]/).pop() + ". Open it in Ross Writer.", f: new Set() }]}]);
      return n.text;
    }
    let file = null, missing = null;
    try {
      const got = await this.sceneFile(raw);
      if (got) file = await (await got[0].getFileHandle(got[1])).getFile();
    } catch (e) { file = null; missing = e; }
    if (!file && raw.file) {
      // its Word file isn't here (not synced to this device yet?): shown, never written over
      this.scenes.set(raw.id, { mtime: 0, lines: [], sigs: [], files: null, trailing: 0, readOnly: ["no Word file on this device yet"] });
      n.readOnly = ["no Word file on this device yet"];
      n.modified = 0;
      n.text = md.serialize([this.titleLine(n), { kind: null, mark: null, runs: [] },
        { kind: null, mark: null, runs: [{ t: `Its Word file (${raw.file}) isn't on this device yet: your sync app may still be copying it.`, f: new Set() }] }]);
      return n.text;
    }
    if (!file) {
      // no Word file yet (Ross Writer makes one when the entry is first opened): an empty scene
      this.scenes.set(raw.id, { mtime: 0, lines: [], sigs: [], files: null, trailing: 0, readOnly: null });
      n.readOnly = null;
      n.modified = 0;
      n.text = md.serialize([this.titleLine(n)]);
      return n.text;
    }
    const known = this.scenes.get(raw.id);
    if (!force && known && known.mtime === file.lastModified && known.text != null) {
      // just as the page gave it, if that's what was written last (and the title's the same)
      n.text = known.shown != null && known.shownTitle === n.title() ? known.shown : this.withTitle(n, known);
      n.readOnly = known.readOnly;
      n.comments = known.comments || [];
      n.modified = file.lastModified;
      return n.text;
    }
    let sc;
    try { sc = await this.readScene(raw.id, await file.arrayBuffer()); } catch (e) {
      // one scene Ross Note can't read doesn't stop the project opening: it's shown, never written over
      const why = `a Word file Ross Note couldn't read (${(e && e.message) || e})`;
      n.readOnly = [why];
      n.modified = file.lastModified;
      n.text = md.serialize([this.titleLine(n), { kind: null, mark: null, runs: [] },
        { kind: null, mark: null, runs: [{ t: `Ross Note couldn't read its Word file (${raw.file}, ${file.size} bytes): ${(e && e.message) || e}`, f: new Set() }] }]);
      this.scenes.set(raw.id, { mtime: 0, lines: [], sigs: [], files: null, trailing: 0, readOnly: [why] });
      return n.text;
    }
    sc.mtime = file.lastModified;
    this.scenes.set(raw.id, sc);
    n.readOnly = sc.readOnly;
    n.comments = sc.comments || [];
    n.modified = file.lastModified;
    n.text = this.withTitle(n, sc);
    if (!sc.readOnly && sc.files) this.template = sc;
    return n.text;
  }

  withTitle(n, sc) {
    // the scene's text with the entry's title as its first line
    return md.serialize([this.titleLine(n), ...(sc.noteLines || [])], { dir: [] });
  }

  async readScene(id, buf) {
    const got = await wordio.readDocx(buf, { keep: true });
    const ro = blockers(got.docText);
    for (const [name, data] of got.media) {
      const ext = name.split(".").pop().toLowerCase();
      const type = { png: "image/png", gif: "image/gif", bmp: "image/bmp", webp: "image/webp", svg: "image/svg+xml" }[ext] || "image/jpeg";
      this.media.set(id + "/" + name, new File([data], name, { type, lastModified: 1 }));
    }
    const noteLines = wordio.toNoteLines(got.lines, (name) => ["media", id, name]);
    let trailing = 0;
    for (let k = got.lines.length - 1; k >= 0; k--) {
      const ln = got.lines[k];
      if (ln.kind || ln.code || ln.runs.some((r) => r.img || (r.t || "").trim())) break;
      trailing++;
    }
    // the lines as the page will give them back (Markdown and back), so an untouched one is seen as such
    const text = md.serialize([{ kind: "h1", runs: [{ t: "T", f: new Set() }] }, ...noteLines], { dir: [] });
    const back = this.ownPictures(id, wordio.fromNoteLines(md.parse(text).slice(1)));
    const kept = got.lines.slice(0, got.lines.length - trailing);
    const sigs = back.length === kept.length ? back.map(sigOf).concat(got.lines.slice(kept.length).map(sigOf)) : null;
    let comments = [];
    try { comments = await readComments(got.files); } catch (e) { comments = []; }
    return { lines: got.lines, sigs, files: got.files, trailing, readOnly: ro.length ? ro : null, noteLines, text, comments };
  }

  // the scene's own pictures by their names (as the scene has them); others stay as they are
  ownPictures(id, lines) {
    for (const ln of lines) {
      for (const r of ln.runs || []) {
        if (!r.img || typeof r.img === "string") continue;
        const parts = md.resolvePicture(r.img.src || "", []) || r.img.target;
        if (parts && parts.length === 3 && parts[0] === "media" && parts[1] === id) r.img = parts[2];
      }
    }
    return lines;
  }

  find(key) {
    if (!key) return null;
    let node = this.root;
    for (const part of key.split("/")) {
      node = node.children.find((c) => c.name === part);
      if (!node) return null;
    }
    return node;
  }

  all() { return [...this.root.walk()]; }

  async read(n) { return this.load(n); }

  async peek(n) {
    try {
      const got = await this.sceneFile(n.raw);
      if (!got) return null;
      const f = await (await got[0].getFileHandle(got[1])).getFile();
      return { modified: f.lastModified, text: f.lastModified === n.modified ? n.text : "\u0000changed elsewhere" };
    } catch (e) { return null; }
  }

  // ------------------------------------------------------------ writing
  async saveProject() {
    const fh = await writeFile(this.handle, this.fileName, JSON.stringify(this.data, null, 1));
    this.jsonModified = (await fh.getFile()).lastModified;
  }

  async pictureBytes(img) {
    const parts = typeof img === "string" ? null : md.resolvePicture(img.src || "", []) || img.target;
    if (!parts || parts[0] !== "media") return null;
    const f = this.media.get(parts.slice(1).join("/"));
    return f ? new Uint8Array(await f.arrayBuffer()) : null;
  }

  // the note's text (its first line the title) into the entry's Word file and the .rwproj
  async write(n, text) {
    if (n.readOnly) throw new Error(`“${n.title()}” has ${n.readOnly.join(", ")}: edit it in Ross Writer.`);
    const raw = n.raw;
    const lines = md.parse(text);
    const ti = lines.findIndex((ln) => ln.runs.some((r) => !r.img && r.t.split(md.OBJ).join("").trim()));
    let body = lines;
    if (ti >= 0) {
      const title = md.titleOfLines([lines[ti]], 1000);
      if (title) raw.title = title;
      body = lines.slice(ti + 1);
    }
    const wl = this.ownPictures(raw.id, wordio.fromNoteLines(body));
    const isEmpty = (ln) => !ln.kind && !ln.code && !(ln.runs || []).some((r) => r.img || (r.t || "").trim());
    while (wl.length && isEmpty(wl[wl.length - 1])) wl.pop();
    const sc = this.scenes.get(raw.id);
    // a new scene doesn't start with the empty line after its title
    if (!(sc && sc.files)) while (wl.length && isEmpty(wl[0])) wl.shift();
    // the empty lines a scene ended with stay (Markdown doesn't keep them)
    for (let k = 0; sc && k < sc.trailing; k++) wl.push({ kind: null, depth: 1, code: false, runs: [] });
    const bytes = (img) => this.pictureBytes(img);
    let blob;
    if (sc && sc.files) blob = await patchDocx(sc.files, sc.lines, sc.sigs, wl, bytes);
    else {
      const tpl = await this.findTemplate();
      // a new scene: made from another of the project's (its look); none to follow, a plain one
      blob = tpl ? await patchDocx(tpl.files, tpl.lines, tpl.sigs, wl, bytes)
        : await wordio.writeDocx(wl, bytes, raw.title || "", "Cambria");
    }
    if (!raw.file) raw.file = SCENES + "/" + raw.id + ".docx";
    const [d, name] = await this.sceneFile(raw, true);
    await writeFile(d, name, blob);
    raw.modified = nowIso();
    await this.saveProject();
    // read back what's there now: the next save is made against it
    await this.load(n, true);
    n.text = text;
    const now = this.scenes.get(raw.id);
    if (now) { now.shown = text; now.shownTitle = n.title(); }
  }

  // ------------------------------------------------------------ comments (the scene's words untouched)
  // Where a place on the page (line k: 0 the title, then the scene's lines; pos in its words) is in the
  // Word file: [body paragraph, offset in its words]. The page's words there must be the file's.
  placeOf(sc, pageLines, line, pos) {
    if (line < 1) throw new Error("A comment goes on the scene's words, not on its title.");
    const i = line - 1;
    const ln = sc.lines[i];
    if (!ln || ln.src == null) throw new Error("Those words can't take a comment on the tablet (a table or the like): add it in Ross Writer.");
    const txt = (l) => (l.runs || []).map((r) => (r.img ? md.OBJ : r.t || "")).join("");
    if (pageLines[line] !== txt(ln)) throw new Error("The page and the scene's file don't match here: wait a moment (it may still be saving) and try again.");
    let off = pos;
    for (let k = i - 1; k >= 0 && sc.lines[k].src === ln.src; k--) off += txt(sc.lines[k]).length;
    return [ln.src, off];
  }

  // a change to an entry's comments ({kind: add|reply|edit|resolve|delete, ...}, as wordpatch.commentEdit);
  // for add, a: {line, pos} and b: {line, pos} on the page, with pageLines its lines' words
  async commentOp(n, op) {
    const sc = this.scenes.get(n.raw.id);
    if (!sc || !sc.files) throw new Error("This entry has no Word file to keep comments in yet: type something in it first.");
    const o = { ...op };
    if (op.kind === "add") {
      [o.sp, o.so] = this.placeOf(sc, op.pageLines, op.a.line, op.a.pos);
      [o.ep, o.eo] = this.placeOf(sc, op.pageLines, op.b.line, op.b.pos);
    }
    const blob = await commentEdit(sc.files, o);
    const [d, name] = await this.sceneFile(n.raw, true);
    await writeFile(d, name, blob);
    n.raw.modified = nowIso();
    await this.saveProject();
    const keep = n.text;
    await this.load(n, true);
    // the page's words are as they were
    n.text = keep;
    const now = this.scenes.get(n.raw.id);
    if (now) { now.shown = keep; now.shownTitle = n.title(); }
    return n.comments;
  }

  async findTemplate() {
    if (this.template && this.template.files) return this.template;
    for (const n of this.all()) {
      const sc = this.scenes.get(n.name);
      if (sc && sc.files && !sc.readOnly) return (this.template = sc);
    }
    return null;
  }

  rawList(parent) {
    if (parent.isRoot()) return this.data.nodes;
    if (!Array.isArray(parent.raw.children)) parent.raw.children = [];
    return parent.raw.children;
  }

  tidyChildren(parent) {
    if (!parent.isRoot() && Array.isArray(parent.raw.children) && !parent.raw.children.length) delete parent.raw.children;
  }

  async newNote(parent, index = null, text = "") {
    const t = nowIso();
    const raw = { id: newId(), title: "Untitled", flag: "", include: true, expanded: true, file: null, created: t, modified: t };
    raw.file = SCENES + "/" + raw.id + ".docx";
    const n = new PNote(parent, raw);
    const list = this.rawList(parent);
    if (index == null || index >= parent.children.length) { parent.children.push(n); list.push(raw); }
    else {
      const before = parent.children[index];
      parent.children.splice(index, 0, n);
      list.splice(list.indexOf(before.raw), 0, raw);
    }
    this.scenes.set(raw.id, { mtime: 0, lines: [], sigs: [], files: null, trailing: 0, readOnly: null });
    // an empty page to type the title on, as a new note (the entry is "Untitled" till then)
    await this.write(n, text || "");
    return n;
  }

  async rename(n, title) {
    title = (title || "").trim() || "Untitled";
    if (title === n.raw.title) return false;
    n.raw.title = title;
    n.raw.modified = nowIso();
    await this.saveProject();
    return true;
  }

  async move(n, newParent, index) {
    if (n === newParent || [...n.walk()].includes(newParent)) return false;
    const oldParent = n.parent;
    const oldIndex = oldParent.children.indexOf(n);
    const oldList = this.rawList(oldParent);
    oldParent.children.splice(oldIndex, 1);
    oldList.splice(oldList.indexOf(n.raw), 1);
    if (oldParent === newParent && index > oldIndex) index -= 1;
    index = Math.max(0, Math.min(index, newParent.children.length));
    const list = this.rawList(newParent);
    const before = newParent.children[index];
    newParent.children.splice(index, 0, n);
    if (before) list.splice(list.indexOf(before.raw), 0, n.raw); else list.push(n.raw);
    n.parent = newParent;
    this.tidyChildren(oldParent);
    await this.saveProject();
    return true;
  }

  // as Ross Writer: out of the tree; its files (and those of the entries under it) into Trash
  async delete(n) {
    const parent = n.parent;
    const list = this.rawList(parent);
    parent.children.splice(parent.children.indexOf(n), 1);
    list.splice(list.indexOf(n.raw), 1);
    this.tidyChildren(parent);
    for (const x of [n, ...n.walk()]) {
      if (!x.raw.file) continue;
      try {
        const [d, name] = await this.sceneFile(x.raw);
        const f = await (await d.getFileHandle(name)).getFile();
        const trash = await this.handle.getDirectoryHandle(TRASH, { create: true });
        await writeFile(trash, `${rwSafeName(x.raw.title)} ${x.raw.id}.docx`, f);
        await d.removeEntry(name);
      } catch (e) { /* no file */ }
    }
    await this.saveProject();
  }

  // another device's version of a scene, kept (in the project's Trash) before ours replaces it
  async keepConflict(n) {
    try {
      const [d, name] = await this.sceneFile(n.raw);
      const f = await (await d.getFileHandle(name)).getFile();
      const trash = await this.handle.getDirectoryHandle(TRASH, { create: true });
      await writeFile(trash, `${rwSafeName(n.raw.title)} ${n.raw.id} (other version ${stamp()}).docx`, f);
    } catch (e) { /* nothing there */ }
  }

  // ------------------------------------------------------------ pictures (in memory; written into the scenes)
  async savePicture(blob, name) {
    let n = name, k = 2;
    const dot = name.lastIndexOf(".");
    while (this.media.has("new/" + n)) { n = dot > 0 ? `${name.slice(0, dot)} (${k})${name.slice(dot)}` : `${name} (${k})`; k++; }
    this.media.set("new/" + n, new File([blob], n, { type: blob.type || "image/png", lastModified: Date.now() }));
    return ["media", "new", n];
  }

  async pictureFile(parts) {
    const f = parts[0] === "media" ? this.media.get(parts.slice(1).join("/")) : null;
    if (!f) throw new Error("no such picture");
    return f;
  }

  async hasWordCopy() { return false; }
  async writeWordCopy() { throw new Error("Word copies are for notes in RossNotes"); }
}

// ------------------------------------------------------------------ a Word document opened by itself
// File ▸ Open a Word Document…: one .docx, worked on in place like a project's scene (its title line is the
// file's name, never written into it). Saves straight back into the file; comments as in scenes.
export class DocxStore extends ProjectStore {
  constructor(fileHandle) {
    super(null, fileHandle.name);
    this.isDoc = true;
    this.fileHandle = fileHandle;
    this.canWrite = true;
    const stem = fileHandle.name.replace(/\.docx$/i, "");
    this.raw = { id: "doc", title: stem, flag: "", include: true, expanded: true, file: fileHandle.name };
  }

  get label() { return this.fileName; }

  async scan() {
    this.data = { format: "word-document", nodes: [this.raw] };
    const root = new PNote(null, null);
    const n = new PNote(root, this.raw);
    root.children.push(n);
    this.root = root;
    await this.load(n);
    if (!this.canWrite && !n.readOnly) n.readOnly = ["no permission to save into it"];
    return root;
  }

  // the "folder" the file is in: just the file
  async sceneFile() {
    const fh = this.fileHandle;
    return [{ getFileHandle: async () => fh }, fh.name];
  }

  async saveProject() { /* no project file */ }
  async newNote() { throw new Error("A Word document opened by itself is one page: new pages are for notes and projects."); }
  async move() { return false; }
  async rename() { return false; }
  async delete() { throw new Error("Close the document instead (File ▸ Back to My Notes)."); }
  async keepConflict() {
    throw new Error(`“${this.fileName}” has changed on another device since you opened it. ` +
      "Your latest typing wasn't saved into it: copy what you need, then open it again (File ▸ Open a Word Document…).");
  }
}

// ------------------------------------------------------------------ a Markdown file opened by itself
// File ▸ Open a Word Document or Note…: a .md (or .txt) file from anywhere, read and edited in place, saved
// straight back into it (its first line its title, as a note's). One page, like a Word document opened by itself.
export class MdFileStore {
  constructor(fileHandle) {
    this.isProject = true;        // (the menus' "Back to My Notes" and the like)
    this.isDoc = true;
    this.isMd = true;
    this.fileHandle = fileHandle;
    this.fileName = fileHandle.name;
    this.handle = null;
    this.canWrite = true;
    this.raw = { id: "md", title: fileHandle.name.replace(/\.(md|markdown|mdown|mkd|txt)$/i, ""), file: fileHandle.name };
    this.root = new PNote(null, null);
    this.crlf = false;
    this.bom = false;
  }

  get label() { return this.fileName; }

  async scan() {
    const root = new PNote(null, null);
    const n = new PNote(root, this.raw);
    n.comments = undefined;
    root.children.push(n);
    this.root = root;
    await this.load(n);
    if (!this.canWrite) n.readOnly = ["no permission to save into it"];
    return root;
  }

  async load(n) {
    const f = await this.fileHandle.getFile();
    let text = await f.text();
    this.bom = text.startsWith("﻿");
    if (this.bom) text = text.slice(1);
    this.crlf = text.includes("\r\n");
    text = text.replace(/\r\n/g, "\n");
    n.text = text;
    n.modified = f.lastModified;
    const t = md.titleOf ? md.titleOf(text) : "";
    if (t) this.raw.title = t;
    return text;
  }

  find(key) { return key === "md" ? this.root.children[0] : null; }
  all() { return [...this.root.walk()]; }
  async read(n) { return this.load(n); }

  async peek(n) {
    try {
      const f = await this.fileHandle.getFile();
      return { modified: f.lastModified, text: f.lastModified === n.modified ? n.text : "\u0000changed elsewhere" };
    } catch (e) { return null; }
  }

  async write(n, text) {
    if (n.readOnly) throw new Error(`“${this.fileName}” can't be saved here: ${n.readOnly.join(", ")}.`);
    let out = this.crlf ? text.replace(/\n/g, "\r\n") : text;
    if (this.bom) out = "﻿" + out;
    const w = await this.fileHandle.createWritable();
    await w.write(out);
    await w.close();
    n.text = text;
    n.modified = (await this.fileHandle.getFile()).lastModified;
    const t = md.titleOf ? md.titleOf(text) : "";
    if (t) this.raw.title = t;
  }

  async newNote() { throw new Error("A file opened by itself is one page: new pages are for notes and projects."); }
  async move() { return false; }
  async rename() { return false; }
  async delete() { throw new Error("Close the file instead (File ▸ Back to My Notes)."); }
  async keepConflict() {
    throw new Error(`“${this.fileName}” has changed on another device since you opened it. ` +
      "Your latest typing wasn't saved into it: copy what you need, then open it again.");
  }
  async savePicture() { throw new Error("Pictures can't be added to a file opened by itself: open its folder as notes instead."); }
  async pictureFile() { throw new Error("no such picture"); }
  async hasWordCopy() { return false; }
  async writeWordCopy() { throw new Error("Word copies are for notes in RossNotes"); }
}
