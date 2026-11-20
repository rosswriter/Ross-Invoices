// RossDraft 1.4: a research PDF shown in the page's place (PDF.js 5.4, vendor/pdfjs: fetched the first time it's
// needed, then kept for use offline). Its pages are drawn as they scroll into view; − / + / Fit Width zoom;
// Share (or Save) hands the PDF to another app. The PDF itself is only read.

let pdfjs = null;
async function lib() {
  if (pdfjs) return pdfjs;
  pdfjs = await import("../vendor/pdfjs/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("../vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href;
  return pdfjs;
}

// box: an element to fill; file: the PDF (a File); actions: { share(file) }. Returns { destroy, doc }.
export async function showPdf(box, file, actions = {}) {
  const L = await lib();
  box.textContent = "";
  box.classList.add("pdfview");
  const bar = document.createElement("div");
  bar.className = "pdfbar";
  const pages = document.createElement("div");
  pages.className = "pdfpages";
  box.append(bar, pages);
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await L.getDocument({ data, standardFontDataUrl: new URL("../vendor/pdfjs/standard_fonts/", import.meta.url).href,
    isEvalSupported: false }).promise;
  let zoom = 0;            // 0: the width of the view
  const info = document.createElement("span");
  info.className = "pdfinfo";
  info.textContent = `${file.name} · ${doc.numPages} page${doc.numPages === 1 ? "" : "s"}`;
  const btn = (label, title, fn) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.title = title;
    b.onclick = fn;
    bar.appendChild(b);
    return b;
  };
  bar.appendChild(info);
  btn("−", "Smaller", () => setZoom((zoom || fitScale()) / 1.2));
  btn("+", "Larger", () => setZoom((zoom || fitScale()) * 1.2));
  btn("Fit Width", "The page as wide as the view", () => setZoom(0));
  if (actions.share) btn(navigator.canShare && navigator.canShare({ files: [file] }) ? "Share…" : "Save a Copy…", "Open it in another app, or keep a copy", () => actions.share(file));
  const first = await doc.getPage(1);
  const base = first.getViewport({ scale: 1 });
  const fitScale = () => Math.max(0.2, (pages.clientWidth - 24) / base.width);
  const slots = [];
  for (let k = 1; k <= doc.numPages; k++) {
    const s = document.createElement("div");
    s.className = "pdfpage";
    s.dataset.n = k;
    const c = document.createElement("canvas");
    s.appendChild(c);
    pages.appendChild(s);
    slots.push(s);
  }
  const drawn = new Map();       // page number -> scale drawn at
  const tasks = new Map();
  const size = () => {
    const sc = zoom || fitScale();
    for (const s of slots) { s.style.width = Math.floor(base.width * sc) + "px"; s.style.height = Math.floor(base.height * sc) + "px"; }
    return sc;
  };
  const draw = async (s) => {
    const k = +s.dataset.n, sc = zoom || fitScale();
    if (drawn.get(k) === sc) return;
    drawn.set(k, sc);
    if (tasks.get(k)) { try { tasks.get(k).cancel(); } catch (e) { /* done */ } }
    const page = await doc.getPage(k);
    const vp = page.getViewport({ scale: sc * (window.devicePixelRatio || 1) });
    const c = s.querySelector("canvas");
    c.width = Math.floor(vp.width);
    c.height = Math.floor(vp.height);
    c.style.width = "100%";
    c.style.height = "100%";
    const t = page.render({ canvas: c, canvasContext: c.getContext("2d"), viewport: vp });
    tasks.set(k, t);
    try { await t.promise; } catch (e) { drawn.delete(k); }
  };
  const io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) draw(e.target); }, { root: box.closest(".scroller") || null, rootMargin: "600px 0px" });
  const setZoom = (z) => {
    zoom = z && Math.abs(z - fitScale()) > 0.01 ? Math.min(6, Math.max(0.2, z)) : 0;
    size();
    for (const s of slots) { io.unobserve(s); io.observe(s); }
  };
  size();
  for (const s of slots) io.observe(s);
  const ro = new ResizeObserver(() => { if (!zoom) setZoom(0); });
  ro.observe(pages);
  return {
    doc,
    destroy() { io.disconnect(); ro.disconnect(); try { doc.destroy(); } catch (e) { /* gone */ } box.textContent = ""; box.classList.remove("pdfview"); },
  };
}
