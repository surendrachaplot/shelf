import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";
const URLBASE = "file://" + fileURLToPath(new URL("./index.html", import.meta.url));
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await b.newContext({ viewport: { width: 375, height: 812 } });
const p = await ctx.newPage();
await p.goto(URLBASE + "?paired=0&unclaimed=1");
await p.waitForTimeout(800);
const out = await p.evaluate(() => {
  const walk = (el, depth = 0, acc = []) => {
    if (depth > 5) return acc;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    acc.push({
      depth, tag: el.tagName.toLowerCase(),
      text: (el.textContent || "").trim().slice(0, 22),
      h: Math.round(r.height), top: Math.round(r.top),
      display: cs.display, flex: cs.flex, dir: cs.flexDirection,
      justify: cs.justifyContent, padBottom: cs.paddingBottom,
    });
    for (const c of el.children) walk(c, depth + 1, acc);
    return acc;
  };
  return walk(document.getElementById("root"));
});
for (const n of out.slice(0, 12)) {
  console.log(`${"  ".repeat(n.depth)}${n.tag} h=${n.h} top=${n.top} flex=${n.flex} justify=${n.justify} padB=${n.padBottom} "${n.text}"`);
}
await b.close();
