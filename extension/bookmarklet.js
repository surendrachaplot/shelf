// bookmarklet.js — "Save to shelf" with nothing to install.
//
// A bookmark whose address is a line of JavaScript. Drag it to the bookmarks
// bar; a click opens <base>/app/?url=<this page>&text=<what is selected> in a
// new tab. It works in every desktop browser, Safari included, which is the
// one browser the extension does not reach yet.
//
//   node extension/build.mjs --bookmarklet [base]     prints the line to paste
//
// THE STRING HAS RULES, because it lives inside an href="…" and then inside a
// URL:
//   · no " or ' or < or > or & — any of them can end or bend an HTML attribute.
//     So the script uses a template literal (backticks), and URLSearchParams
//     instead of writing `&text=` by hand.
//   · no raw space or line break — the one space (`new URLSearchParams`) is
//     written %20. A browser percent-decodes a javascript: address before it
//     runs it.
//   · the base is pasted INTO the script, so it is held to plain URL
//     characters. A base with a backtick or `${` in it would be code.
import { DEFAULT_BASE, TEXT_CAP, normalizeBase } from "./src/url.js";

export function bookmarkletHref(base = DEFAULT_BASE) {
  const b = normalizeBase(base);
  if (!b.ok) throw new Error(b.reason);
  if (!/^https?:\/\/[A-Za-z0-9.\-_~:\/\[\]]+$/.test(b.base)) throw new Error("The shelf address has characters a bookmark cannot carry.");
  // URLSearchParams does the encoding at click time, and writes a space as
  // `+`, which `readShare` (also URLSearchParams) reads back as a space.
  return "javascript:void(open(`" + b.base + "/app/?${new%20URLSearchParams({url:location.href,text:String(getSelection()).trim().slice(0," + TEXT_CAP + ")})}`))";
}

// ponytail: no drag-me page here. That page belongs on the site (api/landing.js,
// another session's file); until then the README says how to paste the line.
