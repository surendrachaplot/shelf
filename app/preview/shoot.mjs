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
  // The two new shelves. Quotes are the hard one: the jacket IS the text, so
  // this is the only way to know whether a wall of them is readable or a wall
  // of grey. Travel has to show a place that IS on the map and one that is not.
  { name: "app-quotes-375-light", q: "", w: 375, h: 980, scheme: "light", clickLabel: "Quotes," },
  { name: "app-quotes-375-dark", q: "", w: 375, h: 980, scheme: "dark", clickLabel: "Quotes," },
  { name: "app-quotes-320-light", q: "", w: 320, h: 900, scheme: "light", clickLabel: "Quotes," },
  { name: "app-places-375-light", q: "", w: 375, h: 980, scheme: "light", clickLabel: "Places," },
  { name: "app-places-unlocated-375-light", q: "", w: 375, h: 980, scheme: "light", clickLabel: ["Places,", "Praia da Ursa"], scroll: 500 },
  { name: "app-recipes-375-dark", q: "", w: 375, h: 980, scheme: "dark", clickLabel: "Recipes," },
  // Tapping a jacket. The detail panel is the same two colours and the same
  // composition language at full size, so opening one reads as a zoom.
  { name: "app-detail-375-light", q: "", w: 375, h: 980, scheme: "light", clickLabel: ["Restaurants,", "St. John"] },
  { name: "app-detail-375-dark", q: "", w: 375, h: 980, scheme: "dark", clickLabel: ["Restaurants,", "St. John"] },
  // The same panel with a frame off the reel — the two cases the field has to
  // hold, and the only way to see whether the empty one is composed or unfinished.
  // By LABEL, not by text: a jacket showing artwork has no text node at all,
  // which is exactly why getByText timed out here the first time.
  { name: "app-detail-art-375-light", q: "", w: 375, h: 980, scheme: "light", clickLabel: "Piranesi, Susanna Clarke" },
  // The catalogue block, per list. A trailer link, a runtime, an opening line,
  // a set of opening hours — all of it renders empty unless the fixture has
  // it, which is how a whole panel ships unlooked-at.
  { name: "app-facts-movie-375-light", q: "", w: 375, h: 980, scheme: "light", clickLabel: ["Movies,", "Sinners"], scroll: 520 },
  { name: "app-facts-movie-375-dark", q: "", w: 375, h: 980, scheme: "dark", clickLabel: ["Movies,", "Sinners"], scroll: 520 },
  // Scrolled past the table to the LINKS — a trailer button nobody has looked
  // at is the whole feature, unverified.
  { name: "app-facts-links-375-light", q: "", w: 375, h: 980, scheme: "light", clickLabel: ["Movies,", "Sinners"], scroll: 900 },
  { name: "app-facts-book-375-light", q: "", w: 375, h: 980, scheme: "light", clickLabel: "Piranesi, Susanna Clarke", scroll: 520 },
  { name: "app-facts-place-375-light", q: "", w: 375, h: 980, scheme: "light", clickLabel: ["Restaurants,", "St. John, Peckham"], scroll: 420 },
  { name: "app-facts-recipe-320-light", q: "", w: 320, h: 900, scheme: "light", clickLabel: ["Recipes,", "Lemon dal"], scroll: 420 },
  // The three new destinations, plus the two states that only exist on a
  // first run or with a provider switched off — neither is reachable by
  // poking a live server, and both have real copy that needs looking at.
  { name: "app-add-375-light", q: "", w: 375, h: 980, scheme: "light", clickLabel: "Add something by name", type: ["piranesi"] },
  { name: "app-add-375-dark", q: "", w: 375, h: 980, scheme: "dark", clickLabel: "Add something by name", type: ["piranesi"] },
  { name: "app-add-empty-375-light", q: "", w: 375, h: 980, scheme: "light", clickLabel: "Add something by name" },
  { name: "app-profile-375-light", q: "", w: 375, h: 980, scheme: "light", clickLabel: "Your card" },
  { name: "app-profile-375-dark", q: "", w: 375, h: 980, scheme: "dark", clickLabel: "Your card" },
  { name: "app-profile-new-375-light", q: "?blankProfile=1", w: 375, h: 980, scheme: "light", clickLabel: "Your card" },
  { name: "app-share-375-light", q: "", w: 375, h: 980, scheme: "light", clickLabel: "Share the Books shelf" },
  { name: "app-share-375-dark", q: "", w: 375, h: 980, scheme: "dark", clickLabel: "Share the Books shelf" },
  { name: "app-profile-320-light", q: "", w: 320, h: 900, scheme: "light", clickLabel: "Your card" },
  { name: "app-add-320-light", q: "", w: 320, h: 900, scheme: "light", clickLabel: "Add something by name", type: ["piranesi"] },
  // The card with the plumbing broken — the sentence somebody reads when
  // sharing from Instagram silently does nothing. It has to be legible and it
  // has to say what to do.
  { name: "app-profile-broken-375-light", q: "?keychain=0", w: 375, h: 980, scheme: "light", clickLabel: "Your card" },
  // THE SHELF THAT WOULD NOT OPEN. Reported from a phone as "WTF there is
  // nothing on my shelf now?" — because a read failure and a first launch drew
  // the same empty boards and neither of them said a word. This frame is the
  // point of the fix: what happened, in bytes, and the way back.
  { name: "app-unreadable-375-light", q: "?broken=1", w: 375, h: 980, scheme: "light" },
  { name: "app-unreadable-375-dark", q: "?broken=1", w: 375, h: 980, scheme: "dark" },
  // There is no pairing screen any more, so there is nothing to shoot: the app
  // opens onto your shelves. The three shots that used to live here — a code
  // field, a claim button, and "waking the server" — went with the accounts.
  // Launch against a server that is still waking. This screen used to be an
  // indefinite spinner under the wordmark — indistinguishable from the splash,
  // and reported as "it is stuck on the splash screen".
  { name: "share-375-light", q: "?screen=share", w: 375, h: 420, scheme: "light" },
  { name: "share-375-dark", q: "?screen=share", w: 375, h: 420, scheme: "dark" },
  { name: "share-320-light", q: "?screen=share", w: 320, h: 420, scheme: "light" },
  { name: "share-done-375-light", q: "?screen=share", w: 375, h: 420, scheme: "light", click: "Restaurants" },
  // THE ANDROID SHARE, at Android sizes. There is no extension and no 420pt
  // sheet: ACTION_SEND opens the app, so the same boards fill the screen. Six
  // bands over ~800pt is a different composition from six over 420 — the bands
  // stretch, and whether that reads as a shelf unit or as six stripes is only
  // answerable by looking. 412×915 is a Pixel; 360×800 is the small Android
  // that most cheap phones actually are.
  { name: "android-share-412-light", q: "?screen=android-share", w: 412, h: 915, scheme: "light" },
  { name: "android-share-412-dark", q: "?screen=android-share", w: 412, h: 915, scheme: "dark" },
  { name: "android-share-360-light", q: "?screen=android-share", w: 360, h: 800, scheme: "light" },
  { name: "android-share-done-412-light", q: "?screen=android-share", w: 412, h: 915, scheme: "light", click: "Places" },
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

  // TAPS FIRST, THEN SCROLL. Scrolling before opening a panel scrolls whatever
  // happens to be on screen — which is how three "scrolled" screenshots of the
  // facts block turned out to be screenshots of the shelf.
  //
  // `clickLabel` takes a string or a LIST of labels, because reaching a jacket
  // that shows artwork needs two label clicks: getByText cannot find it — a
  // cover with a poster on it has no text node at all.
  const labelSteps = (Array.isArray(s.clickLabel) ? s.clickLabel : [s.clickLabel])
    .filter(Boolean).map((l) => ["label", l]);
  for (const step of [...labelSteps, ...(s.click ? [["text", s.click]] : [])]) {
    const target = step[0] === "label"
      ? page.getByLabel(step[1], { exact: false })
      : page.getByText(step[1], { exact: false });
    await target.first().click();
    await page.waitForTimeout(600);      // and the transition after the tap
  }

  if (s.scroll) {
    // A REAL WHEEL EVENT over the middle of the screen, not a scrollTop poke.
    // Two attempts at guessing the container both failed silently: the first
    // scrollable div is the shelf UNDERNEATH an open detail panel, and setting
    // scrollTop on it "succeeded" while the panel on top never moved — so
    // every scrolled screenshot was a screenshot of the top, and I looked at
    // two of them before noticing. A wheel event goes to whatever is actually
    // under the cursor, which is the thing a thumb would move.
    await page.mouse.move(s.w / 2, s.h / 2);
    await page.mouse.wheel(0, s.scroll);
    await page.waitForTimeout(400);
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
