// Where everything is kept: in this browser, on this device (IndexedDB), never
// on a server. The shape of the data is the same as the desktop program's
// "Export for Tablet" file, so the two can be swapped either way.
import * as M from "./money.js";
import { EDITION } from "./edition.js";

export const FORMAT = "ross-invoices-data";
export const KEEP_BACKUPS = 30;

const BASE_SETTINGS = {
  heading: "",             // the name at the top of the sidebar (blank: the business name)
  business: { name: "", address: "", email: "", phone: "", website: "", tax_number: "",
    logo: "", logo_w: 0, logo_h: 0 },
  numbering: { prefix: "INV-", next: 1, digits: 4 },
  estimate_numbering: { prefix: "EST-", next: 1, digits: 4 },
  defaults: { currency: "GBP", terms_days: 30, valid_days: 30, tax_rate: "0", tax_label: "VAT", account: "" },
  thanks: "THANK YOU",
  note: "Thank you for your business.",
  accounts: [],
  style: "classic",
  estimate_word: "Estimate",   // or "Quotation"
  use_sections: false,         // lines under Materials, Labour… headings
  use_costs: false,            // a cost and markup on lines (never printed)
  markup: "0",                 // usual markup on costs, %
  use_jobs: false,             // the Jobs and Purchases pages
  year_start: "04-06",         // the tax year: UK 6 April; "01-01" for a calendar year
};

function deepMerge(a, b) {
  for (const [k, v] of Object.entries(b || {})) {
    if (v && typeof v === "object" && !Array.isArray(v) && a[k] && typeof a[k] === "object") deepMerge(a[k], v);
    else a[k] = v;
  }
  return a;
}
export const DEFAULT_SETTINGS = deepMerge(JSON.parse(JSON.stringify(BASE_SETTINGS)), EDITION.settings);

const clone = (x) => JSON.parse(JSON.stringify(x));

// Lines as kept: blank ones dropped; a section and a cost only when there is one.
function cleanItems(items) {
  return items.filter((it) => (it.description || "").trim()).map((it) => {
    const out = { description: it.description.trim(), quantity: M.fmtQty(it.quantity || "0"), unit: it.unit || "",
      unit_price: M.fmtQty(it.unit_price || "0") };
    if ((it.group || "").trim()) out.group = it.group.trim();
    if (it.cost != null && String(it.cost).trim() !== "") out.cost = M.fmtQty(it.cost);
    return out;
  });
}

export function newId() {
  const a = new Uint8Array(6);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function blankAccount(name = "New account", style = "dash") {
  return { id: newId(), name, style, heading: style === "colon" ? "PAYMENT INFO" : "", title: "",
    lines: [["Bank Name", ""], ["Account Name", ""], ["Account Number", ""]], currency: "", retired: false };
}

export function safeFileName(s) {
  s = String(s || "").replace(/[\\/:*?"<>|\x00-\x1f]+/g, " ").trim().replace(/\s+/g, " ");
  return (s.slice(0, 90) || "Invoice").replace(/[. ]+$/, "");
}

// ------------------------------------------------------------------ IndexedDB
const DB_NAME = EDITION.db;

function openDb() {
  return new Promise((ok, fail) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      if (!db.objectStoreNames.contains("backups")) db.createObjectStore("backups");
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error);
  });
}

function tx(db, store, mode, fn) {
  return new Promise((ok, fail) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    const req = fn(s);
    if (req) req.onsuccess = () => { out = req.result; };
    t.oncomplete = () => ok(out);
    t.onerror = () => fail(t.error);
    t.onabort = () => fail(t.error);
  });
}

// ------------------------------------------------------------------ the store
export class Store {
  constructor() {
    this.db = null;
    this.data = null;
    this.listeners = [];
  }

  static empty() {
    return { format: FORMAT, version: 2, settings: clone(DEFAULT_SETTINGS), clients: [], services: [], invoices: [],
      estimates: [], jobs: [], purchases: [] };
  }

  async open() {
    this.db = await openDb();
    const got = await this.kvGet("data");
    this.data = got ? Store.normalise(got) : Store.empty();
    if (!got) await this.save();
    await this.backup();
    return this;
  }

  async kvGet(key) { return tx(this.db, "kv", "readonly", (s) => s.get(key)); }
  async kvSet(key, value) { return tx(this.db, "kv", "readwrite", (s) => s.put(value, key)); }

  onChange(fn) { this.listeners.push(fn); }

  async save() {
    await this.kvSet("data", clone(this.data));
    this.listeners.forEach((f) => f());
  }

  // Fill in anything missing (from an older file, or the desktop program).
  static normalise(d) {
    d = clone(d || {});
    const s = clone(DEFAULT_SETTINGS);
    for (const [k, v] of Object.entries(d.settings || {})) {
      if (v && typeof v === "object" && !Array.isArray(v) && typeof s[k] === "object" && !Array.isArray(s[k])) {
        Object.assign(s[k], v);
      } else s[k] = v;
    }
    delete s.interface_scale;
    for (const a of s.accounts) {
      a.id ||= newId();
      a.style ||= "dash";
      a.heading ??= ""; a.title ??= ""; a.lines ||= []; a.currency ??= ""; a.retired = !!a.retired;
    }
    const out = { format: FORMAT, version: 2, settings: s, clients: [], services: [], invoices: [], estimates: [],
      jobs: [], purchases: [] };
    const items = (list) => (list || []).map((x) => {
      const it = { description: x.description || "", quantity: String(x.quantity ?? "1"), unit: x.unit || "",
        unit_price: String(x.unit_price ?? "0") };
      if (x.group) it.group = String(x.group);
      if (x.cost != null && x.cost !== "") it.cost = String(x.cost);
      return it;
    });
    const optId = (v) => (v == null || v === "" ? null : +v);
    for (const c of d.clients || []) {
      out.clients.push({ id: +c.id, name: c.name || "", address: c.address || "", email: c.email || "",
        phone: c.phone || "", currency: c.currency || "", account: c.account || "", notes: c.notes || "" });
    }
    for (const v of d.services || []) {
      out.services.push({ id: +v.id, category: v.category || "", name: v.name || "", description: v.description || "",
        unit: v.unit || "", price: String(v.price ?? "0") });
    }
    for (const i of d.invoices || []) {
      out.invoices.push({
        id: +i.id, number: String(i.number || ""), client_id: i.client_id == null ? null : +i.client_id,
        client: i.client || {}, issue_date: i.issue_date || "", due_date: i.due_date || "",
        currency: i.currency || "GBP", tax_rate: String(i.tax_rate ?? "0"), tax_label: i.tax_label || "VAT",
        account_id: i.account_id || "", account: i.account || {}, notes: i.notes || "", created: i.created || "",
        reference: i.reference || "", job_id: optId(i.job_id), from_estimate: optId(i.from_estimate),
        items: items(i.items),
        payments: (i.payments || []).map((p, k) => ({ id: +(p.id ?? k + 1), amount: String(p.amount), date: p.date,
          method: p.method || "", note: p.note || "" })),
      });
    }
    for (const e of d.estimates || []) {
      out.estimates.push({
        id: +e.id, number: String(e.number || ""), client_id: e.client_id == null ? null : +e.client_id,
        client: e.client || {}, issue_date: e.issue_date || "", valid_until: e.valid_until || "",
        currency: e.currency || "GBP", tax_rate: String(e.tax_rate ?? "0"), tax_label: e.tax_label || "VAT",
        account_id: e.account_id || "", account: e.account || {}, show_account: !!e.show_account,
        notes: e.notes || "", status: e.status || "draft", invoice_id: optId(e.invoice_id),
        created: e.created || "", reference: e.reference || "", job_id: optId(e.job_id),
        items: items(e.items),
      });
    }
    for (const j of d.jobs || []) {
      out.jobs.push({ id: +j.id, name: j.name || "", client_id: optId(j.client_id), status: j.status === "done" ? "done" : "open",
        notes: j.notes || "", created: j.created || "" });
    }
    for (const p of d.purchases || []) {
      out.purchases.push({ id: +p.id, job_id: optId(p.job_id), date: p.date || "", supplier: p.supplier || "",
        description: p.description || "", category: p.category || "", amount: String(p.amount ?? "0"),
        currency: p.currency || s.defaults.currency || "GBP", note: p.note || "" });
    }
    return out;
  }

  get settings() { return this.data.settings; }

  nextIdOf(list) { return list.reduce((m, x) => Math.max(m, +x.id || 0), 0) + 1; }

  // ---------------------------------------------------------- backups
  // A copy of everything once a day the app is used; the last 30 kept.
  async backup(today = M.todayIso()) {
    const keys = await tx(this.db, "backups", "readonly", (s) => s.getAllKeys());
    if (!keys.includes(today)) {
      await tx(this.db, "backups", "readwrite", (s) => s.put(clone(this.data), today));
      keys.push(today);
    }
    keys.sort();
    const old = keys.slice(0, Math.max(0, keys.length - KEEP_BACKUPS));
    if (old.length) await tx(this.db, "backups", "readwrite", (s) => { old.forEach((k) => s.delete(k)); });
  }

  async backups() {
    const keys = await tx(this.db, "backups", "readonly", (s) => s.getAllKeys());
    return keys.sort().reverse();
  }

  async backupData(key) { return tx(this.db, "backups", "readonly", (s) => s.get(key)); }

  async restore(key) {
    const d = await this.backupData(key);
    if (!d) return false;
    await tx(this.db, "backups", "readwrite", (s) => s.put(clone(this.data), "before-restore-" + M.todayIso()));
    this.data = Store.normalise(d);
    await this.save();
    return true;
  }

  // ---------------------------------------------------------- whole-file export and import
  exportData(source = "web", version = "") {
    const d = clone(this.data);
    d.exported = new Date().toISOString().slice(0, 19);
    d.source = source;
    d.app_version = version;
    return d;
  }

  static check(d) {
    if (!d || typeof d !== "object") return `That file isn't ${EDITION.name} data.`;
    if (d.format !== FORMAT) {
      if (Array.isArray(d.accounts) || Array.isArray(d)) return "accounts";
      return `That file isn't ${EDITION.name} data (from Export on this app${EDITION.laptop ? ", or Export for Tablet on the laptop" : ""}).`;
    }
    return "";
  }

  // Everything here is replaced by the file (a copy of what was here is kept
  // first). An older file with no estimates leaves the estimates here alone.
  async importData(d) {
    await tx(this.db, "backups", "readwrite", (s) => s.put(clone(this.data), "before-import-" +
      new Date().toISOString().slice(0, 16).replace(":", "")));
    const keep = d && !("estimates" in d) ? clone(this.data.estimates || []) : null;
    const keepNb = d && !("estimates" in d) ? clone(this.settings.estimate_numbering) : null;
    const keepJobs = d && !("jobs" in d) ? clone({ jobs: this.data.jobs || [], purchases: this.data.purchases || [] }) : null;
    // settings the laptop doesn't know about stay as they were here
    const here = clone(this.settings);
    this.data = Store.normalise(d);
    if (keep) { this.data.estimates = keep; this.settings.estimate_numbering = keepNb; }
    if (keepJobs) Object.assign(this.data, keepJobs);
    if (d && d.source === "desktop") {
      for (const k of ["heading", "estimate_word", "use_sections", "use_costs", "markup", "use_jobs", "year_start"]) {
        if (!(k in (d.settings || {}))) this.settings[k] = here[k];
      }
      for (const k of ["tax_number", "logo", "logo_w", "logo_h"]) {
        if (!(k in ((d.settings || {}).business || {}))) this.settings.business[k] = here.business[k];
      }
    }
    await this.save();
  }

  // ---------------------------------------------------------- accounts
  accounts(includeRetired = true) {
    return this.settings.accounts.filter((a) => includeRetired || !a.retired);
  }

  account(aid) { return this.settings.accounts.find((a) => a.id === aid) || null; }

  async addAccount(acc) {
    acc = acc || blankAccount();
    acc.id ||= newId();
    if (this.settings.accounts.some((a) => a.id === acc.id)) acc.id = newId();
    this.settings.accounts.push(acc);
    if (!this.settings.defaults.account) this.settings.defaults.account = acc.id;
    await this.save();
    return acc;
  }

  async saveAccount(acc) {
    const i = this.settings.accounts.findIndex((a) => a.id === acc.id);
    if (i < 0) return this.addAccount(acc);
    this.settings.accounts[i] = acc;
    await this.save();
    return acc;
  }

  async duplicateAccount(aid) {
    const a = clone(this.account(aid));
    a.id = newId();
    a.name += " (copy)";
    a.retired = false;
    const i = this.settings.accounts.findIndex((x) => x.id === aid);
    this.settings.accounts.splice(i + 1, 0, a);
    await this.save();
    return a;
  }

  accountInUse(aid) {
    return [this.data.invoices.filter((i) => i.account_id === aid).length,
      this.data.clients.filter((c) => c.account === aid).length];
  }

  async deleteAccount(aid) {
    if (this.accountInUse(aid)[0]) return false;
    this.settings.accounts = this.settings.accounts.filter((a) => a.id !== aid);
    if (this.settings.defaults.account === aid) {
      const live = this.accounts(false);
      this.settings.defaults.account = live.length ? live[0].id : "";
    }
    this.data.clients.forEach((c) => { if (c.account === aid) c.account = ""; });
    await this.save();
    return true;
  }

  async importAccounts(items) {
    const added = [];
    const names = new Set(this.settings.accounts.map((a) => a.name));
    const values = new Set(this.settings.accounts.map((a) => JSON.stringify((a.lines || []).map((l) => l[1]).filter(Boolean))));
    for (let a of items) {
      if (!a || typeof a !== "object" || !a.name) continue;
      a = clone(a);
      if (names.has(a.name) || values.has(JSON.stringify((a.lines || []).map((l) => l[1]).filter(Boolean)))) continue;
      a.id = newId();
      a.style ||= "dash"; a.heading ??= ""; a.title ??= ""; a.lines ||= []; a.currency ??= ""; a.retired = false;
      this.settings.accounts.push(a);
      added.push(a);
    }
    if (added.length && !this.settings.defaults.account) this.settings.defaults.account = added[0].id;
    await this.save();
    return added;
  }

  // ---------------------------------------------------------- clients
  clients() {
    return [...this.data.clients].sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  }

  client(cid) { return this.data.clients.find((c) => c.id === +cid) || null; }

  async saveClient(c) {
    const fields = ["name", "address", "email", "phone", "currency", "account", "notes"];
    const row = Object.fromEntries(fields.map((k) => [k, c[k] || ""]));
    if (c.id) {
      Object.assign(this.client(c.id), row);
    } else {
      row.id = this.nextIdOf(this.data.clients);
      this.data.clients.push(row);
      c.id = row.id;
    }
    await this.save();
    return c.id;
  }

  clientInvoiceCount(cid) { return this.data.invoices.filter((i) => i.client_id === +cid).length; }

  async deleteClient(cid) {
    if (this.clientInvoiceCount(cid)) return false;
    this.data.clients = this.data.clients.filter((c) => c.id !== +cid);
    await this.save();
    return true;
  }

  // ---------------------------------------------------------- services
  services() {
    const k = (s) => s.toLocaleLowerCase();
    return [...this.data.services].sort((a, b) => k(a.category).localeCompare(k(b.category)) ||
      k(a.name).localeCompare(k(b.name)));
  }

  service(sid) { return this.data.services.find((s) => s.id === +sid) || null; }

  categories() {
    return [...new Set(this.data.services.map((s) => s.category).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
  }

  async saveService(s) {
    const fields = ["category", "name", "description", "unit", "price"];
    const row = Object.fromEntries(fields.map((k) => [k, String(s[k] ?? "")]));
    if (s.id) Object.assign(this.service(s.id), row);
    else {
      row.id = this.nextIdOf(this.data.services);
      this.data.services.push(row);
      s.id = row.id;
    }
    await this.save();
    return s.id;
  }

  async deleteService(sid) {
    this.data.services = this.data.services.filter((s) => s.id !== +sid);
    await this.save();
  }

  // ---------------------------------------------------------- numbering
  nb(kind = "invoice") {
    return kind === "estimate" ? (this.settings.estimate_numbering ||= { prefix: "EST-", next: 1, digits: 4 })
      : this.settings.numbering;
  }

  formatNumber(n, kind = "invoice") {
    const nb = this.nb(kind);
    return (nb.prefix || "") + String(n).padStart(Math.max(1, +nb.digits || 1), "0");
  }

  nextNumber(kind = "invoice") {
    let n = Math.max(1, +this.nb(kind).next || 1);
    while (this.numberTaken(this.formatNumber(n, kind), null, kind)) n++;
    return this.formatNumber(n, kind);
  }

  numberTaken(number, exceptId = null, kind = "invoice") {
    const r = (kind === "estimate" ? this.data.estimates : this.data.invoices).find((i) => i.number === number);
    return !!r && r.id !== exceptId;
  }

  advanceNumbering(number, kind = "invoice") {
    const nb = this.nb(kind);
    const p = nb.prefix || "";
    const rest = number.slice(p.length);
    if (number.startsWith(p) && /^\d+$/.test(rest)) {
      const n = parseInt(rest, 10);
      if (n >= (+nb.next || 1)) nb.next = n + 1;
    }
  }

  // ---------------------------------------------------------- invoices
  // The client's and the account's details are copied into the invoice, so
  // later changes to them leave it as it was.
  async saveInvoice(inv, items) {
    const c = this.client(inv.client_id) || {};
    const acc = this.account(inv.account_id) || {};
    const row = {
      number: String(inv.number || "").trim(),
      client_id: inv.client_id == null ? null : +inv.client_id,
      client: Object.fromEntries(["name", "address", "email", "phone"].map((k) => [k, c[k] || ""])),
      issue_date: inv.issue_date,
      due_date: inv.due_date || "",
      currency: inv.currency || "GBP",
      tax_rate: M.fmtQty(inv.tax_rate || "0"),
      tax_label: inv.tax_label || "VAT",
      account_id: acc.id || "",
      account: clone(acc),
      notes: inv.notes || "",
      reference: (inv.reference || "").trim(),
      job_id: inv.job_id == null || inv.job_id === "" ? null : +inv.job_id,
    };
    if (this.numberTaken(row.number, inv.id || null)) throw new Error(`There is already an invoice numbered ${row.number}.`);
    row.items = cleanItems(items);
    let id = inv.id;
    if (id) {
      const old = this.data.invoices.find((i) => i.id === id);
      Object.assign(old, row);
    } else {
      id = this.nextIdOf(this.data.invoices);
      row.id = id;
      row.created = new Date().toISOString().slice(0, 19);
      row.payments = [];
      row.from_estimate = inv.from_estimate == null ? null : +inv.from_estimate;
      this.data.invoices.push(row);
    }
    this.advanceNumbering(row.number);
    await this.save();
    return id;
  }

  invoice(iid) {
    const r = this.data.invoices.find((i) => i.id === +iid);
    if (!r) return null;
    const inv = clone(r);
    inv.payments.sort((a, b) => (a.date || "").localeCompare(b.date || "") || a.id - b.id);
    return Object.assign(inv, Store.totals(inv));
  }

  // Totals in pence (BigInt), exactly as the desktop program works them out.
  static totals(inv) {
    const sub = inv.items.reduce((s, i) => s + M.lineAmount(i.quantity, i.unit_price), 0n);
    const tax = M.taxOf(sub, inv.tax_rate || "0");
    const total = sub + tax;
    const paidUnits = (inv.payments || []).reduce((s, p) => s + M.units(p.amount), 0n);
    const paid = M.cents(paidUnits);
    return { subtotal: sub, tax, total, paid, balance: total - paid };
  }

  static status(inv, today = M.todayIso()) {
    if (inv.total > 0n && inv.balance <= 0n) return "Paid";
    if (inv.total <= 0n && inv.paid <= 0n) return "Nothing to pay";
    const late = !!inv.due_date && inv.due_date < today;
    if (inv.paid > 0n) return late ? "Part paid, overdue" : "Part paid";
    return late ? "Overdue" : "Unpaid";
  }

  invoices() {
    return this.data.invoices
      .map((i) => this.invoice(i.id))
      .sort((a, b) => (b.issue_date || "").localeCompare(a.issue_date || "") || b.number.localeCompare(a.number));
  }

  async deleteInvoice(iid) {
    this.data.invoices = this.data.invoices.filter((i) => i.id !== +iid);
    await this.save();
  }

  async duplicateInvoice(iid, today = M.todayIso()) {
    const old = this.invoice(iid);
    const gap = M.daysBetween(old.issue_date, old.due_date);
    const acc = this.account(old.account_id);
    const inv = { number: this.nextNumber(), client_id: old.client_id, issue_date: today,
      due_date: old.due_date && gap != null ? M.addDays(today, gap) : "",
      currency: old.currency, tax_rate: old.tax_rate, tax_label: old.tax_label,
      account_id: acc && !acc.retired ? old.account_id : (this.settings.defaults.account || ""), notes: old.notes,
      reference: old.reference, job_id: old.job_id };
    return this.saveInvoice(inv, old.items);
  }

  async addPayment(iid, amount, date, method = "", note = "") {
    const r = this.data.invoices.find((i) => i.id === +iid);
    const pid = r.payments.reduce((m, p) => Math.max(m, +p.id || 0), 0) + 1;
    r.payments.push({ id: pid, amount: M.centsToText(M.cents(amount)), date, method, note });
    await this.save();
    return pid;
  }

  async deletePayment(iid, pid) {
    const r = this.data.invoices.find((i) => i.id === +iid);
    r.payments = r.payments.filter((p) => p.id !== pid);
    await this.save();
  }

  // ---------------------------------------------------------- estimates
  // Like invoices, with a valid-until date instead of a due date, a status
  // (draft, sent, accepted, declined), and payment details off unless ticked.
  static EST_STATUSES = [["draft", "Draft"], ["sent", "Sent"], ["accepted", "Accepted"], ["declined", "Declined"]];

  async saveEstimate(est, items) {
    const c = this.client(est.client_id) || {};
    const acc = this.account(est.account_id) || {};
    const row = {
      number: String(est.number || "").trim(),
      client_id: est.client_id == null ? null : +est.client_id,
      client: Object.fromEntries(["name", "address", "email", "phone"].map((k) => [k, c[k] || ""])),
      issue_date: est.issue_date,
      valid_until: est.valid_until || "",
      currency: est.currency || "GBP",
      tax_rate: M.fmtQty(est.tax_rate || "0"),
      tax_label: est.tax_label || "VAT",
      account_id: acc.id || "",
      account: clone(acc),
      show_account: !!est.show_account,
      notes: est.notes || "",
      reference: (est.reference || "").trim(),
      job_id: est.job_id == null || est.job_id === "" ? null : +est.job_id,
    };
    if (this.numberTaken(row.number, est.id || null, "estimate")) throw new Error(`There is already an estimate numbered ${row.number}.`);
    row.items = cleanItems(items);
    let id = est.id;
    if (id) {
      Object.assign(this.data.estimates.find((e) => e.id === id), row);
    } else {
      id = this.nextIdOf(this.data.estimates);
      Object.assign(row, { id, created: new Date().toISOString().slice(0, 19), status: est.status || "draft",
        invoice_id: null });
      this.data.estimates.push(row);
    }
    this.advanceNumbering(row.number, "estimate");
    await this.save();
    return id;
  }

  estimate(eid) {
    const r = this.data.estimates.find((e) => e.id === +eid);
    if (!r) return null;
    const est = clone(r);
    est.kind = "estimate";
    est.payments = [];
    return Object.assign(est, Store.totals(est));
  }

  estimates() {
    return this.data.estimates
      .map((e) => this.estimate(e.id))
      .sort((a, b) => (b.issue_date || "").localeCompare(a.issue_date || "") || b.number.localeCompare(a.number));
  }

  static estimateStatus(est, today = M.todayIso()) {
    const st = est.status || "draft";
    if ((st === "draft" || st === "sent") && est.valid_until && est.valid_until < today) return "Expired";
    return (Store.EST_STATUSES.find(([k]) => k === st) || [0, "Draft"])[1];
  }

  async setEstimateStatus(eid, status) {
    this.data.estimates.find((e) => e.id === +eid).status = status;
    await this.save();
  }

  async deleteEstimate(eid) {
    this.data.estimates = this.data.estimates.filter((e) => e.id !== +eid);
    await this.save();
  }

  async duplicateEstimate(eid, today = M.todayIso()) {
    const old = this.estimate(eid);
    const gap = M.daysBetween(old.issue_date, old.valid_until);
    const acc = this.account(old.account_id);
    const est = { number: this.nextNumber("estimate"), client_id: old.client_id, issue_date: today,
      valid_until: old.valid_until && gap != null ? M.addDays(today, gap) : "",
      currency: old.currency, tax_rate: old.tax_rate, tax_label: old.tax_label,
      account_id: acc && !acc.retired ? old.account_id : (this.settings.defaults.account || ""),
      show_account: old.show_account, notes: old.notes, reference: old.reference, job_id: old.job_id };
    return this.saveEstimate(est, old.items);
  }

  // Invoices made from this estimate so far (a deposit, stages, the whole),
  // and how much of its subtotal they cover.
  invoicesFrom(eid) {
    const e = this.data.estimates.find((x) => x.id === +eid);
    return this.data.invoices.filter((i) => i.from_estimate === +eid || (e && e.invoice_id === i.id && i.from_estimate == null))
      .map((i) => this.invoice(i.id));
  }

  invoicedFrom(eid) {
    return this.invoicesFrom(eid).reduce((s, i) => s + i.subtotal, 0n);
  }

  // The client said yes: an invoice dated today, due after the usual terms.
  //  mode "all":  the same lines and prices as the estimate
  //  mode "part": one line, a percentage or an amount of the estimate's subtotal (a deposit, a stage)
  //  mode "rest": one line, what's left of the subtotal after the invoices made from it so far
  // Tax is added on the invoice at the estimate's rate. The estimate is marked Accepted.
  async estimateToInvoice(eid, today = M.todayIso(), opts = {}) {
    if (typeof today === "object") { opts = today; today = M.todayIso(); }
    const est = this.estimate(eid);
    const word = this.estimateWord();
    const mode = opts.mode || "all";
    const days = +this.settings.defaults.terms_days || 0;
    let acc = this.account(est.account_id);
    if (!acc || acc.retired) acc = this.account(this.settings.defaults.account || "");
    let items = est.items.map((it) => { const x = { ...it }; delete x.cost; return x; });
    const done = this.invoicedFrom(eid);
    if (mode === "part") {
      const amt = opts.percent != null && opts.percent !== ""
        ? M.taxOf(est.subtotal, opts.percent) : M.cents(opts.amount || "0");
      const what = opts.description || (opts.percent != null && opts.percent !== ""
        ? `Payment of ${M.fmtQty(opts.percent)}% on ${word.toLowerCase()} ${est.number}` : `Payment on ${word.toLowerCase()} ${est.number}`);
      items = [{ description: what, quantity: "1", unit: "", unit_price: M.centsToText(amt) }];
    } else if (mode === "rest") {
      const left = est.subtotal - done;
      items = [{ description: opts.description || `Balance on ${word.toLowerCase()} ${est.number}: ` +
        `${M.fmt(est.subtotal, est.currency)}, less ${M.fmt(done, est.currency)} already invoiced`,
      quantity: "1", unit: "", unit_price: M.centsToText(left) }];
    }
    const iid = await this.saveInvoice({ number: this.nextNumber(), client_id: est.client_id, issue_date: today,
      due_date: days ? M.addDays(today, days) : "", currency: est.currency, tax_rate: est.tax_rate,
      tax_label: est.tax_label, account_id: (acc || {}).id || "", notes: this.settings.note || "",
      reference: est.reference || "", job_id: est.job_id, from_estimate: est.id }, items);
    const r = this.data.estimates.find((e) => e.id === +eid);
    r.status = "accepted";
    if (r.invoice_id == null) r.invoice_id = iid;
    await this.save();
    return iid;
  }

  estimateWord() { return this.settings.estimate_word === "Quotation" ? "Quotation" : "Estimate"; }

  // ---------------------------------------------------------- jobs and purchases
  // A job gathers the quotations, invoices and purchases for one piece of work.
  jobs() {
    return clone(this.data.jobs).sort((a, b) => (a.status === "done") - (b.status === "done") ||
      (b.created || "").localeCompare(a.created || "") || b.id - a.id);
  }

  job(jid) { const j = this.data.jobs.find((x) => x.id === +jid); return j ? clone(j) : null; }

  async saveJob(j) {
    const row = { name: (j.name || "").trim() || "Job", client_id: j.client_id == null || j.client_id === "" ? null : +j.client_id,
      status: j.status === "done" ? "done" : "open", notes: j.notes || "" };
    let id = j.id;
    if (id) Object.assign(this.data.jobs.find((x) => x.id === +id), row);
    else {
      id = this.nextIdOf(this.data.jobs);
      this.data.jobs.push({ id, ...row, created: new Date().toISOString().slice(0, 19) });
    }
    await this.save();
    return id;
  }

  // The job goes; its quotations, invoices and purchases stay, no longer in a job.
  async deleteJob(jid) {
    jid = +jid;
    for (const list of [this.data.estimates, this.data.invoices, this.data.purchases]) {
      for (const x of list) if (x.job_id === jid) x.job_id = null;
    }
    this.data.jobs = this.data.jobs.filter((j) => j.id !== jid);
    await this.save();
  }

  purchases(jobId) {
    return clone(this.data.purchases).filter((p) => jobId === undefined || p.job_id === (jobId == null ? null : +jobId))
      .sort((a, b) => (b.date || "").localeCompare(a.date || "") || b.id - a.id);
  }

  async savePurchase(p) {
    const row = { job_id: p.job_id == null || p.job_id === "" ? null : +p.job_id, date: p.date || M.todayIso(),
      supplier: (p.supplier || "").trim(), description: (p.description || "").trim(), category: (p.category || "").trim(),
      amount: M.centsToText(M.cents(p.amount || "0")), currency: p.currency || this.settings.defaults.currency || "GBP",
      note: (p.note || "").trim() };
    let id = p.id;
    if (id) Object.assign(this.data.purchases.find((x) => x.id === +id), row);
    else { id = this.nextIdOf(this.data.purchases); this.data.purchases.push({ id, ...row }); }
    await this.save();
    return id;
  }

  async deletePurchase(pid) {
    this.data.purchases = this.data.purchases.filter((p) => p.id !== +pid);
    await this.save();
  }

  // What a job's cost on its quotations (from the lines' costs), what was quoted,
  // invoiced, received and spent; each per currency (in pence).
  jobFigures(jid) {
    jid = +jid;
    const add = (o, c, v) => { o[c] = (o[c] || 0n) + v; };
    const f = { quoted: {}, estCost: {}, invoiced: {}, received: {}, spent: {}, owed: {} };
    const ests = this.estimates().filter((e) => e.job_id === jid && e.status !== "declined");
    const accepted = ests.filter((e) => e.status === "accepted");
    for (const e of accepted.length ? accepted : ests) {
      add(f.quoted, e.currency, e.subtotal);
      add(f.estCost, e.currency, e.items.reduce((s, it) => s + (it.cost ? M.lineAmount(it.quantity, it.cost) : 0n), 0n));
    }
    for (const i of this.invoices().filter((x) => x.job_id === jid)) {
      add(f.invoiced, i.currency, i.subtotal);
      // received, without the tax part, in proportion
      const net = i.total > 0n ? (i.paid * i.subtotal) / i.total : 0n;
      add(f.received, i.currency, i.paid > i.total ? i.subtotal : net);
      add(f.owed, i.currency, i.balance > 0n ? i.balance : 0n);
    }
    for (const p of this.data.purchases.filter((x) => x.job_id === jid)) add(f.spent, p.currency, M.cents(p.amount));
    return f;
  }

  // Purchases in the tax year, per currency and per category.
  purchaseSummary(year) {
    const [start, end] = M.taxYearSpan(year);
    const out = {};
    for (const p of this.data.purchases) {
      if (!p.date || p.date < start || p.date > end) continue;
      const o = out[p.currency] ||= { total: 0n, byCategory: {} };
      const v = M.cents(p.amount);
      o.total += v;
      o.byCategory[p.category || "Other"] = (o.byCategory[p.category || "Other"] || 0n) + v;
    }
    return out;
  }

  // Sent and not yet answered (nor expired): how many, and per currency.
  estimatesWaiting(today = M.todayIso()) {
    let n = 0;
    const amounts = {};
    for (const e of this.estimates()) {
      if (Store.estimateStatus(e, today) !== "Sent") continue;
      n++;
      amounts[e.currency] = (amounts[e.currency] || 0n) + e.total;
    }
    return { n, amounts };
  }

  pdfName(inv) {
    return safeFileName(`${inv.number} ${(inv.client || {}).name || ""}`) + ".pdf";
  }

  // ---------------------------------------------------------- figures
  // Per currency: invoiced (by issue date), received (by payment date) and
  // still owed, in the UK tax year starting 6 April <year>.
  yearSummary(year) {
    const [start, end] = M.taxYearSpan(year);
    const out = {};
    for (const inv of this.invoices()) {
      const cur = inv.currency;
      const s = out[cur] ||= { invoiced: 0n, received: 0n, owed: 0n, count: 0 };
      const d = inv.issue_date;
      if (d && d >= start && d <= end) {
        s.invoiced += inv.total;
        s.count++;
        if (inv.balance > 0n) s.owed += inv.balance;
      }
      for (const p of inv.payments) if (p.date >= start && p.date <= end) s.received += M.cents(p.amount);
    }
    return Object.fromEntries(Object.entries(out).filter(([, v]) => v.count || v.received));
  }

  // The four figures on the Dashboard, for a tax year (or all time when year is null).
  dashboard(year = null, today = M.todayIso()) {
    const span = year != null ? M.taxYearSpan(year) : null;
    const inside = (d) => !!d && (!span || (d >= span[0] && d <= span[1]));
    const out = { invoices: 0, outstanding: {}, collected: {}, overdue: 0, overdue_amount: {} };
    for (const inv of this.invoices()) {
      const cur = inv.currency;
      if (inside(inv.issue_date)) {
        out.invoices++;
        if (inv.balance > 0n) {
          out.outstanding[cur] = (out.outstanding[cur] || 0n) + inv.balance;
          if (Store.status(inv, today).includes("verdue")) {
            out.overdue++;
            out.overdue_amount[cur] = (out.overdue_amount[cur] || 0n) + inv.balance;
          }
        }
      }
      for (const p of inv.payments) if (inside(p.date)) out.collected[cur] = (out.collected[cur] || 0n) + M.cents(p.amount);
    }
    return out;
  }

  years() {
    const ys = new Set([...this.data.invoices.map((i) => i.issue_date), ...(this.data.purchases || []).map((p) => p.date)]
      .map((d) => M.taxYearOf(d)).filter((y) => y != null));
    ys.add(M.taxYearOf(M.todayIso()));
    return [...ys].sort((a, b) => b - a);
  }
}
