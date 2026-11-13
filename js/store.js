// Where everything is kept: in this browser, on this device (IndexedDB), never
// on a server. The shape of the data is the same as the desktop program's
// "Export for Tablet" file, so the two can be swapped either way.
import * as M from "./money.js";

export const FORMAT = "ross-invoices-data";
export const KEEP_BACKUPS = 30;

export const DEFAULT_SETTINGS = {
  business: { name: "Jacob Ross", address: "", email: "", phone: "", website: "" },
  numbering: { prefix: "INV-", next: 1, digits: 4 },
  defaults: { currency: "GBP", terms_days: 30, tax_rate: "0", tax_label: "VAT", account: "" },
  thanks: "THANK YOU",
  note: "Thank you for your business.",
  accounts: [],
  style: "classic",
};

const clone = (x) => JSON.parse(JSON.stringify(x));

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
const DB_NAME = "ross-invoices";

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
    return { format: FORMAT, version: 1, settings: clone(DEFAULT_SETTINGS), clients: [], services: [], invoices: [] };
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
    const out = { format: FORMAT, version: 1, settings: s, clients: [], services: [], invoices: [] };
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
        items: (i.items || []).map((x) => ({ description: x.description || "", quantity: String(x.quantity ?? "1"),
          unit: x.unit || "", unit_price: String(x.unit_price ?? "0") })),
        payments: (i.payments || []).map((p, k) => ({ id: +(p.id ?? k + 1), amount: String(p.amount), date: p.date,
          method: p.method || "", note: p.note || "" })),
      });
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
    if (!d || typeof d !== "object") return "That file isn't Ross Invoices data.";
    if (d.format !== FORMAT) {
      if (Array.isArray(d.accounts) || Array.isArray(d)) return "accounts";
      return "That file isn't Ross Invoices data (from Export for Tablet, or Export on this app).";
    }
    return "";
  }

  // Everything here is replaced by the file (a copy of what was here is kept first).
  async importData(d) {
    await tx(this.db, "backups", "readwrite", (s) => s.put(clone(this.data), "before-import-" +
      new Date().toISOString().slice(0, 16).replace(":", "")));
    this.data = Store.normalise(d);
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
  formatNumber(n) {
    const nb = this.settings.numbering;
    return (nb.prefix || "") + String(n).padStart(Math.max(1, +nb.digits || 1), "0");
  }

  nextNumber() {
    let n = Math.max(1, +this.settings.numbering.next || 1);
    while (this.numberTaken(this.formatNumber(n))) n++;
    return this.formatNumber(n);
  }

  numberTaken(number, exceptId = null) {
    const r = this.data.invoices.find((i) => i.number === number);
    return !!r && r.id !== exceptId;
  }

  advanceNumbering(number) {
    const nb = this.settings.numbering;
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
    };
    if (this.numberTaken(row.number, inv.id || null)) throw new Error(`There is already an invoice numbered ${row.number}.`);
    row.items = items.filter((it) => (it.description || "").trim()).map((it) => ({
      description: it.description.trim(), quantity: M.fmtQty(it.quantity || "0"), unit: it.unit || "",
      unit_price: M.fmtQty(it.unit_price || "0") }));
    let id = inv.id;
    if (id) {
      const old = this.data.invoices.find((i) => i.id === id);
      Object.assign(old, row);
    } else {
      id = this.nextIdOf(this.data.invoices);
      row.id = id;
      row.created = new Date().toISOString().slice(0, 19);
      row.payments = [];
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
      account_id: acc && !acc.retired ? old.account_id : (this.settings.defaults.account || ""), notes: old.notes };
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
    const ys = new Set(this.data.invoices.map((i) => M.taxYearOf(i.issue_date)).filter((y) => y != null));
    ys.add(M.taxYearOf(M.todayIso()));
    return [...ys].sort((a, b) => b - a);
  }
}
