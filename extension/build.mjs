// build.mjs — one source, two folders a browser can load.
//
//   node extension/build.mjs                        →  extension/chrome/   extension/firefox/
//   node extension/build.mjs --bookmarklet [base]   →  the bookmark line, printed
//
// The code is the same in both. Only the manifest differs, and only in how it
// names the background file:
//
//   Chromium   background.service_worker
//   Firefox    background.scripts          (it has no extension service worker)
//
// One manifest with BOTH keys does load in both — that was the first version.
// But Chromium 151 then files "'background.scripts' requires manifest version
// of 2 or lower" under the card's Errors button. It hides that until Developer
// mode's error collection is on, which is how a test that read "0 warnings"
// passed while the warning was there. So: a copy each, with only its own key.
//
// Node built-ins only. The two folders are build output and are committed, the
// same trade as api/public/: selftest.mjs fails if they are stale.
import { cpSync, rmSync, readFileSync, writeFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
export const TARGETS = ["chrome", "firefox"];

/** The source manifest, cut down to what one engine understands. Pure. */
export function manifestFor(target, source) {
  const m = structuredClone(source);
  if (target === "chrome") {
    delete m.background.scripts;
    delete m.browser_specific_settings;
  } else {
    delete m.background.service_worker;
    delete m.minimum_chrome_version;
  }
  return m;
}

export function build() {
  const source = JSON.parse(readFileSync(here("./src/manifest.json"), "utf8"));
  for (const target of TARGETS) {
    const out = here(`./${target}/`);
    rmSync(out, { recursive: true, force: true });
    cpSync(here("./src/"), out, { recursive: true });
    writeFileSync(out + "manifest.json", JSON.stringify(manifestFor(target, source), null, 2) + "\n");
  }
}

// realpath, because /tmp and /var are symlinks on a Mac: compared as typed,
// this file run from a temp folder decides it is not the main module and
// quietly builds nothing.
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  if (process.argv[2] === "--bookmarklet") {
    //   node extension/build.mjs --bookmarklet [base]   → the line to paste into a bookmark
    const { bookmarkletHref } = await import("./bookmarklet.js");
    console.log(bookmarkletHref(process.argv[3]));
  } else {
    build();
    console.log(`extension build: ${TARGETS.map((t) => `extension/${t}/`).join("  ")}`);
  }
}
