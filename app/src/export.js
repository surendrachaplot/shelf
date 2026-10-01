// export.js — your shelf, as two files that need nothing from us to open.
//
// Plain JS, importing only design.js and facts.js, so the app calls it, a node
// selftest checks it, and the page it writes is painted from the same tokens
// as the app and the public page (`api/page.js`).
//
// WHY THIS EXISTS BEFORE ANYBODY IS CHARGED. A shelf that can only be read
// inside the app that made it is a hostage. So there are two ways out, and
// they answer different questions:
//
//   exportJson  EVERYTHING, for a machine. Every item exactly as it is held,
//               so another program (or this one, later) can take it back.
//   exportHtml  EVERYTHING A PERSON WOULD READ, for a person. One file, no
//               script, no network needed. It opens in whatever browser
//               exists in ten years, and an article saved with its text is
//               still there after the link has died.
//
// TWO RULES:
//
// 1. EVERY STRING ON THE PAGE IS SOMEBODY ELSE'S. Titles come from catalogues,
//    captions from strangers, notes from the person. All of it goes through
//    `esc`, and a URL reaches an href or a src only if it is http(s). The file
//    is opened from disk, where a script would run with file:// reach.
// 2. THE TIME IS AN ARGUMENT. `now` is passed in, never read here, so the
//    same shelf and the same `now` give the same bytes.
import * as D from "./design.js";
import { factsFor } from "./facts.js";

export const EXPORT_FORMAT = "shelf-export";
export const EXPORT_VERSION = 1;

const isDate = (d) => d instanceof Date && !Number.isNaN(d.getTime());
const pad = (n) => String(n).padStart(2, "0");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "1 Oct 2026", in the person's own timezone. null for a date that is not one. */
const day = (d) => (isDate(d) ? `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : null);

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** http(s) or nothing. `javascript:`, `data:`, `file:` and `geo:` all get nothing. */
const http = (u) => (typeof u === "string" && /^https?:\/\/\S+$/i.test(u.trim()) ? u.trim() : null);

/** `shelf-2026-10-01.json`. The LOCAL date: it is the day the person did it. */
export function exportFilename(kind, now) {
  const ext = kind === "html" ? "html" : "json";
  return isDate(now)
    ? `shelf-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.${ext}`
    : `shelf.${ext}`;
}

/**
 * The whole shelf, for a machine.
 *
 * Items go out WHOLE and untouched — every field, including ones added after
 * this was written (`canonical.article`, `canonical.ocr_text`, whatever comes
 * next). Picking fields here would be a list that is wrong the next time an
 * item learns something, and what it dropped would be gone without a sound.
 *
 * LINKS LOSE THEIR `code`. A link is { code, kind, target, title, at }, and
 * `code` is not just the address of the public page: `POST /api/publish/revoke`
 * takes the code and nothing else, so it is also the only key that deletes the
 * page. An export gets emailed, dropped in a shared folder, handed to another
 * app. So what goes out is the record that a link was made — what, and when —
 * and never the thing that can act on it. The fields are NAMED, not copied, so
 * a secret added to a link later stays behind by default. The phone still
 * holds the codes; nothing is lost by leaving them out of the copy.
 *
 * A missing `now` writes `exported_at: null` rather than throwing or reading
 * the clock: a forgotten argument must not be what stops somebody leaving.
 */
export function exportJson(shelf, { now } = {}) {
  const s = shelf && typeof shelf === "object" ? shelf : {};
  return JSON.stringify({
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exported_at: isDate(now) ? now.toISOString() : null,
    profile: s.profile && typeof s.profile === "object" ? s.profile : {},
    items: Array.isArray(s.items) ? s.items : [],
    // Your own lists. Added the day lists were: an export that leaves out the
    // outfit you spent an evening putting together is not "everything".
    lists: (Array.isArray(s.boards) ? s.boards : []).filter((b) => b && typeof b === "object"),
    links: (Array.isArray(s.links) ? s.links : [])
      .filter((l) => l && typeof l === "object")
      .map((l) => ({ kind: l.kind ?? null, target: l.target ?? null, title: l.title ?? "", at: l.at ?? null })),
  }, null, 2);
}

// ── the page ────────────────────────────────────────────────────────────────

// Derived from LIST_KEYS, the way page.js does it. `unsorted` is a state and
// not a shelf, so it has no name of its own to capitalise.
const labelOf = (k) => (k === "unsorted" ? "Not shelved" : k[0].toUpperCase() + k.slice(1));
const listOf = (item) => (D.LIST_KEYS.includes(item.list) ? item.list : "unsorted");

/** `canonical.article` is the saved text, or an object carrying it as `.text`. */
function articleOf(c) {
  const a = c.article;
  const text = typeof a === "string" ? a : a && typeof a.text === "string" ? a.text : "";
  if (!text.trim()) return null;
  const by = a && typeof a === "object" ? [a.byline, a.siteName].filter(Boolean).join(" · ") : "";
  return { text: text.trim(), by };
}

function stylesheet() {
  const t = D.type;
  const vars = (p) => `--paper:${p.bg}; --sunk:${p.surfaceSunk}; --ink:${p.ink}; --soft:${p.inkSoft}; --faint:${p.inkFaint}; --line:${p.line};`;
  const step = (s) => `font-size:${s.fontSize}px;line-height:${s.lineHeight}px;font-weight:${s.fontWeight}`;
  return `
:root{ ${vars(D.light)}
  ${D.LIST_KEYS.map((k) => `--${k}:${D.light[k]}; --on-${k}:${D.listOn[k]};`).join(" ")} }
/* Only the structure colour inverts. The shelf colours are the brand and are
   the same in both schemes, as in the app. */
@media (prefers-color-scheme: dark){ :root{ ${vars(D.dark)} } }
*{margin:0;padding:0;box-sizing:border-box;border-radius:0}
body{background:var(--paper);color:var(--ink);font-family:Helvetica,Arial,sans-serif;${step(t.body)}}
.wrap{max-width:760px;margin:0 auto;padding:0 ${D.sp.lg}px ${D.sp.huge}px}
a{color:inherit}
.head{padding:${D.sp.xl}px 0 ${D.sp.md}px}
.wordmark{font-size:42px;line-height:44px;letter-spacing:-2.6px;font-weight:700}
.rule{height:${D.RULE}px;background:var(--ink)}
.who{padding:${D.sp.lg}px 0}
.name{${step(t.title)};letter-spacing:-1px}
.micro{${step(t.micro)};letter-spacing:1.8px;text-transform:uppercase}
.meta{${step(t.meta)};color:var(--soft)}
.faint{color:var(--faint)}
.band{display:flex;align-items:center;gap:${D.sp.md}px;padding:${D.sp.md}px ${D.sp.lg}px;margin:${D.sp.xl}px -${D.sp.lg}px 0;border-bottom:${D.BOARD}px solid var(--ink)}
.band h2{font-size:31px;line-height:31px;letter-spacing:-1.5px;font-weight:700;text-transform:uppercase;flex:1}
.item{display:flex;gap:${D.sp.lg}px;align-items:flex-start;padding:${D.sp.lg}px 0;border-bottom:${D.HAIRLINE}px solid var(--line)}
/* min-height is for the day the cover is gone: a broken image with no height
   collapses to a black bar, and with one it is a box that shows its alt text. */
.item img{flex:none;width:${D.cover.minW}px;min-height:${D.cover.minW}px;object-fit:cover;border:${D.COVER_KEYLINE}px solid var(--ink);background:var(--sunk);color:var(--soft);${step(t.micro)}}
.what{flex:1;min-width:0;overflow-wrap:anywhere}
.what > * + *{margin-top:${D.sp.sm}px}
h3{${step(t.heading)};letter-spacing:${t.heading.letterSpacing}px}
.lede{color:var(--soft);max-width:60ch}
dl{display:grid;grid-template-columns:max-content 1fr;gap:${D.sp.xs}px ${D.sp.md}px}
dt{color:var(--faint)}
.note{border:${D.COVER_KEYLINE}px solid var(--ink);padding:${D.sp.md}px;white-space:pre-wrap;max-width:60ch}
.text{background:var(--sunk);padding:${D.sp.md}px;white-space:pre-wrap;max-width:68ch}
.colophon{margin-top:${D.sp.huge}px;border-top:${D.RULE}px solid var(--ink);padding-top:${D.sp.md}px}
@media (max-width:400px){ .item{flex-direction:column} }
@media print{ .band{break-after:avoid} .item{break-inside:avoid} }
`;
}

function itemHtml(item) {
  const c = item.canonical && typeof item.canonical === "object" ? item.canonical : {};
  const title = esc(item.title || "Untitled");
  // platform null: the https map link, which opens on anything (facts.js).
  const { lede, rows, links } = factsFor({ ...item, canonical: c }, { platform: null });
  const article = articleOf(c);
  const img = http(item.image_url);
  const source = http(item.source_url);

  const foot = [];
  const saved = day(new Date(item.created_at));
  if (saved) foot.push(`Saved ${esc(saved)}`);
  // A row that was never resolved is still somebody's save. Say what it is.
  if (item.status && item.status !== "filed") foot.push("Not read yet");
  for (const l of links) {
    const url = http(l.url);
    if (url) foot.push(`<a href="${esc(url)}" rel="nofollow noopener">${esc(l.label)}</a>`);
    // A phone number is worth keeping and `tel:` is not http: print it.
    else if (/^tel:/i.test(l.url)) foot.push(`${esc(l.label)} ${esc(l.url.slice(4))}`);
  }
  if (source) foot.push(`<a href="${esc(source)}" rel="nofollow noopener">Where this came from</a>`);

  return `<article class="item">
${img ? `<img src="${esc(img)}" alt="${title}" loading="lazy" referrerpolicy="no-referrer">` : ""}
<div class="what">
<h3>${title}</h3>
${item.subtitle ? `<p class="meta">${esc(item.subtitle)}</p>` : ""}
${lede ? `<p class="lede">${esc(lede)}</p>` : ""}
${rows.length ? `<dl>${rows.map((r) => `<dt>${esc(r.label)}</dt><dd>${esc(r.value)}</dd>`).join("")}</dl>` : ""}
${String(item.note ?? "").trim() ? `<p class="note">${esc(String(item.note).trim())}</p>` : ""}
${article ? `<p class="micro faint">Saved text${article.by ? ` · ${esc(article.by)}` : ""}</p><div class="text">${esc(article.text)}</div>` : ""}
${foot.length ? `<p class="meta">${foot.join(" · ")}</p>` : ""}
</div>
</article>`;
}

/**
 * The whole shelf, for a person. One file: inline CSS, no script, no font or
 * stylesheet fetched. A cover is the one remote thing, and it carries the title
 * as its alt text, so when the image host is gone the row still says what it is.
 *
 * Shelves come out in LIST_KEYS order and only when they hold something — an
 * archive is not the place for six empty headings.
 */
export function exportHtml(shelf, { now } = {}) {
  const s = shelf && typeof shelf === "object" ? shelf : {};
  const items = (Array.isArray(s.items) ? s.items : []).filter((i) => i && typeof i === "object");
  const profile = s.profile && typeof s.profile === "object" ? s.profile : {};
  const when = day(now);
  const title = `${profile.name ? `${profile.name} · ` : ""}shelf${when ? ` · ${when}` : ""}`;

  const sections = D.LIST_KEYS.map((k) => {
    const mine = items.filter((i) => listOf(i) === k);
    if (!mine.length) return "";
    return `<section>
<div class="band" style="background:var(--${k});color:var(--on-${k})"><h2>${esc(labelOf(k))}</h2><span class="micro">${pad(mine.length)}</span></div>
${mine.map(itemHtml).join("\n")}
</section>`;
  }).filter(Boolean).join("\n");

  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${esc(title)}</title>
<style>${stylesheet()}</style>
</head><body><div class="wrap">
<div class="head"><div class="wordmark">shelf</div></div>
<div class="rule"></div>
<div class="who">
${profile.name ? `<h1 class="name">${esc(profile.name)}</h1>` : ""}
${profile.bio ? `<p class="meta">${esc(profile.bio)}</p>` : ""}
<p class="micro faint">${items.length} ${items.length === 1 ? "thing" : "things"}${when ? ` · exported ${esc(when)}` : ""}</p>
</div>
${sections || `<p class="meta">Nothing on this shelf yet.</p>`}
<p class="colophon meta">This file is yours. It needs no app and no network to read. The covers are fetched from where they were found, so a cover can go missing. The words cannot.</p>
</div></body></html>`;
}
