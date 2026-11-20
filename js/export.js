// RossDraft 1.4: File ▸ Export Project…, as Ross Writer's (project.export_copy, export_readable; scriv.from_project):
//   "copy":      a Ross Writer project: the same files (a copy of a Ross Writer project, for a backup or another
//                device), or, from a Scrivener project, a Ross Writer project made from it (the .scriv only read)
//   "readable":  ordinary folders and Word files named by their titles, in order ("01 Chapter One/02 Rain.docx"),
//                each entry's synopsis and notes in "<title> (notes).txt", PDFs beside them, Contents.txt
//   "scrivener": from a Ross Writer project, a new Scrivener 3 project: the same tree in the Draft, each entry's
//                text, its synopsis, its notes (with its Word comments and footnotes), Include in Compile, flags as
//                labels; PDF entries as PDF documents in Research.
// The project itself is never changed. Everything goes in a new folder named after it ("… (2)" if taken).

import * as md from "./md.js?v=1.9.20";
import * as wordio from "./wordio.js?v=1.8.3";
import { NOTE_RE } from "./wordio.js?v=1.8.3";

export const KINDS = {
  copy: { label: "A Ross Writer project", scriv: "A Ross Writer project made from it: the same tree, each entry its own Word file, its notes as footnotes (the original is only read)",
    rw: "A copy of the project: the same files, opened by Ross Writer and RossDraft just like the original (for a backup, another device, a cloud drive)" },
  readable: { label: "Readable folders", all: "Chapters as folders and scenes as Word files named by their titles, notes in text files and a Contents list (for reading or sending to someone)" },
  scrivener: { label: "A Scrivener project", rw: "A new .scriv that Scrivener 3 opens: the same tree, text, synopses, notes (and comments and footnotes, in Notes), Include in Compile, flags as labels" },
};

const enc = new TextEncoder();
export const safeName = (s) => String(s || "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "Untitled";
const fileTitle = (t) => safeName(String(t || "").replace(/:/g, " -").replace(/[\\/]/g, "-"));
async function freeName(dir, name) {
  const taken = new Set();
  for await (const [n] of dir.entries()) taken.add(n);
  let c = name, k = 2;
  const dot = name.lastIndexOf(".");
  while (taken.has(c)) c = dot > 0 && !name.endsWith(".scriv") ? `${name.slice(0, dot)} (${k++})${name.slice(dot)}` : `${name} (${k++})`;
  return c;
}
async function put(dir, name, data) {
  const h = await dir.getFileHandle(name, { create: true });
  const w = await h.createWritable();
  await w.write(data);
  await w.close();
}
async function copyTree(from, to, skip = () => false) {
  for await (const [name, h] of from.entries()) {
    if (skip(name, h)) continue;
    if (h.kind === "directory") await copyTree(h, await to.getDirectoryHandle(name, { create: true }), skip);
    else await put(to, name, await h.getFile());
  }
}
const newId = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "").slice(0, 12) : Math.random().toString(16).slice(2, 14));

// an entry's text as Word-file lines (its title line left out), its notes' marks and words
function bodyOf(n) {
  const lines = md.parse(n.text || "");
  const ti = lines.findIndex((ln) => ln.runs.some((r) => !r.img && r.t.split(md.OBJ).join("").trim()));
  const wl = wordio.fromNoteLines(ti >= 0 ? lines.slice(ti + 1) : []);
  const isEmpty = (ln) => !ln.kind && !ln.code && !(ln.runs || []).some((r) => r.img || (r.t || "").trim());
  while (wl.length && isEmpty(wl[0])) wl.shift();
  while (wl.length && isEmpty(wl[wl.length - 1])) wl.pop();
  return wl;
}
const hasText = (wl) => wl.some((ln) => (ln.runs || []).some((r) => r.img || (r.t || "").replace(NOTE_RE, "").trim()));
const all = (store) => store.all();

// ------------------------------------------------------------------ a Ross Writer project
export async function exportRoss(store, where, progress = () => {}) {
  const title = store.label;
  const dir = await where.getDirectoryHandle(await freeName(where, safeName(title)), { create: true });
  if (!store.isScriv && !store.isEpub) {
    // a copy: the project file, its Scenes and Attachments (and the idea cards), the same layout
    for await (const [name, h] of store.handle.entries()) {
      if (h.kind === "file" && (name === store.fileName || name === "Ideas.json")) await put(dir, name, await h.getFile());
      else if (h.kind === "directory" && ["Scenes", "Attachments"].includes(name)) {
        await copyTree(h, await dir.getDirectoryHandle(name, { create: true }), (n) => n.endsWith(".saving") || n.startsWith("~$") || n.startsWith(".~lock"));
      }
    }
    return { dir, file: store.fileName, count: all(store).length };
  }
  // from Scrivener (as Ross Writer's import_scriv) or an e-book: a Ross Writer project made from it
  const scenes = await dir.getDirectoryHandle("Scenes", { create: true });
  const nodes = [];
  let k = 0;
  const total = all(store).length;
  const visit = async (list, out, inTrash) => {
    for (const n of list) {
      progress(++k, total);
      const trash = inTrash || n.raw.scrivType === "TrashFolder";
      const raw = { id: newId(), title: n.title(), flag: n.raw.flag || "", include: trash ? false : n.raw.include !== false, expanded: true };
      if (n.raw.synopsis) raw.synopsis = n.raw.synopsis;
      if (n.raw.notes) raw.notes = n.raw.notes;
      const pdf = store.pdfFile ? await store.pdfFile(n) : null;
      if (pdf) {
        const att = await (await dir.getDirectoryHandle("Attachments", { create: true })).getDirectoryHandle(safeName(n.title()), { create: true });
        const name = safeName(n.title()) + ".pdf";
        await put(att, name, pdf);
        raw.pdf = `Attachments/${safeName(n.title())}/${name}`;
        raw.attachments = [raw.pdf];
        raw.file = null;
        raw.include = false;
      } else {
        const wl = bodyOf(n);
        raw.file = "Scenes/" + raw.id + ".docx";
        await put(scenes, raw.id + ".docx", await wordio.writeDocx(wl, (img) => store.pictureBytes(img), n.title(), "Cambria", { notes: n.fnotes || null }));
      }
      out.push(raw);
      if (n.children.length) { raw.children = []; await visit(n.children, raw.children, trash); }
    }
  };
  await visit(store.root.children, nodes, false);
  const file = safeName(title) + ".rwproj";
  const data = { format: "ross-writer-project", version: 1, title, compile: { headings: true, scene_break: "* * *", chapter_page: true, comments: false }, nodes };
  await put(dir, file, JSON.stringify(data, null, 1));
  return { dir, file, count: k };
}

// ------------------------------------------------------------------ readable folders
export async function exportReadable(store, where, progress = () => {}) {
  const title = store.label;
  const dir = await where.getDirectoryHandle(await freeName(where, safeName(title)), { create: true });
  const lines = [title, "=".repeat(Math.max(8, title.length)), ""];
  let docs = 0, k = 0;
  const total = all(store).length;
  const extras = async (n, folder, stem) => {
    const syn = (n.raw.synopsis || "").trim(), notes = (n.raw.notes || "").trim();
    if (syn || notes) {
      const parts = [];
      if (syn) parts.push("Synopsis", "--------", syn, "");
      if (notes) parts.push("Notes", "-----", notes, "");
      await put(folder, stem + " (notes).txt", parts.join("\n"));
    }
    const pdf = store.pdfFile ? await store.pdfFile(n) : null;
    if (pdf) await put(folder, await freeName(folder, `${stem} - ${safeName(pdf.name)}`), pdf);
  };
  const writeText = async (n, folder, stem) => {
    if (n.raw.pdf) return;
    const wl = bodyOf(n);
    if (!hasText(wl)) return;
    // a Ross Writer scene: its own Word file, as it is; otherwise one made from its text
    let blob = null;
    if (!store.isScriv && n.raw.file && store.sceneFile) {
      try { const got = await store.sceneFile(n.raw); if (got) blob = await (await got[0].getFileHandle(got[1])).getFile(); } catch (e) { blob = null; }
    }
    if (!blob) {
      const notes = n.fnotes || null;
      blob = await wordio.writeDocx(wl, (img) => store.pictureBytes(img), n.title(), "Cambria", { notes });
    }
    await put(folder, await freeName(folder, stem + ".docx"), blob);
    docs++;
  };
  const visit = async (list, folder, depth) => {
    const width = Math.max(2, String(list.length).length);
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      progress(++k, total);
      const stem = `${String(i + 1).padStart(width, "0")} ${fileTitle(n.title())}`;
      const mark = [n.raw.flag, n.raw.include === false ? "not in compile" : ""].filter(Boolean);
      lines.push("    ".repeat(depth) + `${i + 1}. ${n.title()}${mark.length ? `  [${mark.join("; ")}]` : ""}`);
      if (n.children.length) {
        const sub = await folder.getDirectoryHandle(stem, { create: true });
        const own = `${"0".repeat(width)} ${fileTitle(n.title())}`;
        await writeText(n, sub, own);
        await extras(n, sub, own);
        await visit(n.children, sub, depth + 1);
      } else {
        await writeText(n, folder, stem);
        await extras(n, folder, stem);
      }
    }
  };
  await visit(store.root.children, dir, 0);
  const d = new Date();
  lines.push("", `Exported from RossDraft on ${d.getDate()} ${d.toLocaleString("en-GB", { month: "long" })} ${d.getFullYear()}.`);
  await put(dir, "Contents.txt", lines.join("\n") + "\n");
  return { dir, count: docs };
}

// ------------------------------------------------------------------ a Scrivener project from a Ross Writer project
// notes for Scrivener's Notes: the entry's own, then its Word comments, then its footnotes (their marks in the
// text become [1], [2]…, endnotes [e1]…), as Ross Writer's _notes_for
function notesFor(n, wl) {
  const out = [];
  if ((n.raw.notes || "").trim()) out.push(n.raw.notes.trim(), "");
  for (const c of (n.comments || []).filter((c) => !c.parent)) {
    out.push(`Comment, ${c.author || "Someone"}${c.date ? ", " + String(c.date).slice(0, 10) : ""}${c.done ? " (resolved)" : ""}:`);
    if (c.words) out.push(`On “${c.words}”`);
    out.push(...String(c.text || "").split("\n"));
    for (const r of (n.comments || []).filter((x) => x.parent === c.id)) out.push(`  Reply, ${r.author || "Someone"}: ${String(r.text || "").replace(/\n/g, " ")}`);
    out.push("");
  }
  const labels = new Map(), cnt = { f: 0, e: 0 };
  for (const ln of wl) for (const r of ln.runs || []) {
    if (!r.t || !r.t.includes("")) continue;
    r.t = r.t.replace(NOTE_RE, (m0, k, id) => {
      if (!labels.has(k + id)) { cnt[k]++; labels.set(k + id, (k === "e" ? "e" : "") + cnt[k]); }
      return `[${labels.get(k + id)}]`;
    });
  }
  for (const [key, label] of labels) out.push(`${key[0] === "e" ? "Endnote" : "Footnote"} [${label}]: ${(n.fnotes && n.fnotes.get(key)) || ""}`);
  return out.join("\n").trim();
}

export async function exportScrivener(store, where, progress = () => {}) {
  const SV = await import("./scriv.js?v=1.9.20");
  const [sdir, xname] = await SV.makeScrivener(where, store.label);
  const sc = new SV.ScrivStore(sdir, xname);
  sc.noBackup = true;
  await sc.scan();
  const draft = sc.root.children.find((c) => c.raw.scrivType === "DraftFolder") || sc.root;
  const research = sc.root.children.find((c) => c.raw.scrivType === "ResearchFolder") || draft;
  let k = 0;
  const total = all(store).length;
  const visit = async (list, parent) => {
    for (const n of list) {
      progress(++k, total);
      const pdf = store.pdfFile ? await store.pdfFile(n) : null;
      if (pdf) {
        // a PDF entry: a PDF document in Research (Scrivener keeps those out of the Draft)
        const x = await sc.addPdf(research, research.children.length, n.title(), pdf);
        if (n.raw.synopsis) x.raw.synopsis = n.raw.synopsis;
        continue;
      }
      const wl = bodyOf(n);
      const notes = notesFor(n, wl);
      const text = md.serialize([{ kind: "h1", mark: null, runs: [{ t: n.title(), f: new Set() }] }, ...wordio.toNoteLines(wl, () => null)], { dir: [] });
      const x = await sc.addNote(parent, parent.children.length, n.title(), text);
      if (n.raw.synopsis) x.raw.synopsis = n.raw.synopsis;
      if (notes) x.raw.notes = notes;
      x.raw.include = n.raw.include !== false;
      x.raw.flag = n.raw.flag || "";
      if (n.children.length) await visit(n.children, x);
    }
  };
  await visit(store.root.children, draft);
  sc.treeDirty = true;
  await sc.saveProject();
  return { dir: sdir, file: xname, count: k };
}
