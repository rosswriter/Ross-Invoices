// Ross Note for the tablet: the RossNotes folder (kept in step with the laptop
// by a sync app such as Drivesync), read and written in place.
import * as md from "./md.js";
import * as ed from "./editor.js";
import { Store, PICTURES } from "./store.js";

export const VERSION = "1.3.0";
const SAVE_AFTER_MS = 700;
const LONG_SIDE = 2000;
const SPACINGS = [["Single", 100], ["1.15", 115], ["1.5", 150], ["Double", 200]];

const $ = (id) => document.getElementById(id);
const S = {
  store: null, busy: Promise.resolve(),
  settings: loadSettings(), urls: new Map(), searching: "",
};

// ------------------------------------------------------------------ the two panes (one unless split)
const P = [0, 1].map((k) => {
  const el = $("pane" + k);
  return { k, el, head: el.querySelector(".head"), scroller: el.querySelector(".scroller"),
    page: el.querySelector(".page"), note: null, dirty: false, timer: 0 };
});
let A = P[0];            // the pane you're working in
let page = A.page;       // its page
Object.defineProperty(S, "note", { get: () => A.note, set: (v) => { A.note = v; } });
const paneOf = (el) => P.find((p) => p.page === el || p.el.contains(el)) || A;

function setActive(p) {
  if (A === p) return;
  A = p;
  page = p.page;
  for (const q of P) q.el.classList.toggle("active", q === p);
  S.settings.active = p.k;
  saveSettings();
  renderTree();
  updateHead();
}

// ------------------------------------------------------------------ settings
function loadSettings() {
  const d = { dark: false, size: 18, spacing: 100, paraGap: false, keepFull: false, side: 260, list: true,
    open: "", open2: "", expanded: [], split: "", ratio: 0.5, active: 0 };
  try { return Object.assign(d, JSON.parse(localStorage.getItem("rossnote") || "{}")); } catch (e) { return d; }
}
function saveSettings() { try { localStorage.setItem("rossnote", JSON.stringify(S.settings)); } catch (e) { /* private */ } }

function applyLook() {
  const s = S.settings;
  document.documentElement.classList.toggle("dark", !!s.dark);
  document.body.classList.toggle("dark", !!s.dark);
  $("app").classList.toggle("dark", !!s.dark);
  document.documentElement.style.setProperty("--size", s.size + "px");
  document.documentElement.style.setProperty("--lh", String(1.25 * s.spacing / 100));
  document.documentElement.style.setProperty("--gap", s.paraGap ? "10px" : "0px");
  document.documentElement.style.setProperty("--side", s.side + "px");
  document.querySelector('meta[name="theme-color"]').content = s.dark ? "#1e2023" : "#1b523d";
  layout();
}

function layout() {
  const narrow = window.innerWidth < 720;
  $("app").classList.toggle("app-narrow", narrow);
  $("app").classList.toggle("list-off", narrow ? !S.sideOpenNarrow : !S.settings.list);
  const split = S.settings.split;
  const v = split === "v" || (split && narrow);            // narrow screens: always one above the other
  $("panes").classList.toggle("split", !!split);
  $("panes").classList.toggle("split-v", !!v);
  P[1].el.hidden = !split;
  $("pdiv").hidden = !split;
  const r = Math.max(0.15, Math.min(0.85, S.settings.ratio || 0.5));
  P[0].el.style.flex = split ? `${r} 1 0` : "";
  P[1].el.style.flex = split ? `${1 - r} 1 0` : "";
  for (const b of document.querySelectorAll("[data-cmd=splith],[data-cmd=splitv]")) {
    b.classList.toggle("on", split === (b.dataset.cmd === "splith" ? "h" : "v"));
  }
}

// Ctrl+\ side by side, Ctrl+Shift+\ top and bottom; the same again goes back to one
async function setSplit(kind) {
  const s = S.settings;
  if (s.split === kind || !kind) {
    await flushSave();
    s.split = "";
    if (A === P[1]) {
      // the note you were working in stays
      const n = P[1].note;
      setActive(P[0]);
      if (n && n !== P[0].note) await openNote(n, P[0]);
    }
    P[1].note = null;
    P[1].page.textContent = "";
  } else {
    const was = s.split;
    s.split = kind;
    if (!was) {
      layout();
      const n = P[0].note;
      if (n) await openNote(n, P[1]);
    }
  }
  saveSettings();
  layout();
  updateHead();
}

// ------------------------------------------------------------------ the folder (kept between visits)
function idb() {
  return new Promise((ok, bad) => {
    const r = indexedDB.open("rossnote", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onsuccess = () => ok(r.result);
    r.onerror = () => bad(r.error);
  });
}
async function kvGet(k) {
  const db = await idb();
  return new Promise((ok) => {
    const r = db.transaction("kv").objectStore("kv").get(k);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ok(undefined);
  });
}
async function kvSet(k, v) {
  const db = await idb();
  return new Promise((ok) => {
    const t = db.transaction("kv", "readwrite");
    t.objectStore("kv").put(v, k);
    t.oncomplete = () => ok();
    t.onerror = () => ok();
  });
}

// one thing at a time with the folder
function queue(fn) {
  const p = S.busy.then(fn, fn);
  S.busy = p.catch((e) => { console.error(e); toast("Something went wrong: " + (e && e.message || e)); });
  return p;
}

async function start() {
  applyLook();
  if ("serviceWorker" in navigator && location.protocol !== "file:" && !location.search.includes("nosw")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  const test = new URLSearchParams(location.search).get("test");
  if (test === "opfs") return openRoot(await navigator.storage.getDirectory(), true);
  let handle = null;
  try { handle = await kvGet("root"); } catch (e) { /* none */ }
  if (handle && handle.kind === "directory") {
    const mode = handle.queryPermission ? await handle.queryPermission({ mode: "readwrite" }) : "granted";
    if (mode === "granted") return openRoot(handle);
    return showStart("again", handle);
  }
  showStart(window.showDirectoryPicker ? "first" : "unsupported");
}

function showStart(kind, handle) {
  $("start").hidden = false;
  const msg = $("start-msg"), btns = $("start-buttons"), note = $("start-note");
  btns.textContent = "";
  const button = (text, main, fn) => {
    const b = document.createElement("button");
    b.className = "big" + (main ? " main" : "");
    b.textContent = text;
    b.onclick = fn;
    btns.appendChild(b);
  };
  if (kind === "again") {
    msg.textContent = `Your notes are in the folder “${handle.name}”.`;
    button("Open my notes", true, async () => {
      const r = await handle.requestPermission({ mode: "readwrite" });
      if (r === "granted") openRoot(handle);
    });
    button("Choose another folder…", false, chooseFolder);
    note.textContent = "Android asks once each time Ross Note starts afresh.";
  } else if (kind === "first") {
    msg.textContent = "Choose your RossNotes folder: the one your sync app (Drivesync) keeps in step with your laptop.";
    button("Choose the RossNotes folder…", true, chooseFolder);
    note.textContent = "Ross Note reads and saves the notes in that folder, as the laptop does: one Markdown file for each note.";
  } else {
    msg.textContent = "This browser can't open a folder on this device. Ross Note needs Chrome or Edge (on Android, version 132 or later).";
    note.textContent = "";
  }
}

async function chooseFolder() {
  try {
    const h = await window.showDirectoryPicker({ id: "rossnotes", mode: "readwrite" });
    await kvSet("root", h);
    openRoot(h);
  } catch (e) {
    if (e && e.name !== "AbortError") toast("Couldn't open that folder: " + e.message);
  }
}

async function openRoot(handle, quiet) {
  $("start").hidden = true;
  S.store = new Store(handle);
  await queue(async () => {
    await S.store.scan();
    if (!S.store.root.children.length) await makeWelcome();
  });
  renderTree();
  layout();
  const n = S.store.find(S.settings.open) || S.store.root.children[0];
  if (S.settings.split) {
    const n2 = S.store.find(S.settings.open2) || n;
    if (n2) await openNote(n2, P[1]);
  }
  if (n) await openNote(n, P[0]);
  if (S.settings.split && S.settings.active === 1) setActive(P[1]);
  updateCount();
}

// ------------------------------------------------------------------ the list of notes
function renderTree() {
  const tree = $("tree");
  tree.textContent = "";
  const q = S.searching.trim().toLowerCase();
  const exp = new Set(S.settings.expanded);
  const add = (note, depth) => {
    const row = document.createElement("div");
    row.className = "row" + (S.note && note.key() === S.note.key() ? " cur" : "");
    row.style.paddingLeft = (depth * 18) + "px";
    row.dataset.key = note.key();
    row.setAttribute("role", "treeitem");
    const tw = document.createElement("span");
    tw.className = "tw";
    tw.textContent = note.children.length && !q ? (exp.has(note.key()) ? "▾" : "▸") : "";
    const lbl = document.createElement("span");
    lbl.className = "lbl";
    lbl.textContent = note.title();
    row.append(tw, lbl);
    tw.onclick = (e) => {
      e.stopPropagation();
      if (!note.children.length) return openNote(note);
      const k = note.key();
      const s = new Set(S.settings.expanded);
      if (s.has(k)) s.delete(k); else s.add(k);
      S.settings.expanded = [...s];
      saveSettings();
      renderTree();
    };
    row.onclick = () => { openNote(note); if ($("app").classList.contains("app-narrow")) { S.sideOpenNarrow = false; layout(); } };
    tree.appendChild(row);
    if (!q && note.children.length && exp.has(note.key())) for (const c of note.children) add(c, depth + 1);
  };
  if (q) {
    for (const n of S.store.all()) {
      if (n.title().toLowerCase().includes(q) || (n.text || "").toLowerCase().includes(q)) {
        add(n, 0);
        tree.lastChild.classList.add("match");
      }
    }
  } else {
    for (const n of S.store.root.children) add(n, 0);
  }
  const cur = tree.querySelector(".row.cur");
  if (cur) cur.scrollIntoView({ block: "nearest" });
}

function updateCount() {
  const n = S.store ? S.store.all().length : 0;
  $("count").textContent = `${n} note${n === 1 ? "" : "s"} · ${S.store ? S.store.handle.name : ""}`;
}

function expandTo(note) {
  const s = new Set(S.settings.expanded);
  for (const a of note.ancestors()) s.add(a.key());
  S.settings.expanded = [...s];
}

function updateHead() {
  for (const p of P) {
    const n = p.note;
    p.head.textContent = n ? [...n.ancestors().reverse().map((a) => a.title()), titleNow(p.page)].join("  ›  ") : "No note open";
  }
}

function titleNow(pg = page) {
  for (const div of pg.children) {
    const t = ed.lineText(div).split(md.OBJ).join("").trim();
    if (t) return t.slice(0, 80);
  }
  return "Untitled";
}

// ------------------------------------------------------------------ opening a note
async function openNote(note, pane = A) {
  if (!note) return;
  await flushSave();
  await queue(async () => {
    try { await S.store.read(note); } catch (e) { /* gone: show what we had */ }
  });
  pane.note = note;
  S.settings[pane.k ? "open2" : "open"] = note.key();
  expandTo(note);
  saveSettings();
  showText(note.text || "", pane);
  renderTree();
  updateHead();
  pane.scroller.scrollTop = 0;
}

function showText(text, pane = A) {
  const lines = md.parse(text);
  const dir = pane.note.folderParts();
  for (const ln of lines) for (const r of ln.runs) if (r.img) r.img.target = md.resolvePicture(r.img.src, dir);
  ed.renderLines(pane.page, lines);
  ed.relayout(pane.page);
  loadPictures(pane.page);
  pane.page.dataset.loaded = "1";
}

async function loadPictures(pg = page) {
  for (const img of pg.querySelectorAll("img.pic:not([data-loaded])")) {
    img.dataset.loaded = "1";
    let parts = img.dataset.target ? img.dataset.target.split("/") : null;
    let file = null;
    if (parts) {
      try { file = await S.store.pictureFile(parts); } catch (e) {
        // as the laptop does: look in Pictures for a file of that name
        const alt = [PICTURES, parts[parts.length - 1]];
        try { file = await S.store.pictureFile(alt); img.dataset.target = alt.join("/"); parts = alt; } catch (e2) { /* missing */ }
      }
    }
    if (!file) {
      img.classList.add("missing");
      img.alt = "Picture not found: " + md.unquote(img.dataset.src.split("/").pop() || "");
      continue;
    }
    const key = parts.join("/") + "@" + file.lastModified;
    let url = S.urls.get(key);
    if (!url) { url = URL.createObjectURL(file); S.urls.set(key, url); }
    img.onload = () => sizePicture(img);
    img.src = url;
  }
}

function sizePicture(img) {
  const share = { small: 1 / 3, medium: 0.6 }[img.dataset.size];
  const nat = img.naturalWidth;
  img.style.width = share && nat ? `min(${(share * 100).toFixed(1)}%, ${nat}px)` : "";
}

// ------------------------------------------------------------------ saving
function changed(pane = A) {
  if (!pane.note) return;
  pane.dirty = true;
  clearTimeout(pane.timer);
  pane.timer = setTimeout(() => queue(() => saveNow(pane)), SAVE_AFTER_MS);
  // the title in the list and the head, as you type
  const row = $("tree").querySelector(`.row[data-key="${CSS.escape(pane.note.key())}"] .lbl`);
  const t = titleNow(pane.page);
  if (row && row.textContent !== t) row.textContent = t;
  // the same note in the other half follows as you type
  for (const q of P) if (q !== pane && q.note === pane.note) mirrorSoon(pane, q);
  updateHead();
}

// the other half shows what this half has: at most one redraw per frame
function mirrorSoon(from, to) {
  if (to.mirrorDue) return;
  to.mirrorDue = true;
  requestAnimationFrame(() => {
    to.mirrorDue = false;
    if (to.note !== from.note || document.activeElement === to.page) return;
    const top = to.scroller.scrollTop;
    ed.renderLines(to.page, ed.readLines(from.page));
    ed.relayout(to.page);
    // pictures: the ones already showing in the first half, not read again
    const have = [...from.page.querySelectorAll("img.pic")];
    [...to.page.querySelectorAll("img.pic")].forEach((img, k) => {
      const src = have[k];
      if (!src || !src.dataset.loaded) return;
      img.dataset.loaded = "1";
      if (src.classList.contains("missing")) { img.classList.add("missing"); img.alt = src.alt; return; }
      img.onload = () => sizePicture(img);
      img.src = src.src;
    });
    loadPictures(to.page);
    to.scroller.scrollTop = top;
  });
}

function flushSave() {
  for (const p of P) clearTimeout(p.timer);
  return queue(async () => { for (const p of P) await saveNow(p); });
}

async function saveNow(pane) {
  if (!pane.dirty || !pane.note) return;
  pane.dirty = false;
  const note = pane.note;
  const lines = ed.readLines(pane.page);
  const text = md.serialize(lines, { dir: note.folderParts() });
  if (text !== note.text) {
    const now = await S.store.peek(note);
    if (now && now.modified !== note.modified && now.text !== note.text && now.text !== text) {
      // changed on the laptop too since we read it: theirs is kept, not lost
      await S.store.keepConflict(note, now.text);
      toast("This note had also changed on another device; that version is kept in the .trash folder.");
    }
    await S.store.write(note, text);
    // the same note open in the other pane shows what was just saved
    for (const q of P) if (q !== pane && q.note === note && !q.dirty) refill(q);
  }
  const title = md.titleOfLines(lines) || "Untitled";
  if (md.safeName(title) !== note.name) {
    const old = note.key();
    if (await S.store.rename(note, title)) {
      rekey(old, note.key());
      for (const q of P) if (q.note === note) S.settings[q.k ? "open2" : "open"] = note.key();
      saveSettings();
      renderTree();
    }
  }
}

// a pane shows its note again, keeping its place (and the caret, if it's there)
function refill(q) {
  const top = q.scroller.scrollTop;
  const had = document.activeElement === q.page;
  const c = had ? ed.caret(q.page) : null;
  showText(q.note.text || "", q);
  q.scroller.scrollTop = top;
  if (had) ed.setCaret(q.page, c);
}

function rekey(oldKey, newKey) {
  S.settings.expanded = S.settings.expanded.map((k) => (k === oldKey ? newKey : k.startsWith(oldKey + "/") ? newKey + k.slice(oldKey.length) : k));
}

// ------------------------------------------------------------------ changes made elsewhere
async function refresh() {
  if (!S.store) return;
  await flushSave();
  await queue(async () => {
    const was = P.map((p) => [p.note && p.note.key(), p.note && p.note.text]);
    await S.store.scan();
    let told = false;
    P.forEach((p, k) => {
      const [key, shown] = was[k];
      const n = key && S.store.find(key);
      if (n) {
        p.note = n;
        if (!p.dirty && n.text !== shown) {
          refill(p);
          if (!told) toast("Read again: changed on another device.");
          told = true;
        }
      } else if (key) {
        p.note = null;
        const first = S.store.root.children[0];
        if (first) setTimeout(() => openNote(first, p));
        else p.page.textContent = "";
      }
    });
  });
  renderTree();
  updateHead();
  updateCount();
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushSave();
  else refresh();
});
window.addEventListener("pagehide", () => flushSave());

// ------------------------------------------------------------------ notes: new, move, delete
async function newNote(under) {
  await flushSave();
  const cur = S.note;
  let note;
  await queue(async () => {
    let parent, index;
    if (!cur) { parent = S.store.root; index = parent.children.length; }
    else if (under) { parent = cur; index = cur.children.length; }
    else { parent = cur.parent; index = parent.children.indexOf(cur) + 1; }
    note = await S.store.newNote(parent, index, "");
  });
  await openNote(note);
  page.focus();
  updateCount();
}

async function moveNote(how) {
  const n = S.note;
  if (!n) return;
  await flushSave();
  const parent = n.parent, sib = parent.children, i = sib.indexOf(n);
  let target = null, index = 0;
  if (how === "up" && i > 0) { target = parent; index = i - 1; }
  else if (how === "down" && i < sib.length - 1) { target = parent; index = i + 2; }
  else if (how === "out" && !parent.isRoot()) { target = parent.parent; index = target.children.indexOf(parent) + 1; }
  else if (how === "in" && i > 0) { target = sib[i - 1]; index = target.children.length; }
  if (!target) return;
  const moving = [n, ...n.walk()];
  const before = moving.map((x) => ({ x, dir: x.folderParts(), text: x.text }));
  const oldKey = n.key();
  await queue(async () => {
    if (!(await S.store.move(n, target, index))) return;
    // a note that moved up or down a level: its picture links made right for where it is now
    for (const b of before) {
      if (!b.text || !b.text.includes("![")) continue;
      const lines = md.parse(b.text);
      for (const ln of lines) for (const r of ln.runs) if (r.img) r.img.target = md.resolvePicture(r.img.src, b.dir);
      const t2 = md.serialize(lines, { dir: b.x.folderParts() });
      if (t2 !== b.text) await S.store.write(b.x, t2);
    }
  });
  rekey(oldKey, n.key());
  if (how === "in") S.settings.expanded = [...new Set([...S.settings.expanded, target.key()])];
  S.settings.open = n.key();
  saveSettings();
  for (const p of P) if (p.note && moving.includes(p.note)) { S.settings[p.k ? "open2" : "open"] = p.note.key(); refill(p); }
  saveSettings();
  renderTree();
  updateHead();
}

async function deleteNote() {
  const n = S.note;
  if (!n) return;
  const under = [...n.walk()].length;
  if (!confirm(`Delete “${n.title()}”${under ? ` and the ${under} note${under === 1 ? "" : "s"} under it` : ""}?\n\nIt goes to the .trash folder inside RossNotes, in case.`)) return;
  await flushSave();
  const parent = n.parent, i = parent.children.indexOf(n);
  const gone = [n, ...n.walk()];
  await queue(() => S.store.delete(n));
  const next = parent.children[Math.min(i, parent.children.length - 1)] || (parent.isRoot() ? null : parent) ||
    S.store.root.children[0];
  for (const p of P) {
    if (!p.note || !gone.includes(p.note)) continue;
    p.note = null;
    p.dirty = false;
    if (next) await openNote(next, p);
    else p.page.textContent = "";
  }
  if (!next) await newNote(false);
  renderTree();
  updateCount();
}

async function makeWelcome() {
  const text = `# Welcome to Ross Note
${md.longDate()}

The first line of a note is its title, in the list on the left.

## On the tablet
- **New** makes a note; the buttons over the list add one under this note, move it up, down, out or in, or delete it
- **B**, **I**, **U**, **S**, **H** bold, italic, underline, strikethrough, ==highlight==
- **H1**, **H2**, **H3** headings, **¶** normal text; **• List**, **1. List**, **❝ Quote**
- **Date** puts in today's date; **Picture** adds a photo (tap it for small, medium or full width)
- **⋯** has line spacing, light or dark, printing and the folder

## Markdown as you type
Start a line with # , ## or ### for a heading, - for a bullet, 1. for a numbered list, > for a quote. Type \\*\\*bold\\*\\*, \\*italic\\*, \\=\\=highlight\\=\\= or \\~\\~strikethrough\\~\\~ and it changes as you finish.

Your notes are the Markdown files in this folder, one for each note, the same as on the laptop.
`;
  const n = await S.store.newNote(S.store.root, 0, text);
  await S.store.rename(n, md.titleOf(text));
}

// ------------------------------------------------------------------ formatting
function exec(cmd, val) {
  page.focus();
  document.execCommand("styleWithCSS", false, false);
  document.execCommand(cmd, false, val);
}

function flagsAtCaret() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return new Set();
  let n = sel.getRangeAt(0).startContainer;
  if (n.nodeType === 1 && n.childNodes[sel.getRangeAt(0).startOffset]) n = n.childNodes[sel.getRangeAt(0).startOffset];
  const line = ed.lineOf(n, page);
  if (!line) return new Set();
  const f = new Set();
  for (let e = n.nodeType === 3 ? n.parentNode : n; e && e !== line; e = e.parentNode) {
    const tg = e.tagName;
    if (tg === "B" || tg === "STRONG") f.add("b");
    if (tg === "I" || tg === "EM") f.add("i");
    if (tg === "U") f.add("u");
    if (tg === "S" || tg === "STRIKE" || tg === "DEL") f.add("s");
    if (e.style && e.style.backgroundColor && !/transparent|rgba\(0, 0, 0, 0\)/.test(e.style.backgroundColor)) f.add("h");
    if (e.style && (e.style.fontWeight === "bold" || +e.style.fontWeight >= 600)) f.add("b");
  }
  return f;
}

function toggleHighlight() {
  page.focus();
  const on = flagsAtCaret().has("h");
  document.execCommand("styleWithCSS", false, true);
  document.execCommand("hiliteColor", false, on ? "transparent" : ed.HL);
  document.execCommand("styleWithCSS", false, false);
  tidyStyles();
  afterEdit();
}

// remove the "no highlight" spans the browser leaves behind
function tidyStyles() {
  for (const sp of page.querySelectorAll("span[style]")) {
    const st = sp.style;
    if (st.backgroundColor === "transparent" || st.backgroundColor === "rgba(0, 0, 0, 0)") st.removeProperty("background-color");
    if (!sp.getAttribute("style").trim()) sp.replaceWith(...sp.childNodes);
  }
}

function setBlock(kind) {
  page.focus();
  const lines = ed.selectedLines(page);
  if (!lines.length) return;
  const all = lines.every((d) => d.dataset.kind === kind);
  for (const d of lines) {
    delete d.dataset.mark;
    delete d.dataset.raw;
    delete d.dataset.code;
    if (kind && !all) d.dataset.kind = kind; else delete d.dataset.kind;
    if (kind && kind[0] === "h" && !all) {
      // headings are bold already: bold inside them means nothing
      for (const b of d.querySelectorAll("b,strong")) b.replaceWith(...b.childNodes);
    }
  }
  afterEdit();
}

function clearFormatting() {
  page.focus();
  document.execCommand("removeFormat");
  document.execCommand("unlink");
  tidyStyles();
  afterEdit();
}

function insertText(s) {
  page.focus();
  document.execCommand("insertText", false, s);
}

function afterEdit() {
  ed.tidy(page);
  ed.relayout(page);
  changed();
  updateButtons();
}

function updateButtons() {
  const f = flagsAtCaret();
  for (const b of document.querySelectorAll("#toolbar .fmt")) {
    const k = { bold: "b", italic: "i", underline: "u", strike: "s", highlight: "h" }[b.dataset.cmd];
    b.classList.toggle("on", f.has(k));
  }
}

const COMMANDS = {
  bold: () => { exec("bold"); afterEdit(); },
  italic: () => { exec("italic"); afterEdit(); },
  underline: () => { exec("underline"); afterEdit(); },
  strike: () => { exec("strikeThrough"); afterEdit(); },
  highlight: toggleHighlight,
  h1: () => setBlock("h1"), h2: () => setBlock("h2"), h3: () => setBlock("h3"),
  normal: () => setBlock(null), ul: () => setBlock("ul"), ol: () => setBlock("ol"), quote: () => setBlock("quote"),
  date: () => insertText(md.longDate()),
  datetime: () => insertText(md.longDate(true)),
  picture: () => { rememberCaret(); $("file-pic").click(); },
  undo: () => { exec("undo"); afterEdit(); },
  redo: () => { exec("redo"); afterEdit(); },
  smaller: () => setSize(-1), bigger: () => setSize(1),
  dark: () => { S.settings.dark = !S.settings.dark; saveSettings(); applyLook(); },
  print: () => printNote(),
  splith: () => setSplit("h"),
  splitv: () => setSplit("v"),
  clear: clearFormatting,
};

function setSize(step) {
  S.settings.size = step === 0 ? 18 : Math.max(11, Math.min(40, S.settings.size + step));
  saveSettings();
  applyLook();
  toast("Text size " + S.settings.size, 1200);
}

// ------------------------------------------------------------------ typing
// what's done on a page is done in its pane: that pane becomes the one you're working in
function onPages(type, fn) {
  for (const p of P) p.page.addEventListener(type, (e) => { setActive(p); return fn(e); });
}
for (const p of P) {
  p.page.addEventListener("focus", () => setActive(p));
  p.el.addEventListener("pointerdown", () => setActive(p));
}

let savedCaret = null;
function rememberCaret() { savedCaret = { pane: A, c: ed.caret(page) }; }

onPages("beforeinput", (e) => {
  if (e.inputType === "insertParagraph" || e.inputType === "insertLineBreak") {
    e.preventDefault();
    enter();
  } else if (e.inputType === "deleteContentBackward") {
    const sel = window.getSelection();
    if (!sel.isCollapsed || !sel.rangeCount) return;
    const r = sel.getRangeAt(0);
    const line = ed.lineOf(r.startContainer, page);
    if (line && line.dataset.kind && ed.offsetIn(line, r.startContainer, r.startOffset) === 0) {
      // at the start of a heading, list line or quote: back to plain text first
      e.preventDefault();
      delete line.dataset.kind;
      delete line.dataset.mark;
      afterEdit();
    }
  }
});

function splitAtCaret() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  if (!r.collapsed) r.deleteContents();
  const line = ed.lineOf(r.startContainer, page);
  if (!line) return null;
  const tail = document.createRange();
  tail.setStart(r.startContainer, r.startOffset);
  tail.setEnd(line, line.childNodes.length);
  const frag = tail.extractContents();
  const nl = document.createElement("div");
  nl.className = "ln";
  nl.appendChild(frag);
  // empty formatting left at the ends goes
  for (const el of [...line.querySelectorAll("*"), ...nl.querySelectorAll("*")]) {
    if (el.tagName !== "IMG" && el.tagName !== "BR" && !el.textContent && !el.querySelector("img")) el.remove();
  }
  if (!ed.lineText(line)) { line.textContent = ""; line.appendChild(document.createElement("br")); }
  if (!ed.lineText(nl)) { nl.textContent = ""; nl.appendChild(document.createElement("br")); }
  else for (const br of nl.querySelectorAll("br")) br.remove();
  line.after(nl);
  return [line, nl];
}

function enter() {
  linkifyBeforeCaret();
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const line = ed.lineOf(sel.getRangeAt(0).startContainer, page);
  if (!line) return;
  const kind = line.dataset.kind;
  if ((kind === "ul" || kind === "ol" || kind === "quote") && !ed.lineText(line).trim()) {
    // Enter on an empty bullet or quote line: the list (or quote) ends
    delete line.dataset.kind;
    delete line.dataset.mark;
    afterEdit();
    return;
  }
  const got = splitAtCaret();
  if (!got) return;
  const [, nl] = got;
  if (kind === "ul" || kind === "ol" || kind === "quote") {
    nl.dataset.kind = kind;
    if (line.dataset.mark) nl.dataset.mark = line.dataset.mark;
  }
  if (line.dataset.code) { nl.dataset.code = "1"; nl.dataset.raw = ""; }
  ed.placeCaret(nl, 0);
  afterEdit();
  scrollCaretIntoView();
}

function scrollCaretIntoView() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const node = sel.getRangeAt(0).startContainer;
  const el = node.nodeType === 1 ? node : node.parentNode;
  if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
}

const INLINE = [
  [/\*\*([^*\s](?:[^*]*[^*\s])?)\*\*$/, "b"],
  [/==([^=\s](?:[^=]*[^=\s])?)==$/, "h"],
  [/~~([^~\s](?:[^~]*[^~\s])?)~~$/, "s"],
  [/(?:^|[^*\p{L}\p{N}])\*([^*\s](?:[^*]*[^*\s])?)\*$/u, "i"],
  [/(?:^|[^_\p{L}\p{N}])_([^_\s](?:[^_]*[^_\s])?)_$/u, "i"],
];

onPages("input", (e) => {
  if (ed.tidy(page)) { /* put right */ }
  if (e.inputType === "insertText" && e.data) {
    const ch = e.data[e.data.length - 1];
    if (ch === " ") { blockMarkdown(); linkifyBeforeCaret(1); }
    if ("*=~_".includes(ch)) inlineMarkdown();
  }
  ed.relayout(page);
  changed();
});

// "# ", "## ", "- ", "1. ", "> " at the start of a line
function blockMarkdown() {
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return;
  const r = sel.getRangeAt(0);
  const line = ed.lineOf(r.startContainer, page);
  if (!line || line.dataset.kind || line.dataset.code) return;
  const pos = ed.offsetIn(line, r.startContainer, r.startOffset);
  const before = ed.lineText(line).slice(0, pos);
  let kind = null;
  const m = /^(#{1,3}) $|^([-*+]) $|^(\d+)[.)] $|^> $/.exec(before.replace(/ /g, " "));
  if (!m) return;
  if (m[1]) kind = "h" + m[1].length;
  else if (m[2]) kind = "ul";
  else if (m[3]) kind = "ol";
  else kind = "quote";
  const del = document.createRange();
  const [n1, o1] = ed.pointAt(line, 0);
  del.setStart(n1, o1);
  del.setEnd(r.startContainer, r.startOffset);
  del.deleteContents();
  delete line.dataset.raw;
  line.dataset.kind = kind;
  if (!ed.lineText(line)) { line.textContent = ""; line.appendChild(document.createElement("br")); ed.placeCaret(line, 0); }
}

// **bold**, *italic*, ==highlight==, ~~strike~~ as you finish typing them
function inlineMarkdown() {
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return;
  const r = sel.getRangeAt(0);
  const node = r.startContainer;
  if (node.nodeType !== 3) return;
  const line = ed.lineOf(node, page);
  if (!line || line.dataset.code) return;
  const before = node.data.slice(0, r.startOffset);
  for (const [re, f] of INLINE) {
    const m = re.exec(before);
    if (!m) continue;
    const inner = m[1];
    const markLen = f === "i" ? 1 : 2;
    const end = r.startOffset;
    const start = end - inner.length - 2 * markLen;            // a character before the marker is kept
    const rng = document.createRange();
    rng.setStart(node, start);
    rng.setEnd(node, end);
    rng.deleteContents();
    const el = f === "b" ? document.createElement("b") : f === "i" ? document.createElement("i") :
      f === "s" ? document.createElement("strike") : document.createElement("span");
    if (f === "h") el.setAttribute("style", "background-color: " + ed.HL + ";");
    el.textContent = inner;
    rng.insertNode(el);
    // typing goes on outside it
    const after = document.createTextNode("​");
    el.after(after);
    ed.placeCaret(after, 1);
    return;
  }
}

// a web address before the caret becomes a live link
function linkifyBeforeCaret(back = 0) {
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return;
  const r = sel.getRangeAt(0);
  const node = r.startContainer;
  if (node.nodeType !== 3) return;
  const line = ed.lineOf(node, page);
  if (!line || line.dataset.code || node.parentNode.closest && node.parentNode.closest("a")) return;
  const upto = r.startOffset - back;
  const text = node.data.slice(0, upto);
  const k = Math.max(text.lastIndexOf(" "), text.lastIndexOf(" "), text.lastIndexOf("​")) + 1;
  const word = text.slice(k);
  if (!word) return;
  const end = md.urlSpan(word, 0);
  if (!end) return;
  const rng = document.createRange();
  rng.setStart(node, k);
  rng.setEnd(node, k + end);
  const a = document.createElement("a");
  a.href = md.hrefOf(word.slice(0, end));
  rng.surroundContents(a);
  const sel2 = window.getSelection();
  const tailNode = a.nextSibling;
  if (tailNode && tailNode.nodeType === 3) ed.placeCaret(tailNode, Math.min(tailNode.data.length, upto - (k + end) + back));
  else { const t = document.createTextNode(""); a.after(t); ed.placeCaret(t, 0); }
  void sel2;
}

// ------------------------------------------------------------------ keys
document.addEventListener("keydown", (e) => {
  const c = e.ctrlKey || e.metaKey;
  const k = e.key;
  let fn = null;
  if (c && e.shiftKey && (k === "H" || k === "h")) fn = COMMANDS.highlight;
  else if (c && e.shiftKey && (k === "X" || k === "x")) fn = COMMANDS.strike;
  else if (c && e.shiftKey && (k === "N" || k === "n")) fn = COMMANDS.normal;
  else if (c && e.shiftKey && (k === "*" || e.code === "Digit8")) fn = COMMANDS.ul;
  else if (c && e.shiftKey && (k === "&" || e.code === "Digit7")) fn = COMMANDS.ol;
  else if (c && e.shiftKey && (k === "D" || k === "d")) fn = COMMANDS.dark;
  else if (c && e.shiftKey && (k === "L" || k === "l")) fn = toggleList;
  else if (c && !e.shiftKey && (k === "1" || k === "2" || k === "3")) fn = COMMANDS["h" + k];
  else if (c && (k === "m" || k === "M")) fn = COMMANDS.quote;
  else if (c && (k === ";" || k === ":")) fn = e.shiftKey ? COMMANDS.datetime : COMMANDS.date;
  else if (c && k === " ") fn = COMMANDS.clear;
  else if (c && (k === "=" || k === "+")) fn = COMMANDS.bigger;
  else if (c && k === "-") fn = COMMANDS.smaller;
  else if (c && k === "0") fn = () => setSize(0);
  else if (c && (k === "p" || k === "P")) fn = printNote;
  else if (c && e.shiftKey && (k === "F" || k === "f")) fn = focusSearch;
  else if (c && e.altKey && (k === "n" || k === "N")) fn = () => newNote(false);
  else if (c && (k === "\\" || k === "|" || e.code === "Backslash")) fn = e.shiftKey ? COMMANDS.splitv : COMMANDS.splith;
  else if (c && (k === "b" || k === "B" || k === "i" || k === "I" || k === "u" || k === "U") && document.activeElement === page) {
    fn = COMMANDS[{ b: "bold", i: "italic", u: "underline" }[k.toLowerCase()]];
  } else if (e.altKey && !c && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(k)) {
    fn = () => moveNote({ ArrowUp: "up", ArrowDown: "down", ArrowLeft: "out", ArrowRight: "in" }[k]);
  }
  if (fn) { e.preventDefault(); fn(); }
});

// ------------------------------------------------------------------ pasting and dropping
onPages("paste", async (e) => {
  const dt = e.clipboardData;
  if (!dt) return;
  const files = [...dt.files].filter((f) => f.type.startsWith("image/"));
  e.preventDefault();
  if (files.length) { await addPictures(files); return; }
  const html = dt.getData("text/html");
  const text = dt.getData("text/plain");
  let lines;
  if (html && /<[a-z]/i.test(html)) lines = ed.linesFromHtml(html);
  else lines = md.parse(text || "");
  if (!lines.length) return;
  pasteLines(lines, !html && !/\n/.test((text || "").trim()) && !/[*_~=<#>[`]/.test(text || ""));
});

function pasteLines(lines, plain) {
  if (plain) { insertText(lines.map((l) => l.runs.map((r) => r.t).join("")).join(" ")); return; }
  const got = splitAtCaret();
  if (!got) return;
  const [first, rest] = got;
  let at = first;
  // the first pasted line joins the line the caret was in (unless it's a heading or list line)
  let k = 0;
  if (!lines[0].kind && !lines[0].code) {
    const el = ed.lineElement(lines[0]);
    for (const br of first.querySelectorAll("br")) br.remove();
    while (el.firstChild) { if (el.firstChild.tagName === "BR") el.firstChild.remove(); else first.appendChild(el.firstChild); }
    k = 1;
  }
  for (; k < lines.length; k++) {
    const el = ed.lineElement(lines[k]);
    at.after(el);
    at = el;
  }
  // the rest of the line the caret was in follows the pasted text
  if (ed.lineText(rest)) {
    const last = at;
    for (const br of last.querySelectorAll("br")) br.remove();
    const pos = ed.lineText(last).length;
    while (rest.firstChild) last.appendChild(rest.firstChild);
    rest.remove();
    const [n, o] = ed.pointAt(last, pos);
    ed.placeCaret(n, o);
  } else {
    rest.remove();
    const [n, o] = ed.pointAt(at, ed.lineText(at).length);
    ed.placeCaret(n, o);
  }
  if (!ed.lineText(first) && first !== at && !first.querySelector("img")) first.remove();
  loadPictures();
  afterEdit();
  scrollCaretIntoView();
}

onPages("dragover", (e) => { if ([...e.dataTransfer.types].includes("Files")) e.preventDefault(); });
onPages("drop", async (e) => {
  const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith("image/"));
  if (!files.length) return;
  e.preventDefault();
  const pos = document.caretPositionFromPoint ? document.caretPositionFromPoint(e.clientX, e.clientY) :
    document.caretRangeFromPoint ? document.caretRangeFromPoint(e.clientX, e.clientY) : null;
  if (pos) ed.placeCaret(pos.offsetNode || pos.startContainer, pos.offset != null ? pos.offset : pos.startOffset);
  await addPictures(files);
});

$("file-pic").addEventListener("change", async (e) => {
  const files = [...e.target.files];
  e.target.value = "";
  if (!files.length) return;
  if (savedCaret) setActive(savedCaret.pane);
  page.focus();
  if (savedCaret) ed.setCaret(page, savedCaret.c);
  await addPictures(files);
});

// ------------------------------------------------------------------ pictures
function pictureStamp() {
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`;
}

// a photo larger than 2,000 pixels is stored reduced to that (unless Keep Photos at Full Size)
async function preparePicture(file) {
  let name = file.name && file.name !== "image.png" && file.name !== "blob" ? file.name : `Pasted ${pictureStamp()}.png`;
  name = name.replace(/[\\/:*?"<>|#%]/g, " ").trim() || "Picture.jpg";
  if (S.settings.keepFull || /gif|svg/.test(file.type)) return [file, name];
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const big = Math.max(bmp.width, bmp.height);
    if (big <= LONG_SIDE) { bmp.close && bmp.close(); return [file, name]; }
    const k = LONG_SIDE / big;
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * k);
    c.height = Math.round(bmp.height * k);
    const g = c.getContext("2d");
    g.imageSmoothingQuality = "high";
    g.drawImage(bmp, 0, 0, c.width, c.height);
    const png = file.type === "image/png";
    const blob = await new Promise((ok) => c.toBlob(ok, png ? "image/png" : "image/jpeg", 0.9));
    const stem = name.replace(/\.[^.]+$/, "");
    return [blob, stem + (png ? ".png" : ".jpg")];
  } catch (e) {
    return [file, name];
  }
}

async function addPictures(files) {
  if (!S.note) return;
  toast("Adding the picture…", 60000);
  const parts = [];
  await queue(async () => {
    for (const f of files) {
      const [blob, name] = await preparePicture(f);
      parts.push(await S.store.savePicture(blob, name));
    }
  });
  page.focus();
  // each picture on a line of its own
  let got = splitAtCaret();
  if (!got) {
    const last = page.lastElementChild;
    ed.placeCaret(last, last.childNodes.length);
    got = splitAtCaret();
    if (!got) return;
  }
  let [line, rest] = got;
  let at = line;
  if (!ed.lineText(line) && !line.querySelector("img")) { at = line.previousElementSibling; line.remove(); }
  for (const p of parts) {
    const div = ed.lineElement({ kind: null, runs: [{ t: md.OBJ, f: new Set(), img: { src: "", size: "", target: p } }] });
    if (at) at.after(div); else page.prepend(div);
    at = div;
  }
  ed.placeCaret(rest, 0);
  loadPictures();
  afterEdit();
  hideToast();
  scrollCaretIntoView();
}

// ------------------------------------------------------------------ taps on links and pictures
function showChip(el, buttons) {
  const chip = $("chip");
  chip.textContent = "";
  for (const [label, fn, on] of buttons) {
    const b = document.createElement("button");
    b.textContent = label;
    if (on) b.classList.add("on");
    b.onmousedown = (e) => e.preventDefault();
    b.onclick = (e) => { e.preventDefault(); fn(); };
    chip.appendChild(b);
  }
  chip.hidden = false;
  const r = el.getBoundingClientRect();
  const w = chip.offsetWidth, h = chip.offsetHeight;
  let top = r.bottom + 6;
  if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
  chip.style.top = top + "px";
  chip.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left)) + "px";
}
function hideChip() { $("chip").hidden = true; for (const i of document.querySelectorAll(".page img.sel")) i.classList.remove("sel"); }

onPages("click", (e) => {
  const img = e.target.closest && e.target.closest("img.pic");
  if (img) {
    hideChip();
    img.classList.add("sel");
    const size = img.dataset.size || "";
    const set = (s) => () => { img.dataset.size = s; img.dataset.changed = "1"; delete img.dataset.alt; sizePicture(img); afterEdit(); hideChip(); };
    showChip(img, [
      ["Small", set("small"), size === "small"], ["Medium", set("medium"), size === "medium"],
      ["Full width", set(""), size === ""],
      ["Open", () => { if (img.src) window.open(img.src, "_blank"); hideChip(); }],
      ["Remove", () => { const line = img.closest(".ln"); img.remove(); if (line && !ed.lineText(line)) line.appendChild(document.createElement("br")); afterEdit(); hideChip(); }],
    ]);
  }
});

document.addEventListener("selectionchange", () => {
  if (!S.note) return;
  updateButtons();
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const p = P.find((q) => q.page.contains(sel.anchorNode));
  if (!p) return;
  setActive(p);
  if (document.querySelector(".page img.sel")) return;
  const n = sel.anchorNode;
  const a = (n.nodeType === 1 ? n : n.parentNode).closest && (n.nodeType === 1 ? n : n.parentNode).closest("a");
  if (a && sel.isCollapsed && page.contains(a)) {
    const href = a.getAttribute("href");
    const local = /^file:/i.test(href);
    showChip(a, [[local ? "On the laptop: " + md.unquote(href.split("/").pop()) : "Open ↗", () => {
      if (!local) window.open(href, "_blank", "noopener");
      hideChip();
    }]]);
  } else hideChip();
});

// ------------------------------------------------------------------ the menus (as on the laptop)
let openMenu = null;
function showMenu(anchor, items) {
  const m = $("menu");
  m.textContent = "";
  for (const it of items) {
    if (it === "-") { m.appendChild(document.createElement("hr")); continue; }
    if (typeof it === "string") { const l = document.createElement("div"); l.className = "lab"; l.textContent = it; m.appendChild(l); continue; }
    const b = document.createElement("button");
    const tick = document.createElement("span");
    tick.className = "tick";
    tick.textContent = it.on ? "✓" : "";
    b.append(tick, document.createTextNode(it.label));
    if (it.keys) { const k = document.createElement("span"); k.className = "keys"; k.textContent = it.keys; b.appendChild(k); }
    if (it.off) b.disabled = true;
    b.addEventListener("mousedown", (e) => e.preventDefault());       // the caret stays in the note
    b.onclick = () => { hideMenu(); it.fn(); };
    m.appendChild(b);
  }
  m.hidden = false;
  const r = anchor.getBoundingClientRect();
  m.style.top = Math.max(8, Math.min(r.bottom + 2, window.innerHeight - m.offsetHeight - 8)) + "px";
  m.style.left = Math.max(8, Math.min(r.left, window.innerWidth - m.offsetWidth - 8)) + "px";
}
function hideMenu() {
  $("menu").hidden = true;
  openMenu = null;
  for (const b of document.querySelectorAll("#menubar button")) b.classList.remove("open");
}
document.addEventListener("pointerdown", (e) => {
  if (!$("menu").hidden && !$("menu").contains(e.target) && !$("menubar").contains(e.target)) hideMenu();
  if (!$("chip").hidden && !$("chip").contains(e.target) && !(e.target.closest && e.target.closest("img.pic"))) hideChip();
});

function menuItems(name) {
  const s = S.settings;
  const n = S.note;
  const sib = n ? n.parent.children : [];
  const i = n ? sib.indexOf(n) : -1;
  const spacing = (v) => () => { s.spacing = v; saveSettings(); applyLook(); };
  switch (name) {
    case "file": return [
      { label: "New Note", fn: () => newNote(false), keys: "Ctrl+Alt+N" },
      { label: "New Note Under This One", fn: () => newNote(true), off: !n },
      "-",
      { label: "Import a Word Document…", fn: () => $("file-docx").click() },
      { label: "Export as Word…", fn: () => exportNotes("word"), off: !n },
      { label: "Export as PDF…", fn: () => exportNotes("pdf"), off: !n },
      { label: "Export as Markdown…", fn: () => exportNotes("md"), off: !n },
      "-",
      { label: "Print This Note…", fn: printNote, keys: "Ctrl+P", off: !n },
      "-",
      { label: "Read the Folder Again", fn: refresh },
      { label: "Choose Another Folder…", fn: async () => { await flushSave(); chooseFolder(); } },
      "-",
      { label: "Delete Note…", fn: deleteNote, off: !n },
    ];
    case "edit": return [
      { label: "Undo", fn: COMMANDS.undo, keys: "Ctrl+Z" },
      { label: "Redo", fn: COMMANDS.redo, keys: "Ctrl+Shift+Z" },
      "-",
      { label: "Cut", fn: () => { page.focus(); document.execCommand("cut"); }, keys: "Ctrl+X" },
      { label: "Copy", fn: () => { page.focus(); document.execCommand("copy"); }, keys: "Ctrl+C" },
      { label: "Paste", fn: pasteFromMenu, keys: "Ctrl+V" },
      { label: "Select All", fn: () => { page.focus(); document.execCommand("selectAll"); }, keys: "Ctrl+A" },
      "-",
      { label: "Search the Notes", fn: focusSearch, keys: "Ctrl+Shift+F" },
    ];
    case "insert": return [
      { label: "Date", fn: COMMANDS.date, keys: "Ctrl+;" },
      { label: "Date and Time", fn: COMMANDS.datetime, keys: "Ctrl+Shift+;" },
      "-",
      { label: "Picture…", fn: COMMANDS.picture },
      { label: "Keep Photos at Full Size", on: s.keepFull, fn: () => {
        s.keepFull = !s.keepFull; saveSettings();
        toast(s.keepFull ? "New photos are kept exactly as they come." : "Photos larger than 2,000 pixels are stored reduced to 2,000.");
      } },
    ];
    case "format": return [
      { label: "Bold", fn: COMMANDS.bold, keys: "Ctrl+B" },
      { label: "Italic", fn: COMMANDS.italic, keys: "Ctrl+I" },
      { label: "Underline", fn: COMMANDS.underline, keys: "Ctrl+U" },
      { label: "Strikethrough", fn: COMMANDS.strike, keys: "Ctrl+Shift+X" },
      { label: "Highlight", fn: COMMANDS.highlight, keys: "Ctrl+Shift+H" },
      "-",
      { label: "Heading 1", fn: COMMANDS.h1, keys: "Ctrl+1" },
      { label: "Heading 2", fn: COMMANDS.h2, keys: "Ctrl+2" },
      { label: "Heading 3", fn: COMMANDS.h3, keys: "Ctrl+3" },
      { label: "Normal Text", fn: COMMANDS.normal, keys: "Ctrl+Shift+N" },
      "-",
      { label: "Bullet List", fn: COMMANDS.ul, keys: "Ctrl+Shift+8" },
      { label: "Numbered List", fn: COMMANDS.ol, keys: "Ctrl+Shift+7" },
      { label: "Quote (indented)", fn: COMMANDS.quote, keys: "Ctrl+M" },
      "-",
      { label: "Clear Formatting", fn: COMMANDS.clear, keys: "Ctrl+Space" },
    ];
    case "notes": return [
      { label: "New Note", fn: () => newNote(false), keys: "Ctrl+Alt+N" },
      { label: "New Note Under This One", fn: () => newNote(true), off: !n },
      "-",
      { label: "Move Up", fn: () => moveNote("up"), keys: "Alt+Up", off: i < 1 },
      { label: "Move Down", fn: () => moveNote("down"), keys: "Alt+Down", off: !n || i >= sib.length - 1 },
      { label: "Move Out a Level", fn: () => moveNote("out"), keys: "Alt+Left", off: !n || n.parent.isRoot() },
      { label: "Move Under the Note Above", fn: () => moveNote("in"), keys: "Alt+Right", off: i < 1 },
      "-",
      { label: "Delete Note…", fn: deleteNote, off: !n },
    ];
    case "view": return [
      { label: "Split Side by Side", on: s.split === "h", fn: COMMANDS.splith, keys: "Ctrl+\\" },
      { label: "Split Top and Bottom", on: s.split === "v", fn: COMMANDS.splitv, keys: "Ctrl+Shift+\\" },
      { label: "One Note Only", on: !s.split, fn: () => setSplit("") },
      "-",
      { label: "Show the Note List", on: $("app").classList.contains("app-narrow") ? !!S.sideOpenNarrow : s.list,
        fn: toggleList, keys: "Ctrl+Shift+L" },
      "-",
      { label: "Larger Text", fn: COMMANDS.bigger, keys: "Ctrl+=" },
      { label: "Smaller Text", fn: COMMANDS.smaller, keys: "Ctrl+−" },
      { label: "Normal Size", fn: () => setSize(0), keys: "Ctrl+0" },
      "-",
      "Line spacing (all notes)",
      ...SPACINGS.map(([l, v]) => ({ label: l, on: s.spacing === v, fn: spacing(v) })),
      { label: "Space Between Paragraphs", on: s.paraGap, fn: () => { s.paraGap = !s.paraGap; saveSettings(); applyLook(); } },
      "-",
      { label: "Dark Mode", on: s.dark, fn: COMMANDS.dark, keys: "Ctrl+Shift+D" },
    ];
    case "help": return [
      { label: "Keyboard Shortcuts", fn: showKeys, keys: "F1" },
      { label: "About Ross Note", fn: () => dialog("About Ross Note",
        `Ross Note ${VERSION}\nA simple, fast tree of notes.\n\nYour notes are the Markdown files in the folder “${S.store ? S.store.handle.name : ""}”, ` +
        "one for each note, the same as on the laptop. Your sync app keeps them in step.") },
    ];
  }
  return [];
}

function showMenuNamed(name) {
  const btn = document.querySelector(`#menubar [data-menu="${name}"]`);
  for (const b of document.querySelectorAll("#menubar button")) b.classList.toggle("open", b === btn);
  openMenu = name;
  showMenu(btn, menuItems(name));
}
for (const b of document.querySelectorAll("#menubar [data-menu]")) {
  b.addEventListener("mousedown", (e) => e.preventDefault());
  b.addEventListener("click", () => (openMenu === b.dataset.menu ? hideMenu() : showMenuNamed(b.dataset.menu)));
  // with one menu open, pointing at another opens it
  b.addEventListener("pointerenter", (e) => { if (openMenu && openMenu !== b.dataset.menu && e.pointerType === "mouse") showMenuNamed(b.dataset.menu); });
}
// Alt shows the menus' letters; Alt+F, Alt+E ... open them
document.addEventListener("keydown", (e) => {
  if (e.key === "Alt") $("menubar").classList.add("keys");
  const letters = { f: "file", e: "edit", i: "insert", o: "format", n: "notes", v: "view", h: "help" };
  if (e.altKey && !e.ctrlKey && !e.shiftKey && letters[e.key.toLowerCase()]) {
    e.preventDefault();
    showMenuNamed(letters[e.key.toLowerCase()]);
  } else if (e.key === "Escape" && openMenu) hideMenu();
  else if (e.key === "F1") { e.preventDefault(); showKeys(); }
});
document.addEventListener("keyup", (e) => { if (e.key === "Alt") $("menubar").classList.remove("keys"); });

async function pasteFromMenu() {
  page.focus();
  try {
    const items = await navigator.clipboard.read();
    for (const it of items) {
      const img = it.types.find((t) => t.startsWith("image/"));
      if (img) { const b = await it.getType(img); return addPictures([new File([b], "image.png", { type: img })]); }
    }
    for (const it of items) {
      if (it.types.includes("text/html")) return pasteLines(ed.linesFromHtml(await (await it.getType("text/html")).text()), false);
    }
    const t = await navigator.clipboard.readText();
    if (t) pasteLines(md.parse(t), !/\n/.test(t.trim()) && !/[*_~=<#>[`]/.test(t));
  } catch (e) {
    toast("Paste with Ctrl+V, or press and hold in the note and choose Paste.");
  }
}

function focusSearch() {
  if ($("app").classList.contains("app-narrow")) { S.sideOpenNarrow = true; layout(); }
  else if (!S.settings.list) { S.settings.list = true; saveSettings(); layout(); }
  $("search").focus();
  $("search").select();
}

function dialog(title, text) {
  $("dialog").querySelector("h2").textContent = title;
  $("dialog").querySelector(".body").textContent = text;
  $("dialog-close").textContent = "Close";
  $("dialog-close").classList.add("main");
  for (const b of $("dialog").querySelectorAll(".extra")) b.remove();
  $("dialog").hidden = false;
}

// a dialog with a form in it and buttons: resolves with the button's value (null for Cancel)
function ask(title, bodyEl, buttons) {
  return new Promise((ok) => {
    const d = $("dialog");
    d.querySelector("h2").textContent = title;
    const body = d.querySelector(".body");
    body.textContent = "";
    body.appendChild(bodyEl);
    for (const b of d.querySelectorAll(".extra")) b.remove();
    const close = $("dialog-close");
    close.textContent = "Cancel";
    close.classList.remove("main");
    const row = close.parentNode;
    const done = (v) => { d.hidden = true; close.onclick = () => { d.hidden = true; }; ok(v); };
    for (const [label, value, main] of buttons) {
      const b = document.createElement("button");
      b.className = "big extra" + (main ? " main" : "");
      b.textContent = label;
      b.onclick = () => done(value);
      row.insertBefore(b, close);
    }
    close.onclick = () => done(null);
    d.hidden = false;
  });
}
$("dialog-close").onclick = () => { $("dialog").hidden = true; };
$("dialog").addEventListener("click", (e) => { if (e.target === $("dialog")) $("dialog-close").click(); });

function showKeys() {
  dialog("Keyboard Shortcuts", [
    "New note: Ctrl+Alt+N",
    "Insert date: Ctrl+;    Date and time: Ctrl+Shift+;",
    "Bold / Italic / Underline: Ctrl+B / I / U",
    "Highlight: Ctrl+Shift+H    Strikethrough: Ctrl+Shift+X",
    "Headings: Ctrl+1 / 2 / 3    Normal text: Ctrl+Shift+N",
    "Bullets: Ctrl+Shift+8    Numbers: Ctrl+Shift+7",
    "Quote (indented): Ctrl+M, or start a line with >",
    "Clear formatting: Ctrl+Space",
    "Text size: Ctrl+=  Ctrl+−  Ctrl+0",
    "Split side by side: Ctrl+\\    Top and bottom: Ctrl+Shift+\\",
    "Hide / show the note list: Ctrl+Shift+L    Light / dark: Ctrl+Shift+D",
    "Search the notes: Ctrl+Shift+F",
    "Move a note: Alt+Up / Down / Left / Right",
    "Print or save as PDF: Ctrl+P",
    "Menus: Alt+F, Alt+E, Alt+I, Alt+O, Alt+N, Alt+V, Alt+H",
  ].join("\n"));
}

async function printNote() {
  await flushSave();
  hideChip();
  window.print();
}

// ------------------------------------------------------------------ the toolbar and the list's buttons
for (const b of document.querySelectorAll("#toolbar [data-cmd]")) {
  b.addEventListener("mousedown", (e) => e.preventDefault());     // the caret stays in the note
  b.addEventListener("click", () => COMMANDS[b.dataset.cmd]());
}
$("b-new").onclick = () => newNote(false);
$("b-list").onclick = toggleList;
function toggleList() {
  if ($("app").classList.contains("app-narrow")) S.sideOpenNarrow = !S.sideOpenNarrow;
  else { S.settings.list = !S.settings.list; saveSettings(); }
  layout();
}
for (const b of document.querySelectorAll("#treebar [data-tree]")) {
  b.addEventListener("click", () => {
    const t = b.dataset.tree;
    if (t === "new") newNote(false);
    else if (t === "child") newNote(true);
    else if (t === "delete") deleteNote();
    else moveNote(t);
  });
}
$("search").addEventListener("input", (e) => { S.searching = e.target.value; renderTree(); });

// the divider: the list wider or narrower
(() => {
  const d = $("divider");
  let x0 = 0, w0 = 0;
  d.addEventListener("pointerdown", (e) => {
    x0 = e.clientX; w0 = $("side").offsetWidth;
    d.setPointerCapture(e.pointerId);
    const move = (ev) => {
      S.settings.side = Math.max(120, Math.min(window.innerWidth - 200, w0 + ev.clientX - x0));
      document.documentElement.style.setProperty("--side", S.settings.side + "px");
    };
    const up = () => { d.removeEventListener("pointermove", move); d.removeEventListener("pointerup", up); saveSettings(); };
    d.addEventListener("pointermove", move);
    d.addEventListener("pointerup", up);
  });
})();
window.addEventListener("resize", layout);
(() => {
  const d = $("pdiv");
  d.addEventListener("pointerdown", (e) => {
    d.setPointerCapture(e.pointerId);
    const box = $("panes").getBoundingClientRect();
    const v = $("panes").classList.contains("split-v");
    const move = (ev) => {
      S.settings.ratio = v ? (ev.clientY - box.top) / box.height : (ev.clientX - box.left) / box.width;
      layout();
    };
    const up = () => { d.removeEventListener("pointermove", move); d.removeEventListener("pointerup", up); saveSettings(); };
    d.addEventListener("pointermove", move);
    d.addEventListener("pointerup", up);
  });
})();
for (const p of P) p.scroller.addEventListener("click", (e) => {
  // a tap below the last line puts the caret at the end
  setActive(p);
  if (e.target === p.scroller || (e.target === page && e.clientY > page.lastElementChild.getBoundingClientRect().bottom)) {
    const last = page.lastElementChild;
    page.focus();
    const [n, o] = ed.pointAt(last, ed.lineText(last).length);
    ed.placeCaret(n, o);
  }
});

// ------------------------------------------------------------------ toasts
let toastTimer = 0;
function toast(msg, ms = 3500) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, ms);
}
function hideToast() { $("toast").hidden = true; }

// ------------------------------------------------------------------ Word in; Word, PDF and Markdown out
let wordio = null;
async function wordModule() { return wordio || (wordio = await import("./wordio.js")); }

$("file-docx").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (f) await importWord(f);
});

async function importWord(file, split = null) {
  await flushSave();
  const W = await wordModule();
  let got;
  try { got = await W.readDocx(await file.arrayBuffer()); } catch (err) {
    dialog("Import a Word Document", `Couldn't read “${file.name}” as a Word document.\n\n${err.message || err}`);
    return null;
  }
  const stem = file.name.replace(/\.[^.]+$/, "");
  const { pre, secs } = W.splitSections(got.lines);
  if (split == null) {
    split = false;
    if (secs.length > 1) {
      const p = document.createElement("div");
      p.textContent = `“${stem}” has ${secs.length} headings. Bring it in as one note, or as a note for each heading ` +
        "(under a note named after the document)?";
      const v = await ask("Import a Word Document", p, [["One note", "one", true], ["A note for each heading", "many"]]);
      if (!v) return null;
      split = v === "many";
    }
  }
  toast("Importing…", 60000);
  const saved = new Map();
  const pictureNames = [...got.media.keys()];
  await queue(async () => {
    for (const name of pictureNames) {
      const data = got.media.get(name);
      const ext = name.split(".").pop().toLowerCase();
      const type = { png: "image/png", gif: "image/gif", bmp: "image/bmp", webp: "image/webp" }[ext] || "image/jpeg";
      const [blob, nm] = await preparePicture(new File([data], `${stem} ${name}`, { type }));
      saved.set(name, await S.store.savePicture(blob, nm));
    }
  });
  const titleLine = { kind: null, depth: 1, code: false, runs: [{ t: got.title || stem, f: new Set() }] };
  const startsWithTitle = (ls) => {
    for (const ln of ls) if (ln.runs.some((r) => r.t.trim())) return !!ln.kind && ln.kind[0] === "h";
    return false;
  };
  const cur = S.note;
  const parent = cur ? cur.parent : S.store.root;
  const index = cur ? parent.children.indexOf(cur) + 1 : parent.children.length;
  let top;
  const make = async (par, idx, lines) => {
    const n = await S.store.newNote(par, idx, "");
    const text = md.serialize(W.toNoteLines(lines, (name) => saved.get(name)), { dir: n.folderParts() });
    await S.store.write(n, text);
    await S.store.rename(n, md.titleOf(text) || "Untitled");
    return n;
  };
  await queue(async () => {
    if (!split) top = await make(parent, index, startsWithTitle(got.lines) ? got.lines : [titleLine, ...got.lines]);
    else {
      top = await make(parent, index, pre.length && pre[0].title ? pre : [titleLine, ...pre]);
      for (const sec of secs) await make(top, top.children.length, sec);
    }
  });
  S.settings.expanded = [...new Set([...S.settings.expanded, top.key()])];
  await openNote(top);
  updateCount();
  toast(`Imported ${file.name}`);
  return top;
}

// which notes, for an export: this one, with those under it, or ones you tick
async function chooseNotes(title, withPages) {
  const n = S.note;
  const box = document.createElement("div");
  box.className = "choose";
  const opt = (value, label, checked) => {
    const l = document.createElement("label");
    l.innerHTML = `<input type="radio" name="which" value="${value}"${checked ? " checked" : ""}> `;
    l.append(label);
    box.appendChild(l);
    return l;
  };
  opt("one", `“${n.title()}”`, true);
  const withKids = opt("kids", "This note and the notes under it", false);
  if (!n.children.length) withKids.querySelector("input").disabled = true;
  opt("pick", "Notes I choose:", false);
  const list = document.createElement("div");
  list.className = "picklist";
  const top = Math.min(...S.store.all().map((x) => x.ancestors().length));
  for (const x of S.store.all()) {
    const l = document.createElement("label");
    l.style.paddingLeft = (x.ancestors().length - top) * 18 + "px";
    l.innerHTML = '<input type="checkbox"> ';
    l.querySelector("input").dataset.key = x.key();
    l.querySelector("input").checked = x === n;
    l.append(x.title());
    list.appendChild(l);
  }
  list.addEventListener("change", () => { box.querySelector('input[value="pick"]').checked = true; });
  box.appendChild(list);
  let pages = null;
  if (withPages) {
    const l = document.createElement("label");
    l.className = "pages";
    l.innerHTML = `<input type="checkbox"${S.settings.newPages ? " checked" : ""}> `;
    l.append("Each note on a new page");
    pages = l.querySelector("input");
    box.appendChild(l);
  }
  const v = await ask(title, box, [["Export", "go", true]]);
  if (!v) return null;
  const which = box.querySelector('input[name="which"]:checked').value;
  let notes;
  if (which === "one") notes = [n];
  else if (which === "kids") notes = [n, ...n.walk()];
  else {
    const keys = new Set([...list.querySelectorAll("input:checked")].map((i) => i.dataset.key));
    notes = S.store.all().filter((x) => keys.has(x.key()));
  }
  if (!notes.length) return null;
  if (pages) { S.settings.newPages = pages.checked; saveSettings(); }
  return { notes, pages: !!(pages && pages.checked) };
}

// the chosen notes, each with its title as a heading; picture links from `dir`
async function joinedParts(notes, dir) {
  const top = Math.min(...notes.map((x) => x.ancestors().length));
  const out = [];
  await queue(async () => {
    for (const n of notes) {
      let text = n.text;
      try { text = await S.store.read(n); } catch (e) { /* as we had it */ }
      const lines = md.parse(text || "");
      for (const ln of lines) for (const r of ln.runs) if (r.img) r.img.target = md.resolvePicture(r.img.src, n.folderParts());
      out.push([n, md.titleAsHeading(md.serialize(lines, { dir }), n.ancestors().length - top + 1)]);
    }
  });
  return out;
}

// save a file where you choose (or to Downloads where the browser can't ask)
async function saveFile(blob, name, desc, ext, mime) {
  if (window.showSaveFilePicker) {
    try {
      const h = await window.showSaveFilePicker({ suggestedName: name, id: "rossnote-export",
        types: [{ description: desc, accept: { [mime]: [ext] } }] });
      const w = await h.createWritable();
      await w.write(blob);
      await w.close();
      return h.name;
    } catch (e) {
      if (e && e.name === "AbortError") return null;
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 5000);
  return name;
}

async function exportNotes(kind) {
  if (!S.note) return null;
  await flushSave();
  const label = { word: "Export as Word", pdf: "Export as PDF", md: "Export as Markdown" }[kind];
  const got = await chooseNotes(label, kind !== "md");
  if (!got) return null;
  const { notes, pages } = got;
  const name = md.safeName(notes.length === 1 ? notes[0].title() : notes[0].title());
  const parts = await joinedParts(notes, []);
  if (kind === "md") {
    const blob = new Blob([parts.map(([, t]) => t).join("\n")], { type: "text/markdown" });
    const saved = await saveFile(blob, name + ".md", "Markdown", ".md", "text/markdown");
    if (saved) toast("Saved " + saved);
    return saved;
  }
  if (kind === "word") {
    toast("Making the Word document…", 60000);
    const W = await wordModule();
    const lines = [];
    parts.forEach(([, text], k) => {
      const nl = md.parse(text);
      for (const ln of nl) for (const r of ln.runs) if (r.img) r.img.target = md.resolvePicture(r.img.src, []);
      const part = W.fromNoteLines(nl);
      while (part.length && !part[part.length - 1].runs.length && !part[part.length - 1].kind) part.pop();
      if (k && part.length) part[0][pages ? "pageBreak" : "gapBefore"] = true;
      lines.push(...part);
    });
    const bytes = async (img) => {
      try { return new Uint8Array(await (await S.store.pictureFile(img.target)).arrayBuffer()); } catch (e) {
        try { return new Uint8Array(await (await S.store.pictureFile([PICTURES, img.target[img.target.length - 1]])).arrayBuffer()); } catch (e2) { return null; }
      }
    };
    const blob = await W.writeDocx(lines, bytes, name);
    hideToast();
    const saved = await saveFile(blob, name + ".docx", "Word document", ".docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    if (saved) toast("Saved " + saved);
    return saved;
  }
  // PDF: the joined notes laid out for printing; the browser's "Save as PDF"
  const doc = $("printdoc");
  doc.textContent = "";
  parts.forEach(([, text], k) => {
    const part = document.createElement("div");
    part.className = "part" + (k && pages ? " newpage" : k ? " gap" : "");
    const lines = md.parse(text);
    for (const ln of lines) for (const r of ln.runs) if (r.img) r.img.target = md.resolvePicture(r.img.src, []);
    ed.renderLines(part, lines);
    ed.relayout(part);
    part.querySelector(".ln.title") && part.querySelector(".ln.title").classList.remove("title");
    doc.appendChild(part);
  });
  await loadPictures(doc);
  await Promise.all([...doc.querySelectorAll("img.pic")].map((i) => (i.decode ? i.decode().catch(() => {}) : null)));
  document.body.classList.add("print-joined");
  const old = document.title;
  document.title = name;
  const after = () => {
    document.body.classList.remove("print-joined");
    document.title = old;
    doc.textContent = "";
    window.removeEventListener("afterprint", after);
  };
  window.addEventListener("afterprint", after);
  window.print();
  return name;
}

// for the tests
window.RN = { S, P, importWord, exportNotes, joinedParts, wordModule, saveFile, setActive, setSplit, get A() { return A; }, md, ed, flushSave, refresh, openNote, newNote, moveNote, addPictures, pasteLines, COMMANDS, VERSION };

start();
