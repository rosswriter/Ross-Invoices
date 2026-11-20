// Ross Note for the tablet: the RossNotes folder (kept in step with the laptop
// by a sync app such as Drivesync), read and written in place.
import * as md from "./md.js?v=1.9.20";
import * as ed from "./editor.js?v=1.9.20";
import { Store, PICTURES } from "./store.js?v=1.9.20";
import * as spell from "./spell.js?v=1.9.20";
import { ProjectStore, DocxStore, MdFileStore, RtfStore, findProjectFiles, findProjects, FLAG_COLOURS, alsoScrivener } from "./project.js?v=1.9.20";

if (ED.project) alsoScrivener();
export const VERSION = "1.9.20";
import { ED } from "./edition.js?v=1.9.20";
// The version shown: RossDraft has its own number (built on V9 VERSION).
const SHOWN = ED.version ? ED.version + " · V9 " + VERSION : VERSION;
export const EDITION = ED.short;   // V9 or RossDraft (js/edition.js); V9 was V7-full until 1.9.2
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
  head.innerHTML = '<span class="hname"></span><button type="button" class="hcomments" hidden></button><span class="hwords"></span>';
  // the page and, beside it (or under it when the pane is narrow), the scene's comments
  const scroller = el.querySelector(".scroller");
  const pbody = document.createElement("div");
  pbody.className = "pbody";
  scroller.before(pbody);
  pbody.appendChild(scroller);
  const cpanel = document.createElement("aside");
  cpanel.className = "cpanel";
  cpanel.hidden = true;
  pbody.appendChild(cpanel);
  const hc = head.querySelector(".hcomments");
  hc.addEventListener("click", (e) => { e.preventDefault(); toggleComments(); });
  hc.addEventListener("mousedown", (e) => e.preventDefault());
  return { k, el, head, hname: head.firstChild, hcomments: hc, hwords: head.lastChild, scroller, cpanel,
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
    // 1.9.0 (from 1.6.8): the new look
    toolbar: false, measure: "medium", font: "literata", focus: false, wordList: true, goal: 0, day: null, colours: {},
    classic: false, ui: 100, ink: "normal" };
  try { return Object.assign(d, JSON.parse(localStorage.getItem(ED.key) || "{}")); } catch (e) { return d; }
}
function saveSettings() { try { localStorage.setItem(ED.key, JSON.stringify(S.settings)); } catch (e) { /* private */ } }

// 1.9.20: what's drawn at the interface size is zoomed, so a pop-up's place is given in its own (zoomed) pixels
const UI_SIZES = [["Small", 90], ["Normal", 100], ["Large", 115], ["Larger", 130], ["Largest", 150]];
const INKS = [["Normal", "normal"], ["Darker", "dark"], ["Darkest", "darkest"]];
function uiz() { const v = +((S && S.settings && S.settings.ui) || 100); return Math.min(2, Math.max(0.8, v / 100)) || 1; }
function putAt(el, left, top) { const z = uiz(); el.style.left = left / z + "px"; el.style.top = top / z + "px"; }
function setUiSize(v) { S.settings.ui = v; saveSettings(); applyLook(); toast("Interface size " + v + "%", 1200); }
function setInk(v) { S.settings.ink = v; saveSettings(); applyLook(); }
const MEASURES = { narrow: 32, medium: 38, wide: 46, full: 38 };
function applyLook() {
  const s = S.settings;
  document.documentElement.classList.toggle("dark", !!s.dark);
  document.body.classList.toggle("dark", !!s.dark);
  $("app").classList.toggle("dark", !!s.dark);
  document.documentElement.style.setProperty("--size", s.size + "px");
  // 1.9.20: the interface size (menus, bars, the list, dialogs; the page keeps its own text size), and darker text
  document.documentElement.style.setProperty("--uiz", String(uiz()));
  document.body.classList.toggle("ink-dark", s.ink === "dark" || s.ink === "darkest");
  document.body.classList.toggle("ink-darkest", s.ink === "darkest");
  document.documentElement.style.setProperty("--lh", String(1.25 * s.spacing / 100));
  document.documentElement.style.setProperty("--gap", s.paraGap ? "10px" : "0px");
  document.documentElement.style.setProperty("--side", s.side + "px");
  document.documentElement.style.setProperty("--measure", (MEASURES[s.measure] || MEASURES.medium) + "em");
  document.body.classList.toggle("fullwidth", s.measure === "full");
  document.body.classList.toggle("classicfont", s.font === "classic");
  document.documentElement.style.setProperty("--pagefont", (PAGE_FONTS.find((f) => f[0] === s.font) || PAGE_FONTS[0])[2]);
  document.body.classList.toggle("focus", !!s.focus);
  document.body.classList.toggle("nowordlist", !s.wordList);
  document.body.classList.toggle("classic", !!s.classic);
  $("toolbar").hidden = !(s.toolbar || s.classic);       // the classic look has its toolbar
  $("b-cmd").hidden = !!s.classic;
  $("modes").textContent = s.focus ? "Focus" : "";
  document.querySelector('meta[name="theme-color"]').content = s.classic ? (s.dark ? "#1e2023" : "#1b523d") :
    (s.dark ? "#2F6296" : "#3B78B4");
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
  if (typeof renderComments === "function") renderComments();
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

// ------------------------------------------------------------------ places: RossNotes, or a Ross Writer project
// each keeps its own open notes and open branches in the list
function placeId(store) {
  if (store && (store.isDoc || store.isEpub)) return "doc:" + store.fileName;
  if (store && store.isProject) return "project:" + store.handle.name + "/" + store.fileName;
  return store && store.handle && typeof S.settings.firstNotes === "string" && store.handle.name !== S.settings.firstNotes ?
    "notes:" + store.handle.name : "notes";      // the first notes folder keeps the old "notes"
}
function enterPlace(store) {
  const s = S.settings;
  s.places = s.places || {};
  if (S.store) {
    // leaving one place for another: this one's open notes kept, the other's taken up
    // (what's open in each pane now: a note renamed since it was opened has a new key)
    s.places[placeId(S.store)] = { open: P[0].note ? P[0].note.key() : s.open, open2: P[1].note ? P[1].note.key() : s.open2,
      expanded: s.expanded };
    const p = s.places[placeId(store)];
    if (p) Object.assign(s, { open: p.open || "", open2: p.open2 || "", expanded: p.expanded || [] });
    else Object.assign(s, { open: "", open2: "", expanded: [] });
  }
  else if (!store.isDoc && !store.isProject && s.where && (s.where !== "notes" || (typeof s.notesName === "string" && store.handle &&
      s.notesName !== store.handle.name))) {
    // starting up after a session that ended in a project, a document or another notes folder: this one's own
    const p = s.places[placeId(store)] || {};
    Object.assign(s, { open: p.open || "", open2: p.open2 || "", expanded: p.expanded || [] });
  }
  s.where = store.isDoc || store.isEpub ? "doc" : store.isProject ? "project" : "notes";
  if (!store.isDoc && !store.isProject && store.handle) {
    if (typeof s.firstNotes !== "string") s.firstNotes = store.handle.name;
    s.notesName = store.handle.name;
  }
  // the last place's search results go with it
  if ($("results")) $("results").hidden = true;
  // what to offer to reopen (File ▸ Reopen …): Android asks again for each folder after a restart, so
  // V9 never reopens a project or a document by itself at the start; one tap does it
  if (store.isDoc || store.isEpub) s.lastDoc = { name: store.isEpub ? store.fileName : store.label || store.fileName };
  else if (store.isProject) s.lastProject = { name: store.label, file: store.fileName };
  saveSettings();
}

// ------------------------------------------------------------------ the folder (kept between visits)
function idb() {
  return new Promise((ok, bad) => {
    const r = indexedDB.open(ED.key, 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onsuccess = () => ok(r.result);
    r.onerror = () => bad(r.error);
  });
}
// tests only (?test=opfs): folders are kept in memory, as headless Chromium crashes reading a test-storage
// folder back out of IndexedDB (a folder you chose on the tablet is kept in IndexedDB as always)
const KV_TEST = /[?&]test=opfs/.test(location.search) ? new Map() : null;

// ------------------------------------------------------------------ 1.9.20: the device check's log
// What happened when you opened something, kept on the tablet (the last 120 steps), so a tablet that won't open
// folders or files (Honor's MagicOS) shows where it fails: Help ▸ Device Check….
const DIAG_KEY = ED.key + "-diag";
function diag(event, detail = "") {
  try {
    const l = JSON.parse(localStorage.getItem(DIAG_KEY) || "[]");
    l.push([Date.now(), event, String(detail == null ? "" : detail).slice(0, 400)]);
    localStorage.setItem(DIAG_KEY, JSON.stringify(l.slice(-120)));
  } catch (e) { /* not kept */ }
}
const diagErr = (e) => `${(e && e.name) || "Error"}: ${(e && e.message) || e}`;
let keepAsked = false;
// the pickers: what was asked, what came back (or why not)
for (const name of ["showDirectoryPicker", "showOpenFilePicker", "showSaveFilePicker"]) {
  const orig = window[name];
  if (typeof orig !== "function") continue;
  window[name] = async function (opts) {
    diag(name + " asked", JSON.stringify(opts || {}));
    try {
      const got = await orig.call(window, opts);
      diag(name + " gave", Array.isArray(got) ? got.map((h) => h.kind + " " + h.name).join(", ") : got.kind + " " + got.name);
      // 1.9.20: a folder came back: Chrome asked to keep what the app remembers (the folders), so the picker
      // is seldom needed again
      if (!keepAsked && navigator.storage && navigator.storage.persist) {
        keepAsked = true;
        navigator.storage.persist().then((ok) => diag("storage kept", ok ? "yes" : "no")).catch(() => {});
      }
      return got;
    } catch (e) { diag(name + " failed", diagErr(e)); throw e; }
  };
}
document.addEventListener("visibilitychange", () => diag("app " + document.visibilityState));
window.addEventListener("pagehide", (e) => diag("page closing", e.persisted ? "kept in memory" : "unloaded"));
window.addEventListener("pageshow", (e) => { if (e.persisted) diag("page back", "from memory"); });
document.addEventListener("freeze", () => diag("app frozen (by the system)"));
document.addEventListener("resume", () => diag("app resumed"));
window.addEventListener("error", (e) => diag("error", (e.message || "") + (e.filename ? " @" + e.filename.split("/").pop() + ":" + e.lineno : "")));
window.addEventListener("unhandledrejection", (e) => diag("error (async)", diagErr(e.reason)));
async function kvGet(k) {
  if (KV_TEST && KV_TEST.has(k)) return KV_TEST.get(k);
  const db = await idb();
  return new Promise((ok) => {
    const r = db.transaction("kv").objectStore("kv").get(k);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ok(undefined);
  });
}
async function kvSet(k, v) {
  if (KV_TEST && v && typeof v === "object") { KV_TEST.set(k, v); return; }
  if (KV_TEST && v == null) KV_TEST.delete(k);
  const db = await idb();
  return new Promise((ok) => {
    const t = db.transaction("kv", "readwrite");
    try { t.objectStore("kv").put(v, k); } catch (e) { diag("couldn't keep " + k, diagErr(e)); ok(); return; }
    t.oncomplete = () => ok();
    t.onerror = () => { diag("couldn't keep " + k, diagErr(t.error)); ok(); };
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
    .map((l) => l.replace(/^at\s+/, "").replace(/https?:\/\/[^\s)]*\/js\//, "").replace(/\[\d.]+/, ""));
  return msg + (at.length ? "  [" + at.join(" ← ") + "]" : "") + "  (" + ED.name + " " + SHOWN + ")";
}
window.addEventListener("error", (ev) => { if (ev.error) toast("Something went wrong: " + whatWentWrong(ev.error), 15000); });
window.addEventListener("unhandledrejection", (ev) => toast("Something went wrong: " + whatWentWrong(ev.reason), 15000));

async function start() {
  try {
    const nav = performance.getEntriesByType("navigation")[0];
    diag("started", `${nav ? nav.type : "?"}${document.wasDiscarded ? ", after the system closed it" : ""}; last place: ${S.settings.where || "none"}`);
  } catch (e) { /* none */ }
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
  // 1.9.2: where you were (a project, a document, or your notes), straight back if Android still lets
  // Ross Note in; otherwise one tap, on the start screen
  const where = S.settings.where;
  if (where === "project" || where === "doc") {
    let h = null, f = null;
    try { h = await kvGet(where === "doc" ? "docFile" : "project"); f = where === "doc" ? true : await kvGet("projectFile"); } catch (e) { h = null; }
    if (h && f) {
      let mode = "prompt";
      try { mode = h.queryPermission ? await h.queryPermission({ mode: "readwrite" }) : "granted"; } catch (e) { /* asked */ }
      if (mode === "granted") return where === "doc" ? openDocFile(h) : openProject(h, f);
      return showStart("again", handle, { where, h, f });
    }
  }
  if (ED.project) {
    // RossDraft 1.0.3: always the start screen (projects first), with "Carry on where I was" when there's a last place
    const dirH = handle && handle.kind === "directory" ? handle : null;
    let was = null;
    if (where === "notes" && dirH) was = { where: "notes", h: dirH };
    else if (where === "project" || where === "doc") {
      try {
        const h = await kvGet(where === "doc" ? "docFile" : "project");
        const f = where === "doc" ? true : await kvGet("projectFile");
        if (h && f) was = { where, h, f };
      } catch (e) { was = null; }
    }
    return showStart(dirH ? "again" : "first", dirH, was);
  }
  if (handle && handle.kind === "directory") {
    const mode = handle.queryPermission ? await handle.queryPermission({ mode: "readwrite" }) : "granted";
    if (mode === "granted") return openRoot(handle);
    return showStart("again", handle, { where: "notes", h: handle });
  }
  showStart(window.showDirectoryPicker ? "first" : "unsupported");
}

// 1.9.2: the start screen: Carry on where I was, Open my notes, Open a Ross Writer Project, Open a Word Document,
// Choose another folder (another set of notes, or the folder holding the projects). Each is one tap: Android
// lets a web app into a folder or a file only from a tap.
function showStart(kind, handle, was = null) {
  diag("start screen", kind + (was ? ", carry on: " + was.where : "") + (handle ? ", notes: " + handle.name : ""));
  $("start").hidden = false;
  // RossDraft 1.0, and Ross Note V9 1.9.20: the raised start screen (paper; midnight in dark mode), compact
  // buttons that sink when tapped.
  if (!$("start").classList.contains("raised")) {
    $("start").classList.add("raised");
    const up = () => $("start").querySelectorAll(".down").forEach(x => x.classList.remove("down"));
    $("start").addEventListener("pointerdown", e => { const b = e.target.closest("#start-buttons button"); if (b) b.classList.add("down"); });
    ["pointerup", "pointercancel"].forEach(t => window.addEventListener(t, up));
    $("start").addEventListener("pointerout", e => { const b = e.target.closest && e.target.closest(".down"); if (b && !b.contains(e.relatedTarget)) b.classList.remove("down"); });
  }
  $("start").querySelector("h1").textContent = ED.name;
  $("start").querySelector("h1").title = "Version " + SHOWN;
  const msg = $("start-msg"), btns = $("start-buttons"), note = $("start-note");
  btns.textContent = "";
  const button = (text, main, fn) => {
    const b = document.createElement("button");
    b.className = "big" + (main ? " main" : "");
    b.textContent = text;
    b.onclick = fn;
    btns.appendChild(b);
    return b;
  };
  if (kind === "unsupported") {
    msg.textContent = "This browser can't open a folder on this device. Ross Note needs Chrome or Edge (on Android, version 132 or later).";
    note.textContent = "";
    return;
  }
  const into = async (h) => {
    let r = "denied";
    try { r = h.queryPermission && (await h.queryPermission({ mode: "readwrite" })) === "granted" ? "granted" : await h.requestPermission({ mode: "readwrite" }); } catch (e) { r = "denied"; }
    if (r !== "granted") toast(`Android didn't let Ross Note into “${h.name}”.`);
    return r === "granted";
  };
  if (was && was.h) {
    const name = was.where === "doc" ? (S.settings.lastDoc || {}).name || was.h.name :
      was.where === "project" ? (S.settings.lastProject || {}).name || was.h.name : was.h.name;
    msg.textContent = `Last: “${name}”${was.where === "project" ? " (a project)" : was.where === "doc" ? "" : " (your notes)"}.`;
    button("Carry on where I was", true, async () => {
      if (!await into(was.h)) return;
      if (was.where === "doc") openDocFile(was.h);
      else if (was.where === "project") openProject(was.h, was.f);
      else openRoot(was.h);
    });
  } else if (ED.project) {
    // RossDraft: projects first
    msg.textContent = "Open a Ross Writer project, a document, or your notes.";
    button("Open a Ross Writer Project…", true, chooseProject);
  } else if (kind === "first") {
    msg.textContent = "Choose your RossNotes folder: the one your sync app keeps in step with the laptop.";
    button("Choose the RossNotes folder…", true, chooseFolder);
  }
  if (handle && !(was && was.where === "notes")) button(`Open my notes (“${handle.name}”)`, false, async () => { if (await into(handle)) openRoot(handle); });
  else if (handle && !was) button("Open my notes", false, async () => { if (await into(handle)) openRoot(handle); });
  else if (ED.project) button("Choose the RossNotes folder…", false, chooseFolder);
  if (!(ED.project && !was)) button("Open a Ross Writer Project…", false, chooseProject);
  if (window.showOpenFilePicker || window.showDirectoryPicker) button(OPEN_DOC, false, chooseWordDoc);
  if (kind !== "first") button("Choose another folder…", false, chooseAnotherFolder);
  note.textContent = ED.project && !was ? "Edited in place, as Ross Writer on the laptop sees them." : kind === "first" ?
    "One Markdown file for each note, as on the laptop." : "Everything was saved as you typed.";
  const ver = document.createElement("span");
  ver.className = "ver";
  ver.textContent = "Version " + SHOWN;
  note.appendChild(document.createElement("br"));
  note.appendChild(ver);
  // 1.9.20: a way to the device check from here (a tablet that won't open folders never gets past this screen)
  const dc = document.createElement("button");
  dc.type = "button";
  dc.className = "devlink";
  dc.textContent = "Trouble opening? Device Check";
  dc.onclick = () => deviceCheck();
  note.appendChild(document.createElement("br"));
  note.appendChild(dc);
}

// ------------------------------------------------------------------ 1.9.2: more than one set of notes
// Any folder of Markdown notes can be opened as your notes; the last few are remembered (kv "noteFolders"),
// each keeping its own open notes and branches (places "notes:<folder>"). The one open is "my notes".
async function noteFolders() {
  let list = [];
  try { list = (await kvGet("noteFolders")) || []; } catch (e) { list = []; }
  return list.filter((h) => h && h.kind === "directory");
}
async function rememberNoteFolder(h) {
  let list = await noteFolders();
  const out = [h];
  for (const x of list) {
    let same = false;
    try { same = await x.isSameEntry(h); } catch (e) { same = x.name === h.name; }
    if (!same && out.length < 6) out.push(x);
  }
  try { await kvSet("noteFolders", out); } catch (e) { /* this visit only */ }
}

async function chooseAnotherFolder() {
  const list = await noteFolders();
  let cur = null;
  try { cur = S.notes ? S.notes.handle : await kvGet("root"); } catch (e) { cur = null; }
  const others = [];
  for (const h of list) {
    let same = false;
    try { same = cur ? await h.isSameEntry(cur) : false; } catch (e) { same = cur && h.name === cur.name; }
    if (!same) others.push(h);
  }
  const box = document.createElement("div");
  box.className = "choose";
  const p = document.createElement("p");
  p.textContent = "Which folder?";
  box.appendChild(p);
  const opts = [];
  const add = (label, value, on) => {
    const l = document.createElement("label");
    l.innerHTML = `<input type="radio" name="fold" value="${opts.length}"${on ? " checked" : ""}> `;
    l.append(label);
    box.appendChild(l);
    opts.push(value);
  };
  others.forEach((h, k) => add(`Notes: “${h.name}”`, { kind: "notes", h }, k === 0));
  add("Another folder of notes…", { kind: "newnotes" }, !others.length);
  add("The folder holding my Ross Writer projects…", { kind: "projects" }, false);
  const v = await ask("Choose Another Folder", box, [["Open", "go", true]]);
  if (v !== "go") return;
  const o = opts[+box.querySelector("input:checked").value];
  if (o.kind === "projects") return chooseProjectsFolder();
  if (o.kind === "newnotes") return chooseFolder();
  let r = "denied";
  try { r = (await o.h.queryPermission({ mode: "readwrite" })) === "granted" ? "granted" : await o.h.requestPermission({ mode: "readwrite" }); } catch (e) { r = "denied"; }
  if (r !== "granted") { toast(`Android didn't let Ross Note into “${o.h.name}”.`); return; }
  try { await kvSet("root", o.h); } catch (e) { /* this visit only */ }
  await rememberNoteFolder(o.h);
  return openRoot(o.h);
}

async function chooseFolder() {
  try {
    pickStart("notes");
    let h;
    try { h = await window.showDirectoryPicker({ id: "rossnotes", mode: "readwrite" }); } finally { pickEnd(); }
    await kvSet("root", h);
    await rememberNoteFolder(h);
    openRoot(h);
  } catch (e) {
    if (e && e.name === "AbortError") pickedNothing("folder", chooseFolder);
    else toast("Couldn't open that folder: " + e.message);
  }
}

async function openRoot(handle, quiet) {
  diag("opening notes", handle && handle.name);
  $("start").hidden = true;
  await flushSave();
  const st = new Store(handle);
  st.onWrite = wordSoon;
  enterPlace(st);
  for (const p of P) { p.note = null; p.dirty = false; }
  S.store = st;
  S.notes = st;                 // your notes (the spelling dictionary lives in their folder)
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
  restoreSpot();
  rememberNoteFolder(handle).catch(() => {});      // in the list of notes folders to switch between
  if (!quiet) setTimeout(lostPick, 400);
}


// ================================================================== RossDraft: the project panel
// Only in RossDraft (ED.project) and only in a Ross Writer project. Everything is kept where Ross Writer keeps it
// (8.6), so the laptop sees it: each entry's synopsis and notes in its node in the .rwproj ("synopsis",
// "notes"), Include in Compile ("include"), and in the .rwproj's "meta": status{id}, scene_targets{id},
// target, deadline (yyyy-mm-dd), days[7] (Monday first), day{date, start} (today's starting total).
const DRAFT_STATUSES = [["", "None"], ["draft", "Draft"], ["revised", "Revised"], ["final", "Final"]];
function draftOn() { return !!(ED.project && S.store && S.store.isProject && !S.store.isDoc); }   // a project (not a document opened by itself)
function pmeta() {
  if (!draftOn()) return {};
  const d = S.store.data;
  if (!d.meta || typeof d.meta !== "object") d.meta = {};
  return d.meta;
}
let projectSaveTimer = 0;
function saveProjectSoon(now) {
  clearTimeout(projectSaveTimer);
  const go = () => queue(() => S.store.saveProject()).catch((e) => toast("Couldn't save the project file: " + ((e && e.message) || e), 8000));
  if (now) return go();
  projectSaveTimer = setTimeout(go, 900);
}
function statusOf(n) { return (pmeta().status || {})[n.raw.id] || ""; }
function statusLabel(v) { const x = DRAFT_STATUSES.find(([k]) => k === v); return x ? x[1] : v; }
function setStatus(nodes, v) {
  const st = pmeta().status || (pmeta().status = {});
  for (const n of nodes) { if (v) st[n.raw.id] = v; else delete st[n.raw.id]; }
  saveProjectSoon(true);
  renderTree();
  renderComments();
}
function toggleInclude(n) {
  n = n || S.note;
  if (!n || !draftOn()) return;
  n.raw.include = n.raw.include === false;
  n.raw.modified = nowIsoLocal();
  saveProjectSoon(true);
  renderTree();
  renderComments();
  toast(n.raw.include ? `“${n.title()}” is in Compile.` : `“${n.title()}” is left out of Compile.`, 2000);
}
function nowIsoLocal() { return new Date().toISOString().replace(/\.\d+Z$/, "Z"); }
function statusChip(n) {
  const v = draftOn() && pmeta().show_status !== false ? statusOf(n) : "";
  if (!v) return null;
  const c = document.createElement("span");
  c.className = "stchip st-" + (["draft", "revised", "final"].includes(v) ? v : "own");
  c.textContent = statusLabel(v);
  return c;
}

// -- the project's words, today's, and how many a day to finish by the date (as Ross Writer's targets.py)
function projectWords() {
  if (!draftOn()) return 0;
  let t = 0;
  for (const n of S.store.all()) if (!n.raw.pdf) t += wordsOfNote(n);
  return t;
}
function writingDaysLeft(m) {
  if (!m.deadline) return null;
  const end = new Date(m.deadline + "T00:00:00");
  if (isNaN(end)) return null;
  const days = Array.isArray(m.days) && m.days.length === 7 ? m.days : [true, true, true, true, true, true, false];
  const d = new Date(); d.setHours(0, 0, 0, 0);
  let n = 0;
  while (d <= end) { if (days[(d.getDay() + 6) % 7]) n++; d.setDate(d.getDate() + 1); }
  return n;
}
function todayIso() { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
function targetFigures() {
  const m = pmeta();
  const target = +m.target || 0;
  if (!target) return null;
  const total = projectWords();
  if (!m.day || m.day.date !== todayIso()) { m.day = { date: todayIso(), start: total }; saveProjectSoon(); }
  const start = m.day.start;
  const left = writingDaysLeft(m);
  const perDay = left ? Math.ceil(Math.max(0, target - start) / left) : left === 0 ? Math.max(0, target - start) : null;
  return { total, target, perDay, today: Math.max(0, total - start), deadline: m.deadline || "" };
}
function niceDate(iso) {
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d)) return "";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });
}
function renderDraftHead() {
  let h = $("draft-head");
  if (!h) {
    h = document.createElement("div");
    h.id = "draft-head";
    h.addEventListener("click", targetsDialog);
    h.title = "Targets and Status…";
    $("tree").before(h);
  }
  const f = draftOn() ? targetFigures() : null;
  h.hidden = !f;
  if (!f) return;
  const fmt = (x) => x.toLocaleString("en-GB");
  h.innerHTML = "";
  const top = document.createElement("div");
  top.className = "dh-top";
  const b = document.createElement("b"); b.textContent = S.store.label;
  const by = document.createElement("span"); by.textContent = f.deadline ? "by " + niceDate(f.deadline) : "";
  top.append(b, by);
  const bar = document.createElement("div"); bar.className = "dh-bar";
  const fill = document.createElement("div"); fill.style.width = Math.min(100, Math.round(100 * f.total / f.target)) + "%";
  bar.appendChild(fill);
  const line = document.createElement("div"); line.className = "dh-line";
  line.textContent = `${fmt(f.total)} of ${fmt(f.target)}` + (f.total >= f.target ? " · target reached" : f.perDay != null ? ` · ${fmt(f.perDay)} a day to go` : "");
  const today = document.createElement("div"); today.className = "dh-line";
  today.textContent = f.perDay ? `Today: ${fmt(f.today)} of ${fmt(f.perDay)}` : `Today: ${fmt(f.today)}`;
  h.append(top, bar, line, today);
}

// ------------------------------------------------------------------ RossDraft 1.1: Compile (Ctrl+Alt+E)
// The ticked entries as one book (compile.js, as Ross Writer's Compile): Word, RTF, PDF or print, e-book.
// Its settings are the project's (the .rwproj's "compile", shared with Ross Writer); the book is saved into
// the project's folder as "<title> (compiled).<ext>" (PDF: the print view's "Save as PDF").
let CM = null;
async function compileModule() { return CM || (CM = await import("./compile.js?v=1.9.20")); }
function projectTitle() { return draftOn() ? (S.store.data.title || String(S.store.fileName || "Book").replace(/\.rwproj$/i, "")) : ""; }
const WORD_FONT = { literata: "Literata", classic: "Cambria", garamond: "EB Garamond", lora: "Lora", sourceserif: "Source Serif 4",
  inter: "Inter", courier: "Courier Prime" };

async function compileDialog() {
  if (!draftOn()) { toast("Compile is for a Ross Writer project: open one first."); return; }
  const C = await compileModule();
  await flushSave();
  const d = S.store.data;
  const o = Object.assign({}, C.DEFAULT_COMPILE, d.compile || {});
  if (!o.author) o.author = S.settings.commentAuthor || "";
  const nodes = S.store.all().filter((n) => !n.raw.pdf);
  const box = document.createElement("div");
  box.className = "compile";
  const row = (n) => `<label class="cmp-row" style="padding-left:${6 + 18 * n.ancestors().length}px"><input type="checkbox" data-k="${escapeHtml(n.key())}"` +
    `${(S.store.compileTicked ? S.store.compileTicked(n) : n.raw.include !== false) ? " checked" : ""}> ${escapeHtml(n.title())}</label>`;
  const breaks = ["* * *", "#", "~", "* * * *"];
  box.innerHTML = `<div class="cmp-what"><div class="cmp-head">What goes in <span class="cmp-n"></span>
      <button type="button" data-all="1">All</button><button type="button" data-all="0">None</button>
      <button type="button" data-all="inc">As ticked in the list</button></div>
    <div class="cmp-list">${nodes.map(row).join("")}</div></div>
    <div class="cmp-opts">
    <label><input type="checkbox" class="o-head"${o.headings ? " checked" : ""}> Titles of chapters and scenes as headings</label>
    <label><input type="checkbox" class="o-page"${o.chapter_page ? " checked" : ""}> Each top-level chapter starts on a new page</label>
    <label class="o-sb">Between scenes without titles <input class="o-break" list="cmp-breaks" value="${escapeHtml(o.scene_break || "")}" placeholder="(nothing)">
      <datalist id="cmp-breaks">${breaks.map((b) => `<option value="${escapeHtml(b)}">`).join("")}</datalist></label>
    <label><input type="checkbox" class="o-com"${o.comments ? " checked" : ""}> Keep the comments (Word)</label>
    <div class="cmp-lay">${Object.entries(C.LAYOUTS).map(([k, v]) => `<label><input type="radio" name="cmp-layout" value="${k}"${o.layout === k ? " checked" : ""}>` +
      ` <b>${v.label}</b> <small>${escapeHtml(v.what)}</small></label>`).join("")}</div>
    <label><input type="checkbox" class="o-tp"${o.title_page ? " checked" : ""}> A title page, with the title, <span class="o-wc"></span> and your name:</label>
    <label class="o-au">Your name <input class="o-author" value="${escapeHtml(o.author)}" placeholder="as on the cover"></label>
    </div>
    <p class="muted">Saved in the project's folder as “${escapeHtml(projectTitle())} (compiled)”. The settings are the project's: Ross Writer on the laptop uses them too.</p>`;
  const ticks = () => [...box.querySelectorAll(".cmp-list input")];
  const count = () => {
    const on = ticks().filter((x) => x.checked);
    const words = on.reduce((t, x) => { const n = S.store.find(x.dataset.k); return t + (n ? wordsOfNote(n) : 0); }, 0);
    box.querySelector(".cmp-n").textContent = `· ${on.length} of ${ticks().length}, ${words.toLocaleString("en")} words`;
    box.querySelector(".o-wc").textContent = aboutWords(words);
  };
  box.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-all]");
    if (!b) return;
    for (const x of ticks()) { const n = S.store.find(x.dataset.k); x.checked = b.dataset.all === "inc" ? !!n && (S.store.compileTicked ? S.store.compileTicked(n) : n.raw.include !== false) : b.dataset.all === "1"; }
    count();
  });
  box.addEventListener("change", count);
  count();
  const v = await ask("Compile", box, [["Word…", "docx", true], ["RTF…", "rtf"], ["PDF or Print…", "print"], ["E-book…", "epub"]]);
  if (!v) return;
  const opts = {
    headings: box.querySelector(".o-head").checked, chapter_page: box.querySelector(".o-page").checked,
    scene_break: box.querySelector(".o-break").value.trim(), comments: box.querySelector(".o-com").checked,
    layout: (box.querySelector('input[name="cmp-layout"]:checked') || { value: "own" }).value,
    title_page: box.querySelector(".o-tp").checked, author: box.querySelector(".o-author").value.trim(),
  };
  d.compile = Object.assign({}, d.compile || {}, opts);
  saveProjectSoon();
  const chosen = ticks().filter((x) => x.checked).map((x) => S.store.find(x.dataset.k)).filter(Boolean);
  if (!chosen.length) { dialog("Compile", "Nothing is ticked."); return; }
  return compileBook(v, chosen, d.compile);
}

function aboutWords(n) {
  const r = n >= 10000 ? Math.round(n / 1000) * 1000 : n >= 1000 ? Math.round(n / 100) * 100 : n;
  return `about ${r.toLocaleString("en")} words`;
}

// the book's lines from the chosen entries (in the list's order)
async function compileLines(chosen, o) {
  const C = await compileModule();
  const W = await wordModule();
  const order = new Map(S.store.all().map((n, i) => [n, i]));
  const nodes = chosen.slice().sort((a, b) => order.get(a) - order.get(b));
  const missing = [];
  const entries = [];
  let words = 0;
  for (const n of nodes) {
    if (n.raw.pdf) continue;
    const text = await queue(() => S.store.read(n));
    if (n.readOnly && n.readOnly.some((w) => /not on this device|couldn't read/.test(w))) { missing.push(n.title()); continue; }
    const nl = md.parse(text).slice(1);
    entries.push({ title: n.title(), depth: n.ancestors().length, hasChildren: n.children.length > 0, lines: W.fromNoteLines(nl),
      comments: n.comments || [], notes: n.fnotes || null });
    words += wordsOfNote(n);
  }
  const title = projectTitle();
  // the scenes' footnotes and endnotes, numbered through the book
  const rn = C.renumberNotes(entries);
  rn.lines.forEach((l, i) => { entries[i].lines = l; });
  const lines = C.markIndents(C.bookLines(entries, Object.assign({}, o, { title, words: aboutWords(words) })));
  return { lines, entries, missing, title, words, notes: rn.notes };
}

async function compileBook(kind, chosen, o) {
  const C = await compileModule();
  const got = await busy("Gathering the book…", () => compileLines(chosen, o), { after: 0 });
  if (got.missing.length) {
    dialog("Compile", `These entries' Word files aren't on this device yet (your sync app may still be copying them), ` +
      `so the book would be missing them:\n\n${got.missing.map((t) => "• " + t).join("\n")}\n\nTry again once they're here, or untick them.`);
    return null;
  }
  const { lines, title, entries, notes } = got;
  const bytes = (img) => S.store.pictureBytes(img);
  const surname = (o.author || "").trim().split(/\s+/).pop() || "";
  const shortTitle = title.toUpperCase().slice(0, 40);
  const pageFont = WORD_FONT[S.settings.font] || "Literata";
  if (kind === "print") return compilePrint(lines, o, title, surname, shortTitle, notes);
  let blob, ext;
  if (kind === "docx") {
    const W = await wordModule();
    ext = "docx";
    blob = await busy("Making the Word document…", async () => {
      if (o.layout === "manuscript") {
        return W.writeDocx(lines, bytes, title, "Times New Roman", { notes, size: 24, line: 480, indent: 720, margins: 1440,
          header: surname ? `${surname} / ${shortTitle} / ` : `${shortTitle} / `, titlePage: !!o.title_page, headingsPlain: true });
      }
      if (o.layout === "reading") {
        return W.writeDocx(lines, bytes, title, pageFont, { notes, size: 23, line: 312, indent: 340, justify: true, footer: "page",
          titlePage: !!o.title_page });
      }
      // the project's own look: its first entry's Word file's styles and page (as Ross Writer's Compile)
      let tpl = null;
      for (const e of chosen) { const sc = S.store.scenes && S.store.scenes.get(e.raw.id); if (sc && sc.files && !sc.readOnly) { tpl = sc; break; } }
      if (!tpl) tpl = await S.store.findTemplate();
      if (tpl && tpl.files) {
        const { patchDocx } = await import("./wordpatch.js?v=1.8.3");
        return patchDocx(tpl.files, tpl.lines, tpl.sigs, lines, bytes, notes, true);
      }
      return W.writeDocx(lines, bytes, title, "Cambria", { notes, footer: "page", titlePage: !!o.title_page });
    }, { after: 0 });
    if (o.comments && entries.some((e) => e.comments.length)) {
      const { exportComments } = await import("./wordpatch.js?v=1.9.20");
      blob = await busy("Putting the comments in…", async () => exportComments(await blob.arrayBuffer(),
        entries.map((e) => ({ title: e.title, comments: e.comments }))), { after: 0 });
    }
  } else if (kind === "rtf") {
    const R = await import("./rtf.js?v=1.9.20");
    ext = "rtf";
    const out = await busy("Making the RTF document…", () => {
      if (o.layout === "manuscript") return R.writeRtf(lines, { notes, title, pictureBytes: bytes, indent: 720, headingsPlain: true,
        look: { font: "Times New Roman", fs: 24, sl: 480, slmult: 1, margl: 1440, margr: 1440, margt: 1440, margb: 1440 },
        header: surname ? `${surname} / ${shortTitle} / ` : `${shortTitle} / `, titlePage: !!o.title_page });
      if (o.layout === "reading") return R.writeRtf(lines, { notes, title, pictureBytes: bytes, indent: 340, justify: true, footer: "page",
        look: { font: pageFont, fs: 23, sl: 312, slmult: 1 }, titlePage: !!o.title_page });
      return R.writeRtf(lines, { notes, title, pictureBytes: bytes, indent: 0, footer: "page", titlePage: !!o.title_page,
        look: { font: "Cambria", fs: 24, sl: 276, slmult: 1 } });
    }, { after: 0 });
    blob = new Blob([out], { type: "application/rtf" });
  } else if (kind === "epub") {
    ext = "epub";
    const d = S.store.data;
    if (!d.compile.epub_id) { d.compile.epub_id = "urn:uuid:" + (crypto.randomUUID ? crypto.randomUUID() : Date.now()); saveProjectSoon(); }
    blob = await busy("Making the e-book…", () => C.epubBlob(lines, { notes, title, author: o.author, title_page: true,
      identifier: d.compile.epub_id }, bytes), { after: 0 });
  }
  const name = md.safeName(title) + " (compiled)." + ext;
  try {
    await queue(async () => {
      const h = await S.store.handle.getFileHandle(name, { create: true });
      const w = await h.createWritable();
      await w.write(blob);
      await w.close();
    });
  } catch (e) {
    // not into the folder (no permission to write there): saved wherever you choose instead
    const saved = await saveFile(blob, name, { docx: "Word document", rtf: "Rich Text Format (RTF)", epub: "E-book (EPUB)" }[ext], "." + ext, blob.type);
    if (saved) toast("Saved " + saved);
    return saved;
  }
  const file = new File([blob], name, { type: blob.type });
  const p = document.createElement("div");
  p.textContent = `“${name}” is in the project's folder (${got.entries.length} entr${got.entries.length === 1 ? "y" : "ies"}, ${got.words.toLocaleString("en")} words).`;
  const canShare = navigator.canShare && navigator.canShare({ files: [file] });
  const v = await ask("Compiled", p, canShare ? [["Share…", "share"], ["OK", "ok", true]] : [["OK", "ok", true]]);
  if (v === "share") { try { await navigator.share({ files: [file], title }); } catch (e) { /* not shared */ } }
  return name;
}

// PDF or print: the book laid out in the print view, the browser's print (and its "Save as PDF")
async function compilePrint(lines, o, title, surname, shortTitle, notes = null) {
  const C = await compileModule();
  const urls = new Map();
  for (const ln of lines) for (const r of ln.runs || []) {
    if (!r.img || urls.has(r.img)) continue;
    try {
      const b = await S.store.pictureBytes(r.img);
      if (b) urls.set(r.img, URL.createObjectURL(new Blob([b])));
    } catch (e) { /* left out */ }
  }
  const font = (PAGE_FONTS.find((f) => f[0] === S.settings.font) || PAGE_FONTS[0])[2];
  const { html, css } = C.printHtml(lines, o.layout, { notes, header: surname ? `${surname} / ${shortTitle}` : shortTitle, font,
    titlePage: !!o.title_page, pictureUrl: (img) => urls.get(img) });
  const doc = $("printdoc");
  doc.innerHTML = html;
  doc.classList.add("book");
  const st = document.createElement("style");
  st.id = "book-css";
  st.textContent = "@media print {" + css.replace(/@page[^{]*\{[^{}]*(\{[^{}]*\}[^{}]*)*\}/g, "") + "}\n" +
    (css.match(/@page[^{]*\{[^{}]*(\{[^{}]*\}[^{}]*)*\}/g) || []).join("\n");
  document.head.appendChild(st);
  await Promise.all([...doc.querySelectorAll("img")].map((i) => (i.decode ? i.decode().catch(() => {}) : null)));
  try { await document.fonts.ready; } catch (e) { /* as they are */ }
  document.body.classList.add("print-joined");
  const old = document.title;
  document.title = title;
  const after = () => {
    document.body.classList.remove("print-joined");
    document.title = old;
    doc.textContent = "";
    doc.classList.remove("book");
    st.remove();
    for (const u of urls.values()) URL.revokeObjectURL(u);
    window.removeEventListener("afterprint", after);
  };
  window.addEventListener("afterprint", after);
  if (!window.RN_NOPRINT) window.print();
  return title;
}

// -- Targets and Status… (as Ross Writer's dialog)
async function targetsDialog() {
  if (!draftOn()) return;
  const m = pmeta(), n = S.note;
  const box = document.createElement("div");
  box.className = "targets";
  const days = Array.isArray(m.days) && m.days.length === 7 ? m.days : [true, true, true, true, true, true, false];
  const dn = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  box.innerHTML = `<fieldset><legend>The project</legend>
    <label>Words <input id="tg-target" type="number" min="0" step="1000" value="${+m.target || ""}" placeholder="no target"></label>
    <label>By <input id="tg-date" type="date" value="${m.deadline || ""}"></label>
    <div class="tg-days">Writing days: ${dn.map((d, i) => `<label><input type="checkbox" data-d="${i}"${days[i] ? " checked" : ""}> ${d}</label>`).join(" ")}</div>
    <div id="tg-sum" class="tg-sum"></div></fieldset>` +
    (n ? `<fieldset><legend>This entry · ${escapeHtml(n.title())}</legend>
    <label>Words <input id="tg-scene" type="number" min="0" step="250" value="${+((m.scene_targets || {})[n.raw.id]) || ""}" placeholder="no target"></label>
    <label>Status <input id="tg-status" list="tg-statuses" value="${escapeHtml(statusLabel(statusOf(n)) === "None" ? "" : statusLabel(statusOf(n)))}" placeholder="None">
    <datalist id="tg-statuses">${DRAFT_STATUSES.slice(1).map(([, l]) => `<option value="${l}">`).join("")}</datalist></label>
    <label class="tg-inc"><input id="tg-include" type="checkbox"${n.raw.include !== false ? " checked" : ""}> Include in Compile</label></fieldset>` : "") +
    `<label class="tg-inc"><input id="tg-show" type="checkbox"${m.show_status !== false ? " checked" : ""}> Show the status in the list</label>
    <p class="muted">Kept in the project file, so Ross Writer on the laptop sees it too.</p>`;
  const sum = () => {
    const t = +box.querySelector("#tg-target").value || 0, el = box.querySelector("#tg-sum");
    if (!t) { el.textContent = ""; return; }
    const tot = projectWords();
    const mm = { deadline: box.querySelector("#tg-date").value, days: [...box.querySelectorAll("[data-d]")].map((c) => c.checked) };
    const left = writingDaysLeft(mm);
    el.textContent = `${tot.toLocaleString("en-GB")} written · ${Math.max(0, t - tot).toLocaleString("en-GB")} to go` +
      (left ? ` · ${Math.ceil(Math.max(0, t - tot) / left).toLocaleString("en-GB")} a day on your writing days to finish on time` :
        left === 0 ? " · the date has passed, or there are no writing days before it" : "");
  };
  box.addEventListener("input", sum);
  sum();
  const v = await ask("Targets and Status", box, [["OK", "ok", true]]);
  if (v !== "ok") return;
  const t = +box.querySelector("#tg-target").value || 0;
  if (t && !m.target) delete m.day;
  if (t) m.target = t; else delete m.target;
  const dl = box.querySelector("#tg-date").value;
  if (dl) m.deadline = dl; else delete m.deadline;
  m.days = [...box.querySelectorAll("[data-d]")].map((c) => c.checked);
  m.show_status = box.querySelector("#tg-show").checked;
  if (n) {
    const st = m.scene_targets || (m.scene_targets = {});
    const sv = +box.querySelector("#tg-scene").value || 0;
    if (sv) st[n.raw.id] = sv; else delete st[n.raw.id];
    const typed = box.querySelector("#tg-status").value.trim();
    const known = DRAFT_STATUSES.find(([, l]) => l.toLowerCase() === typed.toLowerCase());
    const v2 = known ? known[0] : typed;
    const sm = m.status || (m.status = {});
    if (v2) sm[n.raw.id] = v2; else delete sm[n.raw.id];
    n.raw.include = box.querySelector("#tg-include").checked;
  }
  saveProjectSoon(true);
  renderTree();
  renderDraftHead();
  renderComments();
  updateCount();
}
function escapeHtml(t) { return String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]); }

// -- the side panel's Synopsis and Notes tab (beside Comments), for the entry the caret is in
function inspectorOn(p) { return draftOn() && !S.store.isEpub && !!p.note && !p.el.hidden; }
// RossDraft 1.2: the Footnotes tab, for a scene (or a Word document) of the page, not a page of several
function fnOn(p) { return ED.project && !!p.note && !!p.note.fnotes && !p.joined && !p.el.hidden; }
function inspectedNote(p) {
  if (!p.joined) return p.note;
  // on a page of several: the part the caret is in
  const sel = window.getSelection();
  const n0 = sel.rangeCount ? sel.anchorNode : null;
  if (!n0 || !p.page.contains(n0)) return p.inspected && p.joined.includes(p.inspected) ? p.inspected : p.note;
  let el = n0.nodeType === 1 ? n0 : n0.parentNode;
  while (el && el.parentNode !== p.page) el = el.parentNode;
  let k = 0;
  for (let c = el; c; c = c.previousElementSibling) if (c.classList && c.classList.contains("jdiv")) k++;
  return p.joined[k] || p.note;
}
const shownInspector = new WeakMap();
function renderInspector(p, tabs) {
  const n = inspectedNote(p);
  p.inspected = n;
  const key = n.raw.id + "|" + statusOf(n) + "|" + (n.raw.include !== false) + "|" + ((pmeta().scene_targets || {})[n.raw.id] || "") + "|" + (p.note.comments || []).length;
  if (shownInspector.get(p.cpanel) === key && p.cpanel.querySelector(".insp")) return;
  shownInspector.set(p.cpanel, key);
  shownComments.delete(p.cpanel);
  p.cpanel.textContent = "";
  p.cpanel.appendChild(tabs);
  const w = document.createElement("div");
  w.className = "insp";
  const title = document.createElement("div");
  title.className = "insp-title";
  title.textContent = n.title();
  w.appendChild(title);
  // status, compile, the entry's target
  const row = document.createElement("div");
  row.className = "insp-row";
  const sel = document.createElement("select");
  sel.title = "Status";
  const cur = statusOf(n);
  for (const [k, l] of DRAFT_STATUSES) { const o = document.createElement("option"); o.value = k; o.textContent = k ? l : "No status"; sel.appendChild(o); }
  if (cur && !DRAFT_STATUSES.some(([k]) => k === cur)) { const o = document.createElement("option"); o.value = cur; o.textContent = cur; sel.appendChild(o); }
  sel.value = cur;
  sel.onchange = () => setStatus([n], sel.value);
  const inc = document.createElement("label");
  inc.className = "insp-inc";
  inc.innerHTML = `<input type="checkbox"${n.raw.include !== false ? " checked" : ""}> In Compile`;
  inc.querySelector("input").onchange = () => toggleInclude(n);
  row.append(sel, inc);
  const tw = (pmeta().scene_targets || {})[n.raw.id];
  if (tw) {
    const t = document.createElement("span");
    t.className = "insp-target";
    t.textContent = `${wordsOfNote(n).toLocaleString("en-GB")} of ${(+tw).toLocaleString("en-GB")} words`;
    row.appendChild(t);
  }
  w.appendChild(row);
  const field = (label, prop, rows, hint) => {
    const l = document.createElement("label");
    l.className = "insp-label";
    l.textContent = label;
    const ta = document.createElement("textarea");
    ta.rows = rows;
    ta.placeholder = hint;
    ta.spellcheck = true;
    ta.value = n.raw[prop] || "";
    ta.className = "insp-" + prop;
    ta.addEventListener("input", () => {
      if (ta.value.trim()) n.raw[prop] = ta.value; else delete n.raw[prop];
      n.raw.modified = nowIsoLocal();
      saveProjectSoon();
      if (prop === "synopsis") { const r = $("tree").querySelector(`.row[data-key="${CSS.escape(n.key())}"]`); if (r) r.title = ta.value || n.title(); }
    });
    ta.addEventListener("blur", () => saveProjectSoon(true));
    w.append(l, ta);
  };
  field("Synopsis", "synopsis", 4, "What happens here, in a line or two (Scrivener's index card)");
  field("Notes", "notes", 10, "Notes for this entry: research, reminders, what to fix");
  p.cpanel.appendChild(w);
}
function panelTabs(p, cs) {
  const top = document.createElement("div");
  top.className = "ctop ptabs";
  const tab = (label, v) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ptab" + ((S.settings.ptab || "notes") === v ? " on" : "");
    b.textContent = label;
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.onclick = () => { S.settings.ptab = v; saveSettings(); shownComments.delete(p.cpanel); shownInspector.delete(p.cpanel); shownFootnotes.delete(p.cpanel); renderComments(); };
    top.appendChild(b);
  };
  // (three tabs: shorter names, so they fit side by side)
  const three = inspectorOn(p) && fnOn(p);
  if (inspectorOn(p)) tab(three ? "Synopsis" : "Synopsis & Notes", "notes");
  tab(cs.length ? `Comments${three ? " " : " · "}${cs.length}` : "Comments", "comments");
  if (fnOn(p)) { const nf = p.page.querySelectorAll("sup.fnref").length; tab(nf ? `Footnotes${three ? " " : " · "}${nf}` : "Footnotes", "footnotes"); }
  const x = document.createElement("button");
  x.type = "button";
  x.className = "pclose";
  x.textContent = "✕";
  x.title = "Hide the panel";
  x.onclick = toggleComments;
  top.appendChild(x);
  return top;
}
// -- the Footnotes tab (as Ross Writer's Notes tab): each note in the order of the page, its number, its words
// to edit; Footnote and Endnote put a new one at the caret (Ctrl+Alt+F, Ctrl+Alt+D, as Ross Writer)
const shownFootnotes = new WeakMap();
function renderFootnotes(p, tabs) {
  const marks = [...p.page.querySelectorAll("sup.fnref")];
  const labels = ed.numberNotes(p.page);
  const key = marks.map((m) => m.dataset.k).join(",");
  if (shownFootnotes.get(p.cpanel) === key && p.cpanel.querySelector(".fnl")) return;
  shownFootnotes.set(p.cpanel, key);
  shownComments.delete(p.cpanel);
  shownInspector.delete(p.cpanel);
  p.cpanel.textContent = "";
  p.cpanel.appendChild(tabs);
  const w = document.createElement("div");
  w.className = "fnl";
  const row = document.createElement("div");
  row.className = "fn-add";
  const ro = !!p.note.readOnly;
  for (const [label, kind, keys] of [["Footnote", "footnote", "Ctrl+Alt+F"], ["Endnote", "endnote", "Ctrl+Alt+D"]]) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = "+ " + label;
    b.title = `A new ${kind} at the caret (${keys})`;
    b.disabled = ro;
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.onclick = () => insertNote(kind, p);
    row.appendChild(b);
  }
  w.appendChild(row);
  if (!marks.length) {
    const e = document.createElement("p");
    e.className = "fn-empty";
    e.textContent = ro ? "No notes." : "No notes yet. Put the caret where the note's number should go, then + Footnote or + Endnote.";
    w.appendChild(e);
  }
  for (const m of marks) {
    const k = m.dataset.k;
    const it = document.createElement("div");
    it.className = "fn-item";
    it.dataset.k = k;
    const head = document.createElement("div");
    head.className = "fn-head";
    const lab = document.createElement("b");
    lab.textContent = (k[0] === "e" ? "Endnote " : "Footnote ") + (labels.get(k) || "");
    const go = document.createElement("button");
    go.type = "button";
    go.textContent = "Show";
    go.title = "Its place in the text";
    go.onclick = () => { m.scrollIntoView({ block: "center" }); m.classList.add("flash"); setTimeout(() => m.classList.remove("flash"), 1200); };
    const del = document.createElement("button");
    del.type = "button";
    del.textContent = "Delete";
    del.disabled = ro;
    del.onclick = () => { m.remove(); changed(p); shownFootnotes.delete(p.cpanel); renderComments(); toast("Note deleted (Ctrl+Z on the page brings back its number; its words are kept until you leave the scene)."); };
    head.append(lab, go, del);
    const ta = document.createElement("textarea");
    ta.rows = 3;
    ta.value = p.note.fnotes.get(k) || "";
    ta.readOnly = ro;
    ta.spellcheck = true;
    ta.placeholder = "The note's words";
    ta.addEventListener("input", () => {
      p.note.fnotes.set(k, ta.value);
      p.note.fnDirty = true;
      m.title = ta.value;
      changed(p);
    });
    it.append(head, ta);
    w.appendChild(it);
    m.title = p.note.fnotes.get(k) || "";
  }
  p.cpanel.appendChild(w);
}
const fnTimers = new WeakMap();
function fnotesSoon(p) {
  clearTimeout(fnTimers.get(p));
  fnTimers.set(p, setTimeout(() => { if (S.settings.ptab === "footnotes" || !(p.note.comments || []).length) renderComments(); }, 400));
}

// a new footnote or endnote at the caret: its mark in the text, its words in the Footnotes tab
function insertNote(kind, pane = A) {
  const p = pane;
  if (!ED.project || !p.note || !p.note.fnotes) { toast("Footnotes are for a Ross Writer project's scenes, or a Word document."); return; }
  if (p.joined) { toast("Open the scene by itself to add a note."); return; }
  if (p.note.readOnly) { toast("This scene is read-only here."); return; }
  const sel = window.getSelection();
  let r = sel.rangeCount ? sel.getRangeAt(0) : null;
  if (!r || !p.page.contains(r.endContainer)) { toast("Put the caret in the text where the note's number should go."); return; }
  const k = kind === "endnote" ? "e" : "f";
  const ids = [...p.note.fnotes.keys()].filter((x) => x[0] === k).map((x) => +x.slice(1) || 0);
  for (const m of p.page.querySelectorAll("sup.fnref")) if (m.dataset.k[0] === k) ids.push(+m.dataset.k.slice(1) || 0);
  const id = Math.max(0, ...ids) + 1;
  const token = "\uE000" + k + id + "\uE001";
  r = r.cloneRange();
  r.collapse(false);
  const sup = ed.noteElement(token);
  r.insertNode(sup);
  const after = document.createRange();
  after.setStartAfter(sup);
  after.collapse(true);
  sel.removeAllRanges();
  sel.addRange(after);
  p.note.fnotes.set(k + id, "");
  p.note.fnDirty = true;
  changed(p);
  S.settings.showComments = true;
  S.settings.ptab = "footnotes";
  saveSettings();
  shownFootnotes.delete(p.cpanel);
  renderComments();
  const ta = p.cpanel.querySelector(`.fn-item[data-k="${k + id}"] textarea`);
  if (ta) ta.focus();
}
// a note's number tapped: its words in the Footnotes tab
document.addEventListener("click", (e) => {
  const m = e.target.closest && e.target.closest("sup.fnref");
  if (!m || !ED.project) return;
  const p = P.find((q) => q.page.contains(m));
  if (!p || !fnOn(p)) return;
  S.settings.showComments = true;
  S.settings.ptab = "footnotes";
  saveSettings();
  renderComments();
  const ta = p.cpanel.querySelector(`.fn-item[data-k="${m.dataset.k}"] textarea`);
  if (ta) { ta.focus(); ta.scrollIntoView({ block: "nearest" }); }
});

function showInspector() {
  S.settings.showComments = true;
  S.settings.ptab = "notes";
  saveSettings();
  for (const p of P) { shownInspector.delete(p.cpanel); shownComments.delete(p.cpanel); }
  renderComments();
  const ta = A.cpanel.querySelector(".insp-synopsis");
  if (ta) ta.focus();
}
// the caret moving to another part of a joined page: the panel follows it
document.addEventListener("selectionchange", () => {
  if (!draftOn() || !S.settings.showComments) return;
  for (const p of P) if (p.joined && !p.cpanel.hidden && (S.settings.ptab || "notes") === "notes" && inspectedNote(p) !== p.inspected) renderComments();
});

// -- drag and drop in the binder (with the mouse; a finger's long press selects)
let dragNote = null;
function dragRow(row, note) {
  if (!ED.project || (S.store && S.store.isDoc)) return;
  row.addEventListener("pointerdown", (e) => { row.draggable = e.pointerType === "mouse" && !e.shiftKey && !e.ctrlKey; });
  row.addEventListener("dragstart", (e) => {
    dragNote = note;
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", note.title()); } catch (err) { /* fine */ }
    row.classList.add("dragging");
  });
  row.addEventListener("dragend", () => { dragNote = null; row.classList.remove("dragging"); clearDrop(); });
  const where = (e) => {
    const r = row.getBoundingClientRect(), y = (e.clientY - r.top) / r.height;
    return y < 0.28 ? "before" : y > 0.72 ? "after" : "in";
  };
  row.addEventListener("dragover", (e) => {
    if (!dragNote || dragNote === note || [...dragNote.walk()].includes(note)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    clearDrop();
    row.classList.add("drop-" + where(e));
  });
  row.addEventListener("dragleave", () => row.classList.remove("drop-before", "drop-after", "drop-in"));
  row.addEventListener("drop", async (e) => {
    e.preventDefault();
    const n = dragNote, w = where(e);
    clearDrop();
    dragNote = null;
    if (!n || n === note || [...n.walk()].includes(note)) return;
    let target, index;
    if (w === "in") { target = note; index = note.children.length; }
    else { target = note.parent; index = note.parent.children.indexOf(note) + (w === "after" ? 1 : 0); }
    await moveTo(n, target, index);
    toast(`“${n.title()}” moved` + (w === "in" ? ` into “${note.title()}”.` : "."), 1800);
  });
}
function clearDrop() { for (const r of document.querySelectorAll(".drop-before, .drop-after, .drop-in")) r.classList.remove("drop-before", "drop-after", "drop-in"); }

// ------------------------------------------------------------------ 1.9.3: several notes as one page
// As in Ross Writer and the laptop's Ross Note: Ctrl-click notes in the list (or Shift-click for a run of them)
// and they show as one continuous page, in the list's order, a dashed line where one ends and the next begins.
// Everything is edited there and each part is saved back into its own note. A plain click: one note again.
S.sel = new Set();
S.selAnchor = null;
function clearSel() {
  if (!S.sel.size) return;
  S.sel.clear();
  for (const r of $("tree").querySelectorAll(".row.sel")) r.classList.remove("sel");
}
function inListOrder(keys) {
  return S.store.all().filter((n) => keys.has(n.key()));
}
async function selectClick(note, e) {
  const k = note.key();
  if (!S.sel.size && e.shiftKey && !(e.ctrlKey || e.metaKey)) {
    // 1.9.20 (as Ross Writer): the run goes from the note you're on to the one Shift-clicked: click node 1, Shift-click
    // node 7, and 1 to 7 are selected. Nothing open, or the open note not showing in the list: it starts at the click.
    const shown = [...$("tree").querySelectorAll(".row")].map((r) => r.dataset.key);
    const here = A.note && shown.includes(A.note.key()) ? A.note.key() : k;
    S.selAnchor = here;
    const a = shown.indexOf(here), b = shown.indexOf(k);
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) S.sel.add(shown[i]);
    for (const r of $("tree").querySelectorAll(".row")) r.classList.toggle("sel", S.sel.has(r.dataset.key));
    const run = inListOrder(S.sel);
    return run.length >= 2 ? openJoined(run) : openNote(note);
  }
  if (!S.sel.size) {
    // Ctrl-click: starting from what's open: the note, or the notes already joined
    if (A.joined) for (const n of A.joined) S.sel.add(n.key());
    else if (A.note) S.sel.add(A.note.key());
    S.selAnchor = A.note ? A.note.key() : k;
  }
  if (e.shiftKey) {
    const rows = [...$("tree").querySelectorAll(".row")].map((r) => r.dataset.key);
    let a = rows.indexOf(S.selAnchor), b = rows.indexOf(k);
    if (a < 0) a = b;
    if (!(e.ctrlKey || e.metaKey)) S.sel.clear();
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) S.sel.add(rows[i]);
  } else {
    if (S.sel.has(k)) S.sel.delete(k); else S.sel.add(k);
    S.selAnchor = k;
  }
  for (const r of $("tree").querySelectorAll(".row")) r.classList.toggle("sel", S.sel.has(r.dataset.key));
  const notes = inListOrder(S.sel);
  if (notes.length >= 2) return openJoined(notes);
  if (notes.length === 1) { if (!e.shiftKey) clearSel(); return openNote(notes[0]); }
}

// Ctrl+Shift+A: everything showing in the list as one page (not what's inside closed branches)
function selectAllShown() {
  const keys = [...$("tree").querySelectorAll(".row")].map((r) => r.dataset.key);
  if (!keys.length) return;
  S.sel = new Set(keys);
  S.selAnchor = keys[0];
  for (const r of $("tree").querySelectorAll(".row")) r.classList.add("sel");
  const notes = keys.map((k) => S.store.find(k)).filter(Boolean);
  if (notes.length >= 2) return openJoined(notes);
  if (notes.length === 1) return openNote(notes[0]);
}

async function openJoined(notes, pane = A) {
  await busy(`Opening ${notes.length} notes as one page…`, async () => {
    await flushSave();
    await queue(async () => { for (const n of notes) { try { await S.store.read(n); } catch (e) { /* as we had it */ } } });
    // 1.9.20: split, the joined page goes into both halves (as Ross Writer's split shows one document twice);
    // each half scrolls by itself, and what's saved from one shows in the other
    const panes = S.settings.split ? P.filter((q) => !q.el.hidden) : [pane];
    for (const q of panes) {
      q.joined = notes;
      q.note = notes[0];
      S.settings[q.k ? "open2" : "open"] = notes[0].key();
      showJoined(q);
      q.scroller.scrollTop = 0;
    }
    saveSettings();
    markCurrent();
    updateHead();
    updateCount();
  });
  const ro = notes.filter((n) => n.readOnly);
  toast(`${notes.length} notes as one page: each part is saved into its own note.` +
    (ro.length ? ` (Read-only, as ${ro.map((n) => "“" + n.title() + "”").join(", ")} ${ro.length === 1 ? "has" : "have"} comments, footnotes or the like.)` : ""), 4000);
}

function showJoined(pane) {
  const page = pane.page;
  page.textContent = "";
  pane.joined.forEach((n, i) => {
    if (i) {
      const d = document.createElement("div");
      d.className = "jdiv";
      d.contentEditable = "false";
      d.dataset.part = String(i);
      d.title = "“" + n.title() + "” begins";
      page.appendChild(d);
    }
    const lines = md.parse(n.text || "");
    const dir = n.folderParts();
    for (const ln of lines) for (const r of ln.runs) if (r.img) r.img.target = md.resolvePicture(r.img.src, dir);
    const tmp = document.createElement("div");
    ed.renderLines(tmp, lines);
    while (tmp.firstChild) page.appendChild(tmp.firstChild);
  });
  ed.relayout(page);
  const ro = pane.joined.some((n) => n.readOnly);
  page.contentEditable = ro ? "false" : "true";
  pane.el.classList.toggle("readonly", ro);
  pane.el.classList.add("joined");
  loadPictures(page);
  page.dataset.loaded = "1";
  spellSoon(0);
}

// the parts of a joined page: the lines of each note, in order
function joinedPieces(page) {
  const parts = [[]];
  for (const c of page.children) {
    if (c.classList.contains("jdiv")) parts.push([]);
    else if (c.classList.contains("ln")) parts[parts.length - 1].push(c);
  }
  return parts;
}

async function saveJoined(pane) {
  pane.dirty = false;
  const parts = joinedPieces(pane.page);
  if (parts.length !== pane.joined.length) {
    // a note's start was lost: nothing saved over the notes; the page shown again as they are
    toast("Where one note ends and the next begins got lost, so that change wasn't saved. The notes are shown again as they were.", 7000);
    showJoined(pane);
    return;
  }
  for (let i = 0; i < parts.length; i++) {
    const note = pane.joined[i];
    if (note.readOnly) continue;
    const lines = parts[i].map(ed.readLine);
    const text = md.serialize(lines, { dir: note.folderParts() });
    if (text !== note.text) {
      const now = await S.store.peek(note);
      if (now && now.modified !== note.modified && now.text !== note.text && now.text !== text) {
        await S.store.keepConflict(note, now.text);
        toast(`“${note.title()}” had also changed on another device; that version is kept in ` +
          (S.store.isProject ? "the project's Trash folder." : "the .trash folder."));
      }
      await S.store.write(note, text);
      for (const q of P) if (q !== pane && !q.dirty && (q.note === note || (q.joined && q.joined.includes(note)))) refill(q);
    }
    const title = md.titleOfLines(lines) || "Untitled";
    if (md.safeName(title) !== note.name) {
      const old = note.key();
      if (await S.store.rename(note, title)) {
        rekey(old, note.key());
        if (S.sel.has(old)) { S.sel.delete(old); S.sel.add(note.key()); }
        for (const q of P) if (q.note === note) S.settings[q.k ? "open2" : "open"] = note.key();
        saveSettings();
        renderTree();
      }
    }
  }
}

// a note's start can't be typed or deleted away: Backspace at the start of a part, Delete at the end of the one
// before, and anything typed over a selection that runs across a part's start are stopped
function guardJoined(e, p) {
  if (!p.joined) return;
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const r = sel.getRangeAt(0);
  const across = [...p.page.querySelectorAll(".jdiv")].some((d) => r.intersectsNode(d));
  const lineOfNode = (n) => { while (n && n.parentNode !== p.page) n = n.parentNode; return n; };
  let stop = false;
  if (!r.collapsed) stop = across && e.inputType !== "formatBold" && !String(e.inputType).startsWith("format");
  else if (e.inputType === "deleteContentBackward" || e.inputType === "deleteWordBackward") {
    const ln = lineOfNode(r.startContainer);
    if (ln && ln.previousElementSibling && ln.previousElementSibling.classList.contains("jdiv")) {
      const c = ed.caret(p.page);
      stop = c && c.a && c.a.pos === 0;
    }
  } else if (e.inputType === "deleteContentForward" || e.inputType === "deleteWordForward") {
    const ln = lineOfNode(r.startContainer);
    if (ln && ln.nextElementSibling && ln.nextElementSibling.classList.contains("jdiv")) {
      const c = ed.caret(p.page);
      stop = c && c.a && c.a.pos >= ed.lineText(ln).length;
    }
  }
  if (stop) {
    e.preventDefault();
    toast("That's where one note ends and the next begins: each note keeps its own start. (A plain click in the list: one note again.)", 4000);
  }
}

// ------------------------------------------------------------------ 1.9.2: steady as a word processor
// Where you are (each pane's note, its scroll and caret) is kept whenever Ross Note is put aside, closed or
// reloaded, and put back when it starts again. A reload by accident is hard to do: F5 and Ctrl+Shift+R do nothing
// here, the page doesn't pull down to reload, and the browser asks before leaving or reloading.
function keepSpot() {
  if (!S.store) return;          // nothing open yet: nothing to keep (and newer settings aren't written over)
  try {
    S.settings.spot = { where: S.settings.where, panes: P.map((p) => {
      if (!p.note) return null;
      const inIt = p.page.contains(window.getSelection().anchorNode);
      const c = inIt ? ed.caret(p.page) : (p.lastCaret && p.lastCaret.key === p.note.key() ? p.lastCaret.c : null);
      return { key: p.note.key(), top: p.scroller.scrollTop, c };
    }), active: P.indexOf(A) };
    saveSettings();
  } catch (e) { /* kept as before */ }
}
let spotDone = false;
function restoreSpot() {
  if (spotDone) return;
  spotDone = true;
  const sp = S.settings.spot;
  if (!sp || !sp.panes || sp.where !== S.settings.where) return;
  setTimeout(() => {
    sp.panes.forEach((x, k) => {
      const p = P[k];
      if (!x || !p || !p.note || p.note.key() !== x.key) return;
      p.scroller.scrollTop = x.top || 0;
      if (x.c && k === (sp.active || 0)) {
        try { p.page.focus({ preventScroll: true }); ed.setCaret(p.page, x.c); p.scroller.scrollTop = x.top || 0; } catch (e) { /* the top */ }
      }
    });
  }, 300);
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") keepSpot(); });
// the caret in each pane, kept as it moves (a reload can come when the selection is somewhere else)
document.addEventListener("selectionchange", () => {
  const n = window.getSelection().anchorNode;
  for (const p of P) if (p.note && n && p.page.contains(n)) { try { p.lastCaret = { key: p.note.key(), c: ed.caret(p.page) }; } catch (e) { /* as it was */ } }
});
window.addEventListener("pagehide", keepSpot);
window.addEventListener("beforeunload", (e) => {
  keepSpot();
  if (S.store && !location.search.includes("test=")) { e.preventDefault(); e.returnValue = ""; }   // "Leave site?"
});
document.addEventListener("keydown", (e) => {
  const k = e.key;
  // (Ctrl+R alone is Align Right, which keeps the browser from reloading too)
  if (k === "F5" || ((e.ctrlKey || e.metaKey) && e.shiftKey && (k === "r" || k === "R"))) {
    e.preventDefault();
    toast("Ross Note doesn't reload: everything is saved as you type.", 3000);
  }
}, true);
setInterval(() => { if (document.visibilityState === "visible" && S.store) keepSpot(); }, 15000);

// ------------------------------------------------------------------ 1.9.2: a folder choice lost to a restart
// On Android, choosing a folder or a file hands Ross Note over to the system's picker; when the tablet is short
// of memory, Android closes Ross Note meanwhile and starts it afresh when you come back, so what you chose never
// arrives (and Ross Note opens on your notes). A note is kept while a picker is open; finding it on starting
// again, Ross Note says what happened and offers to choose again.
const PICK_KEY = ED.key + "-picking";
function pickStart(what) {
  diag("choosing", what);
  S.picking = true;
  try { localStorage.setItem(PICK_KEY, JSON.stringify({ what, t: Date.now() })); } catch (e) { /* not kept */ }
}
function pickEnd() {
  try { localStorage.removeItem(PICK_KEY); } catch (e) { /* none */ }
  setTimeout(() => { S.picking = false; }, 1500);
}
// 1.9.20: the picker came back with nothing. Cancelled, or (on Honor's MagicOS, now and then) empty even after
// Allow: what to do, and Try Again from a fresh tap (Android opens a picker only from one)
async function pickedNothing(what, retry) {
  const q = document.createElement("div");
  q.innerHTML = `<p>No ${what} came back from the picker.</p>` +
    "<p>If you did choose one: some tablets (Honor's MagicOS among them) now and then hand back nothing even so. Try again: it usually works the next time.</p>" +
    (what === "folder" ? "<p>Choosing a folder: go <b>into</b> it, tap <b>Use this folder</b>, then <b>Allow</b>. Android won't give the top of the " +
      "tablet's storage or the Download folder itself: choose a folder inside one of those.</p>" : "") +
    "<p>Once it has opened, the app remembers it: <b>Carry on</b> brings you back without the picker.</p>";
  if (await ask(what === "folder" ? "No Folder Came Back" : "No File Came Back", q, [["Try Again", "go", true]]) === "go") retry();
}

let lostPickSeen = false;
async function lostPick() {
  if (lostPickSeen) return;
  lostPickSeen = true;
  let was = null;
  try { was = JSON.parse(localStorage.getItem(PICK_KEY) || "null"); localStorage.removeItem(PICK_KEY); } catch (e) { was = null; }
  if (!was || Date.now() - was.t > 15 * 60 * 1000) return;
  const what = was.what === "doc" ? "the Word document" : was.what === "notes" ? "the folder of notes" : "the project's folder";
  const q = document.createElement("div");
  q.innerHTML = `<p>Android closed Ross Note while you were choosing ${what}, and started it afresh when you came back, ` +
    "so what you chose didn't reach it. This happens when the tablet is short of memory.</p>" +
    "<p>Choose it again now. Closing other apps first helps. Once it has opened, File ▸ Reopen opens it " +
    "again without the picker.</p>";
  const v = await ask(was.what === "doc" ? "Open a Word Document" : "Open a Ross Writer Project", q,
    [[was.what === "doc" ? "Choose the document again…" : "Choose the folder again…", "go", true]]);
  if (v === "go") (was.what === "doc" ? chooseWordDoc : was.what === "notes" ? chooseFolder : chooseProject)();
}

// ------------------------------------------------------------------ Ross Writer projects
// A project folder (made by Ross Writer: <name>.rwproj and Scenes/) somewhere your sync app keeps;
// its entries are edited here and saved back into their Word files (project.js)
async function chooseProject() {
  // 1.9.2: the folder holding your projects, once chosen, is remembered: after that, your projects are listed
  // here and the Android folder picker isn't needed
  if (!window.showDirectoryPicker) {
    dialog("Open a Ross Writer Project", "This browser can't open folders on this device. Ross Note needs Chrome (version 132 or later on Android).");
    return;
  }
  let root = null;
  try { root = await kvGet("projectsRoot"); } catch (e) { root = null; }
  if (root && root.kind === "directory") {
    let mode = "prompt";
    try { mode = root.queryPermission ? await root.queryPermission({ mode: "readwrite" }) : "granted"; } catch (e) { /* asked */ }
    if (mode !== "granted") { try { mode = await root.requestPermission({ mode: "readwrite" }); } catch (e) { mode = "denied"; } }
    if (mode === "granted") return pickFromFolder(root, true);
  }
  return chooseProjectsFolder();
}

async function chooseProjectsFolder() {
  toast("Choose the folder that holds your Ross Writer projects (or one project's own folder)…", 8000);
  let h;
  pickStart("project");
  try { h = await window.showDirectoryPicker({ id: "rwproject", mode: "readwrite" }); } catch (e) {
    if (e && e.name === "AbortError") pickedNothing("folder", chooseProjectsFolder);
    else dialog("Open a Ross Writer Project", `The folder picker didn't open.\n\n${(e && e.name) || "Error"}: ${(e && e.message) || e}`);
    return;
  } finally { pickEnd(); }
  return pickFromFolder(h, false);
}

async function pickFromFolder(h, remembered) {
  let found;
  try { found = await busy(`Looking for projects in “${h.name}”…`, () => findProjects(h), { after: 0 }); } catch (e) {
    dialog("Open a Ross Writer Project", `Couldn't read the folder “${h.name}”.\n\n${(e && e.name) || "Error"}: ${(e && e.message) || e}`);
    return;
  }
  if (!found.length) {
    // what is there, so it's clear which folder this was
    const seen = [];
    try { for await (const [name, e] of h.entries()) { seen.push(e.kind === "directory" ? name + "/" : name); if (seen.length >= 25) break; } } catch (e) { /* none */ }
    const q = document.createElement("div");
    q.style.whiteSpace = "pre-wrap";
    q.textContent = `There's no ${ED.project ? "Ross Writer or Scrivener project (.rwproj file, or .scriv folder)" : "Ross Writer project (.rwproj file)"} in “${h.name}” or the folders inside it.\n\n` +
      (seen.length ? "This folder holds:\n" + seen.sort().map((x) => "  " + x).join("\n") : "This folder looks empty to Ross Note.") +
      "\n\nChoose the folder that holds your projects, or a project's own folder (the one with the .rwproj file and the Scenes folder).";
    const v = await ask("Open a Ross Writer Project", q, [["Choose another folder…", "other", true]]);
    if (v === "other") chooseProjectsFolder();
    return;
  }
  // a folder holding projects (not a project's own): remembered, so next time they're listed straight away
  const own = found.length === 1 && found[0].dir === h;
  if (!own || !remembered) {
    let had = null;
    try { had = await kvGet("projectsRoot"); } catch (e) { had = null; }
    if (!own || !had) { try { await kvSet("projectsRoot", h); } catch (e) { /* this visit only */ } }
  }
  if (found.length === 1 && !remembered) return openProject(found[0].dir, found[0].file);
  const box = document.createElement("div");
  box.className = "choose";
  const p = document.createElement("p");
  p.textContent = `In “${h.name}”:`;
  box.appendChild(p);
  const cur = S.store && S.store.isProject ? S.store.fileName : (S.settings.lastProject || {}).file;
  let firstOn = found.findIndex((x) => x.file === cur);
  if (firstOn < 0) firstOn = 0;
  found.forEach((x, k) => {
    const l = document.createElement("label");
    l.innerHTML = `<input type="radio" name="rwp" value="${k}"${k === firstOn ? " checked" : ""}> `;
    const where = x.path.split("/").slice(1).join(" › ");
    l.append(x.file.replace(/\.rwproj$/i, "").replace(/\.scrivx$/i, " (Scrivener)") + (where ? "   (" + where + ")" : ""));
    box.appendChild(l);
  });
  const v = await ask("Open a Ross Writer Project", box, [["Open", "go", true], ["Another folder…", "other"]]);
  if (v === "other") return chooseProjectsFolder();
  if (v !== "go") return;
  const x = found[+box.querySelector("input:checked").value];
  return openProject(x.dir, x.file);
}

async function openProject(handle, file, made = null, fileHandle = null) {
  diag("opening project", (handle && handle.name) + " / " + file);
  $("start").hidden = true;
  await flushSave();
  let st;
  if (made) st = made;       // (an e-book: EpubStore)
  else if (/\.scrivx$/i.test(file)) {
    // RossDraft 1.3: a Scrivener project, opened and saved in place (scriv.js)
    if (!ED.project) { dialog("Open a Project", "Scrivener projects open in RossDraft."); return; }
    const SV = await import("./scriv.js?v=1.9.20");
    st = new SV.ScrivStore(handle, file);
    const locks = await st.findLocks();
    if (locks.length) {
      const q = document.createElement("div");
      q.style.whiteSpace = "pre-wrap";
      q.textContent = `Scrivener seems to have “${st.label}” open: it leaves a lock file in the project while it does ` +
        `(${locks.join(", ")}).\n\nIf Scrivener is open on this project (here or on another computer), close it there first: ` +
        "two programs saving one project can lose work. If it isn't (Scrivener didn't close properly), open it anyway.";
      const v = await ask("Scrivener Has It Open?", q, [["Open Read-Only", "ro", true], ["Open Anyway", "go"]]);
      if (!v) { if (!S.store) start(); return; }
      if (v === "ro") st.readOnlyAll = ["open read-only here (Scrivener had it open)"];
    }
  } else st = new ProjectStore(handle, file);
  st._diag = true;
  try {
    await busy("Opening the project…", (say) => queue(async () => {
      st.onProgress = (k, n) => say(`Opening the project: ${k} of ${n} scenes`);
      try { await st.scan(); } finally { st.onProgress = null; }
    }), { after: 0 });
  } catch (e) {
    dialog(st.isEpub ? "Open an E-book" : st.isScriv ? "Open a Scrivener Project" : "Open a Ross Writer Project", `Couldn't open “${file}”.\n\n${e.message || e}`);
    if (!S.store) start();
    return;
  }
  try {
    if (st.isEpub) await kvSet("docFile", fileHandle);
    else { await kvSet("project", handle); await kvSet("projectFile", file); }
  } catch (e) { /* kept for this visit only */ }
  const fresh = !(S.settings.places || {})[placeId(st)];
  enterPlace(st);
  for (const p of P) { p.note = null; p.dirty = false; }
  S.store = st;
  if (typeof fitScope === "function") fitScope();
  // the first time: the branches open as Ross Writer had them
  if (fresh) S.settings.expanded = st.all().filter((n) => n.children.length && n.raw.expanded !== false).map((n) => n.key());
  renderTree();
  layout();
  const n = st.find(S.settings.open) || st.root.children[0];
  if (S.settings.split) {
    const n2 = st.find(S.settings.open2) || n;
    if (n2) await openNote(n2, P[1]);
  }
  if (n) await openNote(n, P[0]);
  else for (const p of P) { p.page.textContent = ""; p.page.contentEditable = "false"; }
  if (S.settings.split && S.settings.active === 1) setActive(P[1]);
  updateCount();
  restoreSpot();
  const ro = st.all().filter((x) => x.readOnly && !x.raw.pdf).length;
  if (st.isEpub) { toast(`“${st.label}”${st.author ? " by " + st.author : ""}: an e-book, ${st.all().length} entr${st.all().length === 1 ? "y" : "ies"}, to read. ` +
    "File ▸ Export Project… makes a project of it to edit.", 7000); return; }
  toast(`${st.label}${st.isScriv ? " (Scrivener)" : ""}: ${st.all().length} entr${st.all().length === 1 ? "y" : "ies"}` +
    (st.readOnlyAll ? " — read-only" : ro ? ` (${ro} read-only here: ${st.isScriv ? "Scrivener's inline notes, tables, pictures or research files" : "comments, footnotes or the like"})` : ""));
}

// ------------------------------------------------------------------ a Word document by itself
// File ▸ Open a Word Document…: edited and commented in place, saved straight back into it (DocxStore)
const DOC_RE = ED.project ? /\.(docx|rtf|epub|md|markdown|mdown|mkd|txt)$/i : /\.(docx|md|markdown|mdown|mkd|txt)$/i;
// RossDraft 1.0.2: "Open a Document…" takes RTF too (and says what it takes)
const DOC_WHAT = ED.project ? "a Word document (.docx), an RTF document (.rtf), an e-book (.epub) or a Markdown note (.md)" :
  "a Word document (.docx) or a Markdown note (.md)";
const OPEN_DOC = ED.project ? "Open a Document…" : "Open a Word Document…";
let docDir = null;      // the folder a document was chosen from (an RTF's original is kept beside it)

// File ▸ Open a Word Document or Note…: Android's file picker, showing every file (it often doesn't know a
// synced .docx or .md for what it is, and would grey it out). Where that picker isn't there or won't
// open: the folder picker (which works wherever RossNotes does), then the Word and Markdown files in it.
async function chooseWordDoc() {
  toast(ED.project ? "Choose the document (Word, RTF, e-book or Markdown)…" : "Choose the Word document or Markdown note…", 8000);
  let fh = null;
  docDir = null;
  if (window.showOpenFilePicker) {
    pickStart("doc");
    try {
      [fh] = await window.showOpenFilePicker({ id: "worddoc", multiple: false });
    } catch (e) {
      if (e && e.name === "AbortError") { pickedNothing("file", chooseWordDoc); return; }
      fh = null;      // the file picker can't: the folder way instead
    } finally { pickEnd(); }
  }
  if (!fh) fh = await chooseDocInFolder();
  if (!fh) return;
  await openDocFile(fh, true);
}

async function chooseDocInFolder() {
  if (!window.showDirectoryPicker) {
    dialog("Open a Word Document or Note", "This browser can't open files on this device for saving back into them. " +
      "Use File ▸ Import a Word Document… instead (it becomes notes).");
    return null;
  }
  let dir;
  pickStart("doc");
  try { dir = await window.showDirectoryPicker({ id: "docfolder", mode: "readwrite" }); } catch (e) {
    if (e && e.name === "AbortError") pickedNothing("folder", chooseWordDoc);
    else dialog("Open a Word Document or Note", `The folder picker didn't open.\n\n${(e && e.name) || "Error"}: ${(e && e.message) || e}`);
    return null;
  } finally { pickEnd(); }
  const names = [];
  try { for await (const [name, h] of dir.entries()) if (h.kind === "file" && DOC_RE.test(name) && !name.startsWith("~$")) names.push(name); } catch (e) { /* none */ }
  names.sort((x, y) => x.localeCompare(y, undefined, { sensitivity: "base" }));
  if (!names.length) {
    dialog("Open a Word Document or Note", ED.project ? `There are no Word, RTF, e-book or Markdown documents in “${dir.name}”.` :
      `There are no Word documents (.docx) or Markdown notes (.md) in “${dir.name}”.`);
    return null;
  }
  const box = document.createElement("div");
  box.className = "choose";
  names.forEach((n, k) => {
    const l = document.createElement("label");
    l.innerHTML = `<input type="radio" name="docpick" value="${k}"${k === 0 ? " checked" : ""}> `;
    l.append(n);
    box.appendChild(l);
  });
  const v = await ask(`Open from “${dir.name}”`, box, [["Open", "go", true]]);
  if (!v) return null;
  const k = +box.querySelector('input[name="docpick"]:checked').value;
  docDir = dir;
  return dir.getFileHandle(names[k]);
}

async function openDocFile(fh, ask = false) {
  if (!DOC_RE.test(fh.name)) {
    dialog("Open a Word Document or Note", `“${fh.name}” isn't ${DOC_WHAT}. ` +
      "Older .doc files: save them as .docx in Word or LibreOffice first.");
    return;
  }
  // RossDraft 1.5: an e-book, opened to read (epub.js)
  if (/\.epub$/i.test(fh.name)) {
    if (ask) { try { if (fh.requestPermission) await fh.requestPermission({ mode: "read" }); } catch (e) { /* read as it may */ } }
    const EP = await import("./epub.js?v=1.9.20");
    return openProject(null, fh.name, new EP.EpubStore(fh), fh);
  }
  let ro = false;
  if (ask) {
    try {
      const r = fh.requestPermission ? await fh.requestPermission({ mode: "readwrite" }) : "granted";
      ro = r !== "granted";
    } catch (e) { ro = true; }
  }
  if (/\.docx$/i.test(fh.name)) await openWordDoc(fh, ro);
  else if (/\.rtf$/i.test(fh.name)) await openMdFile(fh, ro, "rtf");
  else await openMdFile(fh, ro);
}

async function openMdFile(fh, readOnly = false, kind = "md") {
  $("start").hidden = true;
  await flushSave();
  let dir = docDir;
  if (kind === "rtf" && !dir) { try { const d = await kvGet("docDir"); if (d && d.kind === "directory" && await sameEntryIn(d, fh)) dir = d; } catch (e) { dir = null; } }
  const st = kind === "rtf" ? new RtfStore(fh, dir) : new MdFileStore(fh);
  if (kind === "rtf") {
    // no folder to keep it beside: the original is kept here, File ▸ Save the Original RTF… gives it back
    st.keepOriginal = async (name, bytes) => { await kvSet("rtfOriginal", { name, bytes }); };
    try { await kvSet("docDir", dir || null); } catch (e) { /* kept for this visit only */ }
  }
  st.canWrite = !readOnly;
  try { await busy("Opening " + fh.name + "…", () => queue(() => st.scan()), { after: 0 }); } catch (e) {
    dialog(kind === "rtf" ? "Open an RTF Document" : "Open a Note", `Couldn't open “${fh.name}”.\n\n${(e && e.message) || e}`);
    if (!S.store) start();
    return;
  }
  try { await kvSet("docFile", fh); } catch (e) { /* kept for this visit only */ }
  enterPlace(st);
  for (const p of P) { p.note = null; p.dirty = false; }
  S.store = st;
  if (typeof fitScope === "function") fitScope();
  renderTree();
  layout();
  const n = st.root.children[0];
  if (S.settings.split) await openNote(n, P[1]);
  await openNote(n, P[0]);
  updateCount();
  toast(fh.name + (n.readOnly ? " (read-only: " + n.readOnly.join(", ") + ")" : ""));
}

async function openWordDoc(fh, readOnly = false) {
  $("start").hidden = true;
  await flushSave();
  const st = new DocxStore(fh);
  st.canWrite = !readOnly;
  try { await busy("Opening " + fh.name + "…", () => queue(() => st.scan()), { after: 0 }); } catch (e) {
    dialog("Open a Word Document", `Couldn't open “${fh.name}”.\n\n${(e && e.message) || e}`);
    if (!S.store) start();
    return;
  }
  try { await kvSet("docFile", fh); } catch (e) { /* kept for this visit only */ }
  enterPlace(st);
  for (const p of P) { p.note = null; p.dirty = false; }
  S.store = st;
  if (typeof fitScope === "function") fitScope();
  renderTree();
  layout();
  const n = st.root.children[0];
  if (S.settings.split) await openNote(n, P[1]);
  await openNote(n, P[0]);
  updateCount();
  const cs = n.comments ? n.comments.length : 0;
  toast(`${fh.name}${n.readOnly ? " (read-only: " + n.readOnly.join(", ") + ")" : ""}${cs ? ` · ${cs} comment${cs === 1 ? "" : "s"}` : ""}`);
}

async function backToNotes() {
  await flushSave();
  if (S.notes) return openRoot(S.notes.handle, true);
  let h = null;
  try { h = await kvGet("root"); } catch (e) { /* none */ }
  if (h && h.kind === "directory") {
    let mode = "denied";
    try { mode = h.queryPermission ? await h.queryPermission({ mode: "readwrite" }) : "granted"; } catch (e) { /* asked below */ }
    if (mode !== "granted") { try { mode = await h.requestPermission({ mode: "readwrite" }); } catch (e) { mode = "denied"; } }
    if (mode === "granted") return openRoot(h);
  }
  chooseFolder();
}

// File ▸ Reopen …: the last project (or document), one tap; Android asks for the folder once after a restart
async function reopenProject() {
  let h = null, f = null;
  try { h = await kvGet("project"); f = await kvGet("projectFile"); } catch (e) { /* none */ }
  if (!h || h.kind !== "directory" || !f) return chooseProject();
  let mode = "denied";
  try { mode = h.queryPermission ? await h.queryPermission({ mode: "readwrite" }) : "granted"; } catch (e) { /* asked below */ }
  if (mode !== "granted") { try { mode = await h.requestPermission({ mode: "readwrite" }); } catch (e) { mode = "denied"; } }
  if (mode !== "granted") { dialog("Reopen the Project", `Android didn't let Ross Note into “${h.name}”. Use File ▸ Open a Ross Writer Project… to choose it again.`); return; }
  return openProject(h, f);
}

async function reopenDoc() {
  let fh = null;
  try { fh = await kvGet("docFile"); } catch (e) { /* none */ }
  if (!fh || fh.kind !== "file") return chooseWordDoc();
  return openDocFile(fh, true);
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
  if (ED.project) setTimeout(renderDraftHead, 0);
  const tree = $("tree");
  tree.textContent = "";
  const q = S.searching.trim().toLowerCase();
  const exp = new Set(S.settings.expanded);
  const add = (note, depth) => {
    const row = document.createElement("div");
    row.className = "row" + (S.note && note.key() === S.note.key() ? " cur" : "") + (S.sel.has(note.key()) ? " sel" : "");
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
    if (note.flag && FLAG_COLOURS[note.flag()]) {
      const f = document.createElement("span");
      f.className = "flag";
      f.style.background = FLAG_COLOURS[note.flag()];
      row.insertBefore(f, lbl);
    }
    // RossDraft: the status before the title, left out of Compile shown dim, the synopsis on pointing, dragging
    if (draftOn() && note.raw) {
      const chip = statusChip(note);
      if (chip) row.insertBefore(chip, lbl);
      if (note.raw.include === false) { row.classList.add("noinc"); lbl.title = "Left out of Compile"; }
      if (note.raw.synopsis) row.title = note.raw.synopsis;
    }
    dragRow(row, note);
    if (note.readOnly) {
      const ro = document.createElement("span");
      ro.className = "ro";
      ro.textContent = "read-only";
      ro.title = `Has ${note.readOnly.join(", ")}: edit it in Ross Writer`;
      row.appendChild(ro);
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
    // 1.9.4: a long press with a finger is a Ctrl-click (several notes as one page, by touch)
    row.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "touch") return;
      const x0 = e.clientX, y0 = e.clientY;
      clearTimeout(row._lpTimer);
      const stop = () => { clearTimeout(row._lpTimer); row.removeEventListener("pointermove", move); row.removeEventListener("pointerup", stop); row.removeEventListener("pointercancel", stop); };
      const move = (m) => { if (Math.abs(m.clientX - x0) > 10 || Math.abs(m.clientY - y0) > 10) stop(); };
      row.addEventListener("pointermove", move);
      row.addEventListener("pointerup", stop);
      row.addEventListener("pointercancel", stop);
      row._lpTimer = setTimeout(() => {
        stop();
        row._lp = true;
        if (navigator.vibrate) { try { navigator.vibrate(15); } catch (err) { /* none */ } }
        selectClick(note, { ctrlKey: true, metaKey: false, shiftKey: false });
      }, 500);
    });
    row.addEventListener("contextmenu", (e) => { if (row._lp || e.pointerType === "touch") e.preventDefault(); });
    row.onclick = (e) => {
      if (row._lp) { row._lp = false; e.preventDefault(); return; }         // the tap that ended a long press
      if (e.ctrlKey || e.metaKey || e.shiftKey) { e.preventDefault(); return selectClick(note, e); }   // 1.9.3: several as one page
      clearSel();
      openNote(note);
      if ($("app").classList.contains("app-narrow")) { S.sideOpenNarrow = false; layout(); }
    };
    row.addEventListener("mousedown", (e) => { if (e.shiftKey) e.preventDefault(); });     // no text selected in the list
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
  if (ED.project) setTimeout(renderDraftHead, 0);
  goalSoon();
  const n = S.store ? S.store.all().length : 0;
  const proj = S.store && S.store.isProject;
  $("count").textContent = S.store && S.store.isDoc ? `${S.store.isRtf ? "RTF" : S.store.isMd ? "Note" : "Word"}: ${S.store.label} · ${ED.name} ${SHOWN}` :
    `${n} ${proj ? (n === 1 ? "entry" : "entries") : n === 1 ? "note" : "notes"} · ` +
    `${S.store ? (proj ? (S.store.isEpub ? "E-book: " : S.store.isScriv ? "Scrivener: " : "Ross Writer: ") + S.store.label : S.store.handle.name) : ""} · ${ED.name} ${SHOWN}`;
  document.body.classList.toggle("in-project", !!proj);
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
    p.hname.textContent = n ? [...n.ancestors().reverse().map((a) => a.title()), titleNow(p.page)].join("  ›  ") +
      (n.readOnly ? `  (read-only: it has ${n.readOnly.join(", ")}; edit it in Ross Writer)` : "") : "No note open";
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
  renderComments();
}

// ------------------------------------------------------------------ Word comments (Ross Writer scenes)
// The scene's comments listed beside the page: who, when, the words they're on, what they say. They're
// kept in the Word file as you edit (wordpatch.js); here they're read only. Tap one to go to its words.
// the comments pane's own text size (11 to 26), remembered
function commentSize(step) {
  const s = S.settings;
  s.cSize = step === 0 ? 13 : Math.max(11, Math.min(26, (s.cSize || 13) + step));
  saveSettings();
  document.documentElement.style.setProperty("--csize", s.cSize + "px");
  toast("Comments text size " + s.cSize, 1200);
}
document.documentElement.style.setProperty("--csize", (S.settings.cSize || 13) + "px");

function toggleComments() {
  S.settings.showComments = !S.settings.showComments;
  saveSettings();
  renderComments();
}

function commentDate(iso) {
  const d = new Date(iso);
  return isNaN(d) ? "" : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

const shownComments = new WeakMap();
function renderComments() {
  for (const p of P) {
    const cs = (p.note && p.note.comments) || [];
    const open = cs.filter((c) => !c.done).length;
    p.hcomments.hidden = !cs.length;
    p.hcomments.textContent = cs.length ? `${cs.length} comment${cs.length === 1 ? "" : "s"}${open < cs.length ? ` (${cs.length - open} resolved)` : ""}` : "";
    p.hcomments.classList.toggle("on", !!S.settings.showComments);
    p.hcomments.title = S.settings.showComments ? "Hide the comments" : "Show the comments";
    const insp = inspectorOn(p);
    const fn = fnOn(p);
    const show = !!S.settings.showComments && (cs.length > 0 || insp || fn) && !p.el.hidden;
    p.cpanel.hidden = !show;
    p.el.classList.toggle("cbelow", p.el.clientWidth < 760);
    if (!show) continue;
    // RossDraft: the panel's two tabs, Synopsis & Notes, and Comments
    if (fn && S.settings.ptab === "footnotes") { renderFootnotes(p, panelTabs(p, cs)); continue; }
    if (insp && ((S.settings.ptab || "notes") === "notes" || !cs.length)) { renderInspector(p, panelTabs(p, cs)); continue; }
    if (fn && !cs.length) { renderFootnotes(p, panelTabs(p, cs)); continue; }
    const key = JSON.stringify(cs) + (insp || fn ? "|tabs" : "");
    if (shownComments.get(p.cpanel) === key) continue;
    shownComments.set(p.cpanel, key);
    shownInspector.delete(p.cpanel);
    p.cpanel.textContent = "";
    if (insp || fn) { p.cpanel.appendChild(panelTabs(p, cs)); }
    const top = document.createElement("div");
    top.className = "ctop";
    top.textContent = insp ? "" : "Comments";
    const x = document.createElement("button");
    x.type = "button";
    x.textContent = "✕";
    x.title = "Hide the comments";
    x.onclick = toggleComments;
    // the comments' text size: A− / A+ (also View ▸ Comments Text Larger / Smaller, Ctrl+Alt+= / Ctrl+Alt+−)
    const sizes = document.createElement("span");
    sizes.className = "csizes";
    for (const [label, step, tip] of [["A−", -1, "Smaller text in the comments (Ctrl+Alt+−)"], ["A+", 1, "Larger text in the comments (Ctrl+Alt+=)"]]) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.title = tip;
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.onclick = (e) => { e.stopPropagation(); commentSize(step); };
      sizes.appendChild(b);
    }
    top.appendChild(sizes);
    top.appendChild(x);
    p.cpanel.appendChild(top);
    const replies = (id) => cs.filter((c) => c.parent === id);
    const item = (c, reply) => {
      const it = document.createElement("div");
      it.className = "citem" + (reply ? " reply" : "") + (c.done ? " done" : "");
      const who = document.createElement("div");
      who.className = "cwho";
      who.textContent = [c.author || "Someone", commentDate(c.date), c.done ? "resolved" : ""].filter(Boolean).join(" · ");
      it.appendChild(who);
      if (c.words && !reply) {
        const q = document.createElement("div");
        q.className = "cwords";
        q.textContent = "“" + (c.words.length > 140 ? c.words.slice(0, 140) + "…" : c.words) + "”";
        it.appendChild(q);
      }
      const t = document.createElement("div");
      t.className = "ctext";
      t.textContent = c.text;
      it.appendChild(t);
      const acts = document.createElement("div");
      acts.className = "cacts";
      const act = (label, fn) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = label;
        b.onclick = (e) => { e.stopPropagation(); fn(); };
        acts.appendChild(b);
      };
      act("Reply", () => commentAction(p, c, "reply"));
      act("Edit", () => commentAction(p, c, "edit"));
      if (!reply) act(c.done ? "Reopen" : "Resolve", () => commentAction(p, c, "resolve"));
      act("Delete", () => commentAction(p, c, "delete"));
      it.appendChild(acts);
      it.onclick = () => goToWords(p, c.words || (cs.find((o) => o.id === c.parent) || {}).words || "");
      p.cpanel.appendChild(it);
      for (const r of replies(c.id)) item(r, true);
    };
    for (const c of cs) if (!c.parent || !cs.some((o) => o.id === c.parent)) item(c, false);
  }
}

// your name on comments (asked the first time; Insert ▸ Your Name for Comments… to change it)
async function askAuthor(force) {
  const s = S.settings;
  if (s.commentAuthor && !force) return { author: s.commentAuthor, initials: s.commentInitials || "" };
  const box = document.createElement("div");
  box.className = "cform";
  box.innerHTML = '<label>Your name, as comments show it<input type="text" class="cname"></label>' +
    '<label>Initials<input type="text" class="cinit" maxlength="6"></label>';
  const nameIn = box.querySelector(".cname"), initIn = box.querySelector(".cinit");
  nameIn.value = s.commentAuthor || "";
  initIn.value = s.commentInitials || "";
  nameIn.addEventListener("input", () => {
    if (!initIn.dataset.touched) initIn.value = nameIn.value.split(/\s+/).filter(Boolean).map((w) => w[0].toUpperCase()).join("").slice(0, 4);
  });
  initIn.addEventListener("input", () => { initIn.dataset.touched = "1"; });
  setTimeout(() => nameIn.focus(), 50);
  const v = await ask("Your Name for Comments", box, [["OK", "ok", true]]);
  if (!v || !nameIn.value.trim()) return null;
  s.commentAuthor = nameIn.value.trim();
  s.commentInitials = initIn.value.trim();
  saveSettings();
  return { author: s.commentAuthor, initials: s.commentInitials };
}

// a comment's words, typed in a box
async function commentText(title, quoted, start = "", button = "OK") {
  const box = document.createElement("div");
  box.className = "cform";
  if (quoted) {
    const q = document.createElement("div");
    q.className = "cquote";
    q.textContent = "“" + (quoted.length > 160 ? quoted.slice(0, 160) + "…" : quoted) + "”";
    box.appendChild(q);
  }
  const ta = document.createElement("textarea");
  ta.rows = 5;
  ta.value = start;
  ta.spellcheck = true;
  box.appendChild(ta);
  setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 50);
  const v = await ask(title, box, [[button, "ok", true]]);
  return v ? ta.value.replace(/\s+$/, "") : null;
}

// Insert ▸ Comment (Ctrl+Alt+M): on the words selected (or the word at the caret)
async function addComment() {
  const p = A;
  const n = p.note;
  if (!n || !S.store || !S.store.isProject || !n.comments) {
    toast("Comments are for Ross Writer scenes and Word documents.");
    return;
  }
  let c = ed.caret(p.page);
  if (!c) { toast("Select the words the comment is on first."); return; }
  if (c.a.line === c.b.line && c.a.pos === c.b.pos) {
    // no selection: the word at the caret
    const t = ed.lineText(p.page.children[c.a.line]);
    let a = c.a.pos, b = c.a.pos;
    while (a > 0 && /[\p{L}\p{N}'’-]/u.test(t[a - 1])) a--;
    while (b < t.length && /[\p{L}\p{N}'’-]/u.test(t[b])) b++;
    if (a === b) { toast("Select the words the comment is on first."); return; }
    c = { a: { line: c.a.line, pos: a }, b: { line: c.a.line, pos: b } };
  }
  const lines = [...p.page.children].map((d) => ed.lineText(d));
  const words = lines.slice(c.a.line, c.b.line + 1).map((t, k, arr) =>
    t.slice(k === 0 ? c.a.pos : 0, k === arr.length - 1 ? c.b.pos : undefined)).join(" ").trim();
  const who = await askAuthor(false);
  if (!who) return;
  const text = await commentText("New Comment", words, "", "Add");
  if (text == null || !text.trim()) return;
  await flushSave();
  try {
    await queue(() => S.store.commentOp(n, { kind: "add", a: c.a, b: c.b, pageLines: [...p.page.children].map((d) => ed.lineText(d)), text, ...who }));
  } catch (e) { dialog("New Comment", (e && e.message) || String(e)); return; }
  S.settings.showComments = true;
  saveSettings();
  renderComments();
  toast("Comment added.");
}

async function commentAction(p, c, kind) {
  const n = p.note;
  if (!n) return;
  let op = { kind, id: c.id };
  if (kind === "reply" || kind === "edit") {
    const who = kind === "reply" ? await askAuthor(false) : {};
    if (!who) return;
    const text = await commentText(kind === "reply" ? "Reply" : "Edit Comment", c.words, kind === "edit" ? c.text : "",
      kind === "reply" ? "Reply" : "Save");
    if (text == null || (kind === "reply" && !text.trim())) return;
    op = { ...op, text, ...who };
  } else if (kind === "resolve") op.done = !c.done;
  else if (kind === "delete") {
    const replies = (n.comments || []).filter((x) => x.parent === c.id).length;
    if (!confirm(`Delete ${c.author ? c.author + "’s" : "this"} comment${replies ? ` and its ${replies} repl${replies === 1 ? "y" : "ies"}` : ""}?`)) return;
  }
  await flushSave();
  try { await queue(() => S.store.commentOp(n, op)); } catch (e) { dialog("Comments", (e && e.message) || String(e)); return; }
  renderComments();
  toast({ reply: "Reply added.", edit: "Comment changed.", resolve: op.done ? "Resolved." : "Reopened.", delete: "Comment deleted." }[kind]);
}

// the words a comment is on, found in the page, selected and scrolled to
function goToWords(p, words) {
  const want = (words || "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!want) return;
  const lines = [...p.page.children];
  const starts = [];
  let at = 0;
  const text = lines.map((d) => { const t = ed.lineText(d); starts.push(at); at += t.length + 1; return t; }).join(" ");
  const k = text.replace(/\s/g, " ").indexOf(want);
  if (k < 0) { toast("Those words aren't in the page any more."); return; }
  const where = (off) => {
    let i = 0;
    while (i + 1 < starts.length && starts[i + 1] <= off) i++;
    return ed.pointAt(lines[i], off - starts[i]);
  };
  const r = document.createRange();
  r.setStart(...where(k));
  r.setEnd(...where(k + want.length));
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
  const div = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement;
  const line = div && div.closest(".ln");
  if (line) line.scrollIntoView({ block: "center" });
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
  return [...pg.children].map((d) => ed.lineText(d)).join("\n").split(md.OBJ).join("").split("\u200b").join("").replace(/\uE000[fe]-?\d+\uE001/g, "");
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
    if (pane.joined) { pane.joined = null; pane.el.classList.remove("joined"); }
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
  pane.page.contentEditable = pane.note.readOnly ? "false" : "true";
  pane.el.classList.toggle("readonly", !!pane.note.readOnly);
  loadPictures(pane.page);
  pane.page.dataset.loaded = "1";
  spellSoon(0);
  showPdfIn(pane);
}

// RossDraft 1.4: a PDF entry (research) shown in the page's place (research.js), read-only
async function showPdfIn(pane) {
  if (pane.pdfv) { try { pane.pdfv.destroy(); } catch (e) { /* gone */ } pane.pdfv = null; }
  if (pane.pdfbox) pane.pdfbox.hidden = true;
  pane.page.hidden = false;
  const n = pane.note;
  if (!ED.project || !n || !n.raw || !n.raw.pdf || pane.joined || !S.store || !S.store.pdfFile) return;
  const f = await S.store.pdfFile(n);
  if (!f || pane.note !== n) return;
  if (!pane.pdfbox) {
    pane.pdfbox = document.createElement("div");
    pane.pdfbox.className = "pdfbox";
    pane.page.parentNode.insertBefore(pane.pdfbox, pane.page.nextSibling);
  }
  pane.pdfbox.hidden = false;
  pane.page.hidden = true;
  try {
    const R = await busy("Opening the PDF…", () => import("./research.js?v=1.9.20"), { after: 400 });
    const v = await R.showPdf(pane.pdfbox, f, { share: sharePdf });
    if (pane.note !== n) { v.destroy(); return; }
    pane.pdfv = v;
  } catch (e) {
    pane.pdfbox.hidden = true;
    pane.page.hidden = false;
    toast("The PDF couldn't be shown here: " + ((e && e.message) || e));
  }
}
async function sharePdf(file) {
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: file.name }); return; } catch (e) { if (e && e.name === "AbortError") return; }
  }
  const saved = await saveFile(file, file.name, "PDF", ".pdf", "application/pdf");
  if (saved) toast("Saved " + saved);
}

// File ▸ Export Project… (as Ross Writer's): a Ross Writer project (a copy; from Scrivener, one made from it),
// readable folders, or a Scrivener project (export.js). The project itself is never changed.
async function exportProject() {
  if (!draftOn()) { toast("Export Project is for a Ross Writer or Scrivener project: open one first."); return; }
  if (!window.showDirectoryPicker) { dialog("Export Project", "This browser can't make folders on this device."); return; }
  await flushSave();
  const X = await import("./export.js?v=1.9.20");
  const scr = !!(S.store.isScriv || S.store.isEpub);
  const box = document.createElement("div");
  box.className = "choose";
  const p = document.createElement("p");
  p.textContent = `Export “${S.store.label}” as:`;
  box.appendChild(p);
  const opts = [["copy", X.KINDS.copy.label, scr ? X.KINDS.copy.scriv : X.KINDS.copy.rw],
    ["readable", X.KINDS.readable.label, X.KINDS.readable.all], ...(S.store.isScriv ? [] : [["scrivener", X.KINDS.scrivener.label, X.KINDS.scrivener.rw]])];
  opts.forEach(([v, label, what], k) => {
    const l = document.createElement("label");
    l.innerHTML = `<input type="radio" name="xk" value="${v}"${k ? "" : " checked"}> <span><b>${escapeHtml(label)}</b><br><small>${escapeHtml(what)}</small></span>`;
    box.appendChild(l);
  });
  const n2 = document.createElement("p");
  n2.className = "muted";
  n2.textContent = "Next you choose where: a new folder named after the project is made there. Nothing there is overwritten, and the project itself isn't changed.";
  box.appendChild(n2);
  if (await ask("Export Project", box, [["Choose Where…", "go", true]]) !== "go") return;
  const kind = box.querySelector("input[name=xk]:checked").value;
  let where;
  try { where = await window.showDirectoryPicker({ id: "rdexport", mode: "readwrite" }); } catch (e) {
    if (e && e.name !== "AbortError") dialog("Export Project", `The folder picker didn't open.\n\n${(e && e.message) || e}`);
    return;
  }
  return exportProjectTo(kind, where);
}
async function exportProjectTo(kind, where) {
  const X = await import("./export.js?v=1.9.20");
  let got;
  try {
    got = await busy("Exporting…", (say) => queue(async () => {
      const prog = (k, n) => say(`Exporting: ${k} of ${n}`);
      if (kind === "copy") return X.exportRoss(S.store, where, prog);
      if (kind === "readable") return X.exportReadable(S.store, where, prog);
      return X.exportScrivener(S.store, where, prog);
    }), { after: 0 });
  } catch (e) {
    dialog("Export Project", `The project couldn't be exported.\n\n${(e && e.message) || e}`);
    return null;
  }
  const what = kind === "readable" ? "readable folders" : kind === "scrivener" ? "a Scrivener project" : "a Ross Writer project";
  const q = document.createElement("div");
  q.textContent = `Exported as ${what}: “${got.dir.name}” in “${where.name}”.`;
  if (kind !== "readable" && !RN_TEST_NOASK) {
    if (await ask("Export Project", q, [["Open It", "open"], ["OK", "ok", true]]) === "open") await openProject(got.dir, got.file);
  } else toast(q.textContent, 6000);
  return got;
}
let RN_TEST_NOASK = false;

// Notes ▸ Add a PDF…: a research PDF as an entry where you are (copied into the project, left out of Compile)
function addPdfEntry() {
  if (!draftOn() || !S.store.addPdf) { toast("A PDF entry goes into a Ross Writer or Scrivener project: open one first."); return; }
  const inp = document.createElement("input");
  inp.type = "file";
  inp.accept = ".pdf,application/pdf";
  inp.onchange = async () => {
    const f = inp.files && inp.files[0];
    if (!f) return;
    if (!/\.pdf$/i.test(f.name) && f.type !== "application/pdf") { dialog("Add a PDF", `“${f.name}” isn't a PDF.`); return; }
    await flushSave();
    const cur = S.note;
    const parent = cur ? cur.parent : S.store.root;
    const index = cur ? parent.children.indexOf(cur) + 1 : parent.children.length;
    let n;
    try { n = await busy("Adding “" + f.name + "”…", () => queue(() => S.store.addPdf(parent, index, f.name.replace(/\.pdf$/i, ""), f)), { after: 0 }); } catch (e) {
      dialog("Add a PDF", `Couldn't add it.\n\n${(e && e.message) || e}`);
      return;
    }
    renderTree();
    await openNote(n);
    toast(`“${n.title()}” is in the project (left out of Compile).`);
  };
  inp.click();
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
  if (!S.store && !S.notes) return;
  const home = S.notes || (S.store && S.store.readTop ? S.store : null);
  if (!home) return;
  const [text, when] = await home.readTop(DICT_FILE);
  if (!force && when && when === dictTime) return;
  dictTime = when;
  spell.setOwn(text ? text.split(/\r?\n/) : []);
  spellSoon(0);
}

async function saveDictionary() {
  const text = spell.ownWords().join("\n") + "\n";
  const home = S.notes || (S.store && S.store.writeTop ? S.store : null);
  if (!home) { toast("Open your notes once first: your dictionary is kept in the RossNotes folder."); return; }
  try { await queue(async () => { dictTime = await home.writeTop(DICT_FILE, text); }); } catch (e) { /* the queue said so */ }
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
  const r = range.getBoundingClientRect(), z = uiz();
  const top = r.bottom + 8 + bar.offsetHeight * z > window.innerHeight ? r.top - bar.offsetHeight * z - 8 : r.bottom + 8;
  putAt(bar, Math.max(8, Math.min(r.left, window.innerWidth - bar.offsetWidth * z - 8)), Math.max(8, top));
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
  if (!pane.note || pane.note.readOnly) return;
  pane.dirty = true;
  if (pane.note.fnotes && !pane.joined) { ed.numberNotes(pane.page); fnotesSoon(pane); }
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
  if (pane.joined) return saveJoined(pane);
  if (pane.note.readOnly) { pane.dirty = false; return; }
  pane.dirty = false;
  const note = pane.note;
  const lines = ed.readLines(pane.page);
  const text = md.serialize(lines, { dir: note.folderParts() });
  if (text !== note.text || note.fnDirty) {
    const now = await S.store.peek(note);
    if (now && now.modified !== note.modified && now.text !== note.text && now.text !== text) {
      // changed on the laptop too since we read it: theirs is kept, not lost
      await S.store.keepConflict(note, now.text);
      toast(S.store.isProject ? "This scene had also changed on another device; that version is kept in the project's Trash folder."
        : "This note had also changed on another device; that version is kept in the .trash folder.");
    }
    await S.store.write(note, text);
    // the same note open in the other pane shows what was just saved
    for (const q of P) if (q !== pane && q.note === note && !q.dirty) refill(q);
    // a scene's comments as the saved file has them now (one on deleted words is gone)
    if (note.comments) renderComments();
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
  if (q.joined) {
    const top = q.scroller.scrollTop, had = document.activeElement === q.page, c = had ? ed.caret(q.page) : null;
    showJoined(q);
    q.scroller.scrollTop = top;
    if (had) ed.setCaret(q.page, c);
    return;
  }
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
  if (S.store && S.store.isDoc) { toast("A Word document opened by itself is one page. File ▸ Back to My Notes for notes."); return; }
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
  if (S.store && S.store.isDoc) { toast("A Word document opened by itself is one page. File ▸ Back to My Notes for notes."); return; }
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
  return moveTo(n, target, index);
}

// a note (and the notes under it) to its new place: under target, at index (also drag and drop)
async function moveTo(n, target, index) {
  await flushSave();
  if (n === target || [...n.walk()].includes(target)) return;
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
  if (!target.isRoot()) S.settings.expanded = [...new Set([...S.settings.expanded, target.key()])];
  S.settings.open = n.key();
  saveSettings();
  for (const p of P) if (p.note && moving.includes(p.note)) { S.settings[p.k ? "open2" : "open"] = p.note.key(); refill(p); }
  saveSettings();
  renderTree();
  updateHead();
}

async function deleteNote() {
  if (S.store && S.store.isDoc) { toast("A Word document opened by itself is one page. File ▸ Back to My Notes for notes."); return; }
  const n = S.note;
  if (!n) return;
  const under = [...n.walk()].length;
  const proj = S.store.isProject;
  if (!confirm(`Delete “${n.title()}”${under ? ` and the ${under} ${proj ? "entr" + (under === 1 ? "y" : "ies") : "note" + (under === 1 ? "" : "s")} under it` : ""}?\n\n` +
    (proj ? "Its Word file goes to the project's Trash folder, as in Ross Writer." : "It goes to the .trash folder inside RossNotes, in case."))) return;
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

// ------------------------------------------------------------------ 1.9.20: Fonts (Ctrl+D)
// The writing page's typeface and size (the page's look: the files keep their own; a note's Markdown has no fonts).
// All are bundled (SIL Open Font License), so the page looks the same on the tablet and the laptop, offline too.
const SERIF = '"Liberation Serif", "Noto Serif", serif';
const PAGE_FONTS = [
  ["literata", "Literata", `Literata, Cambria, Caladea, ${SERIF}`, "made for reading on screens"],
  ["classic", "Cambria (as Ross Writer)", `Cambria, Caladea, ${SERIF}`, "the laptop's look (Caladea here: the same widths)"],
  ["garamond", "EB Garamond", `"EB Garamond", Garamond, ${SERIF}`, "a classic book face"],
  ["lora", "Lora", `Lora, ${SERIF}`, "warm, for long reading"],
  ["sourceserif", "Source Serif", `"Source Serif 4", "Source Serif Pro", ${SERIF}`, "clear and even"],
  ["inter", "Inter", 'Inter, "Helvetica Neue", Arial, sans-serif', "a clean sans-serif"],
  ["courier", "Courier Prime", '"Courier Prime", "Courier New", monospace', "typewriter: a manuscript's look"],
];

async function fontsDialog() {
  const s = S.settings;
  const was = { font: s.font, size: s.size, ink: s.ink, ui: s.ui };
  const box = document.createElement("div");
  box.className = "fonts";
  const sample = "The night came down on St David’s.";
  box.innerHTML = `<div class="fonts-list">${PAGE_FONTS.map(([id, label, stack, what]) =>
    `<label class="fontrow"><input type="radio" name="pagefont" value="${id}"${(s.font || "literata") === id ? " checked" : ""}>` +
    `<span class="fname">${label} <small>${what}</small></span><span class="fsample" style='font-family: ${stack}'>${sample}</span></label>`).join("")}</div>` +
    `<div class="fonts-size">Size <button type="button" class="fminus" aria-label="Smaller">A−</button>` +
    `<b class="fsize">${s.size}</b><button type="button" class="fplus" aria-label="Larger">A+</button>` +
    `<button type="button" class="freset">Usual (18)</button></div>` +
    `<div class="fonts-size fonts-ink">Darkness ${INKS.map(([l, v]) => `<button type="button" data-ink="${v}"${(s.ink || "normal") === v ? ' class="on"' : ""}>${l}</button>`).join("")}</div>` +
    `<div class="fonts-size fonts-ui">Interface <select class="fui">${UI_SIZES.map(([l, v]) => `<option value="${v}"${(s.ui || 100) === v ? " selected" : ""}>${l} (${v}%)</option>`).join("")}</select></div>`;
  const show = () => { box.querySelector(".fsize").textContent = s.size; applyLook(); };
  box.addEventListener("change", (e) => { if (e.target.name === "pagefont") { s.font = e.target.value; show(); } });
  box.querySelector(".fminus").onclick = () => { s.size = Math.max(11, s.size - 1); show(); };
  box.querySelector(".fplus").onclick = () => { s.size = Math.min(40, s.size + 1); show(); };
  box.querySelector(".freset").onclick = () => { s.size = 18; show(); };
  for (const b of box.querySelectorAll("[data-ink]")) b.onclick = () => {
    s.ink = b.dataset.ink; for (const o of box.querySelectorAll("[data-ink]")) o.classList.toggle("on", o === b); show(); };
  box.querySelector(".fui").onchange = (e) => { s.ui = +e.target.value; show(); };
  const v = await ask("Fonts", box, [["OK", "ok", true]]);
  if (v !== "ok") Object.assign(s, was);
  saveSettings();
  applyLook();
}

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
  if (A.joined) { guardJoined(e, A); if (e.defaultPrevented) return; }
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
  if (c && e.altKey && !e.shiftKey && (k === "m" || k === "M" || e.code === "KeyM")) fn = addComment;
  else if (c && !e.altKey && !e.shiftKey && (e.code === "KeyK" || k === "k" || k === "K")) fn = commandPalette;
  else if (c && e.shiftKey && !e.altKey && k === "Enter") fn = toggleFocus;
  else if (c && e.shiftKey && !e.altKey && (e.code === "KeyA" || k === "a" || k === "A")) fn = selectAllShown;
  else if (c && e.altKey && !e.shiftKey && (e.code === "KeyY" || k === "y" || k === "Y") && draftOn()) fn = showInspector;
  else if (c && e.altKey && !e.shiftKey && (e.code === "KeyE" || k === "e" || k === "E") && draftOn()) fn = compileDialog;
  else if (c && e.altKey && !e.shiftKey && (e.code === "KeyL" || k === "l" || k === "L")) fn = toggleClassic;
  else if (c && e.altKey && !e.shiftKey && (e.code === "BracketLeft" || e.code === "BracketRight")) fn = () => sideWidth(e.code === "BracketRight" ? 30 : -30);
  else if (c && e.shiftKey && (k === "H" || k === "h")) fn = COMMANDS.highlight;
  else if (c && e.shiftKey && (k === "X" || k === "x")) fn = COMMANDS.strike;
  else if (c && e.shiftKey && (k === "N" || k === "n")) fn = COMMANDS.normal;
  else if (c && e.shiftKey && (k === "*" || e.code === "Digit8")) fn = COMMANDS.ul;
  else if (c && e.shiftKey && (k === "&" || e.code === "Digit7")) fn = COMMANDS.ol;
  else if (c && e.shiftKey && (k === "D" || k === "d")) fn = COMMANDS.dark;
  else if (c && !e.shiftKey && !e.altKey && (k === "d" || k === "D" || e.code === "KeyD")) fn = fontsDialog;
  else if (c && e.shiftKey && !e.altKey && (k === "L" || k === "l")) fn = togglePageView;
  else if (c && e.altKey && !e.shiftKey && (k === "j" || k === "J" || e.code === "KeyJ")) fn = toggleList;
  else if (c && e.altKey && !e.shiftKey && (k === "i" || k === "I" || e.code === "KeyI")) fn = togglePop;
  else if (c && e.altKey && !e.shiftKey && (k === "o" || k === "O" || e.code === "KeyO")) fn = showHeadings;
  else if (c && e.altKey && !e.shiftKey && (k === "f" || k === "F" || e.code === "KeyF")) fn = fnOn(A) ? () => insertNote("footnote") : focusSearch;
  else if (c && e.altKey && !e.shiftKey && (k === "d" || k === "D" || e.code === "KeyD") && fnOn(A)) fn = () => insertNote("endnote");
  else if (c && e.altKey && e.shiftKey && (k === "v" || k === "V" || e.code === "KeyV")) fn = () => pasteFromClipboard(true);
  else if (c && e.altKey && !e.shiftKey && (k === "=" || k === "+" || e.code === "Equal")) fn = () => commentSize(1);
  else if (c && e.altKey && !e.shiftKey && (k === "-" || e.code === "Minus")) fn = () => commentSize(-1);
  else if (c && e.altKey && !e.shiftKey && (k === "0" || e.code === "Digit0")) fn = () => commentSize(0);
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
  const w = chip.offsetWidth * uiz(), h = chip.offsetHeight * uiz();
  let top = r.bottom + 6;
  if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
  putAt(chip, Math.max(8, Math.min(window.innerWidth - w - 8, r.left)), top);
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
function fillMenu(m, items, sub) {
  m.textContent = "";
  for (const it of items) {
    if (it === "-") { m.appendChild(document.createElement("hr")); continue; }
    if (typeof it === "string") { const l = document.createElement("div"); l.className = "lab"; l.textContent = it; m.appendChild(l); continue; }
    const b = document.createElement("button");
    const tick = document.createElement("span");
    tick.className = "tick";
    tick.textContent = it.on ? "✓" : "";
    b.append(tick, document.createTextNode(it.label));
    if (it.keys || it.sub) { const k = document.createElement("span"); k.className = "keys"; k.textContent = it.sub ? "▸" : it.keys; b.appendChild(k); }
    if (it.off) b.disabled = true;
    b.addEventListener("mousedown", (e) => e.preventDefault());       // the caret stays in the note
    if (it.sub) {
      // 1.9.4: a submenu, opened by pointing at it, a click or a tap, or → on the keyboard
      b.classList.add("has-sub");
      const open = () => showSubmenu(b, it.sub);
      b.addEventListener("mouseenter", open);
      b.onclick = open;
      b.addEventListener("keydown", (e) => { if (e.key === "ArrowRight") { e.preventDefault(); open(); const f = $("submenu").querySelector("button:not(:disabled)"); if (f) f.focus(); } });
    } else {
      if (!sub) b.addEventListener("mouseenter", hideSubmenu);
      if (sub) b.addEventListener("keydown", (e) => { if (e.key === "ArrowLeft") { e.preventDefault(); const o = $("menu").querySelector("button.has-sub.open"); hideSubmenu(); if (o) o.focus(); } });
      b.onclick = () => { hideMenu(); it.fn(); };
    }
    m.appendChild(b);
  }
}
function showMenu(anchor, items) {
  const m = $("menu");
  hideSubmenu();
  fillMenu(m, items, false);
  m.hidden = false;
  const r = anchor.getBoundingClientRect(), z = uiz();
  putAt(m, 0, 0);          // measured where there's room for all of it
  putAt(m, Math.max(8, Math.min(r.left, window.innerWidth - m.offsetWidth * z - 8)),
    Math.max(8, Math.min(r.bottom + 2, window.innerHeight - m.offsetHeight * z - 8)));
}
function showSubmenu(btn, items) {
  const sm = $("submenu");
  for (const o of $("menu").querySelectorAll("button.has-sub.open")) o.classList.remove("open");
  btn.classList.add("open");
  fillMenu(sm, typeof items === "function" ? items() : items, true);
  sm.hidden = false;
  const r = btn.getBoundingClientRect(), mr = $("menu").getBoundingClientRect(), z = uiz();
  putAt(sm, 0, 0);
  const sw = sm.offsetWidth * z, sh = sm.offsetHeight * z;
  let left = mr.right - 4;
  if (left + sw > window.innerWidth - 8) left = Math.max(8, mr.left - sw + 4);   // no room: on the left
  putAt(sm, left, Math.max(8, Math.min(r.top - 4, window.innerHeight - sh - 8)));
}
function hideSubmenu() {
  const sm = $("submenu");
  if (sm) sm.hidden = true;
  for (const o of document.querySelectorAll("#menu button.has-sub.open")) o.classList.remove("open");
}
function hideMenu() {
  hideSubmenu();
  $("menu").hidden = true;
  openMenu = null;
  for (const b of document.querySelectorAll("#menubar button")) b.classList.remove("open");
}
document.addEventListener("pointerdown", (e) => {
  if (!$("menu").hidden && !$("menu").contains(e.target) && !$("submenu").contains(e.target) && !$("menubar").contains(e.target)) hideMenu();
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
      { label: "New Note Under This One", fn: () => newNote(true), off: !n || !!(S.store && S.store.isDoc) },
      "-",
      { label: "New Ross Writer Project…", fn: () => newProject(), off: !window.showDirectoryPicker },
      ...(ED.project ? [{ label: "New Scrivener Project…", fn: () => newProject({ scrivener: true }), off: !window.showDirectoryPicker }] : []),
      { label: ED.project ? "Open a Project (Ross Writer or Scrivener)…" : "Open a Ross Writer Project…", fn: chooseProject, off: !window.showDirectoryPicker },
      ...(ED.project ? [{ label: "Scrivener Backups…", fn: () => scrivBackups() }] : []),
      { label: "Choose Another Folder…", fn: chooseAnotherFolder, off: !window.showDirectoryPicker },
      ...(s.lastProject && !(S.store && S.store.isProject && !S.store.isDoc && S.store.fileName === s.lastProject.file)
        ? [{ label: `Reopen “${s.lastProject.name}”`, fn: reopenProject }] : []),
      { label: ED.project ? "Open a Document (Word, RTF, E-book, Markdown)…" : "Open a Word Document or Note…", fn: chooseWordDoc, off: !window.showOpenFilePicker && !window.showDirectoryPicker },
      ...(s.lastDoc && !(S.store && S.store.isDoc) ? [{ label: `Reopen “${s.lastDoc.name}”`, fn: reopenDoc }] : []),
      ...(S.store && (S.store.isProject || S.store.isDoc) ? [{ label: "Back to My Notes (RossNotes)", fn: backToNotes }] : []),
      "-",
      { label: "Import a Word Document…", fn: () => $("file-docx").click(), off: !!(S.store && S.store.isDoc) },
      { label: "Import a Notebook (NoteCase Pro, FeatherNotes)…", fn: () => $("file-book").click(), off: !!(S.store && (S.store.isDoc || S.store.isProject)) },
      { label: "Import a NobleNote Folder…", fn: () => importNoble(), off: !!(S.store && (S.store.isDoc || S.store.isProject)) },
      { label: "Import a Ross Writer Project as Notes…", fn: () => importProject(), off: !!(S.store && (S.store.isDoc || S.store.isProject)) },
      { label: "Export as Word…", fn: () => exportNotes("word"), off: !n },
      { label: "Export as PDF…", fn: () => exportNotes("pdf"), off: !n },
      { label: "Export as Markdown…", fn: () => exportNotes("md"), off: !n },
      ...(ED.project ? [{ label: "Save As RTF…", fn: () => exportNotes("rtf"), off: !n }] : []),
      ...(draftOn() ? [{ label: "Compile…", fn: compileDialog, keys: "Ctrl+Alt+E" }, { label: "Export Project…", fn: exportProject }] : []),
      ...(S.store && S.store.isRtf && S.store.keptWhere === "RossDraft" ? [{ label: "Save the Original RTF…", fn: () => saveOriginalRtf() }] : []),
      "-",
      { label: "Email or Share This Note…", fn: () => shareNote(), off: !n },
      { label: "Copy This Note for Email", fn: () => copyForEmail(), off: !n },
      "-",
      { label: "Update Word Copy", fn: () => updateWordCopy(), off: !n || !!(S.store && S.store.isProject) },
      { label: "Keep Word Copies Updated", on: s.wordAuto !== false, off: !!(S.store && S.store.isProject), fn: () => {
        s.wordAuto = s.wordAuto === false; saveSettings();
        toast(s.wordAuto ? "A note's Word copy is written again each time the note is saved." : "Word copies are written only when you choose Update Word Copy.");
      } },
      "-",
      { label: "Print This Note…", fn: printNote, keys: "Ctrl+P", off: !n },
      "-",
      { label: S.store && S.store.isProject ? "Read the Project Again" : "Read the Folder Again", fn: () => refresh(true) },
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
      { label: S.store && S.store.isProject && !S.store.isDoc ? "List All (Whole Project)" : "List All Matches", fn: () => { if ($("findbar").hidden) openFind(false); listAll(); }, keys: "Ctrl+Shift+F" },
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
      "-",
      { label: "Comment…", fn: addComment, keys: "Ctrl+Alt+M", off: !(A.note && A.note.comments) },
      ...(ED.project ? [
        { label: "Footnote", fn: () => insertNote("footnote"), keys: "Ctrl+Alt+F", off: !fnOn(A) || !!A.note.readOnly },
        { label: "Endnote", fn: () => insertNote("endnote"), keys: "Ctrl+Alt+D", off: !fnOn(A) || !!A.note.readOnly },
      ] : []),
      { label: "Your Name for Comments…", fn: () => askAuthor(true) },
      { label: "Keep Photos at Full Size", on: s.keepFull, fn: () => {
        s.keepFull = !s.keepFull; saveSettings();
        toast(s.keepFull ? "New photos are kept exactly as they come." : "Photos larger than 2,000 pixels are stored reduced to 2,000.");
      } },
    ];
    case "format": return [
      { label: "Fonts…", fn: fontsDialog, keys: "Ctrl+D" },
      "-",
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
      { label: "Select Everything in the List (as one page)", fn: selectAllShown, keys: "Ctrl+Shift+A" },
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
      ...(draftOn() ? [
        "-",
        { label: "Synopsis and Notes", fn: showInspector, keys: "Ctrl+Alt+Y", off: !n },
        { label: "Status", off: !n, sub: DRAFT_STATUSES.map(([k, l]) => ({ label: l, on: !!n && statusOf(n) === k, fn: () => setStatus(S.sel.size > 1 ? inListOrder(S.sel) : [n], k) })) },
        { label: "Include in Compile", on: !!n && n.raw.include !== false, fn: () => toggleInclude(n), off: !n },
        { label: "Targets and Status…", fn: targetsDialog },
        { label: "Compile…", fn: compileDialog, keys: "Ctrl+Alt+E" },
        { label: "Add a PDF…", fn: addPdfEntry },
      ] : []),
    ];
    case "view": return [
      // 1.9.4: shorter, the settings in submenus
      { label: "Headings in This Note…", fn: showHeadings, keys: "Ctrl+Alt+O" },
      { label: "Recent…", fn: showRecent, keys: "Ctrl+Shift+O" },
      "-",
      { label: "Show the Note List", on: $("app").classList.contains("app-narrow") ? !!S.sideOpenNarrow : s.list,
        fn: toggleList, keys: "Ctrl+Alt+J" },
      { label: "Note List Width", sub: [
        { label: "Narrower", fn: () => sideWidth(-30), keys: "Ctrl+Alt+[" },
        { label: "Wider", fn: () => sideWidth(30), keys: "Ctrl+Alt+]" },
        "-",
        { label: "Usual Width", on: !s.side || s.side === 260, fn: () => sideWidth(0), keys: "double-click the divider" },
        { label: "Extra Wide", on: s.side >= 440, fn: () => sideWidth("extra") },
      ] },
      { label: "Page View", on: !!s.pageView, fn: togglePageView, keys: "Ctrl+Shift+L" },
      { label: "Focus (the paragraph you're in)", on: !!s.focus, fn: toggleFocus, keys: "Ctrl+Shift+Enter" },
      { label: "Split", sub: [
        { label: "Side by Side", on: s.split === "h", fn: COMMANDS.splith, keys: "Ctrl+\\" },
        { label: "Top and Bottom", on: s.split === "v", fn: COMMANDS.splitv, keys: "Ctrl+Shift+\\" },
        { label: "One Note Only", on: !s.split, fn: () => setSplit("") },
      ] },
      "-",
      { label: "Text Size and Darkness", sub: [
        { label: "Larger Text", fn: COMMANDS.bigger, keys: "Ctrl+= or Ctrl+Shift+>" },
        { label: "Smaller Text", fn: COMMANDS.smaller, keys: "Ctrl+− or Ctrl+Shift+<" },
        { label: "Normal Size", fn: () => setSize(0), keys: "Ctrl+0" },
        "-",
        ...INKS.map(([l, v]) => ({ label: l === "Normal" ? "Normal Darkness" : l + " Text", on: (s.ink || "normal") === v, fn: () => setInk(v) })),
      ] },
      { label: "Interface Size", sub: UI_SIZES.map(([l, v]) => ({ label: `${l} (${v}%)`, on: (s.ui || 100) === v, fn: () => setUiSize(v) })) },
      { label: "Line Spacing", sub: [
        ...SPACINGS.map(([l, v]) => ({ label: l, on: s.spacing === v, fn: spacing(v), keys: { 100: "Alt+1", 150: "Alt+3", 200: "Alt+2" }[v] })),
        "-",
        { label: "Space Between Paragraphs", on: s.paraGap, fn: () => { s.paraGap = !s.paraGap; saveSettings(); applyLook(); } },
      ] },
      { label: "Line Length", sub: [["Narrow", "narrow"], ["Medium", "medium"], ["Wide", "wide"], ["The Full Width", "full"]].map(([l, v]) =>
        ({ label: l, on: (s.measure || "medium") === v, fn: () => { s.measure = v; saveSettings(); applyLook(); } })) },
      { label: "Typeface", sub: [
        ...PAGE_FONTS.map(([id, label]) => ({ label, on: (s.font || "literata") === id, fn: () => { s.font = id; saveSettings(); applyLook(); } })),
        "-",
        { label: "Fonts…", fn: fontsDialog, keys: "Ctrl+D" },
      ] },
      "-",
      { label: "Dark Mode", on: s.dark, fn: COMMANDS.dark, keys: "Ctrl+Shift+D" },
      { label: "Look", sub: [
        { label: "Classic Look", on: !!s.classic, fn: toggleClassic, keys: "Ctrl+Alt+L" },
        { label: "Toolbar", on: !!s.toolbar || !!s.classic, off: !!s.classic, fn: () => { s.toolbar = !s.toolbar; saveSettings(); applyLook(); } },
        { label: "Word Counts in the List", on: !!s.wordList, fn: () => { s.wordList = !s.wordList; saveSettings(); applyLook(); renderTree(); } },
      ] },
      { label: "Spelling", sub: [
        { label: "Check Spelling (British English)", on: spellMode() === "ross", fn: () => { s.spell = "ross"; saveSettings(); applySpellMode(); }, keys: "F7" },
        { label: "Use the Tablet's Own Spell Checker", on: spellMode() === "device", fn: () => { s.spell = "device"; saveSettings(); applySpellMode(); } },
        { label: "No Spelling Check", on: spellMode() === "off", fn: () => { s.spell = "off"; saveSettings(); applySpellMode(); } },
        "-",
        { label: "Your Dictionary…", fn: showDictionary, off: spellMode() !== "ross" || !spell.ready() },
      ] },
      { label: "Comments", sub: [
        { label: "Show Comments", on: !!s.showComments, fn: toggleComments, off: !(A.note && A.note.comments && A.note.comments.length) },
        "-",
        { label: "Comments Text Larger", fn: () => commentSize(1), keys: "Ctrl+Alt+=" },
        { label: "Comments Text Smaller", fn: () => commentSize(-1), keys: "Ctrl+Alt+−" },
        { label: "Comments Text Normal Size", fn: () => commentSize(0), keys: "Ctrl+Alt+0" },
      ] },
      "-",
      { label: "Pop-up Draft", on: !PN.el.hidden, fn: togglePop, keys: "Ctrl+Alt+I" },
      { label: "Daily Word Target…", fn: setGoal },
    ];
    case "help": return [
      { label: "Keyboard Shortcuts", fn: showKeys, keys: "F1" },
      { label: "Device Check…", fn: deviceCheck },
      { label: "About Ross Note", fn: () => dialog("About Ross Note",
        `${ED.name} (${SHOWN})\nA simple, fast tree of notes, with Ross Writer projects and Word documents edited in place.\n\nYour notes are the Markdown files in the folder “${S.store ? S.store.handle.name : ""}”, ` +
        "one for each note, the same as on the laptop. Your sync app keeps them in step.") },
    ];
  }
  return [];
}

// Help ▸ Device Check…: this tablet and browser, what the app may do with folders and files, the folders it
// remembers (and whether it may still go into them), and the log of what happened; Test the Folder Picker tries
// the picker by itself. The report can be copied or shared.
async function deviceCheck() {
  const out = [];
  const line = (k, v) => out.push(`${k}: ${v}`);
  line("App", `${ED.name} ${SHOWN}`);
  line("Browser", navigator.userAgent);
  try {
    if (navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) {
      const h = await navigator.userAgentData.getHighEntropyValues(["model", "platformVersion", "fullVersionList"]);
      line("Device", `${h.model || "?"}, Android ${h.platformVersion || "?"}; ${(h.fullVersionList || []).map((b) => b.brand + " " + b.version).filter((x) => !/Not.A.Brand/i.test(x)).join(", ")}`);
    }
  } catch (e) { /* not told */ }
  line("Installed as an app", matchMedia("(display-mode: standalone)").matches ? "yes" : "no (in a browser tab)");
  line("Folder picker", typeof window.showDirectoryPicker === "function" ? "yes" : "NO (this browser can't open folders)");
  line("File picker", typeof window.showOpenFilePicker === "function" ? "yes" : "no");
  try { line("Storage kept", (await navigator.storage.persisted()) ? "yes" : "no (the system may clear it)"); } catch (e) { line("Storage kept", "?"); }
  for (const [k, label] of [["root", "My notes folder"], ["projectsRoot", "Projects folder"], ["project", "Last project"], ["docFile", "Last document"]]) {
    let h = null;
    try { h = await kvGet(k); } catch (e) { h = null; }
    if (!h || !h.name) { line(label, "none remembered"); continue; }
    let mode = "?";
    try { mode = h.queryPermission ? await h.queryPermission({ mode: "readwrite" }) : "?"; } catch (e) { mode = diagErr(e); }
    line(label, `“${h.name}”, permission: ${mode}`);
  }
  let log = [];
  try { log = JSON.parse(localStorage.getItem(DIAG_KEY) || "[]"); } catch (e) { log = []; }
  const fmt = (t) => { const d = new Date(t); return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + " " + d.toTimeString().slice(0, 8); };
  const report = () => out.join("\n") + "\n\nWhat happened (newest last):\n" + (log.length ? log.slice(-60).map(([t, e, d]) => `${fmt(t)}  ${e}${d ? " — " + d : ""}`).join("\n") : "(nothing yet)");
  const box = document.createElement("div");
  box.className = "devcheck";
  const pre = document.createElement("pre");
  pre.textContent = report();
  const p = document.createElement("p");
  p.textContent = "Try opening your folder or project the way that fails, then come back here: the steps are kept, even if the app is closed and started again. Copy or share this report.";
  box.append(p, pre);
  setTimeout(() => { pre.scrollTop = pre.scrollHeight; }, 50);
  const v = await ask("Device Check", box, [["Test the Folder Picker…", "test", true], ["Copy", "copy"], ["Share…", "share"], ["Clear the Log", "clear"]]);
  if (v === "copy") { try { await navigator.clipboard.writeText(report()); toast("The report is copied."); } catch (e) { toast("Couldn't copy: " + diagErr(e)); } }
  else if (v === "share") { try { await navigator.share({ title: "Device Check", text: report() }); } catch (e) { if (!(e && e.name === "AbortError")) toast("Couldn't share: " + diagErr(e)); } }
  else if (v === "clear") { try { localStorage.removeItem(DIAG_KEY); } catch (e) { /* none */ } toast("The log is cleared."); }
  else if (v === "test") {
    // the picker by itself: what it gives, whether the folder can be read and remembered
    diag("test", "the folder picker");
    let h = null;
    try { h = await window.showDirectoryPicker({ id: "devcheck", mode: "readwrite" }); } catch (e) { diag("test: no folder", diagErr(e)); return deviceCheck(); }
    try {
      const names = [];
      for await (const [n] of h.entries()) { names.push(n); if (names.length >= 12) break; }
      diag("test: read the folder", `“${h.name}”: ${names.length ? names.join(", ") : "empty"}`);
    } catch (e) { diag("test: couldn't read the folder", diagErr(e)); }
    try { diag("test: permission", await h.queryPermission({ mode: "readwrite" })); } catch (e) { diag("test: permission", diagErr(e)); }
    try {
      await kvSet("devcheck", h);
      const back = await kvGet("devcheck");
      diag("test: remembered", back && back.name === h.name ? "yes" : "NO");
    } catch (e) { diag("test: couldn't remember it", diagErr(e)); }
    try {
      const t = await h.getFileHandle(".rossdraft-test", { create: true });
      const w = await t.createWritable(); await w.write("ok"); await w.close();
      await h.removeEntry(".rossdraft-test");
      diag("test: write", "yes");
    } catch (e) { diag("test: couldn't write", diagErr(e)); }
    return deviceCheck();
  }
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
  diag("box", title + ": " + text);
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
    "List all matches (this note, all notes, or the whole project): Ctrl+Shift+F    ^p a line's end, ^t a tab",
    "Comment: Ctrl+Alt+M, or right-click the words    Comments text size: Ctrl+Alt+=  Ctrl+Alt+−  Ctrl+Alt+0 (or A− A+ in the pane)",
    "Paste as plain text: Ctrl+Alt+Shift+V    Right-click: spelling, cut, copy, paste, comment",
    "Check spelling on or off: F7",
    "Text size: Ctrl+= / Ctrl+Shift+>   Ctrl+− / Ctrl+Shift+<   Ctrl+0    Line spacing: Alt+1 single, Alt+3 1.5, Alt+2 double",
    "Find a note or a command: Ctrl+K    Focus: Ctrl+Shift+Enter    Align: Ctrl+L / E / R / J    Classic look: Ctrl+Alt+L",
    "Several notes as one page: Ctrl-click them in the list, or a long press with a finger; Shift-click the first and Shift-click the last for a run; everything showing in the list: Ctrl+Shift+A; a plain click: one note again",
    "Page view: Ctrl+Shift+L    Note list (project panel): Ctrl+Alt+J (narrower / wider: Ctrl+Alt+[ / ])    Headings: Ctrl+Alt+O    Light / dark: Ctrl+Shift+D",
    "Split view: Ctrl+\\ or F6 (top and bottom: Ctrl+Shift+\\)    Switch pane: Shift+F6",
    "Pop-up note (reminders, things to do): Ctrl+Alt+I",
    "Search the note list: Ctrl+Alt+F",
    "Move a note: Alt+arrows or Alt+Shift+arrows",
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
  const most = window.innerWidth - 300;
  S.settings.side = step === 0 ? 260 :
    step === "extra" ? Math.max(160, Math.min(most, Math.max(440, Math.round(window.innerWidth * 0.4)))) :   // 1.9.5
    Math.max(160, Math.min(most, $("side").offsetWidth + step));
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
  diag("message", msg);
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, ms);
}
function hideToast() { $("toast").hidden = true; }

// ------------------------------------------------------------------ Word in; Word, PDF and Markdown out
let wordio = null;
async function wordModule() { return wordio || (wordio = await import("./wordio.js?v=1.9.20")); }

$("file-docx").addEventListener("change", async (e) => {
  if (S.newProjectWord && e.target.files[0] && S.store && S.store.isProject) {
    S.newProjectWord = false;
    const f = e.target.files[0];
    e.target.value = "";
    await importWord(f, true);
    return;
  }
  S.newProjectWord = false;
  const f = e.target.files[0];
  e.target.value = "";
  if (f) await importWord(f);
});

async function importWord(file, split = null) {
  if (S.store && S.store.isDoc) { toast("A Word document opened by itself is one page. File ▸ Back to My Notes for notes."); return; }
  await flushSave();
  const W = await busy("Opening " + file.name + "…", () => wordModule(), { after: 0 });
  let got;
  try { got = await busy("Reading " + file.name + "…", async () => W.readDocx(await file.arrayBuffer()), { after: 0 }); } catch (err) {
    dialog("Import a Word Document", `Couldn't read “${file.name}” as a Word document.\n\n${err.message || err}`);
    return null;
  }
  const stem = file.name.replace(/\.[^.]+$/, "");
  const { pre, secs } = W.splitSections(got.lines);
  const proj = !!S.store.isProject;
  // in a project, as Ross Writer does it: the top headings chapters, the ones under them scenes
  const subOf = (sec) => W.splitSections(sec.slice(1));
  const nested = proj && secs.some((sec) => subOf(sec).secs.length);
  if (split == null) {
    split = false;
    if (secs.length > 1 || nested) {
      const p = document.createElement("div");
      p.textContent = proj
        ? `“${stem}” has ${secs.length} chapter heading${secs.length === 1 ? "" : "s"}. Bring it in as one entry, or as ` +
          "a chapter for each top heading with a scene for each heading under it (after this entry)?"
        : `“${stem}” has ${secs.length} headings. Bring it in as one note, or as a note for each heading ` +
          "(under a note named after the document)?";
      const v = await ask("Import a Word Document", p, proj
        ? [["One entry", "one", true], ["Chapters and scenes", "many"]]
        : [["One note", "one", true], ["A note for each heading", "many"]]);
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
  const into = S.importInto && S.store.all().includes(S.importInto) ? S.importInto : null;    // (a new Scrivener project's Draft)
  S.importInto = null;
  const parent = into || (cur ? cur.parent : S.store.root);
  const index = into ? into.children.length : cur ? parent.children.indexOf(cur) + 1 : parent.children.length;
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
      else if (S.store.isProject) {
        // in a project, as Ross Writer does it: the top headings chapters, the ones under them scenes
        let at = index;
        const hasText = (ls) => ls.some((ln) => ln.runs.some((r) => r.img || r.t.trim()));
        if (hasText(pre)) {
          const opening = { kind: null, depth: 1, code: false, runs: [{ t: "Opening", f: new Set() }] };
          top = await make(parent, at++, pre.length && pre[0].title ? pre : [opening, ...pre]);
        }
        for (const sec of secs) {
          const sub = W.splitSections(sec.slice(1));
          const ch = await make(parent, at++, [sec[0], ...(sub.secs.length ? sub.pre : sec.slice(1))]);
          if (!top) top = ch;
          for (const s2 of sub.secs) await make(ch, ch.children.length, s2);
          if (sub.secs.length) S.settings.expanded = [...new Set([...S.settings.expanded, ch.key()])];
        }
      } else {
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

// ------------------------------------------------------------------ a NobleNote folder, brought in as notes
// The folder is only read: each notebook (folder) becomes a note with its notes under it, all under one
// note named after the folder, placed after the open note. Empty notes and non-notes are left out.
async function importNoble(dir = null) {
  await flushSave();
  if (S.store && (S.store.isDoc || S.store.isProject)) {
    dialog("Import a NobleNote Folder", "Go back to your notes first (File ▸ Back to My Notes): NobleNote's notes come in among them.");
    return null;
  }
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
  const NB = await import("./notebooks.js?v=1.9.20");
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

async function importNotebook(file) {
  if (S.store && (S.store.isDoc || S.store.isProject)) { toast("Notebooks come in as notes: File ▸ Back to My Notes first."); return null; }
  return busy("Opening " + file.name + "…", (say) => importNotebookNow(file, say), { after: 0 });
}

async function importNotebookNow(file, say) {
  await flushSave();
  const NB = await import("./notebooks.js?v=1.9.20");
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

// ------------------------------------------------------------------ a Ross Writer project, brought in as notes
// The project's folder is only read: its chapters and scenes become notes (a note named after the project,
// the chapters under it, their scenes under them), each scene's words and pictures from its Word file.
// ------------------------------------------------------------------ a new Ross Writer project
// As Ross Writer makes one (Project.create): a folder holding "<title>.rwproj" and an empty Scenes folder.
// Then it's open here like any project; it can start with a Word document brought in as chapters and scenes.
const rwSafe = (t) => (String(t || "").replace(/[\\/:*?"<>|\x00-\x1f]+/g, " ").trim().slice(0, 80) || "Untitled").replace(/[. ]+$/, "") || "Untitled";

async function newProject(opts = null) {
  // RossDraft 1.3: opts.scrivener: a new Scrivener project (Scrivener 3's Novel template), the same way
  const scr = !!(opts && opts.scrivener);
  const KIND = scr ? "New Scrivener Project" : "New Ross Writer Project";
  if (!window.showDirectoryPicker) {
    dialog(KIND, "This browser can't make folders on this device. Ross Note needs Chrome (version 132 or later on Android).");
    return null;
  }
  let title, start;
  if (opts && opts.title) ({ title, start } = opts);
  else {
    const box = document.createElement("div");
    box.className = "choose";
    const lab = document.createElement("div");
    lab.className = "lab";
    lab.textContent = "The project's title";
    const inp = document.createElement("input");
    inp.type = "text";
    inp.className = "wide";
    inp.placeholder = "e.g. The Book";
    inp.setAttribute("autocapitalize", "words");
    box.append(lab, inp);
    const lab2 = document.createElement("div");
    lab2.className = "lab";
    lab2.textContent = "Start it with";
    box.appendChild(lab2);
    for (const [v, t, on] of [["word", "A Word document: its headings become the chapters and scenes", true],
      ["empty", "Nothing yet: one empty chapter", false]]) {
      const l = document.createElement("label");
      l.innerHTML = `<input type="radio" name="start" value="${v}"${on ? " checked" : ""}> `;
      l.append(t);
      box.appendChild(l);
    }
    const p = document.createElement("p");
    p.textContent = scr ? "Next you choose where it goes: a project folder (“…scriv”) is made there, from Scrivener's own Novel " +
      "template. Scrivener 3 (Windows, Mac, iPad) and Ross Writer on the laptop open it." :
      "Next you choose where it goes: a folder named after the project is made there (or, if the folder you " +
      "choose is empty, the project goes in it). Ross Writer on the laptop opens it as one of its own.";
    box.appendChild(p);
    if (scr) box.querySelector('input[value="empty"]').parentNode.lastChild.textContent = "Nothing yet: one chapter with one scene";
    setTimeout(() => inp.focus(), 50);
    for (;;) {
      if (!await ask(KIND, box, [["Choose Where…", "go", true]])) return null;
      title = inp.value.trim();
      if (title) break;
      toast("Give the project a title first.");
    }
    start = box.querySelector("input[name=start]:checked").value;
  }
  // where: the picker straight from the tap
  let where;
  try { where = opts && opts.folder ? opts.folder : await window.showDirectoryPicker({ id: "rwnewproject", mode: "readwrite" }); } catch (e) {
    if (e && e.name === "AbortError") toast("No folder chosen: no project made.");
    else dialog(KIND, `The folder picker didn't open.\n\n${(e && e.name) || "Error"}: ${(e && e.message) || e}`);
    return null;
  }
  if (scr) return newScrivener(where, title, start, opts);
  const name = rwSafe(title);
  const file = name + ".rwproj";
  let dir;
  try {
    dir = await busy(`Making “${title}”…`, async () => {
      // an empty folder: the project goes in it; otherwise a new folder for it, named after it ("… (2)" if taken)
      const there = [];
      for await (const [n] of where.entries()) { if (!n.startsWith(".")) there.push(n); }
      let d = where;
      if (there.length) {
        let cand = name, k = 2;
        const taken = new Set(there);
        while (taken.has(cand)) cand = `${name} (${k++})`;
        d = await where.getDirectoryHandle(cand, { create: true });
      }
      await d.getDirectoryHandle("Scenes", { create: true });
      const data = { format: "ross-writer-project", version: 1, title, compile: {}, nodes: [] };
      const fh = await d.getFileHandle(file, { create: true });
      const w = await fh.createWritable();
      await w.write(JSON.stringify(data, null, 1));
      await w.close();
      return d;
    }, { after: 0 });
  } catch (e) {
    dialog("New Ross Writer Project", `Couldn't make the project in “${where.name}”.\n\n${(e && e.name) || "Error"}: ${(e && e.message) || e}`);
    return null;
  }
  await openProject(dir, file);
  if (!S.store || !S.store.isProject) return null;
  if (start === "empty") {
    const n = await queue(() => S.store.addNote(S.store.root, 0, "Chapter One", "Chapter One\n"));
    renderTree();
    await openNote(n);
  } else if (opts && opts.wordFile) {
    await importWord(opts.wordFile, true);
  } else {
    // a Word document to start it: chosen from a tap of its own (Android lets a picker open only then)
    const q = document.createElement("div");
    q.textContent = `“${title}” is made. Now choose the Word document to bring in: its top headings become the chapters, ` +
      "the headings under them the scenes.";
    if (await ask("New Ross Writer Project", q, [["Choose the Word Document…", "go", true]])) {
      S.newProjectWord = true;
      $("file-docx").click();
    }
  }
  toast(`“${title}” is a Ross Writer project in “${dir.name}”.`, 6000);
  return dir;
}

async function newScrivener(where, title, start, opts) {
  const SV = await import("./scriv.js?v=1.9.20");
  let made;
  try { made = await busy(`Making “${title}”…`, () => SV.makeScrivener(where, title), { after: 0 }); } catch (e) {
    dialog("New Scrivener Project", `Couldn't make the project in “${where.name}”.\n\n${(e && e.message) || e}`);
    return null;
  }
  const [dir, xname] = made;
  await openProject(dir, xname);
  if (!S.store || !S.store.isScriv) return null;
  const draft = S.store.root.children.find((c) => c.raw.scrivType === "DraftFolder") || S.store.root;
  if (start === "empty") {
    // as Ross Writer's new_blank: a chapter (a folder) with a scene in it, ready to write in
    const ch = await queue(() => S.store.addNote(draft, draft.children.length, "Chapter 1", "Chapter 1\n"));
    ch.raw.scrivType = "Folder";
    const sc = await queue(() => S.store.addNote(ch, 0, "Scene 1", "Scene 1\n"));
    S.settings.expanded = [...new Set([...(S.settings.expanded || []), draft.key(), ch.key()])];
    renderTree();
    await openNote(sc);
  } else if (opts && opts.wordFile) {
    S.importInto = draft;
    await importWord(opts.wordFile, true);
  } else {
    const q = document.createElement("div");
    q.textContent = `“${title}” is made. Now choose the Word document to bring in: its top headings become the chapters, ` +
      "the headings under them the scenes, in Scrivener's Draft.";
    if (await ask("New Scrivener Project", q, [["Choose the Word Document…", "go", true]])) {
      S.importInto = draft;
      S.newProjectWord = true;
      $("file-docx").click();
    }
  }
  toast(`“${title}” is a Scrivener project in “${where.name}”.`, 6000);
  return dir;
}

// RossDraft keeps a zip of a Scrivener project before its first save each visit (the last 10): one saved out
async function scrivBackups() {
  const SV = await import("./scriv.js?v=1.9.20");
  const list = await SV.listBackups();
  if (!list.length) { dialog("Scrivener Backups", "None yet. Before RossDraft first saves into a Scrivener project each time you open it, it keeps a zip of the whole project here (the last 10)."); return; }
  const box = document.createElement("div");
  box.className = "choose";
  const p = document.createElement("p");
  p.textContent = "Kept before RossDraft first saved into each project, newest first. Save one out, then unzip it to get the project back as it was.";
  box.appendChild(p);
  list.forEach(([name], k) => {
    const l = document.createElement("label");
    l.innerHTML = `<input type="radio" name="bk" value="${k}"${k ? "" : " checked"}> `;
    l.append(name);
    box.appendChild(l);
  });
  if (await ask("Scrivener Backups", box, [["Save Out…", "go", true]]) !== "go") return;
  const [name, h] = list[+box.querySelector("input:checked").value];
  const saved = await saveFile(await h.getFile(), name, "Zip file", ".zip", "application/zip");
  if (saved) toast("Saved " + saved);
}

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
  if (S.store && (S.store.isDoc || S.store.isProject)) { toast("This brings a project in as notes: File ▸ Back to My Notes first (or use File ▸ Open a Ross Writer Project to work on it in place)."); return null; }
  await flushSave();
  dir = dir || await chooseProjectFolder();
  if (!dir) return null;
  const RW = await busy("Looking in “" + dir.name + "”…", () => import("./rwimport.js?v=1.9.20"), { after: 0 });
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
async function chooseNotes(title, withPages, withComments = false) {
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
  let cbox = null;
  if (withComments && S.store.all().some((x) => x.comments && x.comments.length)) {
    const l = document.createElement("label");
    l.className = "pages";
    l.innerHTML = `<input type="checkbox"${S.settings.exportComments !== false ? " checked" : ""}> `;
    l.append("With the comments");
    cbox = l.querySelector("input");
    box.appendChild(l);
  }
  const v = await ask(title, box, [["Export", "go", true]]);
  if (!v) return null;
  if (cbox) { S.settings.exportComments = cbox.checked; saveSettings(); }
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
  return { notes, pages: !!(pages && pages.checked), comments: !!(cbox && cbox.checked) };
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

// the parts' lines (with their footnotes and endnotes, numbered through: RossDraft 1.2), for Word and RTF
async function exportLines(notes, pages, parts) {
  const W = await wordModule();
  const per = parts.map(([, text]) => {
    const nl = md.parse(text);
    for (const ln of nl) for (const r of ln.runs) if (r.img) r.img.target = md.resolvePicture(r.img.src, []);
    const part = W.fromNoteLines(nl);
    while (part.length && !part[part.length - 1].runs.length && !part[part.length - 1].kind) part.pop();
    return part;
  });
  const C = await compileModule();
  const rn = C.renumberNotes(per.map((l, k) => ({ lines: l, notes: notes[k] && notes[k].fnotes })));
  const lines = [];
  rn.lines.forEach((part, k) => {
    if (k && part.length) part[0] = Object.assign({}, part[0], { [pages ? "pageBreak" : "gapBefore"]: true });
    lines.push(...part);
  });
  return { lines, notes: rn.notes };
}

async function wordBlob(notes, pages, name, parts = null) {
  parts = parts || await joinedParts(notes, []);
  const W = await wordModule();
  const { lines, notes: fnotes } = await exportLines(notes, pages, parts);
  const bytes = async (img) => {
    try { return new Uint8Array(await (await S.store.pictureFile(img.target)).arrayBuffer()); } catch (e) {
      try { return new Uint8Array(await (await S.store.pictureFile([PICTURES, img.target[img.target.length - 1]])).arrayBuffer()); } catch (e2) { return null; }
    }
  };
  return W.writeDocx(lines, bytes, name, "Cambria", { notes: fnotes });
}

// RossDraft 1.0.2: File ▸ Save As RTF…: the chosen notes as one RTF document (rtf.js), for any word processor,
// old ones included. An RTF document that's open keeps its own font, size and page.
async function rtfBlob(notes, pages, name, parts = null) {
  parts = parts || await joinedParts(notes, []);
  const R = await import("./rtf.js?v=1.9.20");
  const { lines, notes: fnotes } = await exportLines(notes, pages, parts);
  const bytes = async (img) => {
    try { return new Uint8Array(await (await S.store.pictureFile(img.target)).arrayBuffer()); } catch (e) {
      try { return new Uint8Array(await (await S.store.pictureFile([PICTURES, img.target[img.target.length - 1]])).arrayBuffer()); } catch (e2) { return null; }
    }
  };
  const own = S.store && S.store.isRtf ? { look: S.store.look, paras: S.store.paras } : {};
  const out = await R.writeRtf(lines, { ...own, notes: fnotes, pictureBytes: bytes, title: name });
  return new Blob([out], { type: "application/rtf" });
}

// an RTF opened without its folder: its original, as it was before RossDraft first saved into it
async function saveOriginalRtf() {
  let o = null;
  try { o = await kvGet("rtfOriginal"); } catch (e) { o = null; }
  if (!o || !o.bytes) { dialog("Save the Original RTF", "There's no original kept: it's kept when RossDraft first saves into an RTF document."); return; }
  const saved = await saveFile(new Blob([o.bytes], { type: "application/rtf" }), o.name.replace(/\.rtf$/i, "") + " (original).rtf",
    "Rich Text Format (RTF)", ".rtf", "application/rtf");
  if (saved) toast("Saved " + saved);
}

async function sameEntryIn(dir, fh) {
  try { const h = await dir.getFileHandle(fh.name); return h.isSameEntry ? await h.isSameEntry(fh) : false; } catch (e) { return false; }
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
  const label = { word: "Export as Word", pdf: "Export as PDF", md: "Export as Markdown", rtf: "Save As RTF" }[kind];
  const got = await chooseNotes(label, kind !== "md", kind === "word" || kind === "pdf");
  if (!got) return null;
  const { notes, pages } = got;
  const withComments = got.comments && notes.some((x) => x.comments && x.comments.length);
  const name = md.safeName(notes.length === 1 ? notes[0].title() : notes[0].title());
  const parts = await busy(`Gathering ${notes.length} note${notes.length === 1 ? "" : "s"}…`, () => joinedParts(notes, []));
  if (kind === "md") {
    const blob = new Blob([parts.map(([, t]) => t).join("\n")], { type: "text/markdown" });
    const saved = await saveFile(blob, name + ".md", "Markdown", ".md", "text/markdown");
    if (saved) toast("Saved " + saved);
    return saved;
  }
  if (kind === "rtf") {
    const blob = await busy("Making the RTF document…", () => rtfBlob(notes, pages, name, parts), { after: 0 });
    const saved = await saveFile(blob, name + ".rtf", "Rich Text Format (RTF)", ".rtf", "application/rtf");
    if (saved) toast("Saved " + saved);
    return saved;
  }
  if (kind === "word") {
    let blob = await busy("Making the Word document…", () => wordBlob(notes, pages, name, parts), { after: 0 });
    if (withComments) {
      // the comments into it, each on its words in its note's part (wordpatch.exportComments)
      const { exportComments } = await import("./wordpatch.js?v=1.9.20");
      blob = await busy("Putting the comments in…", async () => exportComments(await blob.arrayBuffer(),
        notes.map((x) => ({ title: x.title(), comments: x.comments || [] }))), { after: 0 });
    }
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
    // the note's comments after it: who, when, the words they're on, what they say
    const cs = withComments ? notes[k].comments || [] : [];
    if (cs.length) {
      const box = document.createElement("div");
      box.className = "pcomments";
      const h = document.createElement("div");
      h.className = "pch";
      h.textContent = "Comments";
      box.appendChild(h);
      const one = (c, reply) => {
        const it = document.createElement("div");
        it.className = "pc" + (reply ? " reply" : "");
        const who = document.createElement("div");
        who.className = "pcwho";
        who.textContent = [c.author || "Someone", commentDate(c.date), c.done ? "resolved" : ""].filter(Boolean).join(" · ");
        it.appendChild(who);
        if (c.words && !reply) {
          const q = document.createElement("div");
          q.className = "pcwords";
          q.textContent = "“" + c.words + "”";
          it.appendChild(q);
        }
        const t = document.createElement("div");
        t.className = "pctext";
        t.textContent = c.text;
        it.appendChild(t);
        box.appendChild(it);
        for (const r of cs.filter((o) => o.parent === c.id)) one(r, true);
      };
      for (const c of cs) if (!c.parent || !cs.some((o) => o.id === c.parent)) one(c, false);
      doc.appendChild(box);
    }
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

function readOnlyHere() {
  if (!A.note || !A.note.readOnly) return false;
  toast(`Read-only: “${A.note.title()}” has ${A.note.readOnly.join(", ")}. Edit it in Ross Writer.`);
  return true;
}

function replaceOne() {
  if (readOnlyHere()) return;
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
  if (readOnlyHere()) return 0;
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


// ================================================================== 1.8.0
// ------------------------------------------------------------------ the word count, lower right
// The note (or the selection), and in a Ross Writer project its chapter and the whole project. Click it for more.
const wcCache = new WeakMap();   // note -> [text, words] (the notes not on screen are counted once, until they change)
function wordsOfNote(n) {
  if (n.raw && n.raw.pdf) return 0;     // (a research PDF: no words of the project's)
  for (const p of P) if (p.note === n) return wordsIn(pageWords(p.page));
  const t = n.text || "";
  const had = wcCache.get(n);
  if (had && had[0] === t) return had[1];
  const plain = md.parse(t).map((ln) => ln.runs.map((r) => (r.img ? "" : r.t)).join("")).join("\n").split(md.OBJ).join("").replace(/\uE000[fe]-?\d+\uE001/g, "");
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
  const canComment = !!(S.store && S.store.isProject && p.note && p.note.comments);
  items.push({ label: "Comment…", keys: "Ctrl+Alt+M", off: !canComment, fn: addComment });
  items.push({ label: "Highlight", keys: "Ctrl+Shift+H", off: ro || !has, fn: COMMANDS.highlight });
  // 1.9.1: the split, straight from here
  const sp = S.settings.split;
  items.push("-");
  items.push({ label: "Split Side by Side", on: sp === "h", keys: "Ctrl+\\", fn: () => setSplit("h") });
  items.push({ label: "Split Top and Bottom", on: sp === "v", keys: "Ctrl+Shift+\\", fn: () => setSplit("v") });
  if (sp) {
    items.push({ label: "One Note Only", fn: () => setSplit("") });
    items.push({ label: "Switch Pane", keys: "Shift+F6", fn: switchPane });
  }
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
// 1.9.20: pop-up drafts (Jacob: scenes that come to mind, drafted quickly). Each opening is a fresh draft, kept
// as a note in the folder "Reminders" in the working folder: the notes folder (a Reminders branch in the list), or
// the Ross Writer project's folder when one is open (as Ross Writer and the laptop's Ross Note keep them). The
// folder is made if it isn't there. A blank draft isn't kept. Drafts lists the earlier ones (newest first);
// Insert puts the draft at the cursor in the page.
const PN = { el: $("popnote"), ta: $("popnote").querySelector("textarea"), list: $("popnote").querySelector(".plist"),
  timer: 0, cur: null, R: null, range: null };

async function popPlace() {
  const st = S.store;
  if (st && st.isProject && !st.isDoc && !st.isScriv && !st.isEpub && st.handle && /\.rwproj$/i.test(st.fileName || "")) {
    if (!PN.R || PN.R.project !== st) {
      const d = await st.handle.getDirectoryHandle("Reminders", { create: true });
      const store = new Store(d);
      await store.scan();
      PN.R = { store, parent: store.root, project: st, where: "the project’s folder" };
    }
    return PN.R;
  }
  const home = S.notes || (st && !st.isProject ? st : null);
  if (!home) return null;
  let parent = home.find("Reminders");
  if (!parent) {
    parent = await home.addNote(home.root, home.root.children.length, "Reminders", "Reminders\n");
    await home.writeOrder(home.root);
    if (S.store === home) renderTree();
  }
  PN.R = { store: home, parent, project: null, where: "your notes" };
  return PN.R;
}

function popLines() {
  return PN.ta.value.split("\n").map((t) => ({ kind: null, mark: null, runs: t ? [{ t, f: new Set() }] : [] }));
}
function popTitle() {
  const first = (PN.ta.value.split("\n")[0] || "").trim().slice(0, 80);
  return first;
}
function draftStamp() {
  const d = new Date(), z = (n) => String(n).padStart(2, "0");
  return `Draft ${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}.${z(d.getMinutes())}`;
}

async function popSave() {
  clearTimeout(PN.timer);
  const text = PN.ta.value;
  if (!PN.cur && !text.trim()) return;
  const R = PN.R || await popPlace();
  if (!R) { toast("Open your notes (or a Ross Writer project) first: drafts are kept in its Reminders folder."); return; }
  const body = md.serialize(popLines(), { dir: [] });
  await queue(async () => {
    const st = R.store;
    // the notes were read again (coming back to the app): the same notes, found afresh
    if (!R.parent.isRoot()) R.parent = st.find(R.parent.key()) || R.parent;
    if (PN.cur) PN.cur = st.find(PN.cur.key()) || PN.cur;
    if (!PN.cur) {
      PN.cur = await st.addNote(R.parent, 0, popTitle() || draftStamp(), body);
      await st.writeOrder(R.parent);
    } else {
      if (PN.cur.text !== body) await st.write(PN.cur, body);
      const t = popTitle();
      if (t && t !== PN.cur.name && md.safeName && md.safeName(t) !== PN.cur.name) await st.rename(PN.cur, t);
    }
    if (st === S.store) renderTree();
    for (const p of P) if (p.note === PN.cur && !p.dirty) refill(p);
  });
  popCount();
}

function popCount() {
  const b = PN.el.querySelector(".pdrafts");
  const n = PN.R ? PN.R.parent.children.length : 0;
  b.textContent = "Drafts" + (n ? ` (${n})` : "") + (PN.list.hidden ? " ▾" : " ▴");
}

async function popNew() {
  if (PN.cur || PN.ta.value.trim()) await popSave();
  PN.cur = null;
  PN.ta.value = "";
  popListShow(false);
  PN.ta.focus();
}

async function popOpenDraft(n) {
  await popSave();
  try { await PN.R.store.read(n); } catch (e) { /* as we had it */ }
  PN.cur = n;
  PN.ta.value = md.parse(n.text || "").map(plainLine).join("\n").replace(/\n+$/, "");
  popListShow(false);
  PN.ta.focus();
}

async function popListShow(on) {
  PN.list.hidden = !on;
  PN.ta.hidden = on;
  if (on) {
    await popSave();
    const R = await popPlace();
    PN.list.textContent = "";
    const drafts = R ? [...R.parent.children] : [];
    for (const n of drafts) { if (!n.modified) { try { await R.store.read(n); } catch (e) { /* skip */ } } }
    drafts.sort((a, b) => (b.modified || 0) - (a.modified || 0));
    if (!drafts.length) {
      const e = document.createElement("div");
      e.className = "pempty";
      e.textContent = "No drafts yet. Type in the pop-up and it’s kept in Reminders.";
      PN.list.appendChild(e);
    }
    for (const n of drafts) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "pitem" + (n === PN.cur ? " cur" : "");
      const when = n.modified ? new Date(n.modified).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
      b.innerHTML = "<span></span><small></small>";
      b.firstChild.textContent = n.title();
      b.lastChild.textContent = when;
      b.onclick = () => popOpenDraft(n);
      PN.list.appendChild(b);
    }
  }
  popCount();
}

async function popInsert() {
  await popSave();
  const text = PN.ta.value.replace(/\s+$/, "");
  if (!text) { toast("Nothing in the draft to put in the page."); return; }
  if (!A || !A.page || readOnlyHere()) return;
  A.page.focus();
  const sel = getSelection();
  if (PN.range && A.page.contains(PN.range.startContainer)) { sel.removeAllRanges(); sel.addRange(PN.range); }
  // the draft as paragraphs of its own: after a line with words in it, it starts on the next line
  const lines = md.parse(text);
  let at = sel.rangeCount ? sel.getRangeAt(0).startContainer : null;
  while (at && at.parentNode !== A.page) at = at.parentNode;
  if (at && ed.lineText(at).split(md.OBJ).join("").trim()) lines.unshift({ kind: null, mark: null, runs: [] });
  pasteLines(lines, false);
  afterEdit();
  toast("The draft is in the page (it’s kept in Reminders too).");
}

// where the cursor was in the page, for Insert
document.addEventListener("selectionchange", () => {
  const sel = getSelection();
  if (sel.rangeCount && A && A.page && A.page.contains(sel.anchorNode)) PN.range = sel.getRangeAt(0).cloneRange();
});

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
    PN.cur = null;
    PN.ta.value = "";
    PN.list.hidden = true;
    PN.ta.hidden = false;
    PN.R = null;
    PN.ta.focus();          // ready to type at once; where it's kept is found meanwhile
    popPlace().then((R) => {
      PN.ta.placeholder = R ? `A quick draft… (kept in Reminders, in ${R.where})` : "A quick draft…";
      popCount();
    });
  } else popSave();
}
function togglePop() { popShow(PN.el.hidden); }
PN.ta.addEventListener("input", () => { clearTimeout(PN.timer); PN.timer = setTimeout(popSave, 800); });
PN.el.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); popShow(false); page.focus(); } });
PN.el.querySelector(".pclose").onclick = () => popShow(false);
PN.el.querySelector(".pnew").onclick = () => popNew();
PN.el.querySelector(".pdrafts").onclick = () => popListShow(PN.list.hidden);
PN.el.querySelector(".pins").onclick = () => popInsert();
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
    const flat = [];
    for (const it of menuItems(m)) {
      if (it && typeof it === "object" && Array.isArray(it.sub)) { flat.push(it.label); for (const x of it.sub) flat.push(x); flat.push("-"); } else flat.push(it);
    }
    for (const it of flat) {
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
    const ws = l.split(/[^\p{L}\p{N}]+/u);
    let sc = l.startsWith(q) ? 3 : ws.some((w) => w.startsWith(words[0])) ? 2 : 1;
    if (ws.includes(words[0])) sc += 0.25;          // 1.9.20: "dark" finds Dark Mode before Darker Text
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
  const w = FMB.offsetWidth * uiz(), h = FMB.offsetHeight * uiz();
  const topLimit = $("topbar").getBoundingClientRect().bottom + 4;
  let top = r.top - h - 8;
  if (top < topLimit) top = r.bottom + 8;
  const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
  putAt(FMB, left, top);
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

// ------------------------------------------------------------------ 1.9.0: Classic Look (Ctrl+Alt+L)
// the look before 1.9.0 (yellow paper, Cambria, the toolbar, no blue bar, a light list); again: the new look
function toggleClassic() {
  S.settings.classic = !S.settings.classic;
  saveSettings();
  applyLook();
  renderTree();
  updateHead();
  toast(S.settings.classic ? "Classic look (Ctrl+Alt+L for the new one)" : "New look (Ctrl+Alt+L for the classic one)");
}

// for the tests
window.RN = { popNew, popListShow, popInsert, popOpenDraft, PN, draftOn, pmeta, setStatus, toggleInclude, targetsDialog, targetFigures, showInspector, moveTo, ED, selectAllShown, openJoined, selectClick, clearSel, joinedPieces, chooseAnotherFolder, noteFolders, chooseFolder, chooseProjectsFolder, pickFromFolder, lostPick, keepSpot, restoreSpot, showStart, toggleClassic, commandPalette, toggleFocus, chooseColour, colourOf, setGoal, goalNow, sideWidth, showSaved, importNoble, S, P, commentSize, importProject, newProject, importWord, listAll, replaceEverywhere, togglePop, popSave, goTo, showRecent, togglePageView, updateCorner, cornerFigures, pageMenu, spell, spellCheckNow, showDictionary, saveDictionary, openWordDoc, openMdFile, openDocFile, chooseWordDoc, addComment,
  commentAction, askAuthor, renderComments, toggleComments, goToWords, openProject, chooseProject, backToNotes, reopenProject, reopenDoc, openRoot, updateWordCopy, wordFlush, get wordDue() { return [...wordDue]; }, wordsIn, countWords, countBranch, codes, get findCur() { return findCur; }, openFind, findAll, findGo, replaceOne, replaceAll, showHeadings, importNotebook, shareNote, shareText, shareWord, copyForEmail, importWord, exportNotes, rtfBlob, saveOriginalRtf, useDocDir: (d) => { docDir = d; }, pickedNothing, deviceCheck, diag, renderTree, showPdfIn, addPdfEntry, exportProject, exportProjectTo, set testNoAsk(v) { RN_TEST_NOASK = v; }, newScrivener, scrivBackups, insertNote, fnOn, renderFootnotes, fontsDialog, PAGE_FONTS, compileDialog, compileBook, compileLines, compilePrint, compileModule, kvGet, kvSet, joinedParts, wordModule, saveFile, setActive, setSplit, get A() { return A; }, md, ed, flushSave, refresh, openNote, newNote, moveNote, addPictures, pasteLines, COMMANDS, VERSION };

start();
