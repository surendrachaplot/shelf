// Render every screen at every width, in both schemes, and write PNGs.
// This is DESIGN-RULES §0.2 — "render it and look at it" — as far as a Linux
// box can take it: react-native-web running the real components with the real
// styles, in Chromium. It is not iOS: fonts, emoji rasterisation and the
// native scroll/blur are different. It IS the real layout, the real palette,
// the real type scale and the real wrapping behaviour, which is where the
// defects that matter actually live.
import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const URLBASE = "file://" + fileURLToPath(new URL("./index.html", import.meta.url));
const OUT = fileURLToPath(new URL("./shots/", import.meta.url));
await mkdir(OUT, { recursive: true });

const SHOTS = [
  { name: "app-375-light", q: "", w: 375, h: 980, scheme: "light" },
  { name: "app-375-dark", q: "", w: 375, h: 980, scheme: "dark" },
  { name: "app-320-light", q: "", w: 320, h: 900, scheme: "light" },
  { name: "app-restaurants-375-light", q: "", w: 375, h: 980, scheme: "light", clickLabel: "Restaurants," },
  // The pile, at both widths and in both schemes, because it now holds the row
  // that was reported broken: a reel Instagram gave us no caption for. An
  // explanation you have not looked at is a paragraph, not an explanation.
  { name: "app-inbox-375-light", q: "", w: 375, h: 980, scheme: "light", clickLabel: "Not shelved," },
  { name: "app-inbox-375-dark", q: "", w: 375, h: 980, scheme: "dark", clickLabel: "Not shelved," },
  { name: "app-inbox-320-light", q: "", w: 320, h: 900, scheme: "light", clickLabel: "Not shelved," },
  { name: "app-recipes-375-dark", q: "", w: 375, h: 980, scheme: "dark", clickLabel: "Recipes," },
  // Tapping a jacket. The detail panel is the same two colours and the same
  // composition language at full size, so opening one reads as a zoom.
  { name: "app-detail-375-light", q: "", w: 375, h: 980, scheme: "light", clickLabel: "Restaurants,", click: "St. John" },
  { name: "app-detail-375-dark", q: "", w: 375, h: 980, scheme: "dark", clickLabel: "Restaurants,", click: "St. John" },
  // The same panel with a frame off the reel — the two cases the field has to
  // hold, and the only way to see whether the empty one is composed or unfinished.
  // By LABEL, not by text: a jacket showing artwork has no text node at all,
  // which is exactly why getByText timed out here the first time.
  { name: "app-detail-art-375-light", q: "", w: 375, h: 980, scheme: "light", clickLabel: "Piranesi, Susanna Clarke" },
  // The three new destinations, plus the two states that only exist on a
  // first run or with a provider switched off — neither is reachable by
  // poking a live server, and both have real copy that needs looking at.
  { name: "app-add-375-light", q: "", w: 375, h: 980, scheme: "light", clickLabel: "Add something by name", type: ["piranesi"] },
  { name: "app-add-375-dark", q: "", w: 375, h: 980, scheme: "dark", clickLabel: "Add something by name", type: ["piranesi"] },
  { name: "app-add-empty-375-light", q: "", w: 375, h: 980, scheme: "light", clickLabel: "Add something by name" },
  { name: "app-profile-375-light", q: "", w: 375, h: 980, scheme: "light", clickLabel: "Your card" },
  { name: "app-profile-375-dark", q: "", w: 375, h: 980, scheme: "dark", clickLabel: "Your card" },
  { name: "app-profile-new-375-light", q: "?blankProfile=1", w: 375, h: 980, scheme: "light", clickLabel: "Your card" },
  { name: "app-received-375-light", q: "", w: 375, h: 980, scheme: "light", clickLabel: "2 sent to you" },
  { name: "app-share-375-light", q: "", w: 375, h: 980, scheme: "light", clickLabel: "Share the Books shelf" },
  { name: "app-share-375-dark", q: "", w: 375, h: 980, scheme: "dark", clickLabel: "Share the Books shelf" },
  { name: "app-profile-320-light", q: "", w: 320, h: 900, scheme: "light", clickLabel: "Your card" },
  { name: "app-add-320-light", q: "", w: 320, h: 900, scheme: "light", clickLabel: "Add something by name", type: ["piranesi"] },
  // The card with the plumbing broken — the sentence somebody reads when
  // sharing from Instagram silently does nothing. It has to be legible and it
  // has to say what to do.
  { name: "app-profile-broken-375-light", q: "?keychain=0", w: 375, h: 980, scheme: "light", clickLabel: "Your card" },
  { name: "pair-375-light", q: "?paired=0", w: 375, h: 980, scheme: "light" },
  { name: "pair-claim-375-light", q: "?paired=0&unclaimed=1", w: 375, h: 980, scheme: "light" },
  // Launch against a server that is still waking. This screen used to be an
  // indefinite spinner under the wordmark — indistinguishable from the splash,
  // and reported as "it is stuck on the splash screen".
  { name: "pair-waking-375-light", q: "?paired=0&asleep=1", w: 375, h: 980, scheme: "light" },
  { name: "share-375-light", q: "?screen=share", w: 375, h: 420, scheme: "light" },
  { name: "share-375-dark", q: "?screen=share", w: 375, h: 420, scheme: "dark" },
  { name: "share-320-light", q: "?screen=share", w: 320, h: 420, scheme: "light" },
  { name: "share-done-375-light", q: "?screen=share", w: 375, h: 420, scheme: "light", click: "Restaurants" },
];

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
for (const s of SHOTS) {
  const ctx = await browser.newContext({
    viewport: { width: s.w, height: s.h },
    deviceScaleFactor: 2,
    colorScheme: s.scheme,
  });
  const page = await ctx.newPage();
  const errors = [];
  const blessed = new Set();
  page.on("pageerror", (e) => errors.push(String(e)));
  // The message text does not name the URL, so filter at the request instead.
  page.on("requestfailed", (r) => { if (/broken\.invalid/.test(r.url())) blessed.add(r.url()); });
  // `broken.invalid` is a FIXTURE: it exists to 404 so the designed image
  // fallback renders. Its failure is the check passing, so counting it as an
  // error would make the harness red exactly when the thing under test works.
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    // A resource error whose only failed request was the fixture is the
    // fallback working, not a defect. Anything else still counts.
    if (/Failed to load resource/.test(m.text()) && blessed.size) return;
    errors.push(m.text());
  });
  await page.goto(URLBASE + s.q);
  await page.waitForTimeout(700);        // let the entrance stagger finish
  if (s.scroll) {
    // RNW's ScrollView is an overflow div, not the window — scrolling the
    // window here silently does nothing and you screenshot the top twice.
    await page.evaluate((y) => {
      const el = [...document.querySelectorAll("div")].find((d) => d.scrollHeight > d.clientHeight + 40);
      if (!el) throw new Error("no scrollable container found");
      el.scrollTop = y;
    }, s.scroll);
    await page.waitForTimeout(200);
  }
  // Both, in order: reaching a jacket that is not on the default shelf takes
  // two taps — pick the list, then pick the thing.
  for (const step of [s.clickLabel && ["label", s.clickLabel], s.click && ["text", s.click]].filter(Boolean)) {
    const target = step[0] === "label"
      ? page.getByLabel(step[1], { exact: false })
      : page.getByText(step[1], { exact: false });
    await target.first().click();
    await page.waitForTimeout(600);      // and the transition after the tap
  }
  for (const text of s.type ?? []) {
    await page.keyboard.type(text, { delay: 12 });
    // Past the debounce, the round trip, AND the broken-image onError — a
    // shot taken before the 404 lands shows an empty box instead of the
    // designed fallback, which is the opposite of what it is there to prove.
    await page.waitForTimeout(1400);
  }
  await page.screenshot({ path: OUT + s.name + ".png" });
  console.log(`${errors.length ? "ERR " : "ok  "} ${s.name}${errors.length ? "  " + errors.slice(0, 2).join(" | ") : ""}`);
  await ctx.close();
}
await browser.close();
