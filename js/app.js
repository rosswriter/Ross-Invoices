// Ross Invoices on the web: opens the store on this device and shows the pages.
import { Store } from "./store.js";
import { start, toast } from "./ui.js";

async function main() {
  if (!window.indexedDB) {
    document.getElementById("main").textContent = "This browser can't keep data, so Ross Invoices can't run here.";
    return;
  }
  const st = await new Store().open();
  window.__store = st;
  await start(st);
  window.__ready = true;
}

main().catch((e) => {
  console.error(e);
  document.getElementById("main").textContent = "Ross Invoices couldn't start: " + (e.message || e);
});

// Offline: the service worker keeps a copy of the app.
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").then((reg) => {
    reg.addEventListener("updatefound", () => {
      const nw = reg.installing;
      nw && nw.addEventListener("statechange", () => {
        if (nw.state === "installed" && navigator.serviceWorker.controller) {
          toast("A new version of Ross Invoices is ready: it starts the next time you open the app.", 9000);
        }
      });
    });
  }).catch((e) => console.warn("service worker", e));
}
