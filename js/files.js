// Getting files in and out of the app.
//   PDFs: straight into a folder you choose once (Chrome on Android and on
//   computers), one folder per year as on the desktop; otherwise Download.
//   Share: Android's Share sheet, with the PDF attached (Gmail, WhatsApp…).
//   Opening a file (an import): the system's file picker.

export const canPickFolder = typeof window.showDirectoryPicker === "function";

export function canShareFiles() {
  try {
    const f = new File([new Uint8Array(1)], "x.pdf", { type: "application/pdf" });
    return !!(navigator.canShare && navigator.canShare({ files: [f] }));
  } catch (e) { return false; }
}

// ---------------------------------------------------------------- the PDF folder
export async function folderHandle(store) {
  return canPickFolder ? (await store.kvGet("pdfFolder")) || null : null;
}

export async function chooseFolder(store) {
  const h = await window.showDirectoryPicker({ id: "ross-invoices", mode: "readwrite", startIn: "documents" });
  await store.kvSet("pdfFolder", h);
  return h;
}

export async function forgetFolder(store) {
  await store.kvSet("pdfFolder", null);
}

// Chrome asks again for permission now and then (it must be from a tap).
async function allowed(h) {
  const opts = { mode: "readwrite" };
  if ((await h.queryPermission(opts)) === "granted") return true;
  return (await h.requestPermission(opts)) === "granted";
}

// Save bytes as name: into the chosen folder (in a year folder) if there is
// one, or as a download. Returns where it went, in words.
export async function savePdf(store, bytes, name, year) {
  const h = await folderHandle(store);
  if (h) {
    try {
      if (await allowed(h)) {
        const dir = year ? await h.getDirectoryHandle(String(year), { create: true }) : h;
        const fh = await dir.getFileHandle(name, { create: true });
        const w = await fh.createWritable();
        await w.write(new Blob([bytes], { type: "application/pdf" }));
        await w.close();
        return `Saved in ${h.name}${year ? "/" + year : ""}: ${name}`;
      }
    } catch (e) {
      if (e && e.name === "AbortError") throw e;
      console.warn("folder save failed", e);
    }
  }
  download(bytes, name, "application/pdf");
  return `Downloaded: ${name} (in your Downloads)`;
}

export function download(bytes, name, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export async function sharePdf(bytes, name, title, text) {
  const file = new File([bytes], name, { type: "application/pdf" });
  await navigator.share({ files: [file], title, text });
}

// A file chosen by the person (an import).
export function pickFile(accept = ".json,application/json") {
  return new Promise((ok) => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = accept;
    inp.onchange = () => ok(inp.files && inp.files[0] ? inp.files[0] : null);
    inp.click();
  });
}

export async function readJson(file) {
  return JSON.parse(await file.text());
}

export function saveJson(obj, name) {
  download(new TextEncoder().encode(JSON.stringify(obj, null, 2)), name, "application/json");
}
