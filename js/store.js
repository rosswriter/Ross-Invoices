// The notes in the RossNotes folder, laid out exactly as the desktop keeps them:
//   Shopping.md
//   Novel ideas.md
//   Novel ideas/          the notes under "Novel ideas"
//   Pictures/             pictures in notes (not a note)
//   Word Copies/          a Word document kept for a note, as the tree (not a note)
//   .order                the order of the notes in a folder (JSON list of names)
//   .trash/<time>/        deleted notes
import { safeName, titleOf } from "./md.js?v=2.1.2";

export const EXT = ".md";
export const ORDER = ".order";
export const TRASH = ".trash";
export const PICTURES = "Pictures";
export const WORD = "Word Copies";
export const DOCX = ".docx";

export class Note {
  constructor(parent, name) {
    this.parent = parent;   // a Note, or null for the top
    this.name = name;
    this.children = [];
    this.text = null;       // as last read or written
    this.modified = 0;      // the file's lastModified when last read or written
  }
  isRoot() { return this.parent === null; }
  // the folder this note's file is in, as names from the top
  folderParts() { return this.parent ? this.parent.childParts() : []; }
  childParts() { return this.isRoot() ? [] : [...this.folderParts(), this.name]; }
  ancestors() {
    const out = [];
    let p = this.parent;
    while (p && !p.isRoot()) { out.push(p); p = p.parent; }
    return out;
  }
  key() { return [...this.ancestors().reverse().map((a) => a.name), this.name].join("/"); }
  *walk() { for (const c of this.children) { yield c; yield* c.walk(); } }
  title() { return (this.text != null && titleOf(this.text)) || this.name; }
}

function stamp() {
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`;
}

// Python's json.dump(names, ensure_ascii=False, indent=0)
function orderJson(names) {
  if (!names.length) return "[]";
  return "[\n" + names.map((n) => JSON.stringify(n)).join(",\n") + "\n]";
}

async function exists(dir, name, kind) {
  try {
    if (kind === "directory") await dir.getDirectoryHandle(name);
    else await dir.getFileHandle(name);
    return true;
  } catch (e) { return false; }
}

async function writeFile(dir, name, data) {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(data);
  await w.close();
  return fh;
}

async function copyDir(src, dstParent, name) {
  const dst = await dstParent.getDirectoryHandle(name, { create: true });
  for await (const [n, h] of src.entries()) {
    if (h.kind === "file") await writeFile(dst, n, await h.getFile());
    else await copyDir(h, dst, n);
  }
  return dst;
}

// move or rename a file or folder (the browser's own move where it has one)
async function moveEntry(fromDir, name, toDir, newName, kind) {
  const h = kind === "directory" ? await fromDir.getDirectoryHandle(name) : await fromDir.getFileHandle(name);
  if (typeof h.move === "function") {
    try {
      if (fromDir === toDir || await fromDir.isSameEntry(toDir)) await h.move(newName);
      else await h.move(toDir, newName);
      return;
    } catch (e) { /* not on this device: copy instead */ }
  }
  if (kind === "directory") await copyDir(h, toDir, newName);
  else await writeFile(toDir, newName, await h.getFile());
  await fromDir.removeEntry(name, { recursive: kind === "directory" });
}

export class Store {
  constructor(rootHandle) {
    this.handle = rootHandle;
    this.root = new Note(null, "");
  }

  async dir(parts, create = false) {
    let d = this.handle;
    for (const p of parts) d = await d.getDirectoryHandle(p, { create });
    return d;
  }

  // ------------------------------------------------------------ reading
  async scan() {
    const root = new Note(null, "");
    // what we've read already isn't read again unless it changed
    this.known = new Map([...this.root.walk()].map((n) => [n.key(), n]));
    root.children = await this.scanDir(root, this.handle);
    this.root = root;
    return root;
  }

  async scanDir(parent, d) {
    const files = new Map(), dirs = [];
    let order = [];
    for await (const [name, h] of d.entries()) {
      if (name.startsWith(".")) {
        if (name === ORDER && h.kind === "file") {
          try {
            const v = JSON.parse(await (await h.getFile()).text());
            if (Array.isArray(v)) order = v.filter((x) => typeof x === "string");
          } catch (e) { /* a bad order file: alphabetical */ }
        }
        continue;
      }
      if (h.kind === "file" && name.endsWith(EXT) && !name.endsWith(".rossnote-tmp")) files.set(name.slice(0, -EXT.length), h);
      else if (h.kind === "directory" && !(parent.isRoot() && (name === PICTURES || name === WORD))) dirs.push(name);
    }
    // a folder with no note of its own still shows (as a note made for it)
    for (const name of dirs) {
      if (!files.has(name)) files.set(name, await writeFile(d, name + EXT, "# " + name + "\n"));
    }
    const names = [...files.keys()];
    const ordered = [...order.filter((n) => files.has(n)),
      ...names.filter((n) => !order.includes(n)).sort((a, b) => a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0)];
    const out = [];
    for (const name of ordered) {
      const note = new Note(parent, name);
      try {
        const f = await files.get(name).getFile();
        note.modified = f.lastModified;
        const o = this.known && this.known.get(note.key());
        note.text = o && o.modified === f.lastModified && o.text != null ? o.text : await f.text();
      } catch (e) { note.text = ""; }
      if (dirs.includes(name)) note.children = await this.scanDir(note, await d.getDirectoryHandle(name));
      out.push(note);
    }
    return out;
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

  async read(note) {
    const d = await this.dir(note.folderParts());
    const f = await (await d.getFileHandle(note.name + EXT)).getFile();
    note.text = await f.text();
    note.modified = f.lastModified;
    return note.text;
  }

  // the file's state now: {modified, text} (text only if it changed since we last saw it)
  async peek(note) {
    try {
      const d = await this.dir(note.folderParts());
      const f = await (await d.getFileHandle(note.name + EXT)).getFile();
      if (f.lastModified === note.modified) return { modified: f.lastModified, text: note.text };
      return { modified: f.lastModified, text: await f.text() };
    } catch (e) { return null; }
  }

  // ------------------------------------------------------------ writing
  async write(note, text) {
    const d = await this.dir(note.folderParts(), true);
    const fh = await writeFile(d, note.name + EXT, text);
    note.text = text;
    note.modified = (await fh.getFile()).lastModified;
    if (this.onWrite) this.onWrite(note);
  }

  // ------------------------------------------------------------ Word copies (as the laptop keeps them)
  // [folder names, file name] of the Word copy for a note with this key
  wordPlace(key) {
    const parts = key.split("/");
    return [[WORD, ...parts.slice(0, -1)], parts[parts.length - 1] + DOCX];
  }

  async hasWordCopy(note) {
    const [dirs, name] = this.wordPlace(note.key());
    try { return await exists(await this.dir(dirs), name, "file"); } catch (e) { return false; }
  }

  async writeWordCopy(note, blob) {
    const [dirs, name] = this.wordPlace(note.key());
    await writeFile(await this.dir(dirs, true), name, blob);
    return [...dirs, name].join("/");
  }

  // a note's Word copy (and those of the notes under it) follow it
  async moveWordCopy(oldKey, newKey) {
    if (!oldKey || oldKey === newKey) return;
    try {
      const [od, on] = this.wordPlace(oldKey), [nd, nn] = this.wordPlace(newKey);
      let from;
      try { from = await this.dir(od); } catch (e) { return; }
      const stemO = on.slice(0, -DOCX.length), stemN = nn.slice(0, -DOCX.length);
      const hasFile = await exists(from, on, "file"), hasDir = await exists(from, stemO, "directory");
      if (!hasFile && !hasDir) return;
      const to = await this.dir(nd, true);
      if (hasFile) await moveEntry(from, on, to, nn, "file");
      if (hasDir) await moveEntry(from, stemO, to, stemN, "directory");
    } catch (e) { /* left where it was */ }
  }

  async writeOrder(parent) {
    const parts = parent.childParts();
    if (!parent.children.length && !parent.isRoot()) {
      // no notes left under it: its folder goes (if nothing else is in it)
      try {
        const up = await this.dir(parts.slice(0, -1));
        const d = await up.getDirectoryHandle(parts[parts.length - 1]);
        try { await d.removeEntry(ORDER); } catch (e) { /* none */ }
        let empty = true;
        for await (const _ of d.keys()) { empty = false; break; }
        if (empty) await up.removeEntry(parts[parts.length - 1]);
      } catch (e) { /* no folder */ }
      return;
    }
    const d = await this.dir(parts, true);
    await writeFile(d, ORDER, orderJson(parent.children.map((c) => c.name)));
  }

  async uniqueName(parent, want, exclude = null) {
    const base = safeName(want);
    const taken = new Set(parent.children.filter((c) => c !== exclude).map((c) => c.name.toLowerCase()));
    if (parent.isRoot()) { taken.add(PICTURES.toLowerCase()); taken.add(WORD.toLowerCase()); }
    let d = null;
    try { d = await this.dir(parent.childParts()); } catch (e) { /* not made yet */ }
    let name = base, k = 2;
    while (taken.has(name.toLowerCase()) ||
           (d && (!exclude || name !== exclude.name) && await exists(d, name + EXT, "file"))) {
      name = `${base} (${k})`;
      k += 1;
    }
    return name;
  }

  async newNote(parent, index = null, text = "") {
    const name = await this.uniqueName(parent, "Untitled");
    const note = new Note(parent, name);
    if (index == null) parent.children.push(note); else parent.children.splice(index, 0, note);
    await this.write(note, text);
    await this.writeOrder(parent);
    return note;
  }

  // the note's name follows its title; its folder (the notes under it) goes with it
  async rename(note, title) {
    const parent = note.parent;
    const name = await this.uniqueName(parent, title, note);
    if (name === note.name) return false;
    const oldKey = note.key();
    const d = await this.dir(parent.childParts());
    await moveEntry(d, note.name + EXT, d, name + EXT, "file");
    if (await exists(d, note.name, "directory")) await moveEntry(d, note.name, d, name, "directory");
    note.name = name;
    await this.writeOrder(parent);
    await this.moveWordCopy(oldKey, note.key());
    return true;
  }

  async move(note, newParent, index) {
    if (note === newParent || [...note.walk()].includes(newParent)) return false;
    const oldParent = note.parent;
    const oldIndex = oldParent.children.indexOf(note);
    if (oldParent === newParent) {
      oldParent.children.splice(oldIndex, 1);
      if (index > oldIndex) index -= 1;
      newParent.children.splice(Math.max(0, Math.min(index, newParent.children.length)), 0, note);
      await this.writeOrder(newParent);
      return true;
    }
    const oldKey = note.key();
    const from = await this.dir(oldParent.childParts());
    oldParent.children.splice(oldIndex, 1);
    const name = await this.uniqueName(newParent, note.name);
    const to = await this.dir(newParent.childParts(), true);
    await moveEntry(from, note.name + EXT, to, name + EXT, "file");
    if (await exists(from, note.name, "directory")) await moveEntry(from, note.name, to, name, "directory");
    note.parent = newParent;
    note.name = name;
    newParent.children.splice(Math.max(0, Math.min(index, newParent.children.length)), 0, note);
    await this.writeOrder(oldParent);
    await this.writeOrder(newParent);
    await this.moveWordCopy(oldKey, note.key());
    return true;
  }

  async trashDir(label = "") {
    const t = await this.handle.getDirectoryHandle(TRASH, { create: true });
    return t.getDirectoryHandle(stamp() + label, { create: true });
  }

  async delete(note) {
    const trash = await this.trashDir();
    const d = await this.dir(note.folderParts());
    if (await exists(d, note.name + EXT, "file")) await moveEntry(d, note.name + EXT, trash, note.name + EXT, "file");
    if (await exists(d, note.name, "directory")) await moveEntry(d, note.name, trash, note.name, "directory");
    try {
      const [wd, wn] = this.wordPlace(note.key());
      const w = await this.dir(wd);
      if (await exists(w, wn, "file")) await moveEntry(w, wn, trash, note.name + DOCX, "file");
      const stem = wn.slice(0, -DOCX.length);
      if (await exists(w, stem, "directory")) await moveEntry(w, stem, trash, note.name + " (Word Copies)", "directory");
    } catch (e) { /* no Word copy */ }
    const parent = note.parent;
    parent.children.splice(parent.children.indexOf(note), 1);
    await this.writeOrder(parent);
  }

  // another device's version of a note, kept before ours replaces it
  async keepConflict(note, text) {
    const trash = await this.trashDir(" other version");
    await writeFile(trash, note.name + EXT, text);
  }

  // ------------------------------------------------------------ pictures
  async uniquePicture(name) {
    const d = await this.handle.getDirectoryHandle(PICTURES, { create: true });
    const dot = name.lastIndexOf(".");
    const stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot).toLowerCase() : "";
    let n = stem + ext, k = 2;
    while (await exists(d, n, "file")) { n = `${stem} (${k})${ext}`; k += 1; }
    return [d, n];
  }

  async savePicture(blob, name) {
    const [d, n] = await this.uniquePicture(name);
    await writeFile(d, n, blob);
    return [PICTURES, n];
  }

  async pictureFile(parts) {
    const d = await this.dir(parts.slice(0, -1));
    return (await d.getFileHandle(parts[parts.length - 1])).getFile();
  }
}
