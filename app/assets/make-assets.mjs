// make-assets.mjs — draw the icon and splash from the design tokens.
//
//   node assets/make-assets.mjs
//
// The mark is the app: four jackets standing on a board. Not a letterform, not
// an abstraction — the thing the app shows you, at icon size.
//
// Generated rather than drawn, and generated FROM `src/design.js`, so the icon
// cannot drift from the palette the way a hand-exported PNG silently does. If
// the four primaries ever change, re-run this and the icon follows.
//
// Rendered through Chromium because it is already here for the preview
// harness, and an SVG rasterised by a browser is the same rasteriser the rest
// of this project has been judged in.
import { chromium } from "playwright-core";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import * as D from "../src/design.js";

const OUT = fileURLToPath(new URL("./", import.meta.url));
await mkdir(OUT, { recursive: true });

/**
 * A BOOKCASE: two boards, three jackets each, filling the square.
 *
 * The first attempt was four tall thin jackets on one board — and it read as a
 * bar chart, which is precisely the failure the shelf view itself went through
 * twice. Bars are tall and narrow on a common baseline; books are wide and
 * stand in rows. Jackets here are a 1.35 trim and there are two rows, so the
 * mark is unmistakably a case of books at any size.
 */
function mark({ size = 1024, ground, ink, pad: padF = 0.07 }) {
  const S = size;
  const pad = S * padF;
  const gap = S * 0.023;
  const w = (S - pad * 2 - gap * 2) / 3;
  const boardH = S * 0.055;
  const key = Math.max(2, S * 0.011);

  // Six jackets, so two of the four colours appear twice — arranged so no
  // colour sits directly above itself.
  const rows = [
    [["books", 1.30], ["restaurants", 1.38], ["movies", 1.34]],
    [["recipes", 1.36], ["movies", 1.30], ["books", 1.39]],
  ];
  const tallest = Math.max(...rows.flat().map(([, r]) => r)) * w;
  const pitch = tallest + boardH + S * 0.02;
  const top = (S - (pitch * 2 - S * 0.02)) / 2;

  let out = `<rect width="${S}" height="${S}" fill="${ground}"/>`;
  rows.forEach((row, r) => {
    const boardY = top + r * pitch + tallest;
    row.forEach(([list, ratio], i) => {
      const h = w * ratio;
      const x = pad + i * (w + gap);
      out += `<rect x="${x}" y="${boardY - h}" width="${w}" height="${h}" fill="${D.light[list]}" stroke="${ink}" stroke-width="${key}"/>`;
    });
    // The board runs past the jackets, the way it runs full-bleed in the app.
    out += `<rect x="${pad - key * 3}" y="${boardY}" width="${S - pad * 2 + key * 6}" height="${boardH}" fill="${ink}"/>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">${out}</svg>`;
}

/** The splash mark: the same object, smaller, with the wordmark under it. */
function splash({ size = 1024, ground, ink }) {
  const inner = mark({ size, ground: "none", ink, pad: 0.10 })
    .replace(/^<svg[^>]*>|<\/svg>$/g, "")
    .replace(/<rect width="\d+" height="\d+" fill="none"\/>/, "");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <g transform="translate(0, ${-size * 0.06}) scale(0.86) translate(${size * 0.081}, ${size * 0.081})">${inner}</g>
    <text x="${size / 2}" y="${size * 0.96}" text-anchor="middle"
      font-family="Helvetica, Arial, sans-serif" font-weight="700"
      font-size="${size * 0.15}" letter-spacing="${-size * 0.010}" fill="${ink}">shelf</text>
  </svg>`;
}

const JOBS = [
  // The iOS icon. No transparency and no rounded corners — iOS masks it, and
  // pre-rounding it produces a double-rounded corner.
  // pad 0.12: iOS masks the icon with a squircle that eats roughly the outer
  // tenth at the corners. At 0.07 the corner jackets were clipped by it.
  { file: "icon.png", size: 1024, svg: mark({ ground: D.light.bg, ink: D.light.ink, pad: 0.12 }) },
  // The splash mark, drawn on the splash background rather than transparent so
  // the keylines have something to sit against in both schemes.
  { file: "splash-light.png", size: 1024, svg: splash({ ground: D.light.bg, ink: D.light.ink }) },
  { file: "splash-dark.png", size: 1024, svg: splash({ ground: D.dark.bg, ink: D.dark.ink }) },
  { file: "favicon.png", size: 196, svg: mark({ size: 196, ground: D.light.bg, ink: D.light.ink, pad: 0.10 }) },
  // THE ANDROID ADAPTIVE ICON, which is not the iOS one with a different name.
  // Android composites a transparent FOREGROUND over a flat background and
  // then masks the result — to a circle on one launcher, a squircle on the
  // next, a rounded square on a third. Only the middle ~66% is guaranteed to
  // survive that, so the mark needs roughly twice iOS's padding: at 0.12 the
  // outer jackets of the bookcase are inside the mask on a circular launcher
  // and get sliced. 0.26 keeps the whole case inside the safe zone on every
  // mask shape, which is why it is not the same number as the iOS icon.
  { file: "adaptive-icon.png", size: 1024, transparent: true,
    svg: mark({ ground: "transparent", ink: D.light.ink, pad: 0.26 }) },
];

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
for (const job of JOBS) {
  const ctx = await browser.newContext({
    viewport: { width: job.size, height: job.size },
    deviceScaleFactor: 1,
    // Transparency is a property of the JOB, not a guess from its filename.
  });
  const page = await ctx.newPage();
  await page.setContent(
    `<!doctype html><style>html,body{margin:0;padding:0;background:${job.transparent || job.file.startsWith("splash") ? "transparent" : "#fff"}}svg{display:block}</style>${job.svg}`
  );
  await page.waitForTimeout(80);
  await page.screenshot({
    path: OUT + job.file,
    omitBackground: !!job.transparent || job.file.startsWith("splash"),
  });
  console.log(`  ${job.file}  ${job.size}×${job.size}`);
  await ctx.close();
}
await browser.close();
console.log("\nDrawn from src/design.js — re-run after any palette change.");
