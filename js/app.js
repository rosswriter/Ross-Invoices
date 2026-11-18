// Ross Note for the tablet: the RossNotes folder (kept in step with the laptop
// by a sync app such as Drivesync), read and written in place.
import * as md from "./md.js?v=1.6.8";
import * as ed from "./editor.js?v=1.6.8";
import { Store, PICTURES } from "./store.js?v=1.6.8";
import * as spell from "./spell.js?v=1.6.8";

export const VERSION = "1.6.8";
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
  const head = el.querySelector(".head");
  head.innerHTML = '<span class="hname"></span><span class="hwords"></span>';
  return { k, el, head, hname: head.firstChild, hwords: head.lastChild, scroller: el.querySelector(".scroller"),
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
    open: "", open2: "", expanded: [], split: "", ratio: 0.5, active: 0,
    // 1.6.8: the new look
    toolbar: false, measure: "medium", font: "literata", focus: false, wordList: true, goal: 0, day: null, colours: {} };
  try { return Object.assign(d, JSON.parse(localStorage.getItem("rossnote") || "{}")); } catch (e) { return d; }
}
function saveSettings() { try { localStorage.setItem("rossnote", JSON.stringify(S.settings)); } catch (e) { /* private */ } }

const MEASURES = { narrow: 32, medium: 38, wide: 46, full: 38 };
function applyLook() {
  const s = S.settings;
  document.documentElement.classList.toggle("dark", !!s.dark);
  document.body.classList.toggle("dark", !!s.dark);
  $("app").classList.toggle("dark", !!s.dark);
  document.documentElement.style.setProperty("--size", s.size + "px");
  document.documentElement.style.setProperty("--lh", String(1.25 * s.spacing / 100));
  document.documentElement.style.setProperty("--gap", s.paraGap ? "10px" : "0px");
  document.documentElement.style.setProperty("--side", s.side + "px");
  document.documentElement.style.setProperty("--measure", (MEASURES[s.measure] || MEASURES.medium) + "em");
  document.body.classList.toggle("fullwidth", s.measure === "full");
  document.body.classList.toggle("classicfont", s.font === "classic");
  document.body.classList.toggle("focus", !!s.focus);
  document.body.classList.toggle("nowordlist", !s.wordList);
  $("toolbar").hidden = !s.toolbar;
  $("modes").textContent = s.focus ? "Focus" : "";
  document.querySelector('meta[name="theme-color"]').content = s.dark ? "#1B1A1F" : "#FBF8F1";
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

// ------------------------------------------------------------------ "working on it": a bar along the top and a
// line saying what, for anything that takes a while (shown only if it takes more than a moment, so quick things
// don't flicker)
const busyJobs = [];
let busyTimer = 0;
// the bar's element: made here if the page hasn't got it (an older page kept by the browser, straight after
// an update, can come with this newer program)
function busyEl() {
  let el = $("busy");
  if (!el) {
    el = document.createElement("div");
    el.id = "busy";
    el.hidden = true;
    el.setAttribute("role", "status");
    document.body.appendChild(el);
  }
  if (!el.querySelector(".bar")) el.prepend(Object.assign(document.createElement("div"), { className: "bar" }));
  if (!el.querySelector(".txt")) el.appendChild(Object.assign(document.createElement("span"), { className: "txt" }));
  return el;
}
function busyShow() {
  const top = busyJobs[busyJobs.length - 1];
  const el = busyEl();
  if (!top) { clearTimeout(busyTimer); busyTimer = 0; el.hidden = true; document.documentElement.classList.remove("is-busy"); return; }
  el.querySelector(".txt").textContent = top.label;
  el.classList.toggle("quiet", !!top.quiet);
  if (!el.hidden) return;
  if (!busyTimer) {
    busyTimer = setTimeout(() => {
      busyTimer = 0;
      if (busyJobs.length) { el.hidden = false; document.documentElement.classList.add("is-busy"); }
    }, Math.min(...busyJobs.map((j) => j.after)));
  }
}
// busy("Reading…", async (say) => { ...; say("Reading… 12"); ... }, {after: ms, quiet: true for a small one})
async function busy(label, fn, opts = {}) {
  const job = { label, after: opts.after ?? 250, quiet: !!opts.quiet };
  busyJobs.push(job);
  busyShow();
  const say = (text) => { job.label = text; if (busyJobs[busyJobs.length - 1] === job) busyEl().querySelector(".txt").textContent = text; };
  try { return await fn(say); } finally {
    busyJobs.splice(busyJobs.indexOf(job), 1);
    busyShow();
  }
}
// lets the screen draw (a long run of work otherwise holds the bar and its words back)
const breathe = () => new Promise((ok) => setTimeout(ok, 0));

// one thing at a time with the folder
function queue(fn) {
  const p = S.busy.then(fn, fn);
  S.busy = p.catch((e) => { console.error(e); toast("Something went wrong: " + whatWentWrong(e), 15000); });
  return p;
}

// an error as a line you can read out: what, and where in Ross Note it happened
function whatWentWrong(e) {
  const msg = (e && e.message) || String(e);
  const at = ((e && e.stack) || "").split("\n").map((l) => l.trim())
    .filter((l) => /\.js/.test(l)).slice(0, 2)
    .map((l) => l.replace(/^at\s+/, "").replace(/https?:\/\/[^\s)]*\/js\//, "").replace(/\?v=[\d.]+/, ""));
  return msg + (at.length ? "  [" + at.join(" ← ") + "]" : "") + "  (Ross Note " + VERSION + ")";
}
window.addEventListener("error", (ev) => { if (ev.error) toast("Something went wrong: " + whatWentWrong(ev.error), 15000); });
window.addEventListener("unhandledrejection", (ev) => toast("Something went wrong: " + whatWentWrong(ev.reason), 15000));

async function start() {
  applyLook();
  const boot = busyEl();
  boot.hidden = true;
  boot.classList.remove("boot");
  if ("serviceWorker" in navigator && location.protocol !== "file:" && !location.search.includes("nosw")) {
    navigator.serviceWorker.register("sw.js").then((r) => r.update()).catch(() => {});
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
  $("start").querySelector("h1").textContent = "Ross Note " + VERSION;
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
  S.store.onWrite = wordSoon;
  await busy("Reading your notes…", (say) => queue(async () => {
    S.store.onProgress = (n) => say(`Reading your notes… ${n}`);
    try { await S.store.scan(); } finally { S.store.onProgress = null; }
    if (!S.store.root.children.length) await makeWelcome();
  }), { after: 0 });
  dictTime = 0;
  if (spellMode() === "ross" && spell.ready()) readDictionary(true);
  if (S.settings.pop && S.settings.pop.open && PN.el.hidden) setTimeout(() => popShow(true), 300);
  fitScope();
  setTimeout(applySpellMode, 50);
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

// ------------------------------------------------------------------ notebooks' colours
// each top-level note (a notebook) has a colour: its own, chosen, or the next of these in turn
const NB_COLOURS = ["#B4532A", "#2F7D78", "#2F5D8A", "#8A5A9E", "#5B8C3A", "#B0466A", "#C08A1E"];
function notebookOf(note) {
  if (!note) return null;
  const up = note.ancestors();
  return up.length ? up[up.length - 1] : note;
}
function colourOf(note) {
  const top = notebookOf(note);
  if (!top || !S.store) return null;
  const own = (S.settings.colours || {})[top.key()];
  if (own) return own;
  const k = S.store.root.children.indexOf(top);
  return NB_COLOURS[(k < 0 ? 0 : k) % NB_COLOURS.length];
}
function chooseColour() {
  const top = notebookOf(S.note);
  if (!top) return;
  const box = document.createElement("div");
  const p = document.createElement("p");
  p.textContent = `The colour of “${top.title()}” and the notes in it: its mark in the list and the line along the top of its pages.`;
  const row = document.createElement("div");
  row.className = "colours";
  const now = colourOf(top);
  for (const c of NB_COLOURS) {
    const b = document.createElement("button");
    b.style.background = c;
    b.setAttribute("aria-label", c);
    if (c === now) b.classList.add("on");
    b.onclick = () => {
      S.settings.colours = Object.assign({}, S.settings.colours, { [top.key()]: c });
      saveSettings(); $("dialog-close").click(); renderTree(); updateHead();
    };
    row.appendChild(b);
  }
  box.append(p, row);
  ask("Notebook Colour", box, []);
}

// a note's words, or a branch's (the note and every note under it), for the list
function branchWords(n) {
  let w = wordsOfNote(n);
  for (const c of n.children) w += branchWords(c);
  return w;
}
const shortCount = (w) => (w >= 10000 ? Math.round(w / 1000) + "k" : w >= 1000 ? (w / 1000).toFixed(1).replace(/\.0$/, "") + "k" : String(w));

// ------------------------------------------------------------------ the list of notes
const ALIGN_TAGS = /<(p|h[1-6]) align="(center|right|justify)">|<\/(p|h[1-6])>$/gm;   // not words in the note
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
    row.append(tw);
    if (depth === 0 && !q) {
      const nb = document.createElement("span");
      nb.className = "nb";
      nb.style.background = colourOf(note);
      row.append(nb);
    }
    row.append(lbl);
    if (S.settings.wordList) {
      const wn = document.createElement("span");
      wn.className = "wn";
      const w = note.children.length && !exp.has(note.key()) ? branchWords(note) : wordsOfNote(note);
      wn.textContent = w ? shortCount(w) : "";
      row.append(wn);
    }
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
      if (n.title().toLowerCase().includes(q) || (n.text || "").replace(ALIGN_TAGS, "").toLowerCase().includes(q)) {
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
  goalSoon();
  const n = S.store ? S.store.all().length : 0;
  $("count").textContent = `${n} note${n === 1 ? "" : "s"} · ${S.store ? S.store.handle.name : ""} · Ross Note ${VERSION}`;
}

function expandTo(note) {
  const s = new Set(S.settings.expanded);
  const before = s.size;
  for (const a of note.ancestors()) s.add(a.key());
  S.settings.expanded = [...s];
  return s.size !== before;
}

function updateHead() {
  for (const p of P) {
    const n = p.note;
    p.hname.textContent = n ? [...n.ancestors().reverse().map((a) => a.title()), titleNow(p.page)].join("  ›  ") : "No note open";
    p.el.style.setProperty("--nb", n ? colourOf(n) : "transparent");
  }
  showSaved();
  // where you are, in the top bar
  const c = $("crumb");
  c.textContent = "";
  const n = A.note;
  if (n) {
    const nb = document.createElement("span");
    nb.className = "nb";
    nb.style.background = colourOf(n);
    c.appendChild(nb);
    const up = n.ancestors().reverse().map((a) => a.title());
    if (up.length) c.appendChild(document.createTextNode(up.join("  ›  ") + "  ›  "));
    const b = document.createElement("b");
    b.textContent = titleNow(A.page);
    c.appendChild(b);
  }
  wordsSoon();
}

// saved, or being saved, in the status bar
function showSaved() {
  const el = $("saved");
  const dirty = P.some((p) => p.dirty);
  el.textContent = !A.note ? "" : dirty ? "Saving…" : "Saved";
  el.classList.toggle("ok", !dirty && !!A.note);
}

// ------------------------------------------------------------------ word count (as the laptop counts)
// letters and digits, with ' ’ or - inside a word (don't, well-known) as one word
const WORD_RE = /[\p{L}\p{N}]+(?:['\u2019-][\p{L}\p{N}]+)*/gu;
function wordsIn(text) { return (text.match(WORD_RE) || []).length; }

function pageWords(pg) {
  return [...pg.children].map((d) => ed.lineText(d)).join("\n").split(md.OBJ).join("").split("\u200b").join("");
}

let wordsTimer = 0;
function wordsSoon() { clearTimeout(wordsTimer); wordsTimer = setTimeout(countWords, 300); }

function countWords() {
  for (const p of P) {
    if (!p.note) { p.hwords.textContent = ""; continue; }
    const text = pageWords(p.page);
    const n = wordsIn(text);
    let msg = `${n.toLocaleString("en")} word${n === 1 ? "" : "s"} · ${text.replace(/\n/g, "").length.toLocaleString("en")} characters`;
    const sel = window.getSelection();
    if (sel.rangeCount && !sel.isCollapsed && p.page.contains(sel.anchorNode)) {
      const t = sel.toString().split(md.OBJ).join("").split("\u200b").join("");
      if (t.trim()) msg = `${wordsIn(t).toLocaleString("en")} of ${n.toLocaleString("en")} words`;
    }
    p.hwords.textContent = msg;
  }
  updateCorner();
}

// the words in a note (or the selected notes) and every note under it
async function countBranch() {
  const n = S.note;
  if (!n) return null;
  await flushSave();
  let total = 0, k = 0;
  await busy("Counting…", () => queue(async () => {
    await S.store.readAll([n, ...n.walk()]);
    for (const x of [n, ...n.walk()]) {
      const text = x.text;
      const t = md.parse(text || "").map((ln) => ln.runs.map((r) => (r.img ? "" : r.t)).join("")).join("\n");
      total += wordsIn(t.split(md.OBJ).join(""));
      k++;
    }
  }));
  alert(`“${n.title()}”${k > 1 ? ` and the ${k - 1} note${k === 2 ? "" : "s"} under it` : ""}:\n\n${total.toLocaleString("en")} words`);
  return total;
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
  await busy("Opening “" + note.title() + "”…", async () => {
    await flushSave();
    await queue(async () => {
      try { await S.store.read(note); } catch (e) { /* gone: show what we had */ }
    });
    pane.note = note;
    S.settings[pane.k ? "open2" : "open"] = note.key();
    rememberRecent(note);
    const opened = expandTo(note);
    saveSettings();
    showText(note.text || "", pane);
    // the list redrawn only if a branch had to open to show it; otherwise just the current row moves
    if (opened || !markCurrent()) renderTree();
    updateHead();
    pane.scroller.scrollTop = 0;
  });
}

function markCurrent() {
  const tree = $("tree");
  const key = S.note && S.note.key();
  const row = key && tree.querySelector(`.row[data-key="${CSS.escape(key)}"]`);
  if (key && !row && !S.searching.trim()) return false;
  for (const r of tree.querySelectorAll(".row.cur")) r.classList.remove("cur");
  if (row) row.classList.add("cur");
  return true;
}

function showText(text, pane = A) {
  const lines = md.parse(text);
  const dir = pane.note.folderParts();
  for (const ln of lines) for (const r of ln.runs) if (r.img) r.img.target = md.resolvePicture(r.img.src, dir);
  ed.renderLines(pane.page, lines);
  ed.relayout(pane.page);
  loadPictures(pane.page);
  pane.page.dataset.loaded = "1";
  spellSoon(0);
}

// ------------------------------------------------------------------ spelling
// "ross": Ross Note's own British English check (the laptop's dictionary, your words shared through the
// RossNotes folder); "device": the tablet's own spell checker; "off": none.
const DICT_FILE = "Ross Note dictionary.txt";
let spellTimer = 0, dictTime = 0;
const spellMode = () => S.settings.spell || "ross";

function applySpellMode() {
  for (const p of P) p.page.spellcheck = spellMode() === "device";
  if (spellMode() !== "ross") {
    if (window.CSS && CSS.highlights) CSS.highlights.delete("spell");
    hideSpellBar();
    return;
  }
  if (!spell.ready()) {
    busy("Loading the dictionary…", () => spell.load(), { after: 800, quiet: true })
      .then(() => readDictionary()).then(() => spellSoon(0))
      .catch((e) => toast("The spelling dictionary couldn't be loaded: " + (e.message || e) + ". Spelling isn't checked."));
  } else spellSoon(0);
}

// your own words: the dictionary file in the RossNotes folder (read again when another device changes it)
async function readDictionary(force = false) {
  if (!S.store) return;
  const [text, when] = await S.store.readTop(DICT_FILE);
  if (!force && when && when === dictTime) return;
  dictTime = when;
  spell.setOwn(text ? text.split(/\r?\n/) : []);
  spellSoon(0);
}

async function saveDictionary() {
  const text = spell.ownWords().join("\n") + "\n";
  try { await queue(async () => { dictTime = await S.store.writeTop(DICT_FILE, text); }); } catch (e) { /* the queue said so */ }
}

function spellSoon(ms = 600) {
  clearTimeout(spellTimer);
  spellTimer = setTimeout(spellCheckNow, ms);
}

// every misspelt word in the open notes, underlined (the page itself is never changed)
function spellCheckNow() {
  if (!(window.CSS && CSS.highlights && window.Highlight)) return;
  if (spellMode() !== "ross" || !spell.ready()) { CSS.highlights.delete("spell"); return; }
  const ranges = [];
  for (const p of P) {
    if (!p.note || p.el.hidden) continue;
    for (const div of p.page.children) {
      if (div.dataset.code) continue;
      const walker = document.createTreeWalker(div, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (node.parentElement && node.parentElement.closest("code, pre")) continue;
        for (const [a, b, w] of spell.wordsIn(node.data)) {
          if (spell.ok(w)) continue;
          const r = new Range();
          r.setStart(node, a);
          r.setEnd(node, b);
          ranges.push(r);
        }
      }
    }
  }
  S.spellRanges = ranges;
  if (ranges.length) CSS.highlights.set("spell", new Highlight(...ranges));
  else CSS.highlights.delete("spell");
}

// the misspelt word at a place in the page, if there is one
function misspeltAt(node, offset) {
  for (const r of S.spellRanges || []) {
    if (r.startContainer === node && offset >= r.startOffset && offset <= r.endOffset && r.toString()) return r;
  }
  return null;
}

// a bar of suggestions under the word: tap one, or add the word to your dictionary, or ignore it
function showSpellBar(range) {
  const word = range.toString();
  const bar = $("spellbar");
  bar.textContent = "";
  const sug = spell.suggest(word);
  const btn = (label, cls, fn) => {
    const b = document.createElement("button");
    b.className = cls;
    b.textContent = label;
    b.addEventListener("pointerdown", (e) => e.preventDefault());        // the caret stays in the note
    b.onclick = () => { hideSpellBar(); fn(); };
    bar.appendChild(b);
  };
  for (const x of sug) btn(x, "sug", () => replaceWord(range, x));
  if (!sug.length) { const n = document.createElement("span"); n.className = "none"; n.textContent = "No suggestions"; bar.appendChild(n); }
  btn("Add to Dictionary", "act", () => { spell.addOwn(word); saveDictionary(); spellSoon(0); toast(`“${word}” is in your dictionary.`); });
  btn("Ignore", "act", () => { spell.ignore(word); spellSoon(0); });
  bar.hidden = false;
  const r = range.getBoundingClientRect();
  const top = r.bottom + 8 + bar.offsetHeight > window.innerHeight ? r.top - bar.offsetHeight - 8 : r.bottom + 8;
  bar.style.top = Math.max(8, top) + "px";
  bar.style.left = Math.max(8, Math.min(r.left, window.innerWidth - bar.offsetWidth - 8)) + "px";
  S.spellBarFor = range;
}

function hideSpellBar() {
  const bar = $("spellbar");
  if (bar) bar.hidden = true;
  S.spellBarFor = null;
}

function replaceWord(range, text) {
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  document.execCommand("insertText", false, text);
  spellSoon(0);
}

// a tap (or a click) in a misspelt word brings up its suggestions; right-click too, on the laptop
document.addEventListener("selectionchange", () => {
  if (spellMode() !== "ross" || !spell.ready()) return;
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) { hideSpellBar(); return; }
  const node = sel.anchorNode;
  if (!node || node.nodeType !== 3 || !P.some((p) => p.page.contains(node))) { hideSpellBar(); return; }
  if (S.typing) return;
  if (lastPointer !== "touch" || Date.now() - lastPointerAt > 1500) { hideSpellBar(); return; }
  const r = misspeltAt(node, sel.anchorOffset);
  if (r && r !== S.spellBarFor) showSpellBar(r);
  else if (!r) hideSpellBar();
});
for (const p of P) {
  p.page.addEventListener("input", () => {
    S.typing = true;
    hideSpellBar();
    clearTimeout(S.typingTimer);
    S.typingTimer = setTimeout(() => { S.typing = false; }, 900);
    spellSoon(700);
  });
  p.page.addEventListener("contextmenu", (e) => pageMenu(e, p));
  p.scroller.addEventListener("scroll", hideSpellBar, { passive: true });
}

function showDictionary() {
  const box = document.createElement("div");
  box.className = "choose";
  const words = spell.ownWords();
  const p = document.createElement("p");
  p.textContent = words.length
    ? `${words.length} word${words.length === 1 ? "" : "s"} you've added. They're kept in “${DICT_FILE}” in your RossNotes folder, ` +
      "so the laptop's Ross Note knows them too. Untick any to take them out."
    : `None yet. A word you add (tap it, then Add to Dictionary) is kept in “${DICT_FILE}” in your RossNotes folder, ` +
      "so the laptop's Ross Note knows it too.";
  box.appendChild(p);
  const list = document.createElement("div");
  list.className = "picklist";
  for (const w of words) {
    const l = document.createElement("label");
    l.innerHTML = '<input type="checkbox" checked> ';
    l.querySelector("input").dataset.word = w;
    l.append(w);
    list.appendChild(l);
  }
  if (words.length) box.appendChild(list);
  ask("Your Dictionary", box, words.length ? [["Save", "go", true]] : []).then((v) => {
    if (v !== "go") return;
    const keep = [...list.querySelectorAll("input:checked")].map((i) => i.dataset.word);
    if (keep.length === words.length) return;
    spell.setOwn(keep);
    saveDictionary();
    spellSoon(0);
  });
}

async function loadPictures(pg = page) {
  await Promise.all([...pg.querySelectorAll("img.pic:not([data-loaded])")].map((img) => loadPicture(img)));
}

async function loadPicture(img) {
  {
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
      return;
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
  showSaved();
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
  try { await saveNowIn(pane); } finally { showSaved(); goalSoon(); }
}
async function saveNowIn(pane) {
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
let lastRefresh = 0;
async function refresh(force = false) {
  if (!S.store) return;
  // back from one of Ross Note's own pickers (a picture, a file to import): nothing else changed meanwhile
  if (!force && (S.picking || Date.now() - lastRefresh < 3000)) return;
  lastRefresh = Date.now();
  await busy("Checking for changes…", () => refreshNow(), { after: 600, quiet: true });
}

async function refreshNow() {
  if (!PN.el.hidden && document.activeElement !== PN.ta) popLoad();
  if (spellMode() === "ross" && spell.ready()) readDictionary();
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
  if (document.visibilityState === "hidden") flushSave().then(() => setTimeout(() => { if (wordDue.size) wordFlush(); }, 50));
  else { refresh(); setTimeout(() => { S.picking = false; }, 1500); }
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

// alignment: the lines the selection touches; pressed again (or Left) back to the left
function setAlign(align) {
  page.focus();
  const lines = ed.selectedLines(page).filter((d) => !d.dataset.code);
  if (!lines.length) return;
  const all = align && lines.every((d) => d.dataset.align === align);
  for (const d of lines) {
    if (align && !all) d.dataset.align = align; else delete d.dataset.align;
  }
  afterEdit();
  const what = { center: "Centred", right: "Aligned right", justify: "Justified" }[align && !all ? align : ""] || "Aligned left";
  toast(what, 900);
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
  undo: () => { if (!undoReplaceAll()) { exec("undo"); afterEdit(); } },
  find: () => openFind(true),
  headings: () => showHeadings(),
  redo: () => { exec("redo"); afterEdit(); },
  smaller: () => setSize(-1), bigger: () => setSize(1),
  dark: () => { S.settings.dark = !S.settings.dark; saveSettings(); applyLook(); },
  print: () => printNote(),
  share: () => shareNote(),
  splith: () => setSplit("h"),
  splitv: () => setSplit("v"),
  clear: clearFormatting,
  palette: () => commandPalette(),
  focus: () => toggleFocus(),
  left: () => setAlign(null), center: () => setAlign("center"), right: () => setAlign("right"), justify: () => setAlign("justify"),
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
  else if (line.dataset.align) nl.dataset.align = line.dataset.align;      // as in Word: the next line goes on aligned
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
  const plainCtrl = c && !e.shiftKey && !e.altKey;
  const ak = plainCtrl ? { KeyL: "left", KeyE: "center", KeyR: "right", KeyJ: "justify" }[e.code] ||
    { l: "left", e: "center", r: "right", j: "justify" }[(k || "").toLowerCase()] : null;
  if (ak) {
    // Ctrl+L / E / R / J: alignment, as in Ross Writer and Word (the browser's own uses of them don't happen)
    e.preventDefault();
    const inBox = document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
    if (!inBox && page.isContentEditable) COMMANDS[ak]();
    return;
  }
  if (c && !e.altKey && !e.shiftKey && (e.code === "KeyK" || k === "k" || k === "K")) fn = commandPalette;
  else if (c && e.shiftKey && !e.altKey && k === "Enter") fn = toggleFocus;
  else if (c && e.altKey && !e.shiftKey && (e.code === "BracketLeft" || e.code === "BracketRight")) fn = () => sideWidth(e.code === "BracketRight" ? 30 : -30);
  else if (c && e.shiftKey && (k === "H" || k === "h")) fn = COMMANDS.highlight;
  else if (c && e.shiftKey && (k === "X" || k === "x")) fn = COMMANDS.strike;
  else if (c && e.shiftKey && (k === "N" || k === "n")) fn = COMMANDS.normal;
  else if (c && e.shiftKey && (k === "*" || e.code === "Digit8")) fn = COMMANDS.ul;
  else if (c && e.shiftKey && (k === "&" || e.code === "Digit7")) fn = COMMANDS.ol;
  else if (c && e.shiftKey && (k === "D" || k === "d")) fn = COMMANDS.dark;
  else if (c && e.shiftKey && !e.altKey && (k === "L" || k === "l")) fn = togglePageView;
  else if (c && e.altKey && !e.shiftKey && (k === "j" || k === "J" || e.code === "KeyJ")) fn = toggleList;
  else if (c && e.altKey && !e.shiftKey && (k === "i" || k === "I" || e.code === "KeyI")) fn = togglePop;
  else if (c && e.altKey && !e.shiftKey && (k === "o" || k === "O" || e.code === "KeyO")) fn = showHeadings;
  else if (c && e.altKey && !e.shiftKey && (k === "f" || k === "F" || e.code === "KeyF")) fn = focusSearch;
  else if (c && e.altKey && e.shiftKey && (k === "v" || k === "V" || e.code === "KeyV")) fn = () => pasteFromClipboard(true);
  else if (c && e.shiftKey && (k === ">" || e.code === "Period")) fn = COMMANDS.bigger;
  else if (c && e.shiftKey && (k === "<" || e.code === "Comma")) fn = COMMANDS.smaller;
  else if (c && e.shiftKey && !e.altKey && (k === "G" || k === "g")) fn = () => findGo(true);
  else if ((c && !e.shiftKey && !e.altKey && (k === "g" || k === "G")) || (k === "F5" && !c)) fn = goTo;
  else if (k === "F7" && !c) fn = toggleSpelling;
  else if (k === "F6" && !c) fn = e.shiftKey ? switchPane : () => setSplit(S.settings.split ? "" : "h");
  else if (e.altKey && !c && !e.shiftKey && ["1", "2", "3"].includes(k)) fn = () => setSpacingTo({ 1: 100, 2: 200, 3: 150 }[k]);
  else if (e.altKey && e.shiftKey && !c && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(k)) {
    fn = () => moveNote({ ArrowUp: "up", ArrowDown: "down", ArrowLeft: "out", ArrowRight: "in" }[k]);
  }
  else if (c && !e.shiftKey && (k === "1" || k === "2" || k === "3")) fn = COMMANDS["h" + k];
  else if (c && !e.altKey && (k === "m" || k === "M")) fn = e.shiftKey ? COMMANDS.normal : COMMANDS.quote;
  else if (c && (k === ";" || k === ":")) fn = e.shiftKey ? COMMANDS.datetime : COMMANDS.date;
  else if (c && k === " ") fn = COMMANDS.clear;
  else if (c && (k === "=" || k === "+")) fn = COMMANDS.bigger;
  else if (c && k === "-") fn = COMMANDS.smaller;
  else if (c && k === "0") fn = () => setSize(0);
  else if (c && (k === "p" || k === "P")) fn = printNote;
  else if (c && e.shiftKey && !e.altKey && (k === "F" || k === "f")) fn = listAll;
  else if (c && e.shiftKey && !e.altKey && (k === "O" || k === "o")) fn = showRecent;
  else if (c && !e.shiftKey && (k === "f" || k === "F")) fn = () => openFind(false);
  else if (c && !e.shiftKey && (k === "h" || k === "H")) fn = () => openFind(true);
  else if (k === "F3") fn = () => findGo(e.shiftKey);
  else if (k === "Escape" && !$("findbar").hidden && !openMenu && $("dialog").hidden) fn = closeFind;
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

for (const id of ["file-pic", "file-book", "file-docx"]) {
  $(id).addEventListener("click", () => { S.picking = true; });
  $(id).addEventListener("cancel", () => { S.picking = false; });
}
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
  wordsSoon();
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
      { label: "Import a Notebook (NoteCase Pro, FeatherNotes)…", fn: () => $("file-book").click() },
      { label: "Import a Ross Writer Project…", fn: () => importProject() },
      { label: "Import a NobleNote Folder…", fn: () => importNoble() },
      { label: "Export as Word…", fn: () => exportNotes("word"), off: !n },
      { label: "Export as PDF…", fn: () => exportNotes("pdf"), off: !n },
      { label: "Export as Markdown…", fn: () => exportNotes("md"), off: !n },
      "-",
      { label: "Email or Share This Note…", fn: () => shareNote(), off: !n },
      { label: "Copy This Note for Email", fn: () => copyForEmail(), off: !n },
      "-",
      { label: "Update Word Copy", fn: () => updateWordCopy(), off: !n },
      { label: "Keep Word Copies Updated", on: s.wordAuto !== false, fn: () => {
        s.wordAuto = s.wordAuto === false; saveSettings();
        toast(s.wordAuto ? "A note's Word copy is written again each time the note is saved." : "Word copies are written only when you choose Update Word Copy.");
      } },
      "-",
      { label: "Print This Note…", fn: printNote, keys: "Ctrl+P", off: !n },
      "-",
      { label: "Read the Folder Again", fn: refresh },
      { label: "Choose Another Folder…", fn: async () => { await flushSave(); chooseFolder(); } },
      "-",
      { label: "Delete Note…", fn: deleteNote, off: !n },
    ];
    case "edit": return [
      { label: "Find or Do Anything…", fn: commandPalette, keys: "Ctrl+K" },
      "-",
      { label: "Undo", fn: COMMANDS.undo, keys: "Ctrl+Z" },
      { label: "Redo", fn: COMMANDS.redo, keys: "Ctrl+Shift+Z" },
      "-",
      { label: "Cut", fn: () => { page.focus(); document.execCommand("cut"); }, keys: "Ctrl+X" },
      { label: "Copy", fn: () => { page.focus(); document.execCommand("copy"); }, keys: "Ctrl+C" },
      { label: "Paste", fn: pasteFromMenu, keys: "Ctrl+V" },
      { label: "Select All", fn: () => { page.focus(); document.execCommand("selectAll"); }, keys: "Ctrl+A" },
      "-",
      { label: "Find in This Note…", fn: () => openFind(false), keys: "Ctrl+F" },
      { label: "Find and Replace…", fn: () => openFind(true), keys: "Ctrl+H" },
      { label: "Find Next", fn: () => findGo(false), keys: "F3" },
      { label: "Find Previous", fn: () => findGo(true), keys: "Ctrl+Shift+G" },
      { label: "List All Matches", fn: () => { if ($("findbar").hidden) openFind(false); listAll(); }, keys: "Ctrl+Shift+F" },
      { label: "Go To…", fn: goTo, keys: "Ctrl+G" },
      "-",
      { label: "Search the Notes (the list)", fn: focusSearch, keys: "Ctrl+Alt+F" },
      { label: "Paste as Plain Text", fn: () => pasteFromClipboard(true), keys: "Ctrl+Alt+Shift+V" },
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
      { label: "Indent (as a Quote)", fn: COMMANDS.quote, keys: "Ctrl+M" },
      "-",
      { label: "Align Left", fn: COMMANDS.left, keys: "Ctrl+L" },
      { label: "Centre", fn: COMMANDS.center, keys: "Ctrl+E" },
      { label: "Align Right", fn: COMMANDS.right, keys: "Ctrl+R" },
      { label: "Justify", fn: COMMANDS.justify, keys: "Ctrl+J" },
      "-",
      { label: "Clear Formatting", fn: COMMANDS.clear, keys: "Ctrl+Space" },
    ];
    case "notes": return [
      { label: "New Note", fn: () => newNote(false), keys: "Ctrl+Alt+N" },
      { label: "Count Words (with the notes under it)…", fn: countBranch, off: !n },
      { label: "New Note Under This One", fn: () => newNote(true), off: !n },
      "-",
      { label: "Move Up", fn: () => moveNote("up"), keys: "Alt+Up", off: i < 1 },
      { label: "Move Down", fn: () => moveNote("down"), keys: "Alt+Down", off: !n || i >= sib.length - 1 },
      { label: "Move Out a Level", fn: () => moveNote("out"), keys: "Alt+Left", off: !n || n.parent.isRoot() },
      { label: "Move Under the Note Above", fn: () => moveNote("in"), keys: "Alt+Right", off: i < 1 },
      "-",
      { label: "Delete Note…", fn: deleteNote, off: !n },
      "-",
      { label: "Notebook Colour…", fn: chooseColour, off: !n },
    ];
    case "view": return [
      { label: "Headings in This Note…", fn: showHeadings, keys: "Ctrl+Alt+O" },
      { label: "Recent…", fn: showRecent, keys: "Ctrl+Shift+O" },
      { label: "Page View", on: !!s.pageView, fn: togglePageView, keys: "Ctrl+Shift+L" },
      { label: "Focus (the paragraph you're in)", on: !!s.focus, fn: toggleFocus, keys: "Ctrl+Shift+Enter" },
      { label: "Toolbar", on: !!s.toolbar, fn: () => { s.toolbar = !s.toolbar; saveSettings(); applyLook(); } },
      { label: "Word Counts in the List", on: !!s.wordList, fn: () => { s.wordList = !s.wordList; saveSettings(); applyLook(); renderTree(); } },
      { label: "Daily Word Target…", fn: setGoal },
      "-",
      "Line length",
      ...[["Narrow", "narrow"], ["Medium", "medium"], ["Wide", "wide"], ["The Full Width", "full"]].map(([l, v]) =>
        ({ label: l, on: (s.measure || "medium") === v, fn: () => { s.measure = v; saveSettings(); applyLook(); } })),
      "Typeface of the notes",
      { label: "Literata", on: s.font !== "classic", fn: () => { s.font = "literata"; saveSettings(); applyLook(); } },
      { label: "Cambria (as Ross Writer)", on: s.font === "classic", fn: () => { s.font = "classic"; saveSettings(); applyLook(); } },
      { label: "Pop-up Note", on: !PN.el.hidden, fn: togglePop, keys: "Ctrl+Alt+I" },
      { label: "Check Spelling", on: spellMode() === "ross", fn: toggleSpelling, keys: "F7" },
      "-",
      { label: "Split Side by Side", on: s.split === "h", fn: COMMANDS.splith, keys: "Ctrl+\\" },
      { label: "Split Top and Bottom", on: s.split === "v", fn: COMMANDS.splitv, keys: "Ctrl+Shift+\\" },
      { label: "One Note Only", on: !s.split, fn: () => setSplit("") },
      "-",
      { label: "Show the Note List", on: $("app").classList.contains("app-narrow") ? !!S.sideOpenNarrow : s.list,
        fn: toggleList, keys: "Ctrl+Alt+J" },
      "-",
      { label: "Larger Text", fn: COMMANDS.bigger, keys: "Ctrl+= or Ctrl+Shift+>" },
      { label: "Smaller Text", fn: COMMANDS.smaller, keys: "Ctrl+− or Ctrl+Shift+<" },
      { label: "Normal Size", fn: () => setSize(0), keys: "Ctrl+0" },
      "-",
      "Line spacing (all notes)",
      ...SPACINGS.map(([l, v]) => ({ label: l, on: s.spacing === v, fn: spacing(v), keys: { 100: "Alt+1", 150: "Alt+3", 200: "Alt+2" }[v] })),
      { label: "Space Between Paragraphs", on: s.paraGap, fn: () => { s.paraGap = !s.paraGap; saveSettings(); applyLook(); } },
      "-",
      { label: "Dark Mode", on: s.dark, fn: COMMANDS.dark, keys: "Ctrl+Shift+D" },
      "-",
      "Spelling",
      { label: "Check Spelling (British English)", on: spellMode() === "ross", fn: () => { s.spell = "ross"; saveSettings(); applySpellMode(); } },
      { label: "Use the Tablet's Own Spell Checker", on: spellMode() === "device", fn: () => { s.spell = "device"; saveSettings(); applySpellMode(); } },
      { label: "No Spelling Check", on: spellMode() === "off", fn: () => { s.spell = "off"; saveSettings(); applySpellMode(); } },
      { label: "Your Dictionary…", fn: showDictionary, off: spellMode() !== "ross" || !spell.ready() },
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
// Escape closes a dialog (as Cancel)
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("dialog").hidden) { e.preventDefault(); e.stopPropagation(); $("dialog-close").click(); }
}, true);
$("dialog").addEventListener("click", (e) => { if (e.target === $("dialog")) $("dialog-close").click(); });

function showKeys() {
  dialog("Keyboard Shortcuts (as in Ross Writer)", [
    "New note: Ctrl+Alt+N    Go to a note or heading: Ctrl+G or F5    Recent: Ctrl+Shift+O",
    "Bold / Italic / Underline: Ctrl+B / I / U    Highlight: Ctrl+Shift+H    Strikethrough: Ctrl+Shift+X",
    "Headings: Ctrl+1 / 2 / 3    Normal text: Ctrl+Shift+N    Clear formatting: Ctrl+Space",
    "Indent (as a quote): Ctrl+M    Back out: Ctrl+Shift+M    Bullets: Ctrl+Shift+8    Numbers: Ctrl+Shift+7",
    "Insert date: Ctrl+;    Date and time: Ctrl+Shift+;",
    "Find: Ctrl+F    Find and Replace: Ctrl+H    Next: F3    Previous: Ctrl+Shift+G (or Shift+F3)",
    "List all matches (this note or all notes): Ctrl+Shift+F    ^p a line's end, ^t a tab",
    "Paste as plain text: Ctrl+Alt+Shift+V    Right-click: spelling, cut, copy, paste",
    "Check spelling on or off: F7",
    "Text size: Ctrl+= / Ctrl+Shift+>   Ctrl+− / Ctrl+Shift+<   Ctrl+0    Line spacing: Alt+1 single, Alt+3 1.5, Alt+2 double",
    "Find a note or a command: Ctrl+K    Focus: Ctrl+Shift+Enter    Align: Ctrl+L / E / R / J",
    "Page view: Ctrl+Shift+L    Note list: Ctrl+Alt+J (narrower / wider: Ctrl+Alt+[ / ])    Headings: Ctrl+Alt+O    Light / dark: Ctrl+Shift+D",
    "Split view: Ctrl+\\ or F6 (top and bottom: Ctrl+Shift+\\)    Switch pane: Shift+F6",
    "Pop-up note (reminders, things to do): Ctrl+Alt+I",
    "Search the note list: Ctrl+Alt+F",
    "Move a note: Alt+arrows or Alt+Shift+arrows",
    "Word copy (RossNotes/Word Copies, kept up to date): File ▸ Update Word Copy",
    "Print or save as PDF: Ctrl+P    Menus: Alt+F, Alt+E, Alt+I, Alt+O, Alt+N, Alt+V, Alt+H",
    "Word count: lower right (click it for more); today's words beside it, once you set a target (View ▸ Daily Word Target)",
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
$("b-dark").onclick = () => COMMANDS.dark();
$("b-cmd").onclick = () => commandPalette();
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

// the divider: the list wider or narrower (Ctrl+Alt+[ / ]; a double-click: as it was at first)
function sideWidth(step) {
  if (!S.settings.list) { S.settings.list = true; }
  S.settings.side = step === 0 ? 260 : Math.max(160, Math.min(window.innerWidth - 300, $("side").offsetWidth + step));
  saveSettings();
  applyLook();
  toast("The list: " + S.settings.side + " wide", 900);
}
$("divider").addEventListener("dblclick", () => sideWidth(0));
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
async function wordModule() { return wordio || (wordio = await import("./wordio.js?v=1.6.8")); }

$("file-docx").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (f) await importWord(f);
});

async function importWord(file, split = null) {
  await flushSave();
  const W = await busy("Opening " + file.name + "…", () => wordModule(), { after: 0 });
  let got;
  try { got = await busy("Reading " + file.name + "…", async () => W.readDocx(await file.arrayBuffer()), { after: 0 }); } catch (err) {
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
  return busy("Importing " + file.name + "…", (say) => importWordNow(file, W, got, stem, pre, secs, split, say), { after: 0 });
}

async function importWordNow(file, W, got, stem, pre, secs, split, say) {
  const saved = new Map();
  const pictureNames = [...got.media.keys()];
  if (pictureNames.length) say(`Importing ${file.name}: ${pictureNames.length} picture${pictureNames.length === 1 ? "" : "s"}…`);
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
  const orders = new Set();
  const total = split ? secs.length + 1 : 1;
  let done = 0;
  const make = async (par, idx, lines) => {
    const textFor = (n) => md.serialize(W.toNoteLines(lines, (name) => saved.get(name)), { dir: n.folderParts() });
    const n = await S.store.addNote(par, idx, md.titleOf(textFor({ folderParts: () => par.childParts() })) || "Untitled", textFor);
    orders.add(par);
    done++;
    if (total > 1) { say(`Importing ${file.name}: ${done} of ${total} notes`); await breathe(); }
    return n;
  };
  const onWrite = S.store.onWrite;
  S.store.onWrite = null;
  try {
    await queue(async () => {
      if (!split) top = await make(parent, index, startsWithTitle(got.lines) ? got.lines : [titleLine, ...got.lines]);
      else {
        top = await make(parent, index, pre.length && pre[0].title ? pre : [titleLine, ...pre]);
        for (const sec of secs) await make(top, top.children.length, sec);
      }
      for (const par of orders) await S.store.writeOrder(par);
    });
  } finally { S.store.onWrite = onWrite; }
  if (onWrite) onWrite(top);
  S.settings.expanded = [...new Set([...S.settings.expanded, top.key()])];
  await openNote(top);
  updateCount();
  toast(`Imported ${file.name}`);
  return top;
}

// ------------------------------------------------------------------ notebooks from other programs
$("file-book").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (f) await importNotebook(f);
});

async function importNotebook(file) {
  return busy("Opening " + file.name + "…", (say) => importNotebookNow(file, say), { after: 0 });
}

async function importNotebookNow(file, say) {
  await flushSave();
  const NB = await import("./notebooks.js?v=1.6.8");
  const W = await wordModule();
  say("Reading " + file.name + "…");
  await breathe();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = NB.kindOf(bytes);
  let got;
  try {
    if (kind === "ncdb") {
      say("Loading the NoteCase reader…");
      await breathe();
      got = await NB.readNcdb(bytes);
    } else if (kind === "fnx") got = NB.readFnx(new TextDecoder().decode(bytes));
    else throw new Error("it isn't a NoteCase Pro or FeatherNotes notebook");
  } catch (err) {
    dialog("Import a Notebook", `Couldn't import “${file.name}”: ${err.message || err}`);
    return null;
  }
  const total = NB.count(got.tree) + 1;
  let done = 0;
  say(`Importing ${file.name}: ${total} notes…`);
  await breathe();
  const stem = file.name.replace(/\.[^.]+$/, "");
  const saved = new Map();
  const typeOf = (b) => (b[0] === 0x89 ? "image/png" : b[0] === 0x47 ? "image/gif" : b[0] === 0x42 ? "image/bmp"
    : b[0] === 0x52 && b[8] === 0x57 ? "image/webp" : "image/jpeg");
  const savePic = async (data, name) => {
    // named for what the picture really is (as the laptop does)
    const ext = { "image/png": "png", "image/gif": "gif", "image/bmp": "bmp", "image/webp": "webp" }[typeOf(data)] || "jpg";
    name = name.replace(/\.[^.]+$/, "") + "." + ext;
    const [blob, nm] = await preparePicture(new File([data], name, { type: typeOf(data) }));
    return S.store.savePicture(blob, nm);
  };
  const stamp = () => pictureStamp();
  // pictures carried inside a page (data: addresses)
  const pagePicture = async (src) => {
    if (!src.startsWith("data:")) return null;
    try {
      const [head, b64] = src.split(",", 2);
      const data = head.includes(";base64") ? Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
        : new TextEncoder().encode(decodeURIComponent(b64));
      const ext = { "image/png": "png", "image/gif": "gif", "image/bmp": "bmp" }[typeOf(data)] || "jpg";
      return await savePic(data, `Picture ${stamp()}.${ext}`);
    } catch (e) { return null; }
  };
  const cur = S.note;
  const parent = cur ? cur.parent : S.store.root;
  const index = cur ? parent.children.indexOf(cur) + 1 : parent.children.length;
  let top;
  // each note named from its title and written once; each folder's order written once, at the end
  const orders = new Set();
  const make = async (par, idx, node) => {
    let lines = null;
    if (node.lines) {
      for (const ln of node.lines) for (const r of ln.runs) {
        if (r.img && !saved.has(r.img)) saved.set(r.img, got.pictures.get(r.img) ? await savePic(got.pictures.get(r.img), `${stem} ${r.img}`) : null);
      }
    } else lines = await NB.qtHtmlLines(node.html, pagePicture);
    const textFor = (n) => {
      if (lines) return NB.tidyNote(md.serialize(lines, { dir: n.folderParts() }), node.title);
      return node.lines.length ? md.serialize(W.toNoteLines(node.lines, (name) => saved.get(name)), { dir: n.folderParts() })
        : node.title + "\n";
    };
    // the title the text will give it (its name), worked out as the laptop does
    const probe = textFor({ folderParts: () => par.childParts() });
    const n = await S.store.addNote(par, idx, md.titleOf(probe) || node.title || "Untitled", textFor);
    orders.add(par);
    done++;
    if (done % 3 === 0 || done === total) { say(`Importing ${file.name}: ${done} of ${total} notes`); await breathe(); }
    for (const c of node.children) await make(n, n.children.length, c);
    return n;
  };
  const onWrite = S.store.onWrite;
  S.store.onWrite = null;
  try {
    await queue(async () => {
      top = await make(parent, index, { title: stem, lines: [], children: got.tree });
      say(`Importing ${file.name}: putting them in order…`);
      for (const par of orders) await S.store.writeOrder(par);
    });
  } finally { S.store.onWrite = onWrite; }
  if (onWrite) onWrite(top);
  S.settings.expanded = [...new Set([...S.settings.expanded, top.key()])];
  await openNote(top);
  updateCount();
  toast(`Imported ${NB.count(got.tree)} notes from ${file.name}`);
  return top;
}

// ------------------------------------------------------------------ a NobleNote folder, brought in as notes
// The folder is only read: each notebook (folder) becomes a note with its notes under it, all under one
// note named after the folder, placed after the open note. Empty notes and non-notes are left out.
async function importNoble(dir = null) {
  await flushSave();
  if (!dir) {
    if (!window.showDirectoryPicker) { dialog("Import a NobleNote Folder", "This browser can't open a folder. Ross Note needs Chrome or Edge."); return null; }
    S.picking = true;
    try { dir = await window.showDirectoryPicker({ id: "noblenote", mode: "read" }); } catch (e) {
      if (e && e.name !== "AbortError") dialog("Import a NobleNote Folder", "Couldn't open that folder: " + (e.message || e));
      return null;
    } finally { setTimeout(() => { S.picking = false; }, 1500); }
  }
  return busy("Looking in “" + dir.name + "”…", (say) => importNobleNow(dir, say), { after: 0 });
}

async function importNobleNow(dir, say) {
  const NB = await import("./notebooks.js?v=1.6.8");
  let got;
  try { got = await NB.readNobleFolder(dir, (k) => say(`Reading “${dir.name}”: ${k} notes…`)); } catch (e) {
    dialog("Import a NobleNote Folder", "Couldn't read that folder: " + (e.message || e));
    return null;
  }
  const notes = (t) => t.reduce((a, n) => a + (n.folder ? 0 : 1) + notes(n.children), 0);
  const total = NB.count(got.tree);
  if (!notes(got.tree)) {
    dialog("Import a NobleNote Folder", `There are no notes in “${dir.name}”.\n\nChoose NobleNote's notes folder ` +
      "(usually called nobleNote): the one that holds a folder for each notebook.");
    return null;
  }
  const cur = S.note;
  const parent = cur ? cur.parent : S.store.root;
  const index = cur ? parent.children.indexOf(cur) + 1 : parent.children.length;
  const orders = new Set();
  const conflicts = [];
  let done = 0;
  const make = async (par, idx, node) => {
    let textFor;
    if (node.html != null) {
      const lines = await NB.qtHtmlLines(node.html, async () => null, { pre: true, webPictures: true, relative: true });
      textFor = (n) => NB.tidyNote(md.serialize(lines, { dir: n.folderParts() }), "");
    } else if (node.text != null) textFor = () => NB.tidyNote(node.text.replace(/\r\n?/g, "\n"), "");
    else textFor = () => "";
    // its name as its first line; a name Ross Note would read as something else (“1. Digger…”, a list) as a heading
    const body = textFor;
    const head = md.titleOf(node.title) === node.title.trim() ? node.title.trim() : "# " + node.title.trim();
    textFor = (n) => { const t = body(n).replace(/[\u00a0\u202f]/g, " ").replace(/^\n+/, ""); return md.titleOf(t) === node.title.trim() ? t : head + "\n" + t; };
    const name = md.titleOf(textFor({ folderParts: () => par.childParts() })) || node.title || "Untitled";
    const n = await S.store.addNote(par, idx, name, textFor);
    orders.add(par);
    if (/\(conflict \d{4}-\d\d-\d\d/i.test(node.title)) conflicts.push(n);
    done++;
    if (done % 3 === 0 || done === total + 1) { say(`Importing “${dir.name}”: ${done} of ${total + 1} notes`); await breathe(); }
    for (const c of node.children) await make(n, n.children.length, c);
    return n;
  };
  let top;
  const title = /^noblenote$/i.test(dir.name) ? "NobleNote" : dir.name;
  const onWrite = S.store.onWrite;
  S.store.onWrite = null;
  try {
    await queue(async () => {
      top = await make(parent, index, { title, children: got.tree });
      say(`Importing “${dir.name}”: putting them in order…`);
      for (const par of orders) await S.store.writeOrder(par);
    });
  } finally { S.store.onWrite = onWrite; }
  if (onWrite) onWrite(top);
  S.settings.expanded = [...new Set([...S.settings.expanded, top.key()])];
  await openNote(top);
  updateCount();
  const n = notes(got.tree), nb = total - n;
  dialog("Import a NobleNote Folder", `Imported ${n} note${n === 1 ? "" : "s"}` + (nb ? ` in ${nb} notebook${nb === 1 ? "" : "s"}` : "") +
    ` under “${top.title()}”.` +
    (got.skipped.empty ? `\n\n${got.skipped.empty} empty note${got.skipped.empty === 1 ? " was" : "s were"} left out.` : "") +
    (got.skipped.other ? `\n\n${got.skipped.other} other file${got.skipped.other === 1 ? "" : "s"} or folder${got.skipped.other === 1 ? "" : "s"} (settings, backups, programs) left out.` : "") +
    (conflicts.length ? `\n\n${conflicts.length} note${conflicts.length === 1 ? " is a" : "s are"} sync-conflict cop${conflicts.length === 1 ? "y" : "ies"} (“conflict” in the name): ` +
      "compare each with its namesake and keep the one you want." : "") +
    "\n\nThe NobleNote folder itself isn't changed.");
  return top;
}

// ------------------------------------------------------------------ a Ross Writer project, brought in as notes
// The project's folder is only read: its chapters and scenes become notes (a note named after the project,
// the chapters under it, their scenes under them), each scene's words and pictures from its Word file.
async function chooseProjectFolder() {
  if (!window.showDirectoryPicker) {
    dialog("Import a Ross Writer Project", "This browser can't open a folder. Ross Note needs Chrome or Edge.");
    return null;
  }
  S.picking = true;
  let dir;
  try { dir = await window.showDirectoryPicker({ id: "rwproject", mode: "read" }); } catch (e) {
    if (e && e.name !== "AbortError") dialog("Import a Ross Writer Project", "Couldn't open that folder: " + (e.message || e));
    return null;
  } finally { setTimeout(() => { S.picking = false; }, 1500); }
  return dir;
}

async function importProject(dir = null, opts = null) {
  await flushSave();
  dir = dir || await chooseProjectFolder();
  if (!dir) return null;
  const RW = await busy("Looking in “" + dir.name + "”…", () => import("./rwimport.js?v=1.6.8"), { after: 0 });
  let names;
  try { names = await busy("Looking in “" + dir.name + "”…", () => RW.projectFiles(dir), { after: 0 }); } catch (e) {
    dialog("Import a Ross Writer Project", "Couldn't look in that folder: " + (e.message || e));
    return null;
  }
  if (!names.length) {
    dialog("Import a Ross Writer Project", `There's no Ross Writer project in “${dir.name}”.\n\nChoose the project's own ` +
      "folder: the one that holds the project's .rwproj file and its Scenes folder.");
    return null;
  }
  let fileName = names[0];
  if (names.length > 1 && !opts) {
    const box = document.createElement("div");
    box.className = "choose";
    names.forEach((n, k) => {
      const l = document.createElement("label");
      l.innerHTML = `<input type="radio" name="proj" value="${k}"${k ? "" : " checked"}> `;
      l.append(n.replace(/\.rwproj$/i, ""));
      box.appendChild(l);
    });
    if (!await ask("Which Project?", box, [["Next", "go", true]])) return null;
    fileName = names[+box.querySelector("input:checked").value];
  }
  let data;
  try { data = await RW.readProject(dir, fileName); } catch (e) {
    dialog("Import a Ross Writer Project", `Couldn't read “${fileName}”: ${e.message || e}`);
    return null;
  }
  const title = (data.title || fileName.replace(/\.rwproj$/i, "")).trim() || "Ross Writer project";
  const total = RW.countEntries(data.nodes);
  if (!opts) {
    const box = document.createElement("div");
    box.className = "choose";
    const p = document.createElement("p");
    p.textContent = `“${title}”: ${total} entr${total === 1 ? "y" : "ies"}. They come in as notes under a note named ` +
      "after the project, chapters with their scenes under them. The project itself isn't changed.";
    box.appendChild(p);
    const group = (name, items) => {
      const h = document.createElement("div");
      h.className = "lab";
      h.textContent = items[0];
      box.appendChild(h);
      items.slice(1).forEach(([value, label], k) => {
        const l = document.createElement("label");
        l.innerHTML = `<input type="radio" name="${name}" value="${value}"${k ? "" : " checked"}> `;
        l.append(label);
        box.appendChild(l);
      });
    };
    group("split", ["Scenes", ["whole", "Each scene as one note"], ["split", "Split scenes at their headings (a note for each heading, under the scene)"]]);
    group("comments", ["Ross Writer's comments", ["text", "Bring them in as text, at the end of each note"], ["none", "Leave them out"]]);
    if (!await ask("Import a Ross Writer Project", box, [["Import", "go", true]])) return null;
    opts = { split: box.querySelector('input[name="split"]:checked').value === "split",
      comments: box.querySelector('input[name="comments"]:checked').value === "text" };
  }
  return busy(`Importing “${title}”…`, (say) => importProjectNow(RW, dir, data, title, total, opts, say), { after: 0 });
}

async function importProjectNow(RW, dir, data, title, total, opts, say) {
  const W = await wordModule();
  const T = (t, f = []) => ({ t, f: new Set(f) });
  const plain = (t) => ({ kind: null, depth: 1, code: false, runs: [T(t)] });
  const textOf = (ln) => ln.runs.filter((r) => !r.img).map((r) => r.t).join("").trim();
  const cur = S.note;
  const parent = cur ? cur.parent : S.store.root;
  const index = cur ? parent.children.indexOf(cur) + 1 : parent.children.length;
  const orders = new Set();
  let done = 0, missing = 0, comments = 0;
  const add = async (par, idx, lines, picture) => {
    const textFor = (n) => md.serialize(W.toNoteLines(lines, picture), { dir: n.folderParts() });
    const name = md.titleOf(textFor({ folderParts: () => par.childParts() })) || "Untitled";
    const n = await S.store.addNote(par, idx, name, textFor);
    orders.add(par);
    return n;
  };
  const entry = async (par, raw) => {
    const name = String(raw.title || "Untitled").trim() || "Untitled";
    const head = plain(name);
    let lines = [], media = new Map(), cs = [];
    if (raw.pdf) lines = [plain(""), plain("A PDF in Ross Writer: " + String(raw.pdf).split(/[\\/]/).pop())];
    else {
      const buf = await RW.sceneBytes(dir, raw);
      if (buf) {
        try {
          const got = await W.readDocx(buf);
          lines = got.lines;
          media = got.media;
          if (opts.comments) cs = await RW.readComments(buf);
        } catch (e) { lines = [plain(""), plain("(Its Word file couldn't be read: " + (e.message || e) + ")")]; }
      } else if (raw.file) {
        missing++;
        lines = [plain(""), plain("(Its Word file, " + raw.file + ", wasn't in the project folder.)")];
      }
    }
    // a scene that starts with its own title as a heading: not twice
    const firstText = lines.findIndex((ln) => textOf(ln) || ln.runs.some((r) => r.img));
    if (firstText >= 0 && textOf(lines[firstText]).toLowerCase() === name.toLowerCase() &&
        lines[firstText].kind && lines[firstText].kind[0] === "h") lines = lines.slice(firstText + 1);
    // its pictures, into Pictures
    const saved = new Map();
    for (const [pname, bytes] of media) {
      const ext = pname.split(".").pop().toLowerCase();
      const type = { png: "image/png", gif: "image/gif", bmp: "image/bmp", webp: "image/webp" }[ext] || "image/jpeg";
      const [blob, nm] = await preparePicture(new File([bytes], `${md.safeName(name)} ${pname}`, { type }));
      saved.set(pname, await S.store.savePicture(blob, nm));
    }
    const picture = (p) => saved.get(p);
    comments += cs.length;
    // split at the headings: the scene's opening, then a note for each heading
    let own = lines, secs = [];
    if (opts.split) {
      const sp = W.splitSections(lines);
      if (sp.secs.length) { own = sp.pre; secs = sp.secs; }
    }
    // each comment goes with the part its words are in; a reply goes with the comment it answers
    const forOwn = [], forSec = secs.map(() => []);
    let last = forOwn;
    for (const c of cs) {
      if (c.reply) { last.push(c); continue; }
      const k = c.words ? secs.findIndex((sec) => sec.map(textOf).join(" ").includes(c.words.slice(0, 40))) : -1;
      last = k >= 0 ? forSec[k] : forOwn;
      last.push(c);
    }
    const n = await add(par, par.children.length, [head, ...own, ...RW.commentLines(forOwn)], picture);
    done++;
    if (done % 2 === 0 || done === total) { say(`Importing “${data.title || "the project"}”: ${done} of ${total}`); await breathe(); }
    for (let k = 0; k < secs.length; k++) await add(n, n.children.length, [...secs[k], ...RW.commentLines(forSec[k])], picture);
    for (const c of raw.children || []) if (c && typeof c === "object") await entry(n, c);
    return n;
  };
  let top;
  const onWrite = S.store.onWrite;
  S.store.onWrite = null;
  try {
    await queue(async () => {
      const when = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
      top = await add(parent, index, [plain(title), plain(""),
        plain(`Brought in from the Ross Writer project “${title}” on ${when}. Editing these notes doesn't change the project.`)], () => null);
      for (const raw of data.nodes) if (raw && typeof raw === "object") await entry(top, raw);
      say(`Importing “${title}”: putting them in order…`);
      for (const par of orders) await S.store.writeOrder(par);
    });
  } finally { S.store.onWrite = onWrite; }
  if (onWrite) onWrite(top);
  S.settings.expanded = [...new Set([...S.settings.expanded, top.key(), ...top.children.map((c) => c.key())])];
  await openNote(top);
  updateCount();
  toast(`Imported “${title}”: ${done} entr${done === 1 ? "y" : "ies"}` + (comments ? `, ${comments} comment${comments === 1 ? "" : "s"}` : "") +
    (missing ? ` (${missing} Word file${missing === 1 ? "" : "s"} missing)` : ""), 6000);
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
    await S.store.readAll(notes);
    for (const n of notes) {
      const text = n.text;
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

async function wordBlob(notes, pages, name, parts = null) {
  parts = parts || await joinedParts(notes, []);
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
  return W.writeDocx(lines, bytes, name);
}

// ------------------------------------------------------------------ Word copies (as the laptop keeps them)
// RossNotes/Word Copies/<the note's place>.docx: the note and the notes under it, as Export as Word
// makes them; the same file each time, so your sync app carries the latest to the laptop and Drive
async function updateWordCopy(note = null, quiet = false) {
  const n = note || S.note;
  if (!n) return null;
  return busy(quiet ? "Updating the Word copy of “" + n.title() + "”…" : "Saving the Word copy…",
    () => updateWordCopyNow(n, quiet), { after: quiet ? 800 : 0, quiet });
}

async function updateWordCopyNow(n, quiet) {
  if (!quiet) await flushSave();
  const notes = [n, ...n.walk()];
  const parts = await joinedParts(notes, []);
  const blob = await wordBlob(notes, !!S.settings.newPages, md.safeName(n.title()), parts);
  const where = await queue(() => S.store.writeWordCopy(n, blob));
  if (!quiet) toast("Word copy saved: " + where);
  return where;
}

const wordDue = new Set();
let wordTimer = 0;
// a note was saved: its Word copy, and those of the notes it's under, follow (after a pause)
async function wordSoon(note) {
  if (S.settings.wordAuto === false) return;
  for (const x of [note, ...note.ancestors()]) if (await S.store.hasWordCopy(x)) wordDue.add(x.key());
  if (wordDue.size) { clearTimeout(wordTimer); wordTimer = setTimeout(wordFlush, 2000); }
}

async function wordFlush() {
  clearTimeout(wordTimer);
  if (!S.store) return;
  const due = [...wordDue].sort();
  wordDue.clear();
  for (const k of due) {
    const n = S.store.find(k);
    if (n) { try { await updateWordCopy(n, true); } catch (e) { console.error(e); } }
  }
}

async function exportNotes(kind) {
  if (!S.note) return null;
  await flushSave();
  const label = { word: "Export as Word", pdf: "Export as PDF", md: "Export as Markdown" }[kind];
  const got = await chooseNotes(label, kind !== "md");
  if (!got) return null;
  const { notes, pages } = got;
  const name = md.safeName(notes.length === 1 ? notes[0].title() : notes[0].title());
  const parts = await busy(`Gathering ${notes.length} note${notes.length === 1 ? "" : "s"}…`, () => joinedParts(notes, []));
  if (kind === "md") {
    const blob = new Blob([parts.map(([, t]) => t).join("\n")], { type: "text/markdown" });
    const saved = await saveFile(blob, name + ".md", "Markdown", ".md", "text/markdown");
    if (saved) toast("Saved " + saved);
    return saved;
  }
  if (kind === "word") {
    const blob = await busy("Making the Word document…", () => wordBlob(notes, pages, name, parts), { after: 0 });
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

// ------------------------------------------------------------------ email and sharing
async function noteForEmail() {
  const W = await wordModule();
  return { W, title: titleNow(), lines: W.fromNoteLines(ed.readLines(page)) };
}

async function shareNote() {
  if (!S.note) return null;
  await flushSave();
  const p = document.createElement("div");
  p.textContent = "Send “" + titleNow() + "” by email or another app (Android's share panel opens), or copy it " +
    "with its formatting to paste into an email.";
  const how = await ask("Email or Share", p, [["As the message", "text", true], ["As a Word document", "word"],
    ["Copy with formatting", "copy"]]);
  if (how === "text") return shareText();
  if (how === "word") return shareWord();
  if (how === "copy") return copyForEmail();
  return null;
}

async function shareText() {
  const { W, title, lines } = await noteForEmail();
  const text = W.plainText(lines);
  if (navigator.share) {
    try { await navigator.share({ title, text }); return "shared"; } catch (e) {
      if (e && e.name === "AbortError") return null;
    }
  }
  // no share panel here: a new email in the mail app
  location.href = "mailto:?subject=" + encodeURIComponent(title) + "&body=" + encodeURIComponent(text.replace(/\n/g, "\r\n"));
  return "mailto";
}

async function copyForEmail() {
  const { W, title, lines } = await noteForEmail();
  try {
    await navigator.clipboard.write([new ClipboardItem({
      "text/html": new Blob([W.htmlText(lines)], { type: "text/html" }),
      "text/plain": new Blob([W.plainText(lines)], { type: "text/plain" }),
    })]);
    toast(`“${title}” copied, with its formatting: paste it into an email.`);
    return true;
  } catch (e) {
    toast("Couldn't copy here: use Email or Share instead.");
    return false;
  }
}

async function shareWord() {
  const got = await chooseNotes("Share as a Word Document", true);
  if (!got) return null;
  const { notes, pages } = got;
  const name = md.safeName(notes[0].title());
  const blob = await busy("Making the Word document…", () => wordBlob(notes, pages, name), { after: 0 });
  const file = new File([blob], name + ".docx", { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    // a fresh tap, so Android lets the share panel open
    const p = document.createElement("div");
    p.textContent = `“${file.name}” is ready.`;
    if (await ask("Share as a Word Document", p, [["Share", "go", true]])) {
      try { await navigator.share({ files: [file], title: name }); return "shared"; } catch (e) {
        if (e && e.name === "AbortError") return null;
      }
    }
    return null;
  }
  const saved = await saveFile(blob, file.name, "Word document", ".docx", blob.type);
  if (saved) toast("Saved " + saved + " (this browser can't share files): attach it to an email from there.");
  return saved;
}

// ------------------------------------------------------------------ find and replace in the note you're in
const FB = { text: $("find-text"), repl: $("find-repl"), count: $("find-count"), case: $("find-case"), whole: $("find-whole") };
let replaceUndo = null;

function openFind(replace) {
  $("findbar").hidden = false;
  fitScope();
  const show = replace || (!$("find-repl").hidden && !$("findbar").dataset.closed);
  for (const id of ["find-repl", "find-one", "find-all"]) $(id).hidden = !show;
  delete $("findbar").dataset.closed;
  const sel = window.getSelection();
  const t = sel.rangeCount && page.contains(sel.anchorNode) ? sel.toString() : "";
  if (t && !t.includes("\n") && t.length < 100) FB.text.value = t;
  (replace && FB.text.value ? FB.repl : FB.text).focus();
  if (!replace || !FB.text.value) FB.text.select();
  findRefresh();
}

function closeFind() {
  const ms = findAll();
  $("findbar").hidden = true;
  page.focus();
  if (findCur >= 0 && ms[findCur]) selectMatch(ms[findCur]);   // the caret at the word you found
  if (window.CSS && CSS.highlights) CSS.highlights.delete("find-current");
  $("findbar").dataset.closed = "1";
  if (window.CSS && CSS.highlights) CSS.highlights.delete("find");
  page.focus();
}

// Word's codes: ^p a paragraph mark (a line's end), ^t a tab, ^^ a ^
function codes(t) {
  let out = "";
  for (let k = 0; k < t.length; k++) {
    if (t[k] === "^" && k + 1 < t.length && "pPtT^".includes(t[k + 1])) {
      out += { p: "\n", t: "\t", "^": "^" }[t[k + 1].toLowerCase()];
      k++;
    } else out += t[k];
  }
  return out;
}

function findRegex() {
  const t = codes(FB.text.value);
  if (!t) return null;
  let src = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (FB.whole.checked) src = "(?<![\\p{L}\\p{N}])" + src + "(?![\\p{L}\\p{N}])";
  return new RegExp(src, "gu" + (FB.case.checked ? "" : "i"));
}

// the page's words, a line's end as "\n", and where each line starts
function pageText() {
  const lines = [...page.children];
  const starts = [];
  let at = 0;
  const parts = lines.map((d) => { const t = ed.lineText(d); starts.push(at); at += t.length + 1; return t; });
  return { lines, starts, text: parts.join("\n") };
}

function pointOf(pt, off) {
  let i = 0;
  while (i + 1 < pt.starts.length && pt.starts[i + 1] <= off) i++;
  return { line: i, pos: off - pt.starts[i] };
}

// every match: {a: {line, pos}, b: {line, pos}, start, end} (a match can run over a line's end)
function findAll() {
  const re = findRegex();
  const out = [];
  if (!re) return out;
  const pt = pageText();
  let m;
  re.lastIndex = 0;
  while ((m = re.exec(pt.text))) {
    if (!m[0].length) { re.lastIndex++; continue; }
    out.push({ a: pointOf(pt, m.index), b: pointOf(pt, m.index + m[0].length), start: m.index, end: m.index + m[0].length });
  }
  return out;
}

function rangeOf(m) {
  const lines = [...page.children];
  const r = document.createRange();
  const [n1, o1] = ed.pointAt(lines[m.a.line], m.a.pos);
  const [n2, o2] = ed.pointAt(lines[m.b.line], m.b.pos);
  r.setStart(n1, o1);
  r.setEnd(n2, o2);
  return r;
}

let findCur = -1;      // which match is the current one (marked; selected in the page when you go to the page)

function findFrom() {
  const c = ed.caret(page);
  if (!c) return 0;
  const pt = pageText();
  return (pt.starts[c.a.line] || 0) + c.a.pos;
}

function findRefresh(jump = false) {
  if ($("findbar").hidden) return [];
  const ms = findAll();
  if (jump) {
    const at = findFrom();
    findCur = ms.length ? Math.max(0, ms.findIndex((m) => m.start >= at)) : -1;
  } else if (findCur >= ms.length) findCur = ms.length ? 0 : -1;
  findMark(ms);
  if (jump && findCur >= 0) showMatch(ms[findCur]);
  return ms;
}

function findMark(ms) {
  if (window.CSS && CSS.highlights && window.Highlight) {
    try {
      CSS.highlights.set("find", new Highlight(...ms.slice(0, 5000).map(rangeOf)));
      if (findCur >= 0 && ms[findCur]) CSS.highlights.set("find-current", new Highlight(rangeOf(ms[findCur])));
      else CSS.highlights.delete("find-current");
    } catch (e) { /* no marks */ }
  }
  FB.count.textContent = !FB.text.value ? "" : findCur >= 0 && ms.length ? `${findCur + 1} of ${ms.length}` : "Not found";
  FB.text.classList.toggle("none", !!FB.text.value && !ms.length);
}

// scrolled to, without taking the caret from where you're typing
function showMatch(m) {
  const div = page.children[m.a.line];
  const sc = div && div.closest(".scroller");
  if (!sc) return;
  const top = div.getBoundingClientRect().top - sc.getBoundingClientRect().top;
  if (top < 0 || top > sc.clientHeight - 40) sc.scrollTop += top - sc.clientHeight / 3;
}

function selectMatch(m) {
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(rangeOf(m));
  showMatch(m);
}

function findGo(back) {
  if ($("findbar").hidden || !FB.text.value) { openFind(false); return; }
  const ms = findAll();
  if (!ms.length) { findCur = -1; findMark(ms); return; }
  if (findCur < 0) findCur = 0;
  else findCur = (findCur + (back ? ms.length - 1 : 1)) % ms.length;
  findMark(ms);
  if (document.activeElement === page) selectMatch(ms[findCur]); else showMatch(ms[findCur]);
}

// a match replaced in the page itself: lines joined where a line's end is taken out (the first line's
// kind stays), a new line (of the same kind, as Enter) for each ^p in the new words. Like the laptop.
function replaceRange(m, text) {
  const lines = [...page.children];
  const A = lines[m.a.line], B = lines[m.b.line];
  const r = rangeOf(m);
  r.deleteContents();
  if (A !== B) {
    for (const x of [...lines.slice(m.a.line + 1, m.b.line)]) if (x.parentNode) x.remove();
    for (const br of A.querySelectorAll("br")) br.remove();
    for (const br of B.querySelectorAll("br")) br.remove();
    while (B.firstChild) A.appendChild(B.firstChild);
    B.remove();
  }
  let div = A;
  let pos = m.a.pos;
  text.split("\n").forEach((part, k) => {
    if (k) {
      // a new line from here, as Enter makes it
      const [n, o] = ed.pointAt(div, pos);
      const tail = document.createRange();
      tail.setStart(n, o);
      tail.setEnd(div, div.childNodes.length);
      const frag = tail.extractContents();
      const nl = document.createElement("div");
      nl.className = "ln";
      for (const key of ["kind", "mark", "code"]) if (div.dataset[key] != null) nl.dataset[key] = div.dataset[key];
      if (div.dataset.code) nl.dataset.raw = "";
      nl.appendChild(frag);
      div.after(nl);
      div = nl;
      pos = 0;
    }
    if (part) {
      const [n, o] = ed.pointAt(div, pos);
      if (n.nodeType === 3) n.insertData(o, part);
      else {
        const t = document.createTextNode(part);
        const rr = document.createRange();
        rr.setStart(n, o);
        rr.insertNode(t);
      }
      pos += part.length;
    }
  });
  for (const d of [A, div]) {
    if (!d.parentNode) continue;
    for (const el of [...d.querySelectorAll("*")]) {
      if (el.tagName !== "IMG" && el.tagName !== "BR" && !el.textContent && !el.querySelector("img")) el.remove();
    }
    if (!ed.lineText(d)) { if (!d.querySelector("br")) d.appendChild(document.createElement("br")); }
    else for (const br of d.querySelectorAll("br")) br.remove();
  }
  return { line: page.children.length ? [...page.children].indexOf(div) : 0, pos };
}

function replaceOne() {
  const ms = findAll();
  if (findCur < 0 || !ms[findCur]) { findGo(false); return; }
  const m = ms[findCur];
  const back = document.activeElement;
  const text = codes(FB.repl.value);
  let after;
  if (m.a.line === m.b.line && !text.includes("\n")) {
    selectMatch(m);
    page.focus();
    document.execCommand("insertText", false, text);   // keeps the words' formatting; Undo as usual
    after = m.start + text.length;
    afterEdit();
  } else {
    const before = page.innerHTML;
    replaceRange(m, text);
    ed.tidy(page);
    replaceUndo = { page, before, after: page.innerHTML };
    ed.relayout(page);
    changed();
    after = m.start + text.length;
  }
  // the next one: the first match after the replaced words
  const ms2 = findAll();
  findCur = ms2.length ? ms2.findIndex((x) => x.start >= after) : -1;
  if (findCur < 0 && ms2.length) findCur = 0;
  findMark(ms2);
  if (findCur >= 0) showMatch(ms2[findCur]);
  if (back && back !== page && back.focus) back.focus();
}

function replaceAll() {
  const ms = findAll();
  if (!ms.length) return 0;
  const before = page.innerHTML;
  const text = codes(FB.repl.value);
  for (const m of [...ms].reverse()) replaceRange(m, text);   // from the end, so the places before stay right
  ed.tidy(page);
  replaceUndo = { page, before, after: page.innerHTML };
  ed.relayout(page);
  changed();
  findCur = -1;
  findRefresh();
  FB.count.textContent = `Replaced ${ms.length}`;
  toast(`Replaced ${ms.length}`);
  return ms.length;
}

// Undo straight after Replace All: everything back as it was
function undoReplaceAll() {
  if (!replaceUndo || replaceUndo.page !== page || page.innerHTML !== replaceUndo.after) { replaceUndo = null; return false; }
  page.innerHTML = replaceUndo.before;
  replaceUndo = null;
  ed.relayout(page);
  changed();
  findRefresh();
  return true;
}

$("find-prev").onclick = () => findGo(true);
$("find-next").onclick = () => findGo(false);
$("find-one").onclick = replaceOne;
$("find-all").onclick = replaceAll;
$("find-close").onclick = closeFind;
for (const id of ["find-prev", "find-next", "find-one", "find-all", "find-close"]) $(id).addEventListener("mousedown", (e) => e.preventDefault());
FB.text.addEventListener("input", () => findRefresh(true));
FB.case.addEventListener("change", () => findRefresh());
FB.whole.addEventListener("change", () => findRefresh());
FB.text.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); findGo(e.shiftKey); } });
FB.repl.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); replaceOne(); } });
let findTimer = 0;
for (const p of P) p.page.addEventListener("input", () => { clearTimeout(findTimer); findTimer = setTimeout(() => findRefresh(), 250); });

// (1.6 has only the notes: one place)
function placeId() { return "notes"; }
// ================================================================== 1.8.0
// ------------------------------------------------------------------ the word count, lower right
// The note (or the selection), and in a Ross Writer project its chapter and the whole project. Click it for more.
const wcCache = new WeakMap();   // note -> [text, words] (the notes not on screen are counted once, until they change)
function wordsOfNote(n) {
  for (const p of P) if (p.note === n) return wordsIn(pageWords(p.page));
  const t = n.text || "";
  const had = wcCache.get(n);
  if (had && had[0] === t) return had[1];
  const plain = md.parse(t).map((ln) => ln.runs.map((r) => (r.img ? "" : r.t)).join("")).join("\n").split(md.OBJ).join("");
  const w = wordsIn(plain);
  wcCache.set(n, [t, w]);
  return w;
}
const fmt = (k) => k.toLocaleString("en");
function cornerFigures() {
  const p = A, n = p.note;
  if (!n) return null;
  const text = pageWords(p.page);
  const words = wordsIn(text);
  const out = { note: n, words, chars: text.replace(/\n/g, "").length, charsNoSpaces: text.replace(/\s/g, "").length,
    paras: [...p.page.children].filter((d) => ed.lineText(d).trim()).length, sel: null };
  const sel = window.getSelection();
  if (sel.rangeCount && !sel.isCollapsed && p.page.contains(sel.anchorNode)) {
    const t = sel.toString().split(md.OBJ).join("").split("​").join("");
    if (t.trim()) out.sel = wordsIn(t);
  }
  if (S.store && S.store.isProject && !S.store.isDoc) {
    const anc = n.ancestors();
    const top = anc.length ? anc[anc.length - 1] : n;
    if (top !== n || n.children.length) { out.chapter = top; out.chapterWords = [top, ...top.walk()].reduce((s, x) => s + wordsOfNote(x), 0); }
    out.project = S.store.all().reduce((s, x) => s + wordsOfNote(x), 0);
  } else if (n.children.length) out.branch = [n, ...n.walk()].reduce((s, x) => s + wordsOfNote(x), 0);
  return out;
}
function updateCorner() {
  const el = $("wc");
  const f = cornerFigures();
  if (!f) { el.textContent = ""; return; }
  el.textContent = "";
  const main = document.createElement("b");
  main.textContent = f.sel != null ? `${fmt(f.sel)} of ${fmt(f.words)} words` : `${fmt(f.words)} word${f.words === 1 ? "" : "s"}`;
  el.appendChild(main);
  const more = [];
  if (f.chapter && f.chapter !== f.note) more.push(`chapter ${fmt(f.chapterWords)}`);
  if (f.project != null) more.push(`project ${fmt(f.project)}`);
  if (f.branch != null) more.push(`with the notes under it ${fmt(f.branch)}`);
  if (more.length) {
    const m = document.createElement("span");
    m.className = "more";
    m.textContent = "  ·  " + more.join("  ·  ");
    el.appendChild(m);
  }
}
$("wc").onclick = () => {
  const f = cornerFigures();
  if (!f) return;
  const rows = [[`“${f.note.title()}”`, ""], ["Words", fmt(f.words)], ["Characters", fmt(f.chars)],
    ["Characters (no spaces)", fmt(f.charsNoSpaces)], ["Paragraphs", fmt(f.paras)]];
  if (f.sel != null) rows.push(["Selected", fmt(f.sel) + " words"]);
  if (f.branch != null) rows.push(["With the notes under it", fmt(f.branch) + " words"]);
  if (f.chapter && f.chapter !== f.note) rows.push([`The chapter, “${f.chapter.title()}”`, fmt(f.chapterWords) + " words"]);
  if (f.project != null) rows.push([`The project, “${S.store.label}”`, fmt(f.project) + " words"]);
  dialog("Word Count", rows.map(([a, b]) => (b ? `${a}: ${b}` : a)).join("\n"));
};
document.addEventListener("selectionchange", () => wordsSoon());

// ------------------------------------------------------------------ right-click in a page
// Spelling suggestions (on a misspelt word), Cut, Copy, Paste, and Comment… (in Word documents and scenes)
let lastPointer = "mouse", lastPointerAt = 0;
document.addEventListener("pointerdown", (e) => { lastPointer = e.pointerType || "mouse"; lastPointerAt = Date.now(); }, true);

function caretAtPoint(x, y) {
  const pos = document.caretPositionFromPoint ? document.caretPositionFromPoint(x, y) : null;
  if (pos) return { node: pos.offsetNode, off: pos.offset };
  const cr = document.caretRangeFromPoint ? document.caretRangeFromPoint(x, y) : null;
  return cr ? { node: cr.startContainer, off: cr.startOffset } : null;
}

async function pasteFromClipboard(plain) {
  let html = "", text = "";
  try {
    if (!plain && navigator.clipboard.read) {
      for (const item of await navigator.clipboard.read()) {
        if (item.types.includes("text/html")) html = await (await item.getType("text/html")).text();
        if (item.types.includes("text/plain")) text = await (await item.getType("text/plain")).text();
      }
    } else text = await navigator.clipboard.readText();
  } catch (e) { toast("The browser didn't allow pasting from here: use Ctrl+V" + (plain ? " (or Ctrl+Alt+Shift+V)" : "") + "."); return; }
  if (readOnlyHere()) return;
  if (plain) { if (text) { insertText(text.replace(/\r?\n/g, " ")); afterEdit(); } return; }
  let lines;
  if (html && /<[a-z]/i.test(html)) lines = ed.linesFromHtml(html);
  else lines = md.parse(text || "");
  if (lines.length) { pasteLines(lines, !html && !/\n/.test((text || "").trim()) && !/[*_~=<#>[`]/.test(text || "")); }
}

function pageMenu(e, p) {
  e.preventDefault();
  if (A !== p) setActive(p);
  const sel = window.getSelection();
  const at = caretAtPoint(e.clientX, e.clientY);
  let inSel = false;
  if (sel.rangeCount && !sel.isCollapsed && at) { try { inSel = sel.getRangeAt(0).isPointInRange(at.node, at.off); } catch (err) { inSel = false; } }
  if (!inSel && at && p.page.contains(at.node)) {
    const r = document.createRange();
    r.setStart(at.node, at.off);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
  }
  const items = [];
  if (spellMode() === "ross" && spell.ready() && at && at.node.nodeType === 3) {
    const r = misspeltAt(at.node, at.off);
    if (r) {
      const word = r.toString();
      const sug = spell.suggest(word);
      for (const x of sug) items.push({ label: x, fn: () => replaceWord(r, x) });
      if (!sug.length) items.push({ label: "(no suggestions)", fn: () => {}, off: true });
      items.push({ label: "Add to Dictionary", fn: () => { spell.addOwn(word); saveDictionary(); spellSoon(0); toast(`“${word}” is in your dictionary.`); } });
      items.push({ label: "Ignore", fn: () => { spell.ignore(word); spellSoon(0); } });
      items.push("-");
    }
  }
  const has = !window.getSelection().isCollapsed;
  const ro = !!(p.note && p.note.readOnly);
  items.push({ label: "Cut", keys: "Ctrl+X", off: !has || ro, fn: () => { document.execCommand("cut"); afterEdit(); } });
  items.push({ label: "Copy", keys: "Ctrl+C", off: !has, fn: () => document.execCommand("copy") });
  items.push({ label: "Paste", keys: "Ctrl+V", off: ro, fn: () => pasteFromClipboard(false) });
  items.push({ label: "Paste as Plain Text", keys: "Ctrl+Alt+Shift+V", off: ro, fn: () => pasteFromClipboard(true) });
  items.push("-");
  if (typeof addComment === "function") {
    const canComment = !!(S.store && S.store.isProject && p.note && p.note.comments);
    items.push({ label: "Comment…", keys: "Ctrl+Alt+M", off: !canComment, fn: addComment });
  }
  items.push({ label: "Highlight", keys: "Ctrl+Shift+H", off: ro || !has, fn: COMMANDS.highlight });
  showMenu({ getBoundingClientRect: () => new DOMRect(e.clientX, e.clientY, 0, 0) }, items);
}

// ------------------------------------------------------------------ page view (Ross Writer's Ctrl+Shift+L)
function togglePageView() {
  S.settings.pageView = !S.settings.pageView;
  saveSettings();
  document.body.classList.toggle("pageview", !!S.settings.pageView);
  toast(S.settings.pageView ? "Page view: a page-wide column" : "The page fills the width", 1500);
}
document.body.classList.toggle("pageview", !!S.settings.pageView);

function switchPane() {
  if (!S.settings.split) { toast("One pane only: Ctrl+\\ or F6 splits the view."); return; }
  const q = P.find((x) => x !== A && !x.el.hidden);
  if (q) { setActive(q); q.page.focus(); }
}

function toggleSpelling() {
  S.settings.spell = spellMode() === "ross" ? "off" : "ross";
  saveSettings();
  applySpellMode();
  toast(spellMode() === "ross" ? "Spelling is checked" : "Spelling isn't checked", 1500);
}

function setSpacingTo(v) {
  S.settings.spacing = v;
  saveSettings();
  applyLook();
  toast("Line spacing " + (SPACINGS.find((x) => x[1] === v) || [v])[0], 1200);
}

// ------------------------------------------------------------------ Go To (Ctrl+G, F5): a note or a heading
function goTo() {
  const box = document.createElement("div");
  box.className = "goto";
  const inp = document.createElement("input");
  inp.type = "search";
  inp.className = "wide";
  inp.placeholder = S.store && S.store.isProject ? "A scene, a chapter or a heading…" : "A note or a heading…";
  const list = document.createElement("div");
  list.className = "golist";
  box.append(inp, list);
  const heads = [...page.children].filter((d) => /^h[1-6]$/.test(d.dataset.kind || "") && ed.lineText(d).split(md.OBJ).join("").trim());
  const all = [
    ...heads.map((d) => ({ label: "§ " + ed.lineText(d).split(md.OBJ).join("").trim(), hint: "heading in this note", go: () => {
      const sc = d.closest(".scroller"); sc.scrollTop += d.getBoundingClientRect().top - sc.getBoundingClientRect().top - 12;
      ed.setCaret(page, { a: { line: [...page.children].indexOf(d), pos: 0 }, b: { line: [...page.children].indexOf(d), pos: 0 } }); page.focus(); } })),
    ...(S.store ? S.store.all() : []).map((n) => ({ label: n.title(), hint: n.ancestors().reverse().map((a) => a.title()).join(" › "), go: () => openNote(n) })),
  ];
  let shown = [];
  const fill = () => {
    const q = inp.value.trim().toLowerCase();
    shown = (q ? all.filter((x) => x.label.toLowerCase().includes(q)) : all).slice(0, 60);
    list.textContent = "";
    shown.forEach((x, k) => {
      const b = document.createElement("button");
      b.className = "goitem" + (k ? "" : " cur");
      b.innerHTML = "<span></span><small></small>";
      b.firstChild.textContent = x.label;
      b.lastChild.textContent = x.hint;
      b.onclick = () => { $("dialog-close").click(); x.go(); };
      list.appendChild(b);
    });
  };
  inp.addEventListener("input", fill);
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && shown[0]) { e.preventDefault(); $("dialog-close").click(); shown[0].go(); }
  });
  fill();
  ask("Go To", box, []);
  inp.focus();          // at once: what you type straight after Ctrl+G goes here, not into the note
}

// ------------------------------------------------------------------ Recent (Ctrl+Shift+O)
function rememberRecent(n) {
  const s = S.settings;
  const place = placeId(S.store);
  s.recent = [{ place, key: n.key(), title: n.title() }, ...(s.recent || []).filter((r) => !(r.place === place && r.key === n.key()))].slice(0, 20);
}
function showRecent() {
  const s = S.settings;
  const place = S.store ? placeId(S.store) : "";
  const here = (s.recent || []).filter((r) => r.place === place).map((r) => ({ r, n: S.store.find(r.key) })).filter((x) => x.n);
  const box = document.createElement("div");
  box.className = "goto";
  const list = document.createElement("div");
  list.className = "golist";
  box.appendChild(list);
  const add = (label, hint, fn) => {
    const b = document.createElement("button");
    b.className = "goitem";
    b.innerHTML = "<span></span><small></small>";
    b.firstChild.textContent = label;
    b.lastChild.textContent = hint;
    b.onclick = () => { $("dialog-close").click(); fn(); };
    list.appendChild(b);
  };
  for (const { n } of here.slice(0, 15)) if (n !== S.note) add(n.title(), n.ancestors().reverse().map((a) => a.title()).join(" › "), () => openNote(n));
  if (s.lastProject && !(S.store && S.store.isProject && !S.store.isDoc && S.store.fileName === s.lastProject.file)) add(`Reopen “${s.lastProject.name}”`, "Ross Writer project", reopenProject);
  if (s.lastDoc && !(S.store && S.store.isDoc)) add(`Reopen “${s.lastDoc.name}”`, "document", reopenDoc);
  if (S.store && (S.store.isProject || S.store.isDoc)) add("My Notes", "RossNotes", backToNotes);
  if (!list.children.length) { toast("Nothing recent yet."); return; }
  ask("Recent", box, []);
  const first = list.querySelector("button");
  if (first) first.focus();
  list.addEventListener("keydown", (e) => {
    const bs = [...list.querySelectorAll("button")];
    const k = bs.indexOf(document.activeElement);
    if (e.key === "ArrowDown" && k < bs.length - 1) { e.preventDefault(); bs[k + 1].focus(); }
    if (e.key === "ArrowUp" && k > 0) { e.preventDefault(); bs[k - 1].focus(); }
  });
}

// ------------------------------------------------------------------ Find in every note, or the whole project
// List All: every match, with its words around it, in the Results panel; click one to go there.
// Replace All with "All notes" / "Whole project": every note or scene with a match is first copied (a
// snapshot: .snapshots in RossNotes; Snapshots in a project), then changed and saved; read-only scenes are left.
FB.scope = $("find-scope");
function scopeAll() { return FB.scope.value === "all" && S.store && !S.store.isDoc; }
function fitScope() {
  const o = FB.scope.querySelector('option[value="all"]');
  o.textContent = S.store && S.store.isProject && !S.store.isDoc ? "Whole project" : "All notes";
  o.disabled = !!(S.store && S.store.isDoc);
  if (o.disabled) FB.scope.value = "note";
}

const plainLine = (ln) => ln.runs.map((r) => (r.img ? md.OBJ : r.t || "")).join("");

// the matches in a note's text: [{line, a, b, before, hit, after}]
function noteMatches(text, re) {
  const out = [];
  const lines = md.parse(text || "");
  const plain = lines.map(plainLine);
  const whole = plain.join("\n");
  const starts = [];
  let at = 0;
  for (const t of plain) { starts.push(at); at += t.length + 1; }
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(whole))) {
    if (!m[0].length) { re.lastIndex++; continue; }
    let i = 0;
    while (i + 1 < starts.length && starts[i + 1] <= m.index) i++;
    // the words around it, from its own line (as Ross Writer's Search Results show them)
    const ls = starts[i], le = ls + plain[i].length;
    const s0 = Math.max(ls, m.index - 60), e0 = Math.min(le, m.index + m[0].length + 60);
    const clean = (t) => t.split(md.OBJ).join("");
    out.push({ line: i, start: m.index, end: m.index + m[0].length,
      before: (s0 > ls ? "…" : "") + clean(whole.slice(s0, m.index)),
      hit: m[0].replace(/\n/g, " ¶ "),
      after: clean(whole.slice(m.index + m[0].length, Math.max(e0, m.index + m[0].length))) + (e0 < le ? "…" : "") });
  }
  return out;
}

async function listAll() {
  if ($("findbar").hidden) openFind(false);
  const re = findRegex();
  if (!re) { FB.text.focus(); return; }
  await flushSave();
  const notes = scopeAll() ? S.store.all() : (S.note ? [S.note] : []);
  const res = [];
  let total = 0;
  for (const n of notes) {
    const text = n === S.note ? md.serialize(ed.readLines(page), { dir: n.folderParts() }) : n.text;
    const ms = noteMatches(text, re);
    if (ms.length) { res.push({ n, ms }); total += ms.length; }
  }
  showResults(res, total, notes.length);
  return total;
}

function showResults(res, total, of) {
  const el = $("results");
  el.querySelector(".rtitle").textContent = total
    ? `“${FB.text.value}”: ${fmt(total)} in ${res.length} ${S.store.isProject && !S.store.isDoc ? "entr" + (res.length === 1 ? "y" : "ies") : "note" + (res.length === 1 ? "" : "s")}`
    : `“${FB.text.value}”: not found` + (of > 1 ? ` in ${of} notes` : "");
  const list = el.querySelector(".rlist");
  list.textContent = "";
  for (const { n, ms } of res) {
    const h = document.createElement("div");
    h.className = "rnote";
    h.textContent = [...n.ancestors().reverse().map((a) => a.title()), n.title()].join(" › ") + `  (${ms.length})`;
    if (n.readOnly) { const ro = document.createElement("span"); ro.className = "ro"; ro.textContent = "  read-only"; h.appendChild(ro); }
    list.appendChild(h);
    ms.forEach((m, k) => {
      const b = document.createElement("button");
      b.className = "ritem";
      const mk = document.createElement("mark");
      mk.textContent = m.hit;
      b.append(m.before.trimStart(), mk, m.after.trimEnd());
      b.onclick = async () => {
        for (const x of list.querySelectorAll(".ritem.cur")) x.classList.remove("cur");
        b.classList.add("cur");
        if (S.note !== n) await openNote(n);
        const all = findAll();
        findCur = Math.min(k, all.length - 1);
        findMark(all);
        if (all[findCur]) { selectMatch(all[findCur]); page.focus(); }
      };
      list.appendChild(b);
    });
  }
  el.hidden = false;
}
$("results").querySelector(".rclose").onclick = () => { $("results").hidden = true; };

// a match replaced in a note's lines (its formatting from the run it starts in)
function spliceRuns(runs, a, b, rep) {
  let pos = 0;
  const out = [];
  let placed = false;
  for (const r of runs) {
    const len = r.img ? 1 : (r.t || "").length;
    const s = pos, e = pos + len;
    pos = e;
    if (e <= a || s >= b || r.img) { if (!(r.img && s >= a && e <= b)) out.push(r); continue; }
    const keepBefore = (r.t || "").slice(0, Math.max(0, a - s));
    const keepAfter = (r.t || "").slice(Math.max(0, b - s));
    const nr = { ...r, t: keepBefore + (placed ? "" : rep) + keepAfter };
    placed = true;
    if (nr.t) out.push(nr);
  }
  return out;
}

function replaceInText(text, re, rep, dir) {
  const lines = md.parse(text || "");
  let count = 0;
  for (const ln of lines) {
    const plain = plainLine(ln);
    const hits = [];
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(plain))) { if (!m[0].length) { re.lastIndex++; continue; } hits.push([m.index, m.index + m[0].length]); }
    for (const [a, b] of hits.reverse()) { ln.runs = spliceRuns(ln.runs, a, b, rep); count++; }
    if (hits.length && ln.code) ln.raw = plainLine(ln);
  }
  return [md.serialize(lines, { dir }), count];
}

const stamp = () => { const d = new Date(), z = (k) => String(k).padStart(2, "0"); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}.${z(d.getMinutes())}`; };

// a copy of a note (or a scene's Word file) before it's changed by a Replace All across notes
async function snapshot(n, when) {
  try {
    if (S.store.isProject && !S.store.isDoc && n.raw && n.raw.file) {
      const parts = String(n.raw.file).split(/[\\\\/]+/).filter(Boolean);
      let d = S.store.handle;
      for (const x of parts.slice(0, -1)) d = await d.getDirectoryHandle(x);
      const bytes = await (await (await d.getFileHandle(parts[parts.length - 1])).getFile()).arrayBuffer();
      const snaps = await S.store.handle.getDirectoryHandle("Snapshots", { create: true });
      const w = await (await snaps.getFileHandle(`${rwSafe(n.title())} ${n.raw.id} ${when}.docx`, { create: true })).createWritable();
      await w.write(bytes);
      await w.close();
    } else if (S.store.handle) {
      const snaps = await S.store.handle.getDirectoryHandle(".snapshots", { create: true });
      const w = await (await snaps.getFileHandle(`${n.key().split("/").join(" › ")} ${when}.md`, { create: true })).createWritable();
      await w.write(n.text || "");
      await w.close();
    }
    return true;
  } catch (e) { return false; }
}

async function replaceEverywhere() {
  const re = findRegex();
  if (!re) return 0;
  const rep = codes(FB.repl.value);
  if (codes(FB.text.value).includes("\n") || rep.includes("\n")) {
    dialog("Replace All", "^p (a paragraph mark) can be replaced in one note at a time: choose “This note” for that.");
    return 0;
  }
  await flushSave();
  const all = S.store.all();
  const hits = [];
  for (const n of all) {
    const ms = noteMatches(n.text, re);
    if (ms.length) hits.push({ n, k: ms.length });
  }
  const ro = hits.filter((h) => h.n.readOnly);
  const todo = hits.filter((h) => !h.n.readOnly);
  const total = todo.reduce((s, h) => s + h.k, 0);
  const kind = S.store.isProject && !S.store.isDoc ? ["scene", "scenes", "the project's Snapshots folder"] : ["note", "notes", "the .snapshots folder in RossNotes"];
  if (!todo.length) {
    dialog("Replace All", ro.length ? `Found only in read-only ${kind[1]} (${ro.map((h) => h.n.title()).join(", ")}): nothing replaced.` : "Not found.");
    return 0;
  }
  const q = document.createElement("div");
  q.textContent = `Replace ${fmt(total)} × “${FB.text.value}” with “${FB.repl.value}” in ${todo.length} ${todo.length === 1 ? kind[0] : kind[1]}?\n\n` +
    `Undo can't take this back in one go, so each ${kind[0]} is first copied to ${kind[2]}.` +
    (ro.length ? `\n\nLeft as they are (read-only): ${ro.map((h) => h.n.title()).join(", ")}.` : "");
  q.style.whiteSpace = "pre-wrap";
  if (!await ask("Replace All", q, [["Replace All", "go", true]])) return 0;
  const when = stamp();
  let done = 0, changed = 0;
  await busy("Replacing…", (say) => queue(async () => {
    for (const { n } of todo) {
      await snapshot(n, when);
      const [text, k] = replaceInText(n.text, re, rep, n.folderParts());
      if (!k) continue;
      await S.store.write(n, text);
      changed++;
      done += k;
      say(`Replacing… ${changed} of ${todo.length}`);
      // a title that changed: the note's name too (as when you type it)
      if (!S.store.isProject) {
        const title = md.titleOf(text) || "Untitled";
        if (md.safeName(title) !== n.name) {
          const old = n.key();
          if (await S.store.rename(n, title)) rekey(old, n.key());
        }
      }
    }
  }), { after: 0 });
  for (const p of P) if (p.note && todo.some((h) => h.n === p.note)) refill(p);
  for (const p of P) if (p.note) S.settings[p.k ? "open2" : "open"] = p.note.key();
  saveSettings();
  renderTree();
  updateHead();
  findRefresh();
  FB.count.textContent = `Replaced ${fmt(done)}`;
  toast(`Replaced ${fmt(done)} in ${changed} ${changed === 1 ? kind[0] : kind[1]}. The ${kind[1]} as they were are in ${kind[2]}.`, 7000);
  if (!$("results").hidden) listAll();
  return done;
}

$("find-list").onclick = listAll;
$("find-list").addEventListener("mousedown", (e) => e.preventDefault());
FB.scope.addEventListener("change", () => { if (!$("results").hidden) listAll(); });
$("find-all").onclick = () => (scopeAll() ? replaceEverywhere() : replaceAll());

// ------------------------------------------------------------------ the pop-up note (Ctrl+Alt+I)
// A small notepad over whatever you're doing, for reminders and things to do. Plain words, kept as the note
// "Reminders" at the top of your RossNotes folder, so the laptop has it too.
const PN = { el: $("popnote"), ta: $("popnote").querySelector("textarea"), timer: 0, note: null, home: null };
function popHome() { return S.notes || (S.store && !S.store.isProject ? S.store : null); }

async function popLoad() {
  const home = popHome();
  PN.home = home;
  PN.note = home ? home.find("Reminders") : null;
  let body = "";
  if (PN.note) {
    try { await home.read(PN.note); } catch (e) { /* as we had it */ }
    const lines = md.parse(PN.note.text || "").map(plainLine);
    lines.shift();
    while (lines.length && !lines[0].trim()) lines.shift();
    body = lines.join("\n");
  }
  if (document.activeElement !== PN.ta) PN.ta.value = body;
}

async function popSave() {
  clearTimeout(PN.timer);
  const home = PN.home || popHome();
  if (!home) { toast("Open your notes once first: the pop-up note is kept in the RossNotes folder."); return; }
  const lines = [{ kind: null, mark: null, runs: [{ t: "Reminders", f: new Set() }] }, { kind: null, mark: null, runs: [] },
    ...PN.ta.value.split("\n").map((t) => ({ kind: null, mark: null, runs: t ? [{ t, f: new Set() }] : [] }))];
  const text = md.serialize(lines, { dir: [] });
  await queue(async () => {
    let n = home.find("Reminders");
    if (!n) {
      n = await home.addNote(home.root, home.root.children.length, "Reminders", text);
      await home.writeOrder(home.root);
      if (S.store === home) renderTree();
    } else if (n.text !== text) await home.write(n, text);
    PN.note = n;
    for (const p of P) if (p.note === n && !p.dirty) refill(p);
  });
}

function popShow(on) {
  const s = S.settings;
  s.pop = s.pop || {};
  s.pop.open = on;
  saveSettings();
  PN.el.hidden = !on;
  if (on) {
    const r = s.pop;
    if (r.w) { PN.el.style.width = r.w + "px"; PN.el.style.height = r.h + "px"; }
    const x = r.x != null ? r.x : window.innerWidth - 360, y = r.y != null ? r.y : 130;
    PN.el.style.left = Math.max(0, Math.min(x, window.innerWidth - 120)) + "px";
    PN.el.style.top = Math.max(0, Math.min(y, window.innerHeight - 60)) + "px";
    popLoad().then(() => PN.ta.focus());
  } else popSave();
}
function togglePop() { popShow(PN.el.hidden); }
PN.ta.addEventListener("input", () => { clearTimeout(PN.timer); PN.timer = setTimeout(popSave, 800); });
PN.el.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); popShow(false); page.focus(); } });
PN.el.querySelector(".pclose").onclick = () => popShow(false);
(() => {
  const head = PN.el.querySelector(".phead");
  let drag = null;
  head.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) return;
    drag = { x: e.clientX - PN.el.offsetLeft, y: e.clientY - PN.el.offsetTop };
    head.setPointerCapture(e.pointerId);
  });
  head.addEventListener("pointermove", (e) => {
    if (!drag) return;
    PN.el.style.left = Math.max(0, Math.min(e.clientX - drag.x, window.innerWidth - 120)) + "px";
    PN.el.style.top = Math.max(0, Math.min(e.clientY - drag.y, window.innerHeight - 40)) + "px";
  });
  head.addEventListener("pointerup", () => {
    if (!drag) return;
    drag = null;
    S.settings.pop = Object.assign(S.settings.pop || {}, { x: PN.el.offsetLeft, y: PN.el.offsetTop });
    saveSettings();
    PN.ta.focus();
  });
  if (window.ResizeObserver) new ResizeObserver(() => {
    if (PN.el.hidden) return;
    S.settings.pop = Object.assign(S.settings.pop || {}, { w: PN.el.offsetWidth, h: PN.el.offsetHeight });
    saveSettings();
  }).observe(PN.el);
})();

// ------------------------------------------------------------------ the headings in the note: go to one
function showHeadings() {
  const hs = [...page.children].filter((d) => /^h[1-6]$/.test(d.dataset.kind || "") && ed.lineText(d).split(md.OBJ).join("").trim());
  const top = Math.min(...hs.map((d) => +d.dataset.kind[1]), 9);
  const items = hs.length ? hs.map((d) => ({
    label: "\u2003".repeat(+d.dataset.kind[1] - top) + ed.lineText(d).split(md.OBJ).join("").trim().slice(0, 70),
    fn: () => {
      const sc = d.closest(".scroller");
      if (sc) sc.scrollTop += d.getBoundingClientRect().top - sc.getBoundingClientRect().top - 8;
      page.focus();
      ed.placeCaret(...ed.pointAt(d, 0));
    },
  })) : [{ label: "No headings in this note", off: true, fn: () => {} }];
  showMenu(document.querySelector('[data-cmd="headings"]') || $("toolbar"), items);
}

// for the tests
// ------------------------------------------------------------------ 1.6.8: Find or Do Anything (Ctrl+K)
// every command in the menus, every note, the headings in this note, and Find in all notes: type a few letters
function commandPalette() {
  if (!$("dialog").hidden && $("dialog").querySelector(".palette")) return;
  hideMenu();
  const had = { pane: A, c: page.contains(window.getSelection().anchorNode) ? ed.caret(page) : null };
  const box = document.createElement("div");
  box.className = "goto palette";
  const inp = document.createElement("input");
  inp.type = "search";
  inp.className = "wide";
  inp.placeholder = "A command, a note or a heading…";
  inp.setAttribute("aria-label", "A command, a note or a heading");
  const list = document.createElement("div");
  list.className = "golist";
  list.setAttribute("role", "listbox");
  box.append(inp, list);
  const NAMES = { file: "File", edit: "Edit", insert: "Insert", format: "Format", notes: "Notes", view: "View", help: "Help" };
  const cmds = [];
  for (const m of MENUS_HERE) {
    let section = "";
    for (const it of menuItems(m)) {
      if (it === "-") { section = ""; continue; }
      if (typeof it === "string") { section = it; continue; }
      if (it.off || /Find or Do Anything/.test(it.label)) continue;
      const label = (section ? section + ": " : "") + it.label.replace(/…$/, "");
      cmds.push({ label, hint: NAMES[m] + (it.on ? " · on" : ""), keys: it.keys || "", kind: "cmd", go: it.fn });
    }
  }
  const heads = [...page.children].filter((d) => /^h[1-6]$/.test(d.dataset.kind || "") && ed.lineText(d).split(md.OBJ).join("").trim());
  const headItems = heads.map((d) => ({ label: "§ " + ed.lineText(d).split(md.OBJ).join("").trim(), hint: "heading in this note", kind: "head", go: () => {
    const sc = d.closest(".scroller"); sc.scrollTop += d.getBoundingClientRect().top - sc.getBoundingClientRect().top - 12;
    const k = [...page.children].indexOf(d); ed.setCaret(page, { a: { line: k, pos: 0 }, b: { line: k, pos: 0 } }); page.focus(); } }));
  const notes = (S.store ? S.store.all() : []).map((n) => ({ label: n.title(), hint: n.ancestors().reverse().map((a) => a.title()).join(" › ") || "note",
    kind: "note", go: () => openNote(n) }));
  const recent = (S.settings.recent || []).filter((r) => r.place === placeId(S.store)).map((r) => S.store.find(r.key)).filter((n) => n && n !== S.note)
    .slice(0, 5).map((n) => ({ label: n.title(), hint: "recent", kind: "note", go: () => openNote(n) }));
  let shown = [], cur = 0;
  const score = (x, words, q) => {
    const l = x.label.toLowerCase();
    if (!words.every((w) => l.includes(w) || (x.kind === "note" && x.hint.toLowerCase().includes(w)))) return -1;
    let sc = l.startsWith(q) ? 3 : l.split(/[^\p{L}\p{N}]+/u).some((w) => w.startsWith(words[0])) ? 2 : 1;
    if (x.kind === "cmd") sc += 0.5;
    return sc;
  };
  const fill = () => {
    const q = inp.value.trim().toLowerCase();
    if (!q) shown = [...recent, ...cmds.slice(0, 40)];
    else {
      const words = q.split(/\s+/);
      shown = [...cmds, ...headItems, ...notes].map((x) => [score(x, words, q), x]).filter(([sc]) => sc > 0)
        .sort((a, b) => b[0] - a[0]).map(([, x]) => x).slice(0, 40);
      shown.push({ label: `Find “${inp.value.trim()}” in all notes`, hint: "", keys: "Ctrl+Shift+F", kind: "find", go: () => {
        openFind(false); $("find-text").value = inp.value.trim(); $("find-scope").value = "all"; listAll(); } });
    }
    cur = 0;
    list.textContent = "";
    shown.forEach((x, k) => {
      const b = document.createElement("button");
      b.className = "goitem" + (k === cur ? " cur" : "");
      b.setAttribute("role", "option");
      b.innerHTML = "<span></span><small></small>";
      b.firstChild.textContent = x.label;
      b.lastChild.textContent = x.keys || x.hint;
      if (x.keys) b.lastChild.className = "k";
      b.onclick = () => run(x);
      list.appendChild(b);
    });
  };
  const run = (x) => {
    $("dialog-close").click();
    if (x.kind === "cmd" && had.c) { setActive(had.pane); page.focus(); ed.setCaret(page, had.c); }
    setTimeout(() => x.go(), 0);
  };
  const move = (d) => {
    const bs = list.querySelectorAll(".goitem");
    if (!bs.length) return;
    bs[cur].classList.remove("cur");
    cur = (cur + d + bs.length) % bs.length;
    bs[cur].classList.add("cur");
    bs[cur].scrollIntoView({ block: "nearest" });
  };
  inp.addEventListener("input", fill);
  inp.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (e.key === "Enter" && shown[cur]) { e.preventDefault(); run(shown[cur]); }
  });
  fill();
  ask("Find or Do Anything", box, []);
  inp.focus();
}
const MENUS_HERE = ["file", "edit", "insert", "format", "notes", "view", "help"];

// ------------------------------------------------------------------ 1.6.8: focus (Ctrl+Shift+Enter)
function toggleFocus() {
  S.settings.focus = !S.settings.focus;
  saveSettings();
  applyLook();
  markHere();
  toast(S.settings.focus ? "Focus: the paragraph you're in" : "Focus off", 1200);
}
let hereEl = null;
function markHere() {
  const sel = window.getSelection();
  const line = S.settings.focus && sel.rangeCount && page.contains(sel.anchorNode) ? ed.lineOf(sel.anchorNode, page) : null;
  if (line === hereEl) return;
  if (hereEl) hereEl.classList.remove("here");
  hereEl = line;
  if (hereEl) hereEl.classList.add("here");
}

// ------------------------------------------------------------------ 1.6.8: the bar over a selection
const FMB = $("fmtbar");
for (const b of FMB.querySelectorAll("button")) {
  b.addEventListener("mousedown", (e) => e.preventDefault());        // the selection stays
  b.addEventListener("click", () => { COMMANDS[b.dataset.cmd](); requestAnimationFrame(placeFmtbar); });
}
let fbDue = false;
function placeFmtbar() {
  fbDue = false;
  const sel = window.getSelection();
  const pg = sel.rangeCount ? P.map((p) => p.page).find((x) => x.contains(sel.anchorNode)) : null;
  const ok = pg && pg.isContentEditable && !sel.isCollapsed && sel.toString().trim() && $("dialog").hidden && $("menu").hidden &&
    lastPointer !== "touch" && !(ed.lineOf(sel.anchorNode, pg) || {}).dataset?.code;
  if (!ok) { FMB.hidden = true; return; }
  const r = sel.getRangeAt(0).getBoundingClientRect();
  if (!r.width && !r.height) { FMB.hidden = true; return; }
  FMB.hidden = false;
  const w = FMB.offsetWidth, h = FMB.offsetHeight;
  const topLimit = $("topbar").getBoundingClientRect().bottom + 4;
  let top = r.top - h - 8;
  if (top < topLimit) top = r.bottom + 8;
  const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
  FMB.style.top = top + "px";
  FMB.style.left = left + "px";
}
function fmtbarSoon() { if (!fbDue) { fbDue = true; requestAnimationFrame(placeFmtbar); } }
document.addEventListener("selectionchange", () => { fmtbarSoon(); markHere(); });
for (const p of P) p.scroller.addEventListener("scroll", () => { if (!FMB.hidden) fmtbarSoon(); }, { passive: true });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") FMB.hidden = true; });

// ------------------------------------------------------------------ 1.6.8: today's words (View ▸ Daily Word Target)
// the words in all your notes now, less as many as there were when you first opened Ross Note today
function todayKey() { const d = new Date(); return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); }
function allWords() {
  if (!S.store || S.store.isProject || S.store.isDoc) return null;
  let w = 0;
  for (const n of S.store.all()) w += wordsOfNote(n);
  return w;
}
function goalNow() {
  const el = $("goal");
  const s = S.settings;
  const total = allWords();
  if (total == null) { el.hidden = true; return null; }
  if (!s.day || s.day.date !== todayKey()) { s.day = { date: todayKey(), base: total }; saveSettings(); }
  const today = Math.max(0, total - s.day.base);
  el.hidden = !(s.goal > 0);
  if (s.goal > 0) {
    el.querySelector(".done").setAttribute("stroke-dashoffset", String(94.25 * (1 - Math.min(1, today / s.goal))));
    el.querySelector(".txt").innerHTML = "";
    const b = document.createElement("b");
    b.textContent = fmt(today);
    el.querySelector(".txt").append(b, document.createTextNode(` today of ${fmt(s.goal)}`));
  }
  return today;
}
let goalTimer = 0;
function goalSoon() { clearTimeout(goalTimer); goalTimer = setTimeout(goalNow, 1200); }
async function setGoal() {
  const box = document.createElement("div");
  const p = document.createElement("p");
  p.textContent = "How many words a day? Today's words show beside the word count, lower right, with a ring that fills as you go. 0: none shown.";
  const inp = document.createElement("input");
  inp.type = "number"; inp.min = "0"; inp.step = "100"; inp.className = "wide";
  inp.value = String(S.settings.goal || 1000);
  inp.setAttribute("aria-label", "Words a day");
  box.className = "goto";
  box.append(p, inp);
  const v = ask("Daily Word Target", box, [["Set", "set", true]]);
  inp.focus(); inp.select();
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("dialog").querySelector(".extra.main").click(); } });
  if (await v !== "set") return;
  S.settings.goal = Math.max(0, Math.round(+inp.value || 0));
  saveSettings();
  goalNow();
}
$("goal").onclick = setGoal;

window.RN = { commandPalette, toggleFocus, chooseColour, colourOf, setGoal, goalNow, sideWidth, showSaved, S, P, importProject, importNoble, spell, spellCheckNow, showDictionary, listAll, replaceEverywhere, togglePop, popSave, goTo, showRecent, togglePageView, updateCorner, cornerFigures, pageMenu, updateWordCopy, wordFlush, get wordDue() { return [...wordDue]; }, wordsIn, countWords, countBranch, codes, get findCur() { return findCur; }, openFind, findAll, findGo, replaceOne, replaceAll, showHeadings, importNotebook, shareNote, shareText, shareWord, copyForEmail, importWord, exportNotes, joinedParts, wordModule, saveFile, setActive, setSplit, get A() { return A; }, md, ed, flushSave, refresh, openNote, newNote, moveNote, addPictures, pasteLines, COMMANDS, VERSION };

start();
