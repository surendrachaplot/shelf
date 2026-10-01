// background.js — three ways in, one thing done.
//
//   toolbar button      → save the tab you are on
//   keyboard shortcut   → the same (`_execute_action` IS a toolbar click)
//   right-click menu    → save the link you clicked, or the page; selected text
//                         goes along as `text`
//
// "Save" opens the shelf web app at /app/?url=…&text=…, in the shelf tab this
// extension opened last if it is still there, in a new tab if not.
//
// PERMISSIONS, and why each (manifest.json cannot carry comments):
//   activeTab     the toolbar click and the shortcut hand over `tab.url` for
//                 THAT tab, at THAT moment. Without it the URL is undefined.
//   contextMenus  the right-click item. It supplies linkUrl, pageUrl and
//                 selectionText by itself — no content script.
//   storage       the shelf address from the options page (`storage.local`),
//                 and the id of the shelf tab (`storage.session`, which must
//                 outlive this worker — the browser stops it after ~30 s).
//
// NOT asked for: `tabs`. It would let this find ANY open shelf tab by URL, and
// the price is the install prompt "Read your browsing history" on a product
// whose pitch is that it cannot read your things. `tabs.create`, `tabs.update`
// and `tabs.onUpdated` all work without it; only the `url` field is withheld.
// No host permissions, no content scripts, no network calls, no remote code.
import { DEFAULT_BASE, buildSaveUrl } from "./url.js";

// Firefox has `browser`, Chromium has `chrome`. Both return promises in MV3.
const api = globalThis.browser ?? globalThis.chrome;

const getBase = async () => (await api.storage.local.get("base")).base || DEFAULT_BASE;

// No popup, no notification permission: the reason goes where the person is
// already looking. Per-tab, so the browser clears it when the tab moves on.
async function refuse(tab, reason) {
  const where = tab?.id != null ? { tabId: tab.id } : {};
  await api.action.setBadgeBackgroundColor({ ...where, color: "#0A0A0A" });
  await api.action.setBadgeText({ ...where, text: "!" });
  await api.action.setTitle({ ...where, title: reason });
}

async function save(tab, url, text) {
  const built = buildSaveUrl(await getBase(), { url, text });
  if (!built.ok) return refuse(tab, built.reason);

  const { shelfTab } = await api.storage.session.get("shelfTab");
  if (shelfTab) {
    try {
      // `pending` goes down BEFORE the navigation, so the "loading" event it
      // causes is known to be ours even if it beats the promise back.
      await api.storage.session.set({ shelfTab: { id: shelfTab.id, pending: true } });
      const t = await api.tabs.update(shelfTab.id, { url: built.url, active: true });
      await api.windows.update(t.windowId, { focused: true });
      return;
    } catch (_) { /* the tab was closed — open a new one */ }
  }
  const t = await api.tabs.create({ url: built.url });
  await api.storage.session.set({ shelfTab: { id: t.id, pending: true } });
}

// WHY THIS LISTENER EXISTS. Without `tabs` this cannot ask "is tab 41 still
// on shelf?". If somebody opened their bank in the shelf tab, the next save
// would navigate the bank away. So the tab is tracked by its page loads:
//
//   we navigate it        pending = true
//   "loading"  + pending  that is our page arriving. Keep.
//   "complete" + pending  it arrived. pending = false.
//   "loading", no pending a load this extension did not start. The tab is no
//                         longer ours: forget it. The next save opens a new one.
//
// It errs toward a second shelf tab (a reload of the shelf tab also forgets
// it). NOT a timer: Chromium sends "loading" when the response arrives, not
// when the request leaves, and a sleeping Render service takes most of a
// minute to answer — a 2 s window forgot the tab every time (measured).
// ponytail: one hole. Type another address into the shelf tab WHILE shelf is
// still loading and that load counts as ours; the next save replaces that
// page (Back returns to it). Closing it needs the URL, so the `tabs`
// permission, or the web app answering the extension (externally_connectable,
// which wants the final domain). Do it with v2.
api.tabs.onUpdated.addListener(async (tabId, info) => {
  if (!info.status) return;
  const { shelfTab } = await api.storage.session.get("shelfTab");
  if (shelfTab?.id !== tabId) return;
  if (info.status === "complete") {
    if (shelfTab.pending) await api.storage.session.set({ shelfTab: { id: tabId, pending: false } });
  } else if (info.status === "loading" && !shelfTab.pending) {
    await api.storage.session.remove("shelfTab");
  }
});

// ponytail: the toolbar and the shortcut send the page and no selection —
// reading a selection there needs the `scripting` permission. The right-click
// menu already has it for free.
api.action.onClicked.addListener((tab) => save(tab, tab?.url, ""));

// onInstalled also fires on every update and every reload. If the item from
// last time is still registered, creating it again is a "duplicate id" error,
// so clear first. (A guard, not a fix for something seen: Chromium 151
// recorded no error without it.)
api.runtime.onInstalled.addListener(async () => {
  await api.contextMenus.removeAll();
  api.contextMenus.create({ id: "save", title: "Save to shelf", contexts: ["page", "link", "selection"] });
});

api.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "save") return;
  save(tab, info.linkUrl || info.pageUrl || tab?.url, info.selectionText);
});
