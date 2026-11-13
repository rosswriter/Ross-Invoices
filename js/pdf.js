// The invoice on paper: A4, in the two styles of the desktop program (pdf.py):
// "Classic (navy)" and "INV circles". The same drawing code makes the PDF
// (pdf-lib) and paints the preview (a canvas), measuring text the same way
// for both, so the preview is what the PDF will be.
import * as M from "./money.js";

export const A4_W = 595.28, A4_H = 841.89;
const MARGIN = 54.0, BOTTOM = 46.0;
const C = {
  ACCENT: "#1f3b57", LIGHT: "#eef1f4", MID: "#8a8f98", DARK: "#33383f", RED: "#b3261e", GREEN: "#1e7a34",
  WHITE: "#ffffff", BLACK: "#111111", ORANGE: "#f59a0c", GREY: "#a3a3a3", INK: "#1c1c1c", SOFT: "#6b6b6b",
  RULE: "#e4e4e4",
};
export const STYLES = [["classic", "Classic (navy)"], ["circles", "INV circles"]];
const CAP = 0.727;          // Inter's capital height, as a share of the size

// ------------------------------------------------------------------ fonts
const FILES = { regular: "Inter-Regular.ttf", semibold: "Inter-SemiBold.ttf", bold: "Inter-Bold.ttf",
  italic: "Inter-Italic.ttf" };
let FONTS = null;           // name -> {bytes, kit}

export async function loadFonts(base = "fonts/") {
  if (FONTS) return FONTS;
  const out = {};
  for (const [k, f] of Object.entries(FILES)) {
    const bytes = new Uint8Array(await (await fetch(base + f)).arrayBuffer());
    out[k] = { bytes, kit: window.fontkit.create(bytes) };
  }
  // the same faces for the canvas preview
  for (const [k, f] of Object.entries(FILES)) {
    const face = new FontFace("RIPdf-" + k, out[k].bytes.buffer.slice(0));
    await face.load();
    document.fonts.add(face);
  }
  FONTS = out;
  return out;
}

function widthOf(s, f) {
  if (!s) return 0;
  const kit = FONTS[f.w].kit;
  const run = kit.layout(String(s));
  let w = 0;
  for (const g of run.glyphs) w += g.advanceWidth;
  return w * f.size / kit.unitsPerEm;
}

const font = (size, w = "regular") => ({ size, w });

function hex(c) {
  const n = parseInt(c.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// ------------------------------------------------------------------ pens
class MeasurePen {
  constructor() { this.pages = 1; }
  width(s, f) { return widthOf(s, f); }
  text(x, y, s, f, color, align = "left") { return widthOf(s, f); }
  rect() {}
  line() {}
  ellipse() {}
  newPage() { this.pages++; }
}

class PdfPen extends MeasurePen {
  constructor(doc, embedded) {
    super();
    this.doc = doc;
    this.f = embedded;
    this.page = doc.addPage([A4_W, A4_H]);
  }
  col(c) { const [r, g, b] = hex(c); return window.PDFLib.rgb(r, g, b); }
  text(x, y, s, f, color = C.BLACK, align = "left") {
    s = String(s ?? "");
    const w = widthOf(s, f);
    if (align === "right") x -= w;
    else if (align === "centre") x -= w / 2;
    if (s) this.page.drawText(s, { x, y: A4_H - y, size: f.size, font: this.f[f.w], color: this.col(color) });
    return w;
  }
  rect(x, y, w, h, fill = null, stroke = null, line = 0.6) {
    const o = { x, y: A4_H - y - h, width: w, height: h };
    if (fill) o.color = this.col(fill);
    if (stroke) { o.borderColor = this.col(stroke); o.borderWidth = line; }
    this.page.drawRectangle(o);
  }
  line(x1, y1, x2, y2, color, width) {
    this.page.drawLine({ start: { x: x1, y: A4_H - y1 }, end: { x: x2, y: A4_H - y2 }, thickness: width,
      color: this.col(color) });
  }
  ellipse(x, y, w, h, fill) {
    this.page.drawEllipse({ x: x + w / 2, y: A4_H - y - h / 2, xScale: w / 2, yScale: h / 2, color: this.col(fill) });
  }
  newPage() { super.newPage(); this.page = this.doc.addPage([A4_W, A4_H]); }
}

class CanvasPen extends MeasurePen {
  constructor(zoom) {
    super();
    this.zoom = zoom;
    this.canvases = [];
    this.start();
  }
  start() {
    const c = document.createElement("canvas");
    c.width = Math.round(A4_W * this.zoom);
    c.height = Math.round(A4_H * this.zoom);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.scale(this.zoom, this.zoom);
    if ("fontKerning" in ctx) ctx.fontKerning = "none";
    ctx.textBaseline = "alphabetic";
    this.canvases.push(c);
    this.ctx = ctx;
  }
  text(x, y, s, f, color = C.BLACK, align = "left") {
    s = String(s ?? "");
    const w = widthOf(s, f);
    if (align === "right") x -= w;
    else if (align === "centre") x -= w / 2;
    this.ctx.font = `${f.size}px RIPdf-${f.w}`;
    this.ctx.fillStyle = color;
    this.ctx.fillText(s, x, y);
    return w;
  }
  rect(x, y, w, h, fill = null, stroke = null, line = 0.6) {
    if (fill) { this.ctx.fillStyle = fill; this.ctx.fillRect(x, y, w, h); }
    if (stroke) { this.ctx.strokeStyle = stroke; this.ctx.lineWidth = line; this.ctx.strokeRect(x, y, w, h); }
  }
  line(x1, y1, x2, y2, color, width) {
    const c = this.ctx;
    c.strokeStyle = color; c.lineWidth = width;
    c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
  }
  ellipse(x, y, w, h, fill) {
    const c = this.ctx;
    c.fillStyle = fill;
    c.beginPath(); c.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); c.fill();
  }
  newPage() { super.newPage(); this.start(); }
}

// ------------------------------------------------------------------ shared
// Lines of text no wider than width (keeping the writer's own line breaks).
export function wrap(text, f, width) {
  const out = [];
  for (const para of String(text || "").split("\n")) {
    let line = "";
    for (const w of para.split(" ")) {
      const trial = line ? line + " " + w : w;
      if (widthOf(trial, f) <= width || !line) {
        if (widthOf(trial, f) > width && !line) {
          // one very long word (a web address): break it by letters
          let chunk = "";
          for (const ch of w) {
            if (widthOf(chunk + ch, f) > width && chunk) { out.push(chunk); chunk = ""; }
            chunk += ch;
          }
          line = chunk;
        } else line = trial;
      } else {
        out.push(line);
        line = w;
      }
    }
    out.push(line);
  }
  return out;
}

function wordmarkParts(name) {
  const words = String(name || "").toUpperCase().split(/\s+/).filter(Boolean);
  return words.length ? [words[0], words.slice(1).join(" ")] : ["", ""];
}

// The payment block as [kind, value] pairs: heading, title, colon, dash, plain, gap.
export function accountLines(acc) {
  const out = [];
  if (!acc || !Object.keys(acc).length) return out;
  const style = acc.style || "dash";
  if (acc.heading) out.push(["heading", acc.heading]);
  if (acc.title) {
    if (out.length) out.push(["gap", ""]);
    out.push(["title", acc.title]);
    if (style === "colon") out.push(["gap", ""]);
  }
  for (let [label, value] of acc.lines || []) {
    label = (label || "").trim(); value = (value || "").trim();
    if (!label && !value) continue;
    if (!label) out.push(["plain", value]);
    else out.push([style === "colon" ? "colon" : "dash", [label, value]]);
  }
  return out;
}

function stampOf(inv, partCol) {
  if (inv.total > 0n && inv.balance <= 0n) return ["PAID", C.GREEN];
  if (inv.paid > 0n) return ["PART PAID", partCol];
  return ["UNPAID", C.RED];
}

const lineAmt = (it) => M.lineAmount(it.quantity, it.unit_price);

// ------------------------------------------------------------------ Classic (navy)
function paintClassic(pen, inv, s) {
  const cur = inv.currency || "GBP";
  const money = (a) => M.fmt(a, cur);
  const right = A4_W - MARGIN, width = A4_W - 2 * MARGIN;

  const top = MARGIN + 14;
  const [first, rest] = wordmarkParts(s.business.name);
  const w1 = pen.text(MARGIN, top, first, font(17, "bold"), C.ACCENT);
  const w2 = rest ? pen.text(MARGIN + w1 + 5, top, rest, font(17), C.BLACK) : -5;
  pen.line(MARGIN, top + 7, MARGIN + w1 + 5 + w2, top + 7, C.ACCENT, 1.8);
  const b = s.business;
  const addr = String(b.address || "").split("\n").filter((x) => x.trim());
  const contact = [b.email, b.phone, b.website].filter(Boolean).join("  |  ");
  if (contact) addr.push(contact);
  const f9 = font(8.6);
  const boxTop = top + 19;
  let boxBottom;
  if (addr.length) {
    const boxW = Math.max(185, Math.min(width * 0.55, Math.max(...addr.map((x) => pen.width(x, f9))) + 16));
    const boxH = 14 + 12.5 * addr.length;
    pen.rect(MARGIN, boxTop, boxW, boxH, null, C.MID, 0.6);
    let y = boxTop + 7 + 9;
    for (const x of addr) { pen.text(MARGIN + 8, y, x, f9, C.DARK); y += 12.5; }
    boxBottom = boxTop + boxH;
  } else boxBottom = top + 12;

  pen.text(right, MARGIN + 18, "INVOICE", font(24, "bold"), C.ACCENT, "right");
  const f10 = font(9.5);
  let my = MARGIN + 40;
  for (const m of [`Invoice no.: ${inv.number}`, `Issue date: ${M.longDate(inv.issue_date)}`,
    `Due date: ${M.longDate(inv.due_date) || "On receipt"}`]) {
    pen.text(right, my, m, f10, C.BLACK, "right");
    my += 15;
  }
  if (inv.show_stamp !== false) {
    const [stamp, col] = stampOf(inv, C.ACCENT);
    pen.text(right, my + 3, stamp, font(10.5, "bold"), col, "right");
    my += 15;
  }

  const c = inv.client || {};
  let y = Math.max(boxBottom, my) + 30;
  pen.text(MARGIN, y, "BILL TO", font(9.5, "bold"), C.MID);
  y += 17;
  pen.text(MARGIN, y, c.name || "", font(11, "bold"), C.BLACK);
  y += 14;
  for (const x of [...String(c.address || "").split("\n").filter((l) => l.trim()), ...[c.email, c.phone].filter(Boolean)]) {
    pen.text(MARGIN, y, x, f10, C.BLACK);
    y += 12.8;
  }
  y += 22;

  const colAmount = right - 6, colPrice = right - 92, colQty = colPrice - 80;
  const descW = colQty - 58 - (MARGIN + 6);
  const fh = font(8.6, "bold"), frow = font(9.5);
  const header = (y) => {
    pen.rect(MARGIN, y, width, 19, C.ACCENT);
    pen.text(MARGIN + 6, y + 13, "DESCRIPTION", fh, C.WHITE);
    pen.text(colQty, y + 13, "QTY", fh, C.WHITE, "right");
    pen.text(colPrice, y + 13, "UNIT PRICE", fh, C.WHITE, "right");
    pen.text(colAmount, y + 13, "AMOUNT", fh, C.WHITE, "right");
    return y + 19;
  };
  const nextPage = () => { pen.newPage(); return MARGIN; };

  y = header(y);
  let zebra = false;
  const limit = A4_H - BOTTOM - 22;
  for (const it of inv.items) {
    const lines = wrap(it.description, frow, descW);
    const rowH = Math.max(20, 8 + 12.6 * lines.length);
    if (y + rowH > limit) { y = header(nextPage()); zebra = false; }
    if (zebra) pen.rect(MARGIN, y, width, rowH, C.LIGHT);
    zebra = !zebra;
    let ly = y + 13.5;
    for (const ln of lines) { pen.text(MARGIN + 6, ly, ln, frow, C.BLACK); ly += 12.6; }
    const unit = (it.unit || "").trim();
    pen.text(colQty, y + 13.5, M.fmtQty(it.quantity) + (unit ? " " + unit : ""), frow, C.BLACK, "right");
    pen.text(colPrice, y + 13.5, money(it.unit_price), frow, C.BLACK, "right");
    pen.text(colAmount, y + 13.5, money(lineAmt(it)), frow, C.BLACK, "right");
    y += rowH;
  }
  pen.line(MARGIN, y, right, y, C.MID, 0.5);

  const labelX = colPrice - 34;
  const rows = [["Subtotal", inv.subtotal, false, C.BLACK]];
  if (M.units(inv.tax_rate || "0") !== 0n) {
    rows.push([`${inv.tax_label || "Tax"} (${M.fmtQty(inv.tax_rate)}%)`, inv.tax, false, C.BLACK]);
  }
  rows.push(["Total", inv.total, true, C.BLACK]);
  if (inv.paid !== 0n) rows.push(["Paid", inv.paid, false, C.GREEN]);
  const need = 22 + 17 * rows.length + 34;
  if (y + need > limit) y = nextPage();
  let ty = y + 22;
  for (const [label, val, bold, col] of rows) {
    const f = bold ? font(10, "bold") : font(9.5);
    pen.text(labelX, ty, label, f, col, "right");
    pen.text(colAmount, ty, money(val), f, col, "right");
    ty += 17;
  }
  const barTop = ty - 6, barX = labelX - 96;
  const barCol = inv.total > 0n && inv.balance <= 0n ? C.GREEN : C.ACCENT;
  pen.rect(barX, barTop, right - barX, 25, barCol);
  const fb = font(10.5, "bold");
  pen.text(barX + 8, barTop + 16.5, "Balance Due", fb, C.WHITE);
  pen.text(colAmount, barTop + 16.5, money(inv.balance), fb, C.WHITE, "right");
  y = barTop + 25;

  const block = accountLines(inv.account || {});
  const thanks = s.thanks || "";
  const note = String(inv.notes || "").trim();
  const fnote = font(8.6, "italic");
  const noteLines = note ? wrap(note, fnote, width) : [];
  const H = { heading: 17, title: 15, gap: 6, colon: 13.6, dash: 13.6, plain: 13.6 };
  const bh = block.reduce((h, [k]) => h + H[k], 0) + (thanks ? 26 : 0);
  const nh = 12 * noteLines.length + (noteLines.length ? 8 : 0);
  const footTop = A4_H - BOTTOM - 4;
  let wantTop = footTop - nh - bh - 6;
  if (y + 26 > wantTop) {
    if (y + 20 + bh + nh <= footTop) wantTop = y + 20;
    else { y = nextPage(); wantTop = MARGIN; }
  }
  let py = wantTop + 10;
  for (const [kind, val] of block) {
    if (kind === "heading") { pen.text(MARGIN, py, val.toUpperCase(), font(10, "bold"), C.ACCENT); py += 17; }
    else if (kind === "title") { pen.text(MARGIN, py, val, font(10, "bold"), C.BLACK); py += 15; }
    else if (kind === "gap") py += 6;
    else if (kind === "colon") {
      const w = pen.text(MARGIN, py, val[0].toUpperCase().replace(/:+$/, "") + ":", font(9.2, "semibold"), C.BLACK);
      pen.text(MARGIN + w + 4, py, val[1], font(9.2), C.BLACK);
      py += 13.6;
    } else if (kind === "dash") { pen.text(MARGIN, py, `${val[0]} – ${val[1]}`, font(9.5), C.BLACK); py += 13.6; }
    else { pen.text(MARGIN, py, val, font(9.5), C.BLACK); py += 13.6; }
  }
  if (thanks) { py += 12; pen.text(MARGIN, py, thanks, font(10, "bold"), C.BLACK); py += 14; }
  let ny = wantTop === MARGIN ? Math.max(footTop - nh + 8, py + 18) : footTop - nh + 8;
  for (const ln of noteLines) { pen.text(MARGIN, ny, ln, fnote, C.MID); ny += 12; }
}

function footerClassic(pen, inv, s, n, total) {
  let txt = `${s.business.name || ""} — Invoice ${inv.number}`;
  if (total > 1) txt += ` — page ${n} of ${total}`;
  pen.text(A4_W / 2, A4_H - 22, txt, font(7.5), C.MID, "centre");
}

// ------------------------------------------------------------------ INV circles
function paintCircles(pen, inv, s) {
  const cur = inv.currency || "GBP";
  const money = (a) => M.fmt(a, cur);
  const Mg = 40, right = A4_W - Mg, width = right - Mg;
  const f8 = font(8.4), fb = font(8.4, "bold");

  const d = 58, gap = 10, top = 42;
  const fc = font(28);
  [["I", C.GREY], ["N", C.ORANGE], ["V", C.GREY]].forEach(([ch, col], i) => {
    const x = Mg + i * (d + gap);
    pen.ellipse(x, top, d, d, col);
    pen.text(x + d / 2, top + d / 2 + fc.size * CAP / 2, ch, fc, C.WHITE, "centre");
  });

  const b = s.business;
  let y = top + d + 34;
  pen.text(Mg, y, b.name || "", font(22), C.INK);
  const addr = String(b.address || "").split("\n").filter((x) => x.trim());
  const contact = [b.phone, b.email, b.website].filter(Boolean);
  const ay = y + 22;
  const aw = Math.max(0, ...addr.map((x) => pen.width(x, f8)));
  const cx = Mg + Math.max(125, aw + 24);
  addr.forEach((x, k) => pen.text(Mg, ay + k * 11.5, x, f8, C.SOFT));
  contact.forEach((x, k) => pen.text(cx, ay + k * 11.5, x, f8, C.SOFT));
  const leftBottom = ay + 11.5 * Math.max(addr.length, contact.length, 1);

  const lx = right - 165;
  let my = top + d + 12;
  for (const [a, v] of [["Invoice #", inv.number], ["Date", M.longDate(inv.issue_date)],
    ["Due", M.longDate(inv.due_date) || "On receipt"]]) {
    pen.text(lx + 50, my, a, fb, C.INK, "right");
    pen.text(right - 6, my, v, f8, C.INK, "right");
    my += 13;
  }
  if (inv.show_stamp !== false) {
    const [stamp, col] = stampOf(inv, C.ORANGE);
    pen.text(right - 6, my + 2, stamp, font(9, "bold"), col, "right");
    my += 15;
  }
  my += 8;
  const c = inv.client || {};
  pen.text(lx + 50, my, "Bill to", fb, C.INK, "right");
  const bill = [c.name || "", ...String(c.address || "").split("\n").filter((l) => l.trim()),
    ...[c.email, c.phone].filter(Boolean)];
  const bw = right - 6 - (lx + 62);
  bill.forEach((x, k) => {
    const f = k === 0 ? fb : f8;
    for (const ln of wrap(x, f, bw)) { pen.text(right - 6, my, ln, f, C.INK, "right"); my += 11.5; }
  });
  y = Math.max(leftBottom, my) + 6;
  pen.line(Mg, y, right, y, C.RULE, 0.8);
  y += 18;

  const colAmount = right - 8, colPrice = right - 100, colQty = colPrice - 80;
  const descW = colQty - 50 - (Mg + 8);
  const fh = font(8.6, "bold"), frow = font(9);
  const header = (y) => {
    pen.rect(Mg, y, width, 20, C.ORANGE);
    pen.text(Mg + 8, y + 13.5, "Description", fh, C.WHITE);
    pen.text(colQty, y + 13.5, "Qty", fh, C.WHITE, "right");
    pen.text(colPrice, y + 13.5, "Rate", fh, C.WHITE, "right");
    pen.text(colAmount, y + 13.5, "Amount", fh, C.WHITE, "right");
    return y + 20;
  };
  const nextPage = () => { pen.newPage(); return MARGIN; };
  y = header(y);
  const limit = A4_H - BOTTOM - 22;
  for (const it of inv.items) {
    const lines = wrap(it.description, frow, descW);
    const rowH = Math.max(28, 16 + 12.4 * lines.length);
    if (y + rowH > limit) y = header(nextPage());
    let ly = y + 18;
    for (const ln of lines) { pen.text(Mg + 8, ly, ln, frow, C.INK); ly += 12.4; }
    const unit = (it.unit || "").trim();
    pen.text(colQty, y + 18, M.fmtQty(it.quantity) + (unit ? " " + unit : ""), frow, C.INK, "right");
    pen.text(colPrice, y + 18, money(it.unit_price), frow, C.INK, "right");
    pen.text(colAmount, y + 18, money(lineAmt(it)), frow, C.INK, "right");
    y += rowH;
    pen.line(Mg, y, right, y, C.RULE, 0.6);
  }

  const note = String(inv.notes || "").trim();
  const fnote = font(8.4);
  for (const ln of note ? wrap(note, fnote, width - 16) : []) {
    y += 14;
    if (y > limit) y = nextPage() + 14;
    pen.text(Mg + 8, y, ln, fnote, C.SOFT);
  }

  const rows = [["Subtotal", inv.subtotal, C.INK]];
  if (M.units(inv.tax_rate || "0") !== 0n) {
    rows.push([`${inv.tax_label || "Tax"} (${M.fmtQty(inv.tax_rate)}%)`, inv.tax, C.INK]);
  }
  if (inv.subtotal !== inv.total) rows.push(["Total", inv.total, C.INK]);
  if (inv.paid !== 0n) rows.push(["Paid", inv.paid, C.GREEN]);
  const need = 30 + 15 * rows.length + 30;
  if (y + need > limit) y = nextPage();
  let ty = y + 30;
  for (const [label, val, col] of rows) {
    pen.text(colPrice, ty, label, font(8.8), C.SOFT, "right");
    pen.text(colAmount, ty, money(val), f8, col, "right");
    ty += 15;
  }
  const barTop = ty, barX = colQty - 50;
  const barCol = inv.total > 0n && inv.balance <= 0n ? C.GREEN : C.INK;
  pen.rect(barX, barTop, right - barX, 24, barCol);
  pen.text(barX + 10, barTop + 16, "Balance Due", font(11), C.WHITE);
  pen.text(colAmount, barTop + 16, money(inv.balance), font(11, "semibold"), C.WHITE, "right");
  y = barTop + 24;

  const block = accountLines(inv.account || {});
  if (block.length && block[0][0] !== "heading") block.unshift(["heading", "Payment info"]);
  const thanks = s.thanks || "";
  const H = { heading: 20, title: 13, gap: 9, colon: 12, dash: 12, plain: 12 };
  const bh = block.reduce((h, [k]) => h + H[k], 0) + (thanks ? 24 : 0);
  const footTop = A4_H - BOTTOM - 4;
  let wantTop = footTop - bh;
  if (y + 30 > wantTop) {
    if (y + 30 + bh <= footTop) wantTop = y + 30;
    else { y = nextPage(); wantTop = MARGIN; }
  }
  let py = wantTop + 10;
  for (const [kind, val] of block) {
    if (kind === "heading") {
      pen.ellipse(Mg, py - 9, 11, 11, C.ORANGE);
      pen.text(Mg + 17, py, val.toUpperCase(), font(10, "bold"), C.INK);
      py += 20;
    } else if (kind === "title") { pen.text(Mg, py, val, fb, C.INK); py += 13; }
    else if (kind === "gap") py += 9;
    else if (kind === "colon") { pen.text(Mg, py, `${val[0].replace(/:+$/, "")}: ${val[1]}`, f8, C.SOFT); py += 12; }
    else if (kind === "dash") { pen.text(Mg, py, `${val[0]} – ${val[1]}`, f8, C.SOFT); py += 12; }
    else { pen.text(Mg, py, val, f8, C.SOFT); py += 12; }
  }
  if (thanks) { py += 12; pen.text(Mg, py, thanks, font(9.5, "bold"), C.INK); }
}

function footerCircles(pen, inv, s, n, total) {
  pen.text(A4_W / 2, A4_H - 22, `${n} / ${total}`, font(7.5), C.GREY, "centre");
}

// ------------------------------------------------------------------ making it
function styleOf(s) {
  return s.style === "circles" ? [paintCircles, footerCircles] : [paintClassic, footerClassic];
}

// Run the layout through a pen, with the footers on every page.
function run(pen, inv, s) {
  const [paint, footer] = styleOf(s);
  const m = new MeasurePen();
  paint(m, inv, s);
  const total = m.pages;
  const orig = pen.newPage.bind(pen);
  let n = 1;
  pen.newPage = () => { footer(pen, inv, s, n, total); orig(); n++; };
  paint(pen, inv, s);
  footer(pen, inv, s, n, total);
  return total;
}

export function countPages(inv, s) {
  const m = new MeasurePen();
  styleOf(s)[0](m, inv, s);
  return m.pages;
}

// The invoice as PDF bytes.
export async function makePdf(inv, s) {
  await loadFonts();
  const { PDFDocument } = window.PDFLib;
  const doc = await PDFDocument.create();
  doc.registerFontkit(window.fontkit);
  const emb = {};
  for (const [k, f] of Object.entries(FONTS)) emb[k] = await doc.embedFont(f.bytes, { subset: true });
  doc.setTitle(`Invoice ${inv.number}`);
  doc.setAuthor(s.business.name || "");
  doc.setCreator("Ross Invoices");
  doc.setProducer("Ross Invoices (web)");
  run(new PdfPen(doc, emb), inv, s);
  return doc.save();
}

// The pages as canvases, for the preview.
export async function renderPages(inv, s, zoom = 1.5) {
  await loadFonts();
  const pen = new CanvasPen(zoom);
  run(pen, inv, s);
  return pen.canvases;
}
