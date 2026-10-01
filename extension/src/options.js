// options.js — one field: where the shelf web app lives.
import { DEFAULT_BASE, normalizeBase } from "./url.js";

const api = globalThis.browser ?? globalThis.chrome;
const $ = (id) => document.getElementById(id);

const show = async () => { $("base").value = (await api.storage.local.get("base")).base || DEFAULT_BASE; };

$("save").addEventListener("click", async () => {
  const r = normalizeBase($("base").value);
  // A bad address is NOT stored. The old one stays in use, and the line says why.
  if (!r.ok) { $("status").textContent = r.reason; return; }
  await api.storage.local.set({ base: r.base });
  await show();
  $("status").textContent = "Saved.";
});

$("reset").addEventListener("click", async () => {
  await api.storage.local.remove("base");
  await show();
  $("status").textContent = "Saved.";
});

show();
