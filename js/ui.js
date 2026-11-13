// Ross Invoices on a tablet: the pages and windows, as in the desktop program.
import * as M from "./money.js";
import { Store, blankAccount } from "./store.js";
import * as P from "./pdf.js";
import * as F from "./files.js";

export const VERSION = "1.1.0";
const TERMS = [["On receipt", 0], ["7 days", 7], ["14 days", 14], ["30 days", 30], ["60 days", 60]];
const EST_TERMS = [["No end date", 0], ["14 days", 14], ["30 days", 30], ["60 days", 60], ["90 days", 90]];
const METHODS = ["Bank transfer", "Cash", "Cheque", "PayPal", "Card", "Other"];
const UNITS = ["hours", "days", "sessions", "words", "pages", "chapters", "items"];
const GROUPS = ["Teaching", "Editing", "Mentoring", "Readings and talks", "Writing", "Expenses"];
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
  return sheet("Ross Invoices", h("p", { class: "msg" }, text),
    [{ label: no, value: false }, { label: yes, value: true, cls: danger ? "danger" : "primary" }]);
}

export function infoBox(text) {
  return sheet("Ross Invoices", h("p", { class: "msg" }, text), [{ label: "OK", value: true, cls: "primary" }]);
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
const PAGES = [
  ["Dashboard", "Overview", "◫"], ["Invoices", "Everything you have invoiced", "▤"],
  ["Estimates", "Prices you have quoted", "◇"],
  ["Clients", "Who you work for", "☺"], ["Services", "What you charge for", "✎"],
  ["Payment Accounts", "Where you are paid", "£"], ["Settings", "Your details and choices", "⚙"],
];

function wordmark(name) {
  const w = String(name || "").toUpperCase().split(/\s+/).filter(Boolean);
  return h("span", {}, h("b", {}, w[0] || ""), w.length > 1 ? " " + w.slice(1).join(" ") : "");
}

function buildFrame() {
  const nav = $("#nav");
  nav.innerHTML = "";
  for (const [name, , icon] of PAGES) {
    nav.append(h("button", { class: "navb" + (state.page === name ? " on" : ""), type: "button",
      onclick: () => go(name) }, h("span", { class: "nav-i" }, icon), h("span", {}, name)));
  }
  $("#wordmark").replaceChildren(wordmark(st.settings.business.name));
  $("#topname").textContent = st.settings.business.name || "Ross Invoices";
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
  const [name, sub] = PAGES.find((p) => p[0] === state.page);
  const main = $("#main");
  main.replaceChildren(h("div", { class: "page-head" }, h("h1", {}, name), h("p", { class: "sub" }, sub)));
  $("#toptitle").textContent = name;
  ({ Dashboard: pageDashboard, Invoices: pageInvoices, Estimates: pageEstimates, Clients: pageClients, Services: pageServices,
    "Payment Accounts": pageAccounts, Settings: pageSettings })[name](main);
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
    `${wait.n} estimate${wait.n === 1 ? "" : "s"} awaiting an answer (` +
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
      h("p", {}, "To bring in your clients, services, accounts and invoices from Ross Invoices on the laptop, use ",
        h("b", {}, "Export for Tablet"), " there (Settings), then ",
        h("button", { class: "link", type: "button", onclick: () => importAll() }, "Import that file here"), "."),
      h("p", {}, "Or start fresh: put your details in ",
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
      est ? "Estimates" : "");
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
  if (inv.kind === "estimate") {
    return [`Estimate ${inv.number} from ${name}`, [`Dear ${inv.client.name || ""},`, "",
      `Please find attached my estimate ${inv.number} for ${M.fmt(inv.total, cur)}` +
      (inv.valid_until ? `, valid until ${M.longDate(inv.valid_until)}` : "") + ".", "",
      "Do let me know if you would like to go ahead, or if you have any questions.", "",
      "With best wishes,", name].join("\n")];
  }
  const subject = `Invoice ${inv.number} from ${name}`;
  const body = [`Dear ${inv.client.name || ""},`, "",
    `Please find attached invoice ${inv.number} for ${M.fmt(inv.paid !== 0n ? inv.balance : inv.total, cur)}` +
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
    `Drawing the ${inv.kind === "estimate" ? "estimate" : "invoice"}…`));
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
async function editInvoice(inv, kind = inv && inv.kind === "estimate" ? "estimate" : "invoice") {
  const s = st.settings, d = s.defaults;
  const est = kind === "estimate";
  const word = est ? "estimate" : "invoice", Word = est ? "Estimate" : "Invoice";
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
  fillClients(inv ? inv.client_id : "");
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
  const showAcc = h("input", { type: "checkbox", checked: inv ? !!inv.show_account : false });
  const showAccRow = est ? h("label", { class: "check" }, showAcc, " Print the payment details on the estimate") : null;

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
        } }, "✕")));
    Object.assign(row, { desc, qty, unit, price, amount });
    if (at == null) { lines.push(row); linesBox.append(row.el); } else { lines.splice(at, 0, row); }
    requestAnimationFrame(grow);
    return row;
  }
  const items = inv ? inv.items : [];
  items.forEach((it) => addLine(it));
  if (!items.length) addLine({ description: "", quantity: "1", unit: "", unit_price: "" });

  const totals = h("div", { class: "totals" });
  function current() {
    return lines.map((r) => ({ description: r.desc.value.trim(), quantity: M.parseAmount(r.qty.value),
      unit: r.unit.value.trim(), unit_price: M.parseAmount(r.price.value) })).filter((x) => x.description);
  }
  function draft() {
    const c = st.client(clientSel.value) || {};
    const out = { number: number.value.trim(), client_id: clientSel.value ? +clientSel.value : null,
      client: Object.fromEntries(["name", "address", "email", "phone"].map((k) => [k, c[k] || ""])),
      issue_date: issue.value || M.todayIso(),
      currency: currency.value, tax_rate: M.parseAmount(tax.value), tax_label: taxLabel.value.trim() || "Tax",
      account_id: accountSel.value || "", account: st.account(accountSel.value) || {}, notes: notes.value.trim(),
      items: current(), payments: inv && !est ? inv.payments : [] };
    const end = terms.value === "0" ? "" : due.value;
    if (est) Object.assign(out, { kind: "estimate", valid_until: end, show_account: showAcc.checked,
      status: inv ? inv.status : "draft" });
    else out.due_date = end;
    return Object.assign(out, Store.totals(out));
  }
  function recalc() {
    const cur = currency.value;
    for (const r of lines) r.amount.textContent = M.fmt(M.lineAmount(M.parseAmount(r.qty.value), M.parseAmount(r.price.value)), cur);
    const t = draft();
    const rows = [["Subtotal", t.subtotal]];
    if (t.tax !== 0n) rows.push([`${t.tax_label} (${M.fmtQty(t.tax_rate)}%)`, t.tax]);
    rows.push(["Total", t.total]);
    if (t.paid !== 0n) rows.push(["Paid", t.paid], ["Balance", t.balance]);
    totals.replaceChildren(...rows.map(([l, v], i) => h("div", { class: i === rows.length - 1 ? "t-row big" : "t-row" },
      h("span", {}, l), h("span", {}, M.fmt(v, cur)))));
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
      field("Tax", h("div", { class: "with-btn" }, tax, h("span", {}, "%"), taxLabel))),
    h("h3", { class: "sec" }, "Lines"),
    linesBox,
    h("div", { class: "bar" },
      h("button", { type: "button", onclick: pickService }, "+ Add Service"),
      h("button", { type: "button", onclick: () => { addLine({ quantity: "1" }).desc.focus(); recalc(); } }, "+ Add Line"),
      h("span", { class: "grow" }), totals),
    field(`Note on the ${word}`, notes),
    datalist("units", UNITS));
  accountChanged(false);
  recalc();

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

// ------------------------------------------------------------------ Estimates
function estimateTable(list) {
  const today = M.todayIso();
  if (!list.length) return h("div", { class: "empty" }, st.data.estimates.length ? "No estimates here." :
    "No estimates yet. An estimate tells a client what the work will cost; when they say yes, turn it into an invoice.");
  const numbers = Object.fromEntries(st.data.invoices.map((i) => [i.id, i.number]));
  const t = h("div", { class: "tbl est" },
    h("div", { class: "tr th" }, h("span", { class: "c-num" }, "Number"), h("span", { class: "c-client" }, "Client"),
      h("span", { class: "c-date" }, "Date"), h("span", { class: "c-date c-due" }, "Valid until"),
      h("span", { class: "c-amt" }, "Total"), h("span", { class: "c-num c-paid" }, "Invoice"),
      h("span", { class: "c-st" }, "Status")));
  for (const e of list) {
    t.append(h("button", { class: "tr", type: "button", onclick: () => estimateMenu(e.id) },
      h("span", { class: "c-num" }, h("b", {}, e.number)),
      h("span", { class: "c-client" }, (e.client || {}).name || ""),
      h("span", { class: "c-date" }, M.shortDate(e.issue_date)),
      h("span", { class: "c-date c-due" }, M.shortDate(e.valid_until) || "—"),
      h("span", { class: "c-amt strong" }, M.fmt(e.total, e.currency)),
      h("span", { class: "c-num c-paid" }, numbers[e.invoice_id] || ""),
      h("span", { class: "c-st" }, pill(Store.estimateStatus(e, today)))));
  }
  return t;
}

function pageEstimates(main) {
  main.append(h("div", { class: "bar" },
    h("button", { class: "primary", type: "button", onclick: () => newEstimate() }, "+  New Estimate"),
    select([[0, "All estimates"], [1, "Awaiting an answer"], [2, "Accepted"], [3, "Declined or expired"]], state.efilter,
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
  const inv = e.invoice_id ? st.invoice(e.invoice_id) : null;
  const v = await actions(`${e.number} · ${e.client.name || ""} · ${status}`, [
    { icon: "✎", label: "Change", value: "edit" },
    { icon: "⧉", label: "Duplicate", sub: "A new estimate like this one, dated today", value: "dup" },
    inv ? { icon: "▤", label: `Open Invoice ${inv.number}`, sub: "Already turned into an invoice", value: "open" }
      : { icon: "✓", label: "Turn into Invoice", sub: "The client said yes: an invoice with the same lines", value: "inv" },
    null,
    { icon: "◳", label: "Preview", value: "preview" },
    { icon: "⤓", label: "Save PDF", sub: F.canPickFolder ? "Into your Estimates folder" : "To Downloads", value: "pdf" },
    { icon: "✉", label: share ? "Send…" : "Send by Email", sub: share ? "Share the PDF: Gmail, WhatsApp…" :
      "Downloads the PDF and opens an email", value: "send" },
    null,
    ...Store.EST_STATUSES.map(([k, label]) => ({ icon: (e.status || "draft") === k ? "●" : "○", label: `Mark as ${label}`,
      value: "st:" + k, disabled: (e.status || "draft") === k })),
    null,
    { icon: "✕", label: "Delete Estimate…", value: "delete", danger: true },
  ]);
  if (v === "edit") await editInvoice(e, "estimate");
  else if (v === "dup") {
    const id = await st.duplicateEstimate(eid);
    toast(`Made ${st.estimate(id).number}, dated today.`);
    render();
    await editInvoice(st.estimate(id), "estimate");
  } else if (v === "inv") await turnIntoInvoice(e);
  else if (v === "open") { go("Invoices"); await invoiceMenu(inv.id); }
  else if (v === "preview") await preview(e);
  else if (v === "pdf") await savePdf(e);
  else if (v === "send") await sendInvoice(e);
  else if (v && v.startsWith("st:")) {
    await st.setEstimateStatus(eid, v.slice(3));
    render();
  } else if (v === "delete") {
    let msg = `Delete estimate ${e.number} for ${e.client.name || ""}?`;
    if (inv) msg += `\n\nInvoice ${inv.number}, made from it, stays.`;
    msg += "\n\nAny PDF already saved stays where it is.";
    if (await confirmBox(msg, "Delete", "Keep it", true)) {
      await st.deleteEstimate(eid);
      toast(`Estimate ${e.number} deleted.`);
      render();
    }
  }
}

async function turnIntoInvoice(e) {
  if (!(await confirmBox(`Turn ${e.number} into an invoice?\n\nThe invoice gets the next invoice number, today's date ` +
    `and your usual payment terms, with the same client, lines and prices. ${e.number} is marked Accepted.`,
  "Make the Invoice"))) return;
  const iid = await st.estimateToInvoice(e.id);
  const inv = st.invoice(iid);
  go("Invoices");
  toast(`${e.number} accepted: invoice ${inv.number} made from it. Check it, then save the PDF.`, 9000);
  await editInvoice(inv);
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
    await st.save();
    toast("Settings saved.");
    buildFrame();
  } }, "Save Settings");

  const box = (title, ...kids) => h("section", { class: "box" }, h("h3", {}, title), ...kids);
  const pdfInfo = h("div");
  const dataInfo = h("div");
  main.append(h("div", { class: "settings" },
    h("div", { class: "col" },
      box("You (top of every invoice)", field("Name", name), field("Address", address), field("Email", email),
        field("Phone", phone), field("Website", web)),
      box("Where PDFs go", pdfInfo),
      box("Your data", dataInfo)),
    h("div", { class: "col" },
      box("New invoices", field("Number starts with", prefix), h("div", { class: "grid2" }, field("Next number", next),
        field("Digits", digits)), sample, field("Currency", currency),
      field("Payment due in (days; 0 = on receipt)", terms), h("div", { class: "grid2" }, field("Tax rate (%)", tax),
        field("Tax called", taxLabel)), field("Under the bank details", thanks), field("Note at the foot", note),
      field("Invoice style", style)),
      box("New estimates", field("Number starts with", eprefix), field("Next number", enext), esample,
        field("Valid for (days; 0 = no end date)", valid),
        h("p", { class: "muted" }, "Estimates use the same style, currency and tax as invoices. " +
          "Payment details are printed only if you tick the box on the estimate.")),
      h("div", { class: "bar" }, h("span", { class: "grow" }), saveBtn),
      box("About", h("p", {}, `Ross Invoices for the web, version ${VERSION}.`),
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
  const counts = `${st.data.clients.length} clients, ${st.data.services.length} services, ${st.settings.accounts.length} accounts, ${st.data.invoices.length} invoices, ${st.data.estimates.length} estimates`;
  const backups = await st.backups();
  dataInfo.append(
    h("p", {}, "Kept on this device, in this browser: ", h("b", {}, counts), "."),
    h("p", { class: "muted" }, persisted ? "The browser has agreed to keep it (it won't be cleared to save space)." :
      "Install the app (browser menu → Install app / Add to Home screen) so the browser keeps your data safely."),
    h("div", { class: "bar" },
      h("button", { type: "button", onclick: exportAll }, "Export Everything…"),
      h("button", { type: "button", onclick: importAll }, "Import…")),
    h("p", { class: "muted" }, "Export makes a file to bring into Ross Invoices on the laptop (Settings → Import from Tablet), " +
      "or onto another device. Import replaces what's here with a file from Export for Tablet, or from this app; " +
      "a copy of what was here is kept first."),
    h("h4", {}, "Daily copies"),
    backups.length ? h("div", { class: "backups" }, backups.slice(0, 10).map((k) => h("div", { class: "row-item" },
      h("span", { class: "grow" }, k.startsWith("before-") ? k.replace("before-import-", "Before an import, ").replace("before-restore-", "Before a restore, ") : M.longDate(k)),
      h("button", { type: "button", class: "small", onclick: () => restoreBackup(k) }, "Go back to this")))) :
      h("p", { class: "muted" }, "None yet."));
}

async function exportAll() {
  const d = st.exportData("web", VERSION);
  F.saveJson(d, `Ross Invoices data ${M.todayIso()}.json`);
  toast("Saved to your Downloads. Bring it into the laptop program with Settings → Import from Tablet.", 9000);
}

async function importAll() {
  const f = await F.pickFile();
  if (!f) return;
  let d;
  try { d = await F.readJson(f); } catch (e) { await infoBox("That file couldn't be read."); return; }
  const why = Store.check(d);
  if (why === "accounts") {
    const added = await st.importAccounts(Array.isArray(d) ? d : d.accounts);
    toast(`That was a payment accounts file: added ${added.length}.`);
    render();
    return;
  }
  if (why) { await infoBox(why); return; }
  const n = Store.normalise(d);
  const from = d.source === "desktop" ? "the laptop program" : "Ross Invoices";
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
