// Ross Invoices on a tablet: the pages and windows, as in the desktop program.
import * as M from "./money.js";
import { Store, blankAccount } from "./store.js";
import * as P from "./pdf.js";
import * as F from "./files.js";
import { EDITION } from "./edition.js";

export const VERSION = "1.2.0";
const TERMS = [["On receipt", 0], ["7 days", 7], ["14 days", 14], ["30 days", 30], ["60 days", 60]];
const EST_TERMS = [["No end date", 0], ["14 days", 14], ["30 days", 30], ["60 days", 60], ["90 days", 90]];
const METHODS = ["Bank transfer", "Cash", "Cheque", "PayPal", "Card", "Other"];
const UNITS = ["hours", "days", "sessions", "words", "pages", "chapters", "items"];
const GROUPS = ["Teaching", "Editing", "Mentoring", "Readings and talks", "Writing", "Expenses"];
const SECTIONS = ["Materials", "Labour", "Fabrication", "Installation", "Transport", "Equipment hire", "Other"];
const PURCHASE_KINDS = ["Materials", "Gas and consumables", "Tools", "Equipment hire", "Transport and fuel",
  "Subcontractor", "Other"];
const PILLS = {
  "Paid": ["Paid", "#e3f3e7", "#1e7a34"], "Unpaid": ["Unpaid", "#fde8e7", "#b3261e"],
  "Overdue": ["Overdue", "#b3261e", "#ffffff"], "Part paid": ["Partial", "#fff3d4", "#8a5a00"],
  "Part paid, overdue": ["Partial, overdue", "#b3261e", "#ffffff"],
  "Nothing to pay": ["Nothing due", "#eceff3", "#6b7480"],
  // estimates
  "Draft": ["Draft", "#eceff3", "#6b7480"], "Sent": ["Sent", "#e3ecf7", "#1f3b57"],
  "Accepted": ["Accepted", "#e3f3e7", "#1e7a34"], "Declined": ["Declined", "#fde8e7", "#b3261e"],
  "Expired": ["Expired", "#f6ead8", "#7a4b00"],
};
const RECENT = 10;

let st = null;
const state = { page: "Dashboard", filter: 0, search: "", period: "all", year: null, efilter: 0 };

// ------------------------------------------------------------------ little helpers
export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style") el.style.cssText = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "value") el.value = v;
    else if (k === "checked") el.checked = !!v;
    else if (k === "html") el.innerHTML = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const $ = (sel, root = document) => root.querySelector(sel);

function pill(status) {
  const [label, bg, fg] = PILLS[status] || [status, "#eceff3", "#1d232b"];
  return h("span", { class: "pill", style: `background:${bg};color:${fg}` }, label);
}

export function toast(msg, ms = 4500) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("on"), ms);
}

function field(label, input, hint) {
  return h("label", { class: "field" }, h("span", { class: "flabel" }, label), input,
    hint ? h("span", { class: "hint" }, hint) : null);
}

function select(options, value, onchange) {
  const s = h("select", { onchange });
  for (const [v, label] of options) {
    const o = h("option", { value: v ?? "" }, label);
    if (String(v ?? "") === String(value ?? "")) o.selected = true;
    s.append(o);
  }
  return s;
}

const currencyOptions = (blank) => [...(blank ? [["", blank]] : []),
  ...Object.entries(M.CURRENCIES).map(([k, v]) => [k, v[1]])];

function accountLabel(a) {
  let s = a.name;
  if (a.currency) s += ` (${a.currency})`;
  if (a.retired) s += " — retired";
  return s;
}

function accountOptions(current, blank) {
  const list = st.accounts(false);
  const cur = st.account(current);
  if (cur && cur.retired) list.push(cur);
  return [...(blank ? [["", blank]] : []), ...list.map((a) => [a.id, accountLabel(a)])];
}

// A date box, with the date written out under it (13 November 2026), so it
// reads the same whatever order the tablet shows the box in.
function dated(input) {
  const say = h("span", { class: "hint said" });
  const upd = () => { say.textContent = input.value ? M.longDate(input.value) : (input.disabled ? "" : " "); };
  input.addEventListener("input", upd);
  input.addEventListener("change", upd);
  input._say = upd;
  upd();
  return h("div", { class: "dated" }, input, say);
}

function datalist(id, values) {
  return h("datalist", { id }, values.map((v) => h("option", { value: v })));
}

// ------------------------------------------------------------------ sheets (windows)
// A window over the page: centred on a wide screen, the whole screen on a narrow one.
export function sheet(title, body, buttons, opts = {}) {
  return new Promise((resolve) => {
    const root = $("#sheets");
    const close = (v) => {
      wrap.remove();
      document.removeEventListener("keydown", onKey);
      if (!root.children.length) document.body.classList.remove("sheet-open");
      resolve(v);
    };
    const onKey = (e) => { if (e.key === "Escape" && root.lastElementChild === wrap) close(null); };
    const foot = h("div", { class: "sheet-foot" });
    for (const b of buttons) {
      foot.append(h("button", { class: b.cls || "", type: "button", onclick: async () => {
        if (b.run) {
          const r = await b.run();
          if (r === false) return;
          close(r === undefined ? b.value ?? true : r);
        } else close(b.value ?? null);
      } }, b.label));
    }
    const wrap = h("div", { class: "sheet-wrap" + (opts.wide ? " wide" : "") + (opts.tall ? " tall" : "") },
      h("div", { class: "sheet", role: "dialog", "aria-label": title },
        h("div", { class: "sheet-head" }, h("h2", {}, title),
          h("button", { class: "x", type: "button", "aria-label": "Close", onclick: () => close(null) }, "✕")),
        h("div", { class: "sheet-body" }, body), buttons.length ? foot : null));
    wrap.addEventListener("click", (e) => { if (e.target === wrap && !opts.modal) close(null); });
    document.addEventListener("keydown", onKey);
    root.append(wrap);
    document.body.classList.add("sheet-open");
    const first = wrap.querySelector("input:not([type=checkbox]):not([type=radio]), textarea, select");
    if (first && !opts.nofocus && window.matchMedia("(pointer: fine)").matches) first.focus();
  });
}

export function confirmBox(text, yes = "Yes", no = "Cancel", danger = false) {
  return sheet(EDITION.name, h("p", { class: "msg" }, text),
    [{ label: no, value: false }, { label: yes, value: true, cls: danger ? "danger" : "primary" }]);
}

export function infoBox(text) {
  return sheet(EDITION.name, h("p", { class: "msg" }, text), [{ label: "OK", value: true, cls: "primary" }]);
}

// A list of choices (an action menu).
function actions(title, items) {
  return new Promise((resolve) => {
    const list = h("div", { class: "actions" });
    let done;
    const p = sheet(title, list, []).then((v) => resolve(done ?? v));
    for (const it of items) {
      if (!it) { list.append(h("hr")); continue; }
      list.append(h("button", { class: "act" + (it.danger ? " danger" : ""), type: "button", disabled: it.disabled,
        onclick: () => { done = it.value; list.closest(".sheet-wrap").querySelector(".x").click(); } },
      h("span", { class: "act-icon" }, it.icon || ""), h("span", {}, it.label),
      it.sub ? h("span", { class: "act-sub" }, it.sub) : null));
    }
    return p;
  });
}

// ------------------------------------------------------------------ the frame
// "Estimate" or "Quotation", as chosen in Settings
const EW = () => st.estimateWord();
const ew = () => EW().toLowerCase();

// [key, label, subtitle, icon]
function PAGES() {
  const jobs = !!st.settings.use_jobs;
  return [
    ["Dashboard", "Dashboard", "Overview", "◫"], ["Invoices", "Invoices", "Everything you have invoiced", "▤"],
    ["Estimates", EW() + "s", "Prices you have quoted", "◇"],
    ...(jobs ? [["Jobs", "Jobs", "Each piece of work: quoted, invoiced, spent, made", "⚒"],
      ["Purchases", "Purchases", "Materials and costs you have paid for", "⛁"]] : []),
    ["Clients", "Clients", "Who you work for", "☺"], ["Services", "Services", "What you charge for", "✎"],
    ["Payment Accounts", "Payment Accounts", "Where you are paid", M.symbol(st.settings.defaults.currency || "GBP").replace(/[A-Z]+/, "") || "£"],
    ["Settings", "Settings", "Your details and choices", "⚙"],
  ];
}

function wordmark(name) {
  const w = String(name || "").toUpperCase().split(/\s+/).filter(Boolean);
  return h("span", {}, h("b", {}, w[0] || ""), w.length > 1 ? " " + w.slice(1).join(" ") : "");
}

function buildFrame() {
  const nav = $("#nav");
  nav.innerHTML = "";
  for (const [key, label, , icon] of PAGES()) {
    nav.append(h("button", { class: "navb" + (state.page === key ? " on" : ""), type: "button", "data-page": key,
      onclick: () => go(key) }, h("span", { class: "nav-i" }, icon), h("span", {}, label)));
  }
  const head = (st.settings.heading || "").trim() || st.settings.business.name || EDITION.name;
  $("#wordmark").replaceChildren(wordmark(head));
  $("#topname").textContent = head;
  document.title = EDITION.name;
}

export function go(page) {
  state.page = page;
  document.body.classList.remove("menu-open");
  render();
  $("#main").scrollTop = 0;
  window.scrollTo(0, 0);
}

export function render() {
  buildFrame();
  M.setYearStart(st.settings.year_start);
  const pg = PAGES().find((p) => p[0] === state.page) || PAGES()[0];
  state.page = pg[0];
  const [key, name, sub] = pg;
  const main = $("#main");
  main.replaceChildren(h("div", { class: "page-head" }, h("h1", {}, name), h("p", { class: "sub" }, sub)));
  $("#toptitle").textContent = name;
  ({ Dashboard: pageDashboard, Invoices: pageInvoices, Estimates: pageEstimates, Jobs: pageJobs, Purchases: pagePurchases,
    Clients: pageClients, Services: pageServices, "Payment Accounts": pageAccounts, Settings: pageSettings })[key](main);
}

// ------------------------------------------------------------------ Dashboard
function pageDashboard(main) {
  const main_cur = st.settings.defaults.currency || "GBP";
  const amounts = (d) => {
    const ks = Object.keys(d);
    if (!ks.length) return [M.fmt(0n, main_cur), ""];
    ks.sort((a, b) => (a !== main_cur) - (b !== main_cur) || (d[b] > d[a] ? 1 : d[b] < d[a] ? -1 : 0));
    return [M.fmt(d[ks[0]], ks[0]), ks.slice(1).map((c) => M.fmt(d[c], c)).join("\n")];
  };
  const year = state.period === "all" ? null : +state.period;
  const dash = st.dashboard(year);
  const card = (title, value, more) => h("div", { class: "card" }, h("div", { class: "card-t" }, title.toUpperCase()),
    h("div", { class: "card-v" }, value), h("div", { class: "card-m" }, more || " "));
  const late = Object.entries(dash.overdue_amount).sort((a, b) => (a[0] !== main_cur) - (b[0] !== main_cur))
    .map(([c, v]) => M.fmt(v, c)).join("\n");
  main.append(h("div", { class: "cards" },
    card("Invoices", String(dash.invoices)), card("Outstanding", ...amounts(dash.outstanding)),
    card("Collected", ...amounts(dash.collected)), card("Overdue", String(dash.overdue), late)));
  const periods = [["all", "All time"], ...st.years().map((y) => [String(y), "Tax year " + M.taxYearLabel(y)])];
  main.append(h("div", { class: "bar" },
    h("label", { class: "inline" }, "Showing: ", select(periods, state.period, (e) => { state.period = e.target.value; render(); })),
    h("span", { class: "grow" }),
    h("button", { class: "primary big", type: "button", onclick: () => newInvoice() }, "+  New Invoice")));
  const wait = st.estimatesWaiting();
  if (wait.n) {
    main.append(h("div", { class: "foot-row est-wait" }, h("button", { class: "link", type: "button",
      onclick: () => { state.efilter = 1; go("Estimates"); } },
    `${wait.n} ${ew()}${wait.n === 1 ? "" : "s"} awaiting an answer (` +
      Object.entries(wait.amounts).sort().map(([c, v]) => M.fmt(v, c)).join(", ") + ") →")));
  }
  const span = year != null ? M.taxYearSpan(year) : null;
  const rows = st.invoices().filter((i) => !span || (i.issue_date >= span[0] && i.issue_date <= span[1])).slice(0, RECENT);
  main.append(invoiceTable(rows, true));
  main.append(h("div", { class: "foot-row" },
    h("span", { class: "muted" }, rows.length === RECENT ? `The ${RECENT} most recent` : ""),
    h("button", { class: "link", type: "button", onclick: () => go("Invoices") }, "See all invoices →")));
  if (!st.data.invoices.length && !st.data.clients.length) {
    main.append(h("div", { class: "welcome" },
      h("h3", {}, "Welcome"),
      h("p", {}, "Everything you put in here is kept on this device, in this browser."),
      EDITION.laptop ? h("p", {}, "To bring in your clients, services, accounts and invoices from Ross Invoices on the laptop, use ",
        h("b", {}, "File → Export for Tablet"), " there, then ",
        h("button", { class: "link", type: "button", onclick: () => importAll() }, "Import that file here"), ".") : null,
      h("p", {}, EDITION.laptop ? "Or start fresh: put your details in " : "To start, put your details, logo and bank account in ",
        h("button", { class: "link", type: "button", onclick: () => go("Settings") }, "Settings"), ".")));
  }
}

function invoiceTable(list, compact) {
  const today = M.todayIso();
  if (!list.length) return h("div", { class: "empty" }, compact ? "No invoices yet." : "No invoices here.");
  const t = h("div", { class: "tbl inv" + (compact ? " compact" : "") },
    h("div", { class: "tr th" }, h("span", { class: "c-num" }, "Number"), h("span", { class: "c-client" }, "Client"),
      h("span", { class: "c-date" }, "Issued"), compact ? null : h("span", { class: "c-date c-due" }, "Due"),
      h("span", { class: "c-amt" }, "Total"), compact ? null : h("span", { class: "c-amt c-paid" }, "Paid"),
      h("span", { class: "c-amt" }, "Balance"), h("span", { class: "c-st" }, "Status")));
  for (const inv of list) {
    const cur = inv.currency;
    const status = Store.status(inv, today);
    t.append(h("button", { class: "tr", type: "button", onclick: () => invoiceMenu(inv.id) },
      h("span", { class: "c-num" }, h("b", {}, inv.number)),
      h("span", { class: "c-client" }, (inv.client || {}).name || ""),
      h("span", { class: "c-date" }, M.shortDate(inv.issue_date)),
      compact ? null : h("span", { class: "c-date c-due" }, M.shortDate(inv.due_date) || "On receipt"),
      h("span", { class: "c-amt" }, M.fmt(inv.total, cur)),
      compact ? null : h("span", { class: "c-amt c-paid" }, M.fmt(inv.paid, cur)),
      h("span", { class: "c-amt" + (inv.balance > 0n ? " strong" : "") }, M.fmt(inv.balance, cur)),
      h("span", { class: "c-st" }, pill(status))));
  }
  return t;
}

// ------------------------------------------------------------------ Invoices
function pageInvoices(main) {
  const search = h("input", { type: "search", placeholder: "Search…", value: state.search,
    oninput: (e) => { state.search = e.target.value; fill(); } });
  main.append(h("div", { class: "bar" },
    h("button", { class: "primary", type: "button", onclick: () => newInvoice() }, "+  New Invoice"),
    select([[0, "All invoices"], [1, "Still to be paid"], [2, "Overdue"], [3, "Paid"]], state.filter,
      (e) => { state.filter = +e.target.value; fill(); }),
    search));
  const holder = h("div");
  main.append(holder);
  const years = st.years();
  if (state.year == null || !years.includes(state.year)) state.year = years[0];
  const sumText = h("div", { class: "summary" });
  main.append(h("div", { class: "bar sum" }, h("label", { class: "inline" }, "Tax year: ",
    select(years.map((y) => [y, M.taxYearLabel(y)]), state.year, (e) => { state.year = +e.target.value; summary(); })),
  sumText));

  function fill() {
    const today = M.todayIso();
    const q = state.search.trim().toLowerCase();
    const list = st.invoices().filter((inv) => {
      const s = Store.status(inv, today);
      if (state.filter === 1 && (s === "Paid" || s === "Nothing to pay")) return false;
      if (state.filter === 2 && !s.toLowerCase().includes("overdue")) return false;
      if (state.filter === 3 && s !== "Paid") return false;
      if (q && !(inv.number + " " + (inv.client.name || "") + " " + inv.items.map((i) => i.description).join(" "))
        .toLowerCase().includes(q)) return false;
      return true;
    });
    holder.replaceChildren(invoiceTable(list, false));
  }
  function summary() {
    const [a, b] = M.taxYearSpan(state.year);
    const parts = Object.entries(st.yearSummary(state.year)).sort().map(([cur, v]) =>
      `${cur}: invoiced ${M.fmt(v.invoiced, cur)}, received ${M.fmt(v.received, cur)}, still owed ${M.fmt(v.owed, cur)}`);
    sumText.textContent = `(${M.longDate(a)} to ${M.longDate(b)})  ` + (parts.length ? parts.join("  ·  ") : "nothing yet");
  }
  fill();
  summary();
}

async function invoiceMenu(iid) {
  const inv = st.invoice(iid);
  if (!inv) return;
  const cur = inv.currency;
  const status = Store.status(inv);
  const share = F.canShareFiles();
  const v = await actions(`${inv.number} · ${inv.client.name || ""}`, [
    { icon: "✎", label: "Change", value: "edit" },
    { icon: "⧉", label: "Duplicate", sub: "A new invoice like this one, dated today", value: "dup" },
    { icon: "£", label: "Record Payment", sub: `Balance ${M.fmt(inv.balance, cur)} · ${status}`, value: "pay",
      disabled: inv.balance <= 0n },
    { icon: "≡", label: `Payments (${inv.payments.length})`, value: "payments" },
    null,
    { icon: "◳", label: "Preview", value: "preview" },
    { icon: "⤓", label: "Save PDF", sub: F.canPickFolder ? "Into your invoices folder" : "To Downloads", value: "pdf" },
    { icon: "✉", label: share ? "Send…" : "Send by Email", sub: share ? "Share the PDF: Gmail, WhatsApp…" :
      "Downloads the PDF and opens an email", value: "send" },
    null,
    { icon: "✕", label: "Delete Invoice…", value: "delete", danger: true },
  ]);
  if (v === "edit") await editInvoice(inv);
  else if (v === "dup") {
    const id = await st.duplicateInvoice(iid);
    toast(`Made ${st.invoice(id).number}, dated today.`);
    render();
    await editInvoice(st.invoice(id));
  } else if (v === "pay") await recordPayment(inv);
  else if (v === "payments") await paymentsList(inv);
  else if (v === "preview") await preview(inv);
  else if (v === "pdf") await savePdf(inv);
  else if (v === "send") await sendInvoice(inv);
  else if (v === "delete") {
    let msg = `Delete invoice ${inv.number} for ${inv.client.name || ""}?`;
    if (inv.payments.length) msg += `\n\nIts ${inv.payments.length} payment record(s) will go too.`;
    msg += "\n\nAny PDF already saved stays where it is.";
    if (await confirmBox(msg, "Delete", "Keep it", true)) {
      await st.deleteInvoice(iid);
      toast(`Invoice ${inv.number} deleted.`);
      render();
    }
  }
}

// ------------------------------------------------------------------ PDFs
async function pdfBytes(inv) {
  return P.makePdf(inv, st.settings);
}

async function savePdf(inv, quiet = false) {
  const est = inv.kind === "estimate";
  try {
    const bytes = await pdfBytes(inv);
    const where = await F.savePdf(st, bytes, st.pdfName(inv), M.toDate(inv.issue_date)?.getFullYear(),
      est ? EW() + "s" : "");
    const saved = (await st.kvGet("pdfSaved")) || {};
    saved[(est ? "e" : "") + inv.id] = M.todayIso();
    await st.kvSet("pdfSaved", saved);
    if (!quiet) toast(where, 7000);
    return bytes;
  } catch (e) {
    if (e && e.name === "AbortError") return null;
    await infoBox("The PDF couldn't be saved: " + (e.message || e));
    return null;
  }
}

function emailText(inv) {
  const name = st.settings.business.name || "";
  const cur = inv.currency;
  const ref = (inv.reference || "").trim() ? ` (your ref. ${inv.reference.trim()})` : "";
  if (inv.kind === "estimate") {
    return [`${EW()} ${inv.number} from ${name}${ref}`, [`Dear ${inv.client.name || ""},`, "",
      `Please find attached my ${ew()} ${inv.number}${ref} for ${M.fmt(inv.total, cur)}` +
      (inv.valid_until ? `, valid until ${M.longDate(inv.valid_until)}` : "") + ".", "",
      "Do let me know if you would like to go ahead, or if you have any questions.", "",
      "With best wishes,", name].join("\n")];
  }
  const subject = `Invoice ${inv.number} from ${name}${ref}`;
  const body = [`Dear ${inv.client.name || ""},`, "",
    `Please find attached invoice ${inv.number}${ref} for ${M.fmt(inv.paid !== 0n ? inv.balance : inv.total, cur)}` +
    (inv.due_date ? `, due by ${M.longDate(inv.due_date)}` : "") + ".", "",
    "Payment details are on the invoice.", "", "With best wishes,", name].join("\n");
  return [subject, body];
}

// An estimate still a draft becomes Sent once it has gone.
async function sendInvoice(inv) {
  const [subject, body] = emailText(inv);
  const bytes = await pdfBytes(inv);
  const sent = async () => {
    if (inv.kind === "estimate" && (inv.status || "draft") === "draft") {
      await st.setEstimateStatus(inv.id, "sent");
      render();
    }
  };
  if (F.canShareFiles()) {
    try {
      await F.sharePdf(bytes, st.pdfName(inv), subject, body);
      await sent();
      return;
    } catch (e) {
      if (e && e.name === "AbortError") return;
    }
  }
  await sent();
  F.download(bytes, st.pdfName(inv), "application/pdf");
  location.href = `mailto:${encodeURIComponent(inv.client.email || "")}?subject=${encodeURIComponent(subject)}` +
    `&body=${encodeURIComponent(body)}`;
  toast(`The PDF is in your Downloads: attach ${st.pdfName(inv)} to the email.`, 12000);
}

async function preview(inv) {
  const box = h("div", { class: "preview" }, h("p", { class: "muted" },
    `Drawing the ${inv.kind === "estimate" ? ew() : "invoice"}…`));
  const p = sheet(`Preview — ${inv.number}`, box, [{ label: "Close", value: null }], { wide: true, tall: true, nofocus: true });
  const canvases = await P.renderPages(inv, st.settings, 2);
  box.replaceChildren(...canvases.map((c) => h("div", { class: "page" }, c)));
  return p;
}

// ------------------------------------------------------------------ payments
async function recordPayment(inv) {
  const cur = inv.currency;
  const amount = h("input", { type: "text", inputmode: "decimal",
    value: M.centsToText(inv.balance > 0n ? inv.balance : 0n) });
  const date = h("input", { type: "date", value: M.todayIso() });
  const method = h("input", { type: "text", list: "methods", value: "Bank transfer" });
  const note = h("input", { type: "text" });
  const body = h("div", { class: "form" },
    h("p", {}, "Balance due: ", h("b", {}, M.fmt(inv.balance, cur))),
    field(`Amount received (${M.symbol(cur)})`, amount), field("Date", dated(date)), field("How", method),
    field("Note", note), datalist("methods", METHODS));
  const ok = await sheet(`Record Payment — ${inv.number}`, body, [{ label: "Cancel", value: false },
    { label: "Record", cls: "primary", run: () => {
      if (M.cents(M.parseAmount(amount.value)) <= 0n) { amount.focus(); return false; }
      return true;
    } }]);
  if (!ok) return;
  await st.addPayment(inv.id, M.parseAmount(amount.value), date.value || M.todayIso(), method.value.trim(), note.value.trim());
  const now = st.invoice(inv.id);
  toast(`Payment recorded. ${now.number} is now ${Store.status(now).toLowerCase()}.`);
  render();
}

async function paymentsList(inv) {
  const box = h("div", { class: "form" });
  const fill = () => {
    const now = st.invoice(inv.id);
    box.replaceChildren();
    if (!now.payments.length) box.append(h("p", { class: "muted" }, "No payments recorded yet."));
    for (const p of now.payments) {
      box.append(h("div", { class: "row-item" },
        h("div", { class: "grow" }, h("b", {}, M.fmt(p.amount, now.currency)), "  ", M.longDate(p.date),
          h("div", { class: "muted" }, [p.method, p.note].filter(Boolean).join(" · "))),
        h("button", { class: "small danger", type: "button", onclick: async () => {
          if (await confirmBox(`Remove the payment of ${M.fmt(p.amount, now.currency)} on ${M.longDate(p.date)}?`,
            "Remove", "Keep it", true)) {
            await st.deletePayment(inv.id, p.id);
            fill();
            render();
          }
        } }, "Remove")));
    }
    box.append(h("p", {}, "Total ", M.fmt(now.total, now.currency), " · paid ", M.fmt(now.paid, now.currency),
      " · balance ", h("b", {}, M.fmt(now.balance, now.currency))));
  };
  fill();
  const v = await sheet(`Payments — ${inv.number}`, box, [{ label: "Close", value: null },
    { label: "Record Payment…", cls: "primary", value: "add" }]);
  if (v === "add") await recordPayment(st.invoice(inv.id));
}

// ------------------------------------------------------------------ the invoice editor
async function newInvoice() {
  if (!st.data.clients.length) {
    if (!(await confirmBox("You have no clients yet. Add one now?", "Add a Client"))) return;
    const c = await editClient(null);
    if (!c) return;
  }
  return editInvoice(null);
}

async function newEstimate() {
  if (!st.data.clients.length) {
    if (!(await confirmBox("You have no clients yet. Add one now?", "Add a Client"))) return;
    const c = await editClient(null);
    if (!c) return;
  }
  return editInvoice(null, "estimate");
}

// The same window makes invoices and estimates. An estimate has "Valid for"
// instead of payment terms, and prints the payment details only if ticked.
async function editInvoice(inv, kind = inv && inv.kind === "estimate" ? "estimate" : "invoice", opts = {}) {
  const s = st.settings, d = s.defaults;
  const est = kind === "estimate";
  const word = est ? ew() : "invoice", Word = est ? EW() : "Invoice";
  const T = est ? EST_TERMS : TERMS;
  const number = h("input", { type: "text", value: inv ? inv.number : st.nextNumber(kind) });
  let clientSel;
  const clientWrap = h("div", { class: "with-btn" });
  const fillClients = (sel) => {
    clientSel = select([["", "— choose a client —"], ...st.clients().map((c) => [c.id, c.name])], sel ?? "",
      () => clientChanged());
    clientWrap.replaceChildren(clientSel, h("button", { type: "button", class: "small", onclick: async () => {
      const c = await editClient(null);
      if (c) { fillClients(c.id); clientChanged(); }
    } }, "New…"));
  };
  fillClients(inv ? inv.client_id : (opts.client_id ?? ""));
  const issue = h("input", { type: "date", value: inv ? inv.issue_date : M.todayIso() });
  const due = h("input", { type: "date" });
  const terms = select([...T.map(([l, n]) => [n, l]), [-1, "Choose a date"]], "");
  const setDue = (iso) => {
    due.value = iso || "";
    const n = iso ? M.daysBetween(issue.value, iso) : 0;
    const known = T.find((t) => t[1] === n);
    terms.value = String(!iso ? 0 : known ? known[1] : -1);
    due.disabled = terms.value === "0";
    if (due._say) due._say();
  };
  if (inv) setDue(est ? inv.valid_until : inv.due_date);
  else {
    const n = +(est ? d.valid_days ?? 30 : d.terms_days) || 0;
    setDue(n ? M.addDays(issue.value, n) : "");
  }
  terms.onchange = () => {
    const n = +terms.value;
    due.disabled = n === 0;
    if (n === 0) due.value = "";
    else if (n > 0) due.value = M.addDays(issue.value, n);
    else if (!due.value) due.value = M.addDays(issue.value, 30);
    due._say();
  };
  issue.addEventListener("change", () => { if (+terms.value > 0) { due.value = M.addDays(issue.value, +terms.value); due._say(); } });
  due.onchange = () => setDue(due.value);
  const currency = select(currencyOptions(), inv ? inv.currency : d.currency || "GBP", () => recalc());
  let accountSel;
  const accWrap = h("div", { class: "with-btn" });
  const accText = h("div", { class: "muted small-text" });
  const fillAccounts = (sel) => {
    accountSel = select(accountOptions(sel, "(no payment details)"), sel ?? "", () => accountChanged(true));
    accWrap.replaceChildren(accountSel, h("button", { type: "button", class: "small", onclick: async () => {
      const a = await editAccount(null);
      if (a) { fillAccounts(a.id); accountChanged(true); }
    } }, "New…"));
  };
  fillAccounts(inv ? inv.account_id : d.account || "");
  const tax = h("input", { type: "text", inputmode: "decimal", class: "narrow",
    value: M.fmtQty(inv ? inv.tax_rate : d.tax_rate || "0"), oninput: () => recalc() });
  const taxLabel = h("input", { type: "text", class: "narrow", value: inv ? inv.tax_label : d.tax_label || "VAT" });
  const notes = h("textarea", { rows: 2, placeholder: `A note at the foot of the ${word} (optional)` });
  notes.value = inv ? inv.notes : est ? "" : s.note || "";
  const reference = h("input", { type: "text", value: inv ? inv.reference || "" : "",
    placeholder: "e.g. PO 4471, or the tender number" });
  // the job it belongs to (when jobs are switched on)
  let jobSel = null;
  const jobWrap = h("div", { class: "with-btn" });
  const fillJobs = (sel) => {
    const open = st.jobs().filter((j) => j.status !== "done" || j.id === +sel);
    jobSel = select([["", "(not part of a job)"], ...open.map((j) => [j.id, j.name])], sel ?? "");
    jobWrap.replaceChildren(jobSel, h("button", { type: "button", class: "small", onclick: async () => {
      const first = lines.find((r) => r.desc.value.trim());
      const id = await editJob(null, { client_id: clientSel.value ? +clientSel.value : null,
        name: first ? first.desc.value.trim().split("\n")[0].slice(0, 60) : "" });
      if (id) fillJobs(id);
    } }, "New…"));
  };
  if (s.use_jobs) fillJobs(inv ? inv.job_id ?? "" : (opts.job_id ?? ""));
  const showAcc = h("input", { type: "checkbox", checked: inv ? !!inv.show_account : false });
  const showAccRow = est ? h("label", { class: "check" }, showAcc, ` Print the payment details on the ${word}`) : null;

  function clientChanged() {
    const c = st.client(clientSel.value);
    if (!c) return;
    if (c.currency) currency.value = c.currency;
    if (c.account && [...accountSel.options].some((o) => o.value === c.account)) {
      accountSel.value = c.account;
      accountChanged(false);
    }
    recalc();
  }
  function accountChanged(fromUser) {
    const a = st.account(accountSel.value);
    accText.textContent = a ? (a.lines || []).map((l) => l[1]).filter(Boolean).slice(0, 3).join(" · ") : "";
    if (a && a.currency && fromUser) { currency.value = a.currency; recalc(); }
  }

  // the lines
  const linesBox = h("div", { class: "lines" });
  const lines = [];
  function addLine(it, at = null) {
    const row = { el: null };
    const desc = h("textarea", { rows: 1, class: "desc", placeholder: "Description" });
    desc.value = it.description || "";
    const qty = h("input", { type: "text", inputmode: "decimal", class: "qty", value: M.fmtQty(it.quantity ?? 1) });
    const unit = h("input", { type: "text", class: "unit", list: "units", placeholder: "per…", value: it.unit || "" });
    const price = h("input", { type: "text", inputmode: "decimal", class: "price",
      value: it.unit_price != null && it.unit_price !== "" ? M.centsToText(M.cents(it.unit_price)) : "" });
    const amount = h("span", { class: "amount" });
    const grow = () => { desc.style.height = "auto"; desc.style.height = desc.scrollHeight + 2 + "px"; };
    desc.addEventListener("input", grow);
    for (const x of [desc, qty, unit, price]) x.addEventListener("input", recalc);
    // section and cost (when switched on in Settings)
    const group = h("input", { type: "text", class: "group", list: "sections", placeholder: "Section",
      value: it.group ?? (lines.length ? lines[lines.length - 1].group.value : "") });
    const cost = h("input", { type: "text", inputmode: "decimal", class: "cost", placeholder: "0.00",
      value: it.cost != null && it.cost !== "" ? M.centsToText(M.cents(it.cost)) : "" });
    const margin = h("span", { class: "muted small-text margin" });
    row.autoPrice = !price.value;
    cost.addEventListener("input", () => {
      if (row.autoPrice && cost.value.trim()) {
        const c = M.cents(M.parseAmount(cost.value));
        price.value = M.centsToText(c + M.taxOf(c, s.markup || "0"));
      }
      recalc();
    });
    price.addEventListener("input", () => { row.autoPrice = !price.value.trim(); });
    group.addEventListener("input", recalc);
    const extra = (s.use_sections || s.use_costs) ? h("div", { class: "l-extra" },
      s.use_sections ? h("label", { class: "l-group" }, h("span", { class: "mini" }, "Section"), group) : null,
      s.use_costs ? h("label", { class: "l-cost" }, h("span", { class: "mini" }, `Your cost (each)`), cost) : null,
      s.use_costs ? margin : null) : null;
    const move = (step) => {
      const i = lines.indexOf(row), j = i + step;
      if (j < 0 || j >= lines.length) return;
      [lines[i], lines[j]] = [lines[j], lines[i]];
      linesBox.replaceChildren(...lines.map((r) => r.el));
    };
    row.el = h("div", { class: "line" },
      h("div", { class: "l-desc" }, desc),
      h("label", { class: "l-qty" }, h("span", { class: "mini" }, "Qty"), qty),
      h("label", { class: "l-unit" }, h("span", { class: "mini" }, "Per"), unit),
      h("label", { class: "l-price" }, h("span", { class: "mini" }, "Unit price"), price),
      h("div", { class: "l-amt" }, h("span", { class: "mini" }, "Amount"), amount),
      h("div", { class: "l-btns" },
        h("button", { type: "button", class: "icon", title: "Move up", onclick: () => move(-1) }, "↑"),
        h("button", { type: "button", class: "icon", title: "Move down", onclick: () => move(1) }, "↓"),
        h("button", { type: "button", class: "icon danger", title: "Remove line", onclick: () => {
          lines.splice(lines.indexOf(row), 1);
          row.el.remove();
          recalc();
        } }, "✕")), extra);
    Object.assign(row, { desc, qty, unit, price, amount, group, cost, margin });
    if (at == null) { lines.push(row); linesBox.append(row.el); } else { lines.splice(at, 0, row); }
    requestAnimationFrame(grow);
    return row;
  }
  const items = inv ? inv.items : [];
  items.forEach((it) => addLine(it));
  if (!items.length) addLine({ description: "", quantity: "1", unit: "", unit_price: "" });

  const totals = h("div", { class: "totals" });
  function current() {
    return lines.map((r) => {
      const x = { description: r.desc.value.trim(), quantity: M.parseAmount(r.qty.value),
        unit: r.unit.value.trim(), unit_price: M.parseAmount(r.price.value) };
      if (r.group.value.trim()) x.group = r.group.value.trim();
      if (r.cost.value.trim()) x.cost = M.parseAmount(r.cost.value);
      return x;
    }).filter((x) => x.description);
  }
  function draft() {
    const c = st.client(clientSel.value) || {};
    const out = { number: number.value.trim(), client_id: clientSel.value ? +clientSel.value : null,
      client: Object.fromEntries(["name", "address", "email", "phone"].map((k) => [k, c[k] || ""])),
      issue_date: issue.value || M.todayIso(),
      currency: currency.value, tax_rate: M.parseAmount(tax.value), tax_label: taxLabel.value.trim() || "Tax",
      account_id: accountSel.value || "", account: st.account(accountSel.value) || {}, notes: notes.value.trim(),
      items: current(), payments: inv && !est ? inv.payments : [], reference: reference.value.trim(),
      job_id: jobSel && jobSel.value ? +jobSel.value : (s.use_jobs ? null : inv ? inv.job_id ?? null : null) };
    if (inv && !est) out.from_estimate = inv.from_estimate ?? null;
    const end = terms.value === "0" ? "" : due.value;
    if (est) Object.assign(out, { kind: "estimate", valid_until: end, show_account: showAcc.checked,
      status: inv ? inv.status : "draft" });
    else out.due_date = end;
    return Object.assign(out, Store.totals(out));
  }
  function recalc() {
    const cur = currency.value;
    let costs = 0n, costed = 0n;
    for (const r of lines) {
      const amt = M.lineAmount(M.parseAmount(r.qty.value), M.parseAmount(r.price.value));
      r.amount.textContent = M.fmt(amt, cur);
      if (r.cost.value.trim()) {
        const c = M.lineAmount(M.parseAmount(r.qty.value), M.parseAmount(r.cost.value));
        costs += c; costed += amt;
        r.margin.textContent = `Cost ${M.fmt(c, cur)} · you make ${M.fmt(amt - c, cur)}`;
      } else r.margin.textContent = "";
    }
    const t = draft();
    const rows = [["Subtotal", t.subtotal]];
    if (t.tax !== 0n) rows.push([`${t.tax_label} (${M.fmtQty(t.tax_rate)}%)`, t.tax]);
    rows.push(["Total", t.total]);
    if (t.paid !== 0n) rows.push(["Paid", t.paid], ["Balance", t.balance]);
    totals.replaceChildren(...rows.map(([l, v], i) => h("div", { class: i === rows.length - 1 ? "t-row big" : "t-row" },
      h("span", {}, l), h("span", {}, M.fmt(v, cur)))),
    s.use_costs && costs ? h("div", { class: "t-row costs" }, h("span", {}, "Your costs (not printed)"),
      h("span", {}, `${M.fmt(costs, cur)} · margin ${M.fmt(costed - costs, cur)}`)) : null);
  }

  async function pickService() {
    const svs = st.services();
    if (!svs.length) {
      await infoBox("No services yet: add them on the Services page. You can still type a line yourself.");
      return;
    }
    const groups = {};
    for (const sv of svs) (groups[sv.category || "Other"] ||= []).push(sv);
    const names = Object.keys(groups).sort((a, b) => (a === "Other") - (b === "Other") || a.localeCompare(b));
    const items = [];
    for (const g of names) {
      if (names.length > 1) items.push({ label: g, sub: "", disabled: true, icon: "▸" });
      for (const sv of groups[g]) {
        items.push({ icon: "+", label: sv.name, value: sv.id,
          sub: M.fmt(sv.price, currency.value) + (sv.unit ? " per " + sv.unit.replace(/s$/, "") : "") });
      }
    }
    const sid = await actions("Add a Service", items);
    const sv = sid != null && st.service(sid);
    if (!sv) return;
    const last = lines[lines.length - 1];
    if (last && !last.desc.value.trim()) { lines.pop(); last.el.remove(); }
    addLine({ description: sv.description || sv.name, quantity: "1", unit: sv.unit, unit_price: sv.price });
    recalc();
  }

  const body = h("div", { class: "editor" },
    h("div", { class: "grid2" },
      field(`${Word} number`, number), field("Client", clientWrap),
      field(est ? "Date" : "Issue date", dated(issue)),
      field(est ? "Valid for" : "Due", h("div", { class: "with-btn top" }, terms, dated(due))),
      field("Currency", currency), field(est ? "Payment details" : "Pay into", h("div", {}, accWrap, accText, showAccRow)),
      field("Tax", h("div", { class: "with-btn" }, tax, h("span", {}, "%"), taxLabel)),
      field("Their reference (PO or tender no.)", reference),
      s.use_jobs ? field("Job", jobWrap) : null),
    h("h3", { class: "sec" }, "Lines"),
    linesBox,
    h("div", { class: "bar" },
      h("button", { type: "button", onclick: pickService }, "+ Add Service"),
      h("button", { type: "button", onclick: () => { addLine({ quantity: "1" }).desc.focus(); recalc(); } }, "+ Add Line"),
      h("span", { class: "grow" }), totals),
    field(`Note on the ${word}`, notes),
    datalist("units", UNITS), datalist("sections", SECTIONS));
  accountChanged(false);
  recalc();
  if (!inv && opts.client_id) clientChanged();

  async function check() {
    const t = draft();
    if (!t.number) { await infoBox(`The ${word} needs a number.`); return null; }
    if (!t.client_id) { await infoBox(`Please choose who the ${word} is for.`); return null; }
    if (!t.items.length) { await infoBox(`The ${word} has no lines yet.`); return null; }
    return t;
  }
  async function save() {
    const t = await check();
    if (!t) return null;
    if (inv) t.id = inv.id;
    try {
      return await (est ? st.saveEstimate(t, t.items) : st.saveInvoice(t, t.items));
    } catch (e) {
      await infoBox(e.message);
      return null;
    }
  }
  const v = await sheet(inv ? `${Word} ${inv.number}` : `New ${Word}`, body, [
    { label: "Cancel", value: null },
    { label: "Preview", run: async () => { const t = draft(); await preview(t); return false; } },
    { label: "Save", cls: "", run: async () => { const id = await save(); return id ? { id, pdf: false } : false; } },
    { label: "Save and Make PDF", cls: "primary", run: async () => { const id = await save(); return id ? { id, pdf: true } : false; } },
  ], { wide: true, tall: true, modal: true });
  if (!v) return;
  render();
  const saved = est ? st.estimate(v.id) : st.invoice(v.id);
  if (v.pdf) await savePdf(saved);
  else toast(`${Word} ${saved.number} saved.`);
}

// ------------------------------------------------------------------ Estimates (or Quotations)
function estimateTable(list, compact = false) {
  const today = M.todayIso();
  if (!list.length) return h("div", { class: "empty" }, st.data.estimates.length ? `No ${ew()}s here.` :
    `No ${ew()}s yet. ${EW() === "Quotation" ? "A quotation" : "An estimate"} tells a client what the work will cost; ` +
    "when they say yes, turn it into an invoice (all at once, or a deposit and stages).");
  const t = h("div", { class: "tbl est" + (compact ? " compact" : "") },
    h("div", { class: "tr th" }, h("span", { class: "c-num" }, "Number"), h("span", { class: "c-client" }, "Client"),
      h("span", { class: "c-date" }, "Date"), compact ? null : h("span", { class: "c-date c-due" }, "Valid until"),
      h("span", { class: "c-amt" }, "Total"), compact ? null : h("span", { class: "c-amt c-paid" }, "Invoiced"),
      h("span", { class: "c-st" }, "Status")));
  for (const e of list) {
    const done = st.invoicedFrom(e.id);
    t.append(h("button", { class: "tr", type: "button", onclick: () => estimateMenu(e.id) },
      h("span", { class: "c-num" }, h("b", {}, e.number)),
      h("span", { class: "c-client" }, (e.client || {}).name || "",
        e.reference ? h("span", { class: "tag" }, e.reference) : null),
      h("span", { class: "c-date" }, M.shortDate(e.issue_date)),
      compact ? null : h("span", { class: "c-date c-due" }, M.shortDate(e.valid_until) || "—"),
      h("span", { class: "c-amt strong" }, M.fmt(e.total, e.currency)),
      compact ? null : h("span", { class: "c-amt c-paid" }, done ? (done >= e.subtotal ? "All" : M.fmt(done, e.currency)) : ""),
      h("span", { class: "c-st" }, pill(Store.estimateStatus(e, today)))));
  }
  return t;
}

function pageEstimates(main) {
  main.append(h("div", { class: "bar" },
    h("button", { class: "primary", type: "button", onclick: () => newEstimate() }, `+  New ${EW()}`),
    select([[0, `All ${ew()}s`], [1, "Awaiting an answer"], [2, "Accepted"], [3, "Declined or expired"]], state.efilter,
      (e) => { state.efilter = +e.target.value; fill(); })));
  const holder = h("div");
  main.append(holder);
  function fill() {
    const today = M.todayIso();
    const list = st.estimates().filter((e) => {
      const s = Store.estimateStatus(e, today);
      if (state.efilter === 1) return s === "Draft" || s === "Sent";
      if (state.efilter === 2) return s === "Accepted";
      if (state.efilter === 3) return s === "Declined" || s === "Expired";
      return true;
    });
    holder.replaceChildren(estimateTable(list));
  }
  fill();
}

async function estimateMenu(eid) {
  const e = st.estimate(eid);
  if (!e) return;
  const status = Store.estimateStatus(e);
  const share = F.canShareFiles();
  const made = st.invoicesFrom(eid);
  const done = st.invoicedFrom(eid);
  const left = e.subtotal - done;
  const job = e.job_id ? st.job(e.job_id) : null;
  const v = await actions(`${e.number} · ${e.client.name || ""} · ${status}`, [
    { icon: "✎", label: "Change", value: "edit" },
    { icon: "⧉", label: "Duplicate", sub: `A new ${ew()} like this one, dated today`, value: "dup" },
    left > 0n || !made.length ? { icon: "✓", label: "Turn into Invoice", value: "inv",
      sub: made.length ? `${M.fmt(left, e.currency)} (before tax) still to invoice` :
        "The client said yes: invoice it all, or a deposit or stage" } : false,
    ...made.map((i) => ({ icon: "▤", label: `Open Invoice ${i.number}`, value: "open:" + i.id,
      sub: `${M.fmt(i.total, i.currency)} · ${Store.status(i)}` })),
    job ? { icon: "⚒", label: `Job: ${job.name}`, value: "job" } : false,
    null,
    { icon: "◳", label: "Preview", value: "preview" },
    { icon: "⤓", label: "Save PDF", sub: F.canPickFolder ? `Into your ${EW()}s folder` : "To Downloads", value: "pdf" },
    { icon: "✉", label: share ? "Send…" : "Send by Email", sub: share ? "Share the PDF: Gmail, WhatsApp…" :
      "Downloads the PDF and opens an email", value: "send" },
    null,
    ...Store.EST_STATUSES.map(([k, label]) => ({ icon: (e.status || "draft") === k ? "●" : "○", label: `Mark as ${label}`,
      value: "st:" + k, disabled: (e.status || "draft") === k })),
    null,
    { icon: "✕", label: `Delete ${EW()}…`, value: "delete", danger: true },
  ].filter((x) => x !== false));
  if (v === "edit") await editInvoice(e, "estimate");
  else if (v === "dup") {
    const id = await st.duplicateEstimate(eid);
    toast(`Made ${st.estimate(id).number}, dated today.`);
    render();
    await editInvoice(st.estimate(id), "estimate");
  } else if (v === "inv") await turnIntoInvoice(e);
  else if (v && v.startsWith("open:")) { go("Invoices"); await invoiceMenu(+v.slice(5)); }
  else if (v === "job") { go("Jobs"); await jobSheet(job.id); }
  else if (v === "preview") await preview(e);
  else if (v === "pdf") await savePdf(e);
  else if (v === "send") await sendInvoice(e);
  else if (v && v.startsWith("st:")) {
    await st.setEstimateStatus(eid, v.slice(3));
    render();
  } else if (v === "delete") {
    let msg = `Delete ${ew()} ${e.number} for ${e.client.name || ""}?`;
    if (made.length) msg += `\n\nThe invoice${made.length > 1 ? "s" : ""} made from it (${made.map((i) => i.number).join(", ")}) stay.`;
    msg += "\n\nAny PDF already saved stays where it is.";
    if (await confirmBox(msg, "Delete", "Keep it", true)) {
      await st.deleteEstimate(eid);
      toast(`${EW()} ${e.number} deleted.`);
      render();
    }
  }
}

// The whole quotation as one invoice, or a deposit / a stage / the rest.
async function turnIntoInvoice(e) {
  const cur = e.currency;
  const done = st.invoicedFrom(e.id);
  const left = e.subtotal - done;
  const first = done === 0n;
  const choice = (val, label, sub, on) => h("label", { class: "choice" },
    h("input", { type: "radio", name: "how", value: val, checked: on }), h("span", {}, h("b", {}, label),
      sub ? h("span", { class: "muted small-text block" }, sub) : null));
  const pct = h("input", { type: "text", inputmode: "decimal", class: "narrow", placeholder: "50" });
  const amt = h("input", { type: "text", inputmode: "decimal", class: "narrow", placeholder: "0.00" });
  const desc = h("input", { type: "text", placeholder: "e.g. Deposit, or Stage 2: frame erected" });
  const preview = h("p", { class: "muted" });
  const body = h("div", { class: "form" },
    h("p", {}, `${EW()} ${e.number}: ${M.fmt(e.subtotal, cur)} before tax` +
      (done ? `; ${M.fmt(done, cur)} invoiced so far, ${M.fmt(left, cur)} left.` : ".")),
    first ? choice("all", `The whole ${ew()}`, "All its lines and prices, on one invoice", true) : null,
    choice("part", first ? "A deposit or stage payment" : "A further stage payment",
      "A percentage of the total, or an amount", !first),
    h("div", { class: "indent with-btn" }, pct, h("span", {}, "%  or"), amt, h("span", {}, M.symbol(cur))),
    h("div", { class: "indent" }, field("What it's for (optional)", desc)),
    !first ? choice("rest", `The rest: ${M.fmt(left, cur)}`, "The final invoice for what's left", false) : null,
    preview,
    h("p", { class: "muted small-text" }, `The invoice gets the next number, today's date, your usual payment terms and ` +
      `the ${ew()}'s tax rate. ${e.number} is marked Accepted.`));
  const how = () => (body.querySelector("input[name=how]:checked") || {}).value;
  const partAmount = () => pct.value.trim() ? M.taxOf(e.subtotal, M.parseAmount(pct.value)) : M.cents(M.parseAmount(amt.value || "0"));
  const upd = () => {
    const m = how();
    const v = m === "all" ? e.subtotal : m === "rest" ? left : partAmount();
    preview.textContent = `This invoice: ${M.fmt(v, cur)} before tax` + (M.units(e.tax_rate || "0") ? `, ${M.fmt(v + M.taxOf(v, e.tax_rate), cur)} with ${e.tax_label}` : "") + ".";
  };
  pct.addEventListener("input", () => { if (pct.value.trim()) amt.value = ""; body.querySelector("input[value=part]").checked = true; upd(); });
  amt.addEventListener("input", () => { if (amt.value.trim()) pct.value = ""; body.querySelector("input[value=part]").checked = true; upd(); });
  body.addEventListener("change", upd);
  upd();
  const ok = await sheet(`Turn ${e.number} into an Invoice`, body, [{ label: "Cancel", value: false },
    { label: "Make the Invoice", cls: "primary", run: async () => {
      if (how() === "part") {
        const v = partAmount();
        if (v <= 0n) { await infoBox("Give a percentage or an amount for this payment."); return false; }
        if (v > left) { await infoBox(`That's more than the ${M.fmt(left, cur)} left to invoice.`); return false; }
      }
      return true;
    } }]);
  if (!ok) return;
  const mode = how();
  const iid = await st.estimateToInvoice(e.id, { mode, percent: pct.value.trim() ? M.parseAmount(pct.value) : null,
    amount: amt.value.trim() ? M.parseAmount(amt.value) : null, description: desc.value.trim() || null });
  const inv = st.invoice(iid);
  go("Invoices");
  toast(`${e.number} accepted: invoice ${inv.number} made from it. Check it, then save the PDF.`, 9000);
  await editInvoice(inv);
}

// ------------------------------------------------------------------ Jobs
function figs(o) {
  const ks = Object.keys(o).filter((k) => o[k] !== 0n);
  if (!ks.length) return "—";
  return ks.sort().map((c) => M.fmt(o[c], c)).join(" + ");
}
const minus = (a, b) => {
  const out = { ...a };
  for (const [c, v] of Object.entries(b)) out[c] = (out[c] || 0n) - v;
  return out;
};

function pageJobs(main) {
  state.jfilter ??= 1;
  main.append(h("div", { class: "bar" },
    h("button", { class: "primary", type: "button", onclick: async () => { const id = await editJob(null); if (id) { render(); jobSheet(id); } } },
      "+  New Job"),
    select([[1, "Open jobs"], [2, "Finished jobs"], [0, "All jobs"]], state.jfilter, (e) => { state.jfilter = +e.target.value; fill(); })));
  const holder = h("div");
  main.append(holder);
  main.append(h("p", { class: "muted small-text" }, "Figures are before tax. Made so far = received − spent. " +
    "Purchases are recorded on the job, or on the Purchases page."));
  function fill() {
    const list = st.jobs().filter((j) => state.jfilter === 0 || (state.jfilter === 1) === (j.status !== "done"));
    if (!list.length) {
      holder.replaceChildren(h("div", { class: "empty" }, st.data.jobs.length ? "No jobs here." :
        `No jobs yet. A job gathers one piece of work: its ${ew()}, the invoices (deposit, stages, final) ` +
        "and what you spend on materials, so you can see what it made."));
      return;
    }
    const t = h("div", { class: "tbl jobs" },
      h("div", { class: "tr th" }, h("span", { class: "c-client" }, "Job"), h("span", { class: "c-amt" }, "Quoted"),
        h("span", { class: "c-amt c-due" }, "Invoiced"), h("span", { class: "c-amt c-paid" }, "Received"),
        h("span", { class: "c-amt" }, "Spent"), h("span", { class: "c-amt" }, "Made so far")));
    for (const j of list) {
      const f = st.jobFigures(j.id);
      const made = minus(f.received, f.spent);
      const neg = Object.values(made).some((v) => v < 0n);
      const c = j.client_id ? st.client(j.client_id) : null;
      t.append(h("button", { class: "tr" + (j.status === "done" ? " dim" : ""), type: "button", onclick: () => jobSheet(j.id) },
        h("span", { class: "c-client" }, h("b", {}, j.name), c ? h("span", { class: "muted" }, "  " + c.name) : null),
        h("span", { class: "c-amt" }, figs(f.quoted)), h("span", { class: "c-amt c-due" }, figs(f.invoiced)),
        h("span", { class: "c-amt c-paid" }, figs(f.received)), h("span", { class: "c-amt" }, figs(f.spent)),
        h("span", { class: "c-amt strong" + (neg ? " neg" : "") }, figs(made))));
    }
    holder.replaceChildren(t);
  }
  fill();
}

async function editJob(j, preset = {}) {
  const name = h("input", { type: "text", value: j ? j.name : preset.name || "",
    placeholder: "e.g. Railings, Grenville police station" });
  const client = select([["", "— no client yet —"], ...st.clients().map((c) => [c.id, c.name])],
    j ? j.client_id ?? "" : preset.client_id ?? "");
  const notes = h("textarea", { rows: 3 });
  notes.value = j ? j.notes : "";
  const body = h("div", { class: "form" }, field("Job", name), field("Client", client), field("Notes", notes));
  const ok = await sheet(j ? "Change Job" : "New Job", body, [{ label: "Cancel", value: null },
    { label: "Save", cls: "primary", run: () => { if (!name.value.trim()) { name.focus(); return false; } return true; } }]);
  if (!ok) return null;
  return st.saveJob({ id: j ? j.id : null, name: name.value, client_id: client.value || null, notes: notes.value,
    status: j ? j.status : "open" });
}

async function jobSheet(jid) {
  const j = st.job(jid);
  if (!j) return;
  const f = st.jobFigures(jid);
  const c = j.client_id ? st.client(j.client_id) : null;
  const ests = st.estimates().filter((e) => e.job_id === j.id);
  const invs = st.invoices().filter((i) => i.job_id === j.id);
  const buys = st.purchases(j.id);
  const row = (label, val, cls = "") => h("div", { class: "t-row " + cls }, h("span", {}, label), h("span", {}, val));
  const made = minus(f.received, f.spent);
  const body = h("div", { class: "form job" },
    c ? h("p", { class: "muted" }, c.name) : null,
    j.notes ? h("p", {}, j.notes) : null,
    h("div", { class: "job-figs" },
      row(`Quoted (before tax)`, figs(f.quoted)),
      Object.values(f.estCost).some((v) => v) ? row("Your costs on the " + ew(), figs(f.estCost), "muted") : null,
      row("Invoiced", figs(f.invoiced)), row("Received", figs(f.received)), row("Still owed (with tax)", figs(f.owed)),
      row("Spent on purchases", figs(f.spent)),
      row("Made so far (received − spent)", figs(made), "big"),
      Object.keys(f.quoted).length ? row(`If all quoted is paid`, figs(minus(f.quoted, f.spent)), "muted") : null),
    h("h4", {}, `${EW()}s`),
    ests.length ? ests.map((e) => h("button", { class: "row-item btn", type: "button", onclick: () => { done("est:" + e.id); } },
      h("b", {}, e.number), h("span", { class: "grow" }, " " + M.fmt(e.total, e.currency)), pill(Store.estimateStatus(e)))) :
      h("p", { class: "muted" }, "None yet."),
    h("h4", {}, "Invoices"),
    invs.length ? invs.map((i) => h("button", { class: "row-item btn", type: "button", onclick: () => { done("inv:" + i.id); } },
      h("b", {}, i.number), h("span", { class: "grow" }, " " + M.fmt(i.total, i.currency)), pill(Store.status(i)))) :
      h("p", { class: "muted" }, "None yet."),
    h("h4", {}, "Purchases"),
    buys.length ? buys.map((p) => h("button", { class: "row-item btn", type: "button", onclick: () => { done("buy:" + p.id); } },
      h("span", { class: "grow" }, h("b", {}, p.description || p.category || "Purchase"),
        h("span", { class: "muted" }, `  ${M.shortDate(p.date)}${p.supplier ? " · " + p.supplier : ""}`)),
      h("span", {}, M.fmt(p.amount, p.currency)))) :
      h("p", { class: "muted" }, "None yet."));
  let done;
  const p = sheet(j.name, body, [
    { label: "Close", value: null },
    { label: "Change…", value: "edit" },
    { label: j.status === "done" ? "Reopen" : "Finished", value: "status" },
    { label: `+ ${EW()}`, value: "newest" },
    { label: "+ Purchase", cls: "primary", value: "buy" },
  ], { wide: true });
  done = (v) => { jobSheet.next = v; body.closest(".sheet-wrap").querySelector(".x").click(); };
  let v = await p;
  if (jobSheet.next) { v = jobSheet.next; jobSheet.next = null; }
  if (!v) return;
  if (v === "edit") { await editJob(j); render(); return jobSheet(jid); }
  if (v === "status") {
    await st.saveJob({ ...j, status: j.status === "done" ? "open" : "done" });
    toast(j.status === "done" ? "Job reopened." : "Job marked finished.");
    render();
    return;
  }
  if (v === "newest") { await editInvoice(null, "estimate", { job_id: j.id, client_id: j.client_id }); return jobSheet(jid); }
  if (v === "buy") { await editPurchase(null, { job_id: j.id }); render(); return jobSheet(jid); }
  if (v.startsWith("est:")) { await estimateMenu(+v.slice(4)); return; }
  if (v.startsWith("inv:")) { await invoiceMenu(+v.slice(4)); return; }
  if (v.startsWith("buy:")) { await editPurchase(st.purchases().find((x) => x.id === +v.slice(4))); render(); return jobSheet(jid); }
}

// ------------------------------------------------------------------ Purchases
function pagePurchases(main) {
  const years = st.years();
  if (state.pyear == null || !years.includes(state.pyear)) state.pyear = M.taxYearOf(M.todayIso());
  main.append(h("div", { class: "bar" },
    h("button", { class: "primary", type: "button", onclick: async () => { if (await editPurchase(null)) render(); } },
      "+  Record Purchase"),
    h("label", { class: "inline" }, M.calendarYears() ? "Year: " : "Tax year: ",
      select(years.map((y) => [y, M.taxYearLabel(y)]), state.pyear, (e) => { state.pyear = +e.target.value; render(); }))));
  const [a, b] = M.taxYearSpan(state.pyear);
  const list = st.purchases().filter((p) => p.date >= a && p.date <= b);
  const sum = st.purchaseSummary(state.pyear);
  main.append(h("div", { class: "summary block" }, Object.keys(sum).length ? Object.entries(sum).map(([cur, o]) =>
    h("p", {}, h("b", {}, `Spent ${M.fmt(o.total, cur)}`), "  —  ",
      Object.entries(o.byCategory).sort((x, y) => (y[1] > x[1]) - (y[1] < x[1])).map(([k, v]) => `${k} ${M.fmt(v, cur)}`).join(" · "))) :
    h("p", {}, "Nothing recorded in this year yet.")));
  if (!list.length) return;
  const t = h("div", { class: "tbl buys" },
    h("div", { class: "tr th" }, h("span", { class: "c-date" }, "Date"), h("span", { class: "c-client" }, "What"),
      h("span", { class: "c-hide" }, "Job"), h("span", { class: "c-amt" }, "Amount")));
  for (const p of list) {
    const j = p.job_id ? st.job(p.job_id) : null;
    t.append(h("button", { class: "tr", type: "button", onclick: async () => { if (await editPurchase(p)) render(); } },
      h("span", { class: "c-date" }, M.shortDate(p.date)),
      h("span", { class: "c-client" }, h("b", {}, p.description || p.category || "Purchase"),
        h("span", { class: "muted" }, [p.supplier, p.category].filter(Boolean).map((x) => "  " + x).join(" ·"))),
      h("span", { class: "c-hide" }, j ? j.name : "—"),
      h("span", { class: "c-amt strong" }, M.fmt(p.amount, p.currency))));
  }
  main.append(t);
}

async function editPurchase(p, preset = {}) {
  const date = h("input", { type: "date", value: p ? p.date : M.todayIso() });
  const what = h("input", { type: "text", value: p ? p.description : "", placeholder: "e.g. 20 lengths 2\" box steel" });
  const supplier = h("input", { type: "text", list: "suppliers", value: p ? p.supplier : "" });
  const kind = h("input", { type: "text", list: "kinds", value: p ? p.category : "Materials" });
  const amount = h("input", { type: "text", inputmode: "decimal", value: p ? M.centsToText(M.cents(p.amount)) : "" });
  const currency = select(currencyOptions(), p ? p.currency : st.settings.defaults.currency || "GBP");
  const jobs = st.jobs().filter((j) => j.status !== "done" || (p && p.job_id === j.id) || preset.job_id === j.id);
  const job = select([["", "(not for a particular job)"], ...jobs.map((j) => [j.id, j.name])], p ? p.job_id ?? "" : preset.job_id ?? "");
  const note = h("input", { type: "text", value: p ? p.note : "", placeholder: "e.g. receipt no." });
  const suppliers = [...new Set(st.data.purchases.map((x) => x.supplier).filter(Boolean))];
  const body = h("div", { class: "form" },
    h("div", { class: "grid2" }, field("Date", dated(date)), field("Amount paid", h("div", { class: "with-btn" }, amount, currency))),
    field("What", what), h("div", { class: "grid2" }, field("Supplier", supplier), field("Kind", kind)),
    field("Job", job), field("Note", note), datalist("suppliers", suppliers), datalist("kinds", PURCHASE_KINDS));
  const buttons = [{ label: "Cancel", value: null }];
  if (p) buttons.push({ label: "Delete", cls: "danger", value: "delete" });
  buttons.push({ label: "Save", cls: "primary", run: () => {
    if (M.cents(M.parseAmount(amount.value)) <= 0n) { amount.focus(); return false; }
    return "save";
  } });
  const v = await sheet(p ? "Purchase" : "Record a Purchase", body, buttons);
  if (v === "delete") {
    if (await confirmBox(`Delete this purchase of ${M.fmt(p.amount, p.currency)}?`, "Delete", "Keep it", true)) {
      await st.deletePurchase(p.id);
      return true;
    }
    return false;
  }
  if (v !== "save") return false;
  await st.savePurchase({ id: p ? p.id : null, date: date.value, description: what.value, supplier: supplier.value,
    category: kind.value, amount: M.parseAmount(amount.value), currency: currency.value, job_id: job.value || null,
    note: note.value });
  toast("Purchase recorded.");
  return true;
}

// ------------------------------------------------------------------ Clients
function pageClients(main) {
  main.append(h("div", { class: "bar" },
    h("button", { class: "primary", type: "button", onclick: async () => { if (await editClient(null)) render(); } },
      "+  New Client")));
  const list = st.clients();
  if (!list.length) { main.append(h("div", { class: "empty" }, "No clients yet.")); return; }
  const t = h("div", { class: "tbl" },
    h("div", { class: "tr th" }, h("span", { class: "grow" }, "Name"), h("span", { class: "c-hide" }, "Email"),
      h("span", { class: "c-small" }, "Invoices")));
  for (const c of list) {
    t.append(h("button", { class: "tr", type: "button", onclick: () => clientMenu(c) },
      h("span", { class: "grow" }, h("b", {}, c.name), c.address ? h("div", { class: "muted" }, c.address.split("\n")[0]) : null),
      h("span", { class: "c-hide" }, c.email), h("span", { class: "c-small" }, String(st.clientInvoiceCount(c.id)))));
  }
  main.append(t);
}

async function clientMenu(c) {
  const n = st.clientInvoiceCount(c.id);
  const v = await actions(c.name, [
    { icon: "✎", label: "Change", value: "edit" },
    { icon: "+", label: "New Invoice for this client", value: "inv" },
    null,
    { icon: "✕", label: "Delete Client…", value: "del", danger: true, disabled: n > 0,
      sub: n ? `Has ${n} invoice(s), so it stays` : "" },
  ]);
  if (v === "edit") { if (await editClient(c)) render(); }
  else if (v === "inv") {
    await editInvoice(null);
  } else if (v === "del" && (await confirmBox(`Delete ${c.name}?`, "Delete", "Keep", true))) {
    await st.deleteClient(c.id);
    render();
  }
}

async function editClient(c) {
  c = { ...(c || {}) };
  const name = h("input", { type: "text", value: c.name || "" });
  const address = h("textarea", { rows: 3 });
  address.value = c.address || "";
  const email = h("input", { type: "email", value: c.email || "" });
  const phone = h("input", { type: "tel", value: c.phone || "" });
  const currency = select(currencyOptions("Your usual currency"), c.currency || "");
  const account = select(accountOptions(c.account, "Your usual account"), c.account || "");
  const notes = h("textarea", { rows: 2, placeholder: "For you only; not printed" });
  notes.value = c.notes || "";
  const body = h("div", { class: "form" }, field("Name", name), field("Address", address), field("Email", email),
    field("Phone", phone), field("Currency", currency), field("Usually pay into", account), field("Notes", notes));
  const ok = await sheet(c.id ? "Client" : "New Client", body, [{ label: "Cancel", value: false },
    { label: "Save", cls: "primary", run: async () => {
      if (!name.value.trim()) { await infoBox("Please give the client a name."); return false; }
      return true;
    } }]);
  if (!ok) return null;
  Object.assign(c, { name: name.value.trim(), address: address.value.trim(), email: email.value.trim(),
    phone: phone.value.trim(), currency: currency.value, account: account.value, notes: notes.value.trim() });
  c.id = await st.saveClient(c);
  return c;
}

// ------------------------------------------------------------------ Services
function pageServices(main) {
  main.append(h("div", { class: "bar" },
    h("button", { class: "primary", type: "button", onclick: async () => { if (await editService(null)) render(); } },
      "+  New Service")));
  const list = st.services();
  if (!list.length) { main.append(h("div", { class: "empty" }, "No services yet.")); return; }
  let group = null;
  const t = h("div", { class: "tbl" });
  for (const sv of list) {
    if (sv.category !== group) {
      group = sv.category;
      t.append(h("div", { class: "tr group" }, group || "Other"));
    }
    t.append(h("button", { class: "tr", type: "button", onclick: () => serviceMenu(sv) },
      h("span", { class: "grow" }, h("b", {}, sv.name), h("div", { class: "muted" }, sv.description)),
      h("span", { class: "c-amt" }, M.fmt(sv.price, st.settings.defaults.currency) + (sv.unit ? " / " + sv.unit.replace(/s$/, "") : ""))));
  }
  main.append(t);
}

async function serviceMenu(sv) {
  const v = await actions(sv.name, [{ icon: "✎", label: "Change", value: "edit" }, null,
    { icon: "✕", label: "Delete Service…", value: "del", danger: true,
      sub: "Invoices that used it keep their lines" }]);
  if (v === "edit") { if (await editService(sv)) render(); }
  else if (v === "del" && (await confirmBox(`Delete the service ${sv.name}?`, "Delete", "Keep", true))) {
    await st.deleteService(sv.id);
    render();
  }
}

async function editService(sv) {
  sv = { ...(sv || {}) };
  const cats = [...new Set([...st.categories(), ...GROUPS])].sort();
  const category = h("input", { type: "text", list: "cats", value: sv.category || "" });
  const name = h("input", { type: "text", value: sv.name || "", placeholder: "Short name, for your lists" });
  const desc = h("textarea", { rows: 3, placeholder: "What appears on the invoice (it can be changed on each invoice)" });
  desc.value = sv.description || "";
  const unit = h("input", { type: "text", list: "units2", value: sv.unit || "" });
  const price = h("input", { type: "text", inputmode: "decimal", placeholder: "0.00",
    value: sv.price ? M.centsToText(M.cents(sv.price)) : "" });
  const body = h("div", { class: "form" }, field("Group", category), field("Name", name), field("Description", desc),
    field("Charged per", unit), field("Price", price), datalist("cats", cats), datalist("units2", UNITS));
  const ok = await sheet(sv.id ? "Service" : "New Service", body, [{ label: "Cancel", value: false },
    { label: "Save", cls: "primary", run: async () => {
      if (!name.value.trim()) { await infoBox("Please give the service a name."); return false; }
      return true;
    } }]);
  if (!ok) return null;
  Object.assign(sv, { category: category.value.trim(), name: name.value.trim(),
    description: desc.value.trim() || name.value.trim(), unit: unit.value.trim(), price: M.parseAmount(price.value) });
  sv.id = await st.saveService(sv);
  return sv;
}

// ------------------------------------------------------------------ Payment Accounts
function accountSample(a) {
  const out = h("div", { class: "acc-sample" });
  for (const [kind, val] of P.accountLines(a)) {
    if (kind === "heading") out.append(h("div", { class: "a-head" }, val.toUpperCase()));
    else if (kind === "title") out.append(h("div", {}, h("b", {}, val)));
    else if (kind === "gap") out.append(h("div", { class: "a-gap" }));
    else if (kind === "colon") out.append(h("div", {}, h("b", {}, val[0].toUpperCase().replace(/:+$/, "") + ":"), " ", val[1]));
    else if (kind === "dash") out.append(h("div", {}, `${val[0]} – ${val[1]}`));
    else out.append(h("div", {}, val));
  }
  if (st.settings.thanks) out.append(h("div", { class: "a-gap" }), h("div", {}, h("b", {}, st.settings.thanks)));
  return out;
}

function pageAccounts(main) {
  main.append(h("div", { class: "bar" },
    h("button", { class: "primary", type: "button", onclick: async () => { if (await editAccount(null)) render(); } },
      "+  New Account"),
    h("button", { type: "button", onclick: importAccounts }, "Import…"),
    h("button", { type: "button", onclick: () => F.saveJson({ accounts: st.settings.accounts }, "payment-accounts.json") },
      "Export…")));
  const list = st.accounts(true);
  if (!list.length) { main.append(h("div", { class: "empty" }, "No payment accounts yet.")); return; }
  const t = h("div", { class: "tbl" });
  for (const a of list) {
    const [n] = st.accountInUse(a.id);
    const tags = [];
    if (a.id === st.settings.defaults.account) tags.push(h("span", { class: "tag on" }, "Usual"));
    if (a.retired) tags.push(h("span", { class: "tag" }, "Retired"));
    t.append(h("button", { class: "tr acc" + (a.retired ? " dim" : ""), type: "button", onclick: () => accountMenu(a) },
      h("span", { class: "grow" }, h("b", {}, a.name), " ", tags,
        h("div", { class: "muted" }, (a.lines || []).map((l) => l[1]).filter(Boolean).slice(0, 3).join(" · "))),
      h("span", { class: "c-small" }, a.currency || "any"), h("span", { class: "c-small" }, n ? `${n} inv.` : "")));
  }
  main.append(t);
}

async function accountMenu(a) {
  const [n, m] = st.accountInUse(a.id);
  const v = await actions(a.name, [
    { icon: "✎", label: "Change", value: "edit" },
    { icon: "⧉", label: "Duplicate", value: "dup" },
    { icon: "★", label: "Use for New Invoices", value: "default", disabled: a.id === st.settings.defaults.account || a.retired },
    { icon: a.retired ? "↺" : "⏸", label: a.retired ? "Bring Back" : "Retire",
      sub: a.retired ? "" : "Kept on old invoices, gone from the lists", value: "retire" },
    null,
    { icon: "✕", label: "Delete…", value: "del", danger: true, disabled: n > 0,
      sub: n ? `Used on ${n} invoice(s): retire it instead` : (m ? `${m} client(s) will go back to your usual account` : "") },
  ]);
  if (v === "edit") { if (await editAccount(a)) render(); }
  else if (v === "dup") { await st.duplicateAccount(a.id); render(); }
  else if (v === "default") { st.settings.defaults.account = a.id; await st.save(); render(); }
  else if (v === "retire") {
    a.retired = !a.retired;
    if (a.retired && st.settings.defaults.account === a.id) {
      const live = st.accounts(false).filter((x) => x.id !== a.id);
      st.settings.defaults.account = live.length ? live[0].id : "";
    }
    await st.saveAccount(a);
    render();
  } else if (v === "del" && (await confirmBox(`Delete the account ${a.name}?`, "Delete", "Keep", true))) {
    await st.deleteAccount(a.id);
    render();
  }
}

async function editAccount(acc) {
  const isNew = !acc;
  const a = JSON.parse(JSON.stringify(acc || blankAccount()));
  const name = h("input", { type: "text", value: a.name, placeholder: "For the lists, e.g. Santander UK" });
  const currency = select(currencyOptions("Any currency"), a.currency || "");
  const colon = h("input", { type: "radio", name: "astyle", checked: a.style === "colon" });
  const dash = h("input", { type: "radio", name: "astyle", checked: a.style !== "colon" });
  const heading = h("input", { type: "text", value: a.heading || "", placeholder: "e.g. PAYMENT INFO (optional)" });
  const title = h("input", { type: "text", value: a.title || "", placeholder: "e.g. Grenada Co-operative Bank Ltd. (optional)" });
  const rows = h("div", { class: "acc-lines" });
  const sampleBox = h("div");
  const collect = () => ({ ...a, name: name.value.trim(), currency: currency.value, style: colon.checked ? "colon" : "dash",
    heading: heading.value.trim(), title: title.value.trim(),
    lines: [...rows.children].map((r) => [r.querySelector(".lab").value.trim(), r.querySelector(".val").value.trim()])
      .filter(([l, v]) => l || v) });
  const refresh = () => sampleBox.replaceChildren(accountSample(collect()));
  const addRow = (lab = "", val = "") => {
    const r = h("div", { class: "acc-line" },
      h("input", { type: "text", class: "lab", value: lab, placeholder: "Label", oninput: refresh }),
      h("input", { type: "text", class: "val", value: val, placeholder: "Value", oninput: refresh }),
      h("button", { type: "button", class: "icon", onclick: () => { if (r.previousElementSibling) r.previousElementSibling.before(r); refresh(); } }, "↑"),
      h("button", { type: "button", class: "icon", onclick: () => { if (r.nextElementSibling) r.nextElementSibling.after(r); refresh(); } }, "↓"),
      h("button", { type: "button", class: "icon danger", onclick: () => { r.remove(); refresh(); } }, "✕"));
    rows.append(r);
    return r;
  };
  (a.lines || []).forEach(([l, v]) => addRow(l, v));
  for (const x of [name, heading, title]) x.addEventListener("input", refresh);
  colon.onchange = dash.onchange = refresh;
  const body = h("div", { class: "acc-edit" },
    h("div", { class: "form" },
      field("Name", name), field("Currency", currency),
      h("div", { class: "field" }, h("span", { class: "flabel" }, "Style"),
        h("label", { class: "radio" }, colon, " LABEL: value, with a heading (as for the Grenada Co-op)"),
        h("label", { class: "radio" }, dash, " Label – value (as for Santander)")),
      field("Heading", heading), field("Title", title),
      h("div", { class: "flabel" }, "Details printed on the invoice (leave the label empty for a plain line):"),
      rows,
      h("button", { type: "button", onclick: () => { addRow().querySelector(".lab").focus(); } }, "+ Add Line")),
    h("div", { class: "acc-right" }, h("div", { class: "flabel" }, "How it will look:"), sampleBox));
  refresh();
  const ok = await sheet(isNew ? "New Payment Account" : `Payment Account — ${a.name}`, body,
    [{ label: "Cancel", value: false }, { label: "Save", cls: "primary", run: async () => {
      if (!name.value.trim()) { await infoBox("Please give the account a name for the lists."); return false; }
      return true;
    } }], { wide: true, modal: true });
  if (!ok) return null;
  const out = collect();
  return isNew ? st.addAccount(out) : st.saveAccount(out);
}

async function importAccounts() {
  const f = await F.pickFile();
  if (!f) return;
  try {
    const d = await F.readJson(f);
    const items = Array.isArray(d) ? d : d.accounts || (d.settings && d.settings.accounts) || [];
    const added = await st.importAccounts(items);
    toast(added.length ? `Added ${added.length} account(s): ${added.map((a) => a.name).join(", ")}` :
      "Nothing new: those accounts are here already.", 7000);
    render();
  } catch (e) {
    await infoBox("That file couldn't be read as payment accounts.");
  }
}

// ------------------------------------------------------------------ Settings
async function pageSettings(main) {
  const s = st.settings, b = s.business, nb = s.numbering, d = s.defaults;
  const inp = (v, type = "text", extra = {}) => h("input", { type, value: v ?? "", ...extra });
  const name = inp(b.name), email = inp(b.email, "email"), phone = inp(b.phone, "tel"), web = inp(b.website, "url");
  const address = h("textarea", { rows: 3 });
  address.value = b.address || "";
  const prefix = inp(nb.prefix), next = inp(nb.next, "number", { min: 1 }), digits = inp(nb.digits, "number", { min: 1, max: 8 });
  const sample = h("span", { class: "muted" });
  const showSample = () => {
    sample.textContent = "Next: " + (prefix.value || "") + String(Math.max(1, +next.value || 1))
      .padStart(Math.max(1, +digits.value || 1), "0");
  };
  [prefix, next, digits].forEach((x) => x.addEventListener("input", showSample));
  showSample();
  const currency = select(currencyOptions(), d.currency || "GBP");
  const terms = inp(d.terms_days, "number", { min: 0, max: 365 });
  const tax = inp(M.fmtQty(d.tax_rate || "0"), "text", { inputmode: "decimal" });
  const taxLabel = inp(d.tax_label || "VAT");
  const thanks = inp(s.thanks || "");
  const note = inp(s.note || "");
  const style = select(P.STYLES, s.style || "classic");
  const en = st.nb("estimate");
  const eprefix = inp(en.prefix), enext = inp(st.nextNumber("estimate").slice((en.prefix || "").length).replace(/^0+/, "") || 1,
    "number", { min: 1 });
  const valid = inp(d.valid_days ?? 30, "number", { min: 0, max: 365 });
  const esample = h("span", { class: "muted" });
  const showESample = () => {
    esample.textContent = "Next: " + (eprefix.value || "") + String(Math.max(1, +enext.value || 1))
      .padStart(Math.max(1, +digits.value || 1), "0");
  };
  [eprefix, enext, digits].forEach((x) => x.addEventListener("input", showESample));
  showESample();
  const heading = inp(s.heading || "", "text", { placeholder: b.name || EDITION.name });
  const taxNo = inp(b.tax_number || "");
  const word = select([["Estimate", "Estimates"], ["Quotation", "Quotations"]], s.estimate_word || "Estimate");
  const chk = (on) => h("input", { type: "checkbox", checked: !!on });
  const useSections = chk(s.use_sections), useCosts = chk(s.use_costs), useJobs = chk(s.use_jobs);
  const markup = inp(M.fmtQty(s.markup || "0"), "text", { inputmode: "decimal", class: "narrow" });
  const yearStart = select([["04-06", "6 April (UK)"], ["01-01", "1 January (calendar year, as in Grenada)"]],
    s.year_start || "04-06");
  // the logo: made smaller here, kept with the settings
  const logoBox = h("div", { class: "logo-box" });
  const showLogo = () => {
    logoBox.replaceChildren(
      b.logo ? h("img", { src: b.logo, alt: "Your logo", class: "logo-prev" }) : h("p", { class: "muted" }, "No logo."),
      h("div", { class: "bar" },
        h("button", { type: "button", onclick: async () => {
          const f = await F.pickFile("image/png,image/jpeg,image/webp");
          if (!f) return;
          try {
            Object.assign(b, await shrinkLogo(f));
            await st.save();
            toast("Logo added. It prints at the top of invoices and " + ew() + "s.");
          } catch (e) { await infoBox("That picture couldn't be used: " + (e.message || e)); }
          showLogo();
        } }, b.logo ? "Change Logo…" : "Add Logo…"),
        b.logo ? h("button", { type: "button", onclick: async () => {
          Object.assign(b, { logo: "", logo_w: 0, logo_h: 0 });
          await st.save();
          showLogo();
        } }, "Remove") : null));
  };
  showLogo();

  const saveBtn = h("button", { class: "primary", type: "button", onclick: async () => {
    Object.assign(b, { name: name.value.trim(), address: address.value.trim(), email: email.value.trim(),
      phone: phone.value.trim(), website: web.value.trim() });
    Object.assign(nb, { prefix: prefix.value, next: Math.max(1, +next.value || 1), digits: Math.min(8, Math.max(1, +digits.value || 4)) });
    Object.assign(en, { prefix: eprefix.value, next: Math.max(1, +enext.value || 1), digits: nb.digits });
    Object.assign(d, { currency: currency.value, terms_days: Math.max(0, +terms.value || 0),
      valid_days: Math.max(0, +valid.value || 0), tax_rate: M.parseAmount(tax.value),
      tax_label: taxLabel.value.trim() || "VAT" });
    s.thanks = thanks.value.trim();
    s.note = note.value.trim();
    s.style = style.value;
    b.tax_number = taxNo.value.trim();
    s.heading = heading.value.trim();
    s.estimate_word = word.value;
    Object.assign(s, { use_sections: useSections.checked, use_costs: useCosts.checked, use_jobs: useJobs.checked,
      markup: M.parseAmount(markup.value || "0"), year_start: yearStart.value });
    await st.save();
    toast("Settings saved.");
    render();
  } }, "Save Settings");

  const box = (title, ...kids) => h("section", { class: "box" }, h("h3", {}, title), ...kids);
  const pdfInfo = h("div");
  const dataInfo = h("div");
  main.append(h("div", { class: "settings" },
    h("div", { class: "col" },
      box("You (top of every invoice)", field("Name", name), field("Address", address), field("Email", email),
        field("Phone", phone), field("Website", web), field(`${d.tax_label || "VAT"} registration number (if you have one)`, taxNo),
        field("Logo", logoBox)),
      box("Where PDFs go", pdfInfo),
      box("Your data", dataInfo)),
    h("div", { class: "col" },
      box("New invoices", field("Number starts with", prefix), h("div", { class: "grid2" }, field("Next number", next),
        field("Digits", digits)), sample, field("Currency", currency),
      field("Payment due in (days; 0 = on receipt)", terms), h("div", { class: "grid2" }, field("Tax rate (%)", tax),
        field("Tax called", taxLabel)), field("Under the bank details", thanks), field("Note at the foot", note),
      field("Invoice style", style)),
      box(`New ${ew()}s`, field("Call them", word), field("Number starts with", eprefix), field("Next number", enext), esample,
        field("Valid for (days; 0 = no end date)", valid),
        h("p", { class: "muted" }, `${EW()}s use the same style, currency and tax as invoices. ` +
          `Payment details are printed only if you tick the box on the ${ew()}.`)),
      box("Ways of working",
        h("label", { class: "check" }, useSections, " Sections on lines (Materials, Labour…), with a subtotal for each"),
        h("label", { class: "check" }, useCosts, " Your cost on lines, with a markup (never printed)"),
        h("div", { class: "indent" }, field("Usual markup on costs (%)", markup)),
        h("label", { class: "check" }, useJobs, " Jobs and purchases (what each job made)"),
        field("The tax year starts on", yearStart),
        field("Name at the top of the app", heading)),
      h("div", { class: "bar" }, h("span", { class: "grow" }), saveBtn),
      box("About", h("p", {}, `${EDITION.name} for the web, version ${VERSION}.`),
        h("p", { class: "muted" }, "Works without a connection once installed. Nothing you enter leaves this device unless you export, save or share it.")))));

  // PDFs
  const folder = await F.folderHandle(st);
  if (F.canPickFolder) {
    pdfInfo.append(h("p", {}, folder ? ["PDFs are saved in ", h("b", {}, folder.name), ", in a folder for each year."] :
      "No folder chosen yet: PDFs go to your Downloads. Choose a folder to keep them together, a folder for each year inside it."),
    h("div", { class: "bar" }, h("button", { type: "button", onclick: async () => {
      try { await F.chooseFolder(st); toast("PDFs will be saved there."); render(); } catch (e) { /* cancelled */ }
    } }, folder ? "Choose Another Folder…" : "Choose Folder…"),
    folder ? h("button", { type: "button", onclick: async () => { await F.forgetFolder(st); render(); } }, "Use Downloads Instead") : null));
  } else {
    pdfInfo.append(h("p", {}, "This browser can't save into a folder of your choosing, so PDFs go to your Downloads, " +
      "or use Send… to share one straight into an email."));
  }

  // data
  const persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false;
  const counts = `${st.data.clients.length} clients, ${st.data.services.length} services, ${st.settings.accounts.length} accounts, ${st.data.invoices.length} invoices, ${st.data.estimates.length} ${ew()}s` +
    (st.settings.use_jobs ? `, ${st.data.jobs.length} jobs, ${st.data.purchases.length} purchases` : "");
  const backups = await st.backups();
  dataInfo.append(
    h("p", {}, "Kept on this device, in this browser: ", h("b", {}, counts), "."),
    h("p", { class: "muted" }, persisted ? "The browser has agreed to keep it (it won't be cleared to save space)." :
      "Install the app (browser menu → Install app / Add to Home screen) so the browser keeps your data safely."),
    h("div", { class: "bar" },
      h("button", { type: "button", onclick: exportAll }, "Export Everything…"),
      h("button", { type: "button", onclick: importAll }, "Import…")),
    h("p", { class: "muted" }, EDITION.laptop
      ? "Export makes a file to bring into Ross Invoices on the laptop (File → Import from Tablet), " +
        "or onto another device. Import replaces what's here with a file from Export for Tablet, or from this app; " +
        "a copy of what was here is kept first."
      : "Export makes one file with everything in it. Keep a copy somewhere safe (Google Drive, or email it to yourself) " +
        "every week or so: if the tablet is lost or broken, Import brings it all back on a new one."),
    h("h4", {}, "Daily copies"),
    backups.length ? h("div", { class: "backups" }, backups.slice(0, 10).map((k) => h("div", { class: "row-item" },
      h("span", { class: "grow" }, k.startsWith("before-") ? k.replace("before-import-", "Before an import, ").replace("before-restore-", "Before a restore, ") : M.longDate(k)),
      h("button", { type: "button", class: "small", onclick: () => restoreBackup(k) }, "Go back to this")))) :
      h("p", { class: "muted" }, "None yet."));
}

// A logo picture made no bigger than 800 pixels across, as PNG (keeps a
// transparent background) or JPEG (for a photo).
async function shrinkLogo(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 800 / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * k), hh = Math.round(bmp.height * k);
  const c = document.createElement("canvas");
  c.width = w; c.height = hh;
  c.getContext("2d").drawImage(bmp, 0, 0, w, hh);
  const png = file.type !== "image/jpeg";
  return { logo: c.toDataURL(png ? "image/png" : "image/jpeg", 0.9), logo_w: w, logo_h: hh };
}

async function exportAll() {
  const d = st.exportData("web", VERSION);
  F.saveJson(d, `${EDITION.name} data ${M.todayIso()}.json`);
  toast(EDITION.laptop ? "Saved to your Downloads. Bring it into the laptop program with File → Import from Tablet." :
    "Saved to your Downloads. Keep a copy somewhere safe, such as Google Drive.", 9000);
}

async function importAll() {
  const f = await F.pickFile();
  if (!f) return;
  let d;
  try { d = await F.readJson(f); } catch (e) { await infoBox("That file couldn't be read."); return; }
  const why = Store.check(d);
  if (why === "accounts") {
    const added = await st.importAccounts(Array.isArray(d) ? d : d.accounts);
    render();
    await infoBox(`That file holds only payment accounts, so only those were brought in (${added.length} added).` +
      (EDITION.laptop ? "\n\nTo bring in everything (clients, services, invoices), use File → Export for Tablet " +
        "on the laptop, and import that file here." : ""));
    return;
  }
  if (why) { await infoBox(why); return; }
  const n = Store.normalise(d);
  const from = d.source === "desktop" ? "the laptop program" : EDITION.name;
  const when = d.exported ? ` (exported ${M.longDate(d.exported)} ${d.exported.slice(11, 16)})` : "";
  const ok = await confirmBox(`Replace everything here with the file from ${from}${when}?\n\n` +
    `It has ${n.clients.length} clients, ${n.services.length} services, ${n.settings.accounts.length} payment accounts and ` +
    `${n.invoices.length} invoices` + ("estimates" in d ? `, and ${n.estimates.length} estimates.` :
      ".\n\n(It has no estimates, so the estimates here stay as they are.)") + `\n\nWhat's here now (${st.data.invoices.length} invoices) is kept as a copy first, under Settings → Daily copies.`,
  "Replace", "Cancel", true);
  if (!ok) return;
  await st.importData(d);
  toast(`Brought in ${n.invoices.length} invoices and ${n.clients.length} clients.`, 7000);
  render();
}

async function restoreBackup(k) {
  if (!(await confirmBox(`Go back to the copy from ${k.startsWith("before-") ? k : M.longDate(k)}? What's here now is kept as a copy first.`,
    "Go back", "Cancel", true))) return;
  await st.restore(k);
  toast("Done.");
  render();
}

// ------------------------------------------------------------------ start
export async function start(store) {
  st = store;
  st.onChange(() => buildFrame());
  $("#menu").onclick = () => document.body.classList.toggle("menu-open");
  $("#scrim").onclick = () => document.body.classList.remove("menu-open");
  render();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}

// for the tests
export const _test = { editInvoice, invoiceMenu, estimateMenu, turnIntoInvoice, newEstimate, recordPayment, savePdf, sendInvoice, preview, editClient, editService,
  editAccount, importAll, exportAll, emailText, state };
