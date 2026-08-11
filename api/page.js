// page.js — the public face of a shelf.
//
// This is the surface the whole sharing feature exists for: someone sends you a
// link, you open it on a phone you have never installed shelf on, and what you
// see has to be the thing itself — not a marketing page with a download button
// where the shelf should be.
//
// It renders from `app/src/design.js` and `app/src/exlibris.js` DIRECTLY. Not a
// copy of the palette, not a stylesheet that agrees with the app today: the
// same file the app imports. A shared page that has drifted a shade off is
// worse than no shared page, because the person you sent it to now has a
// slightly wrong impression of your taste and neither of you can tell why.
//
// (This is why the API deploy needs the repository root and not just `api/` —
// see OPERATIONS.)
import { readFile } from "node:fs/promises";
import { isMain } from "./ismain.js";
import * as D from "../app/src/design.js";
import { plateSvg, plateColours, plateFor } from "../app/src/exlibris.js";

const LIST_LABEL = { books: "Books", restaurants: "Restaurants", movies: "Movies", recipes: "Recipes" };

// Where these pages actually live. og:url has to be ABSOLUTE — a relative one
// is ignored, and the preview card then has no canonical address to attach to,
// which is how a link pasted into a message ends up as a grey rectangle.
//
// RENDER_EXTERNAL_URL is set by Render itself, so on Render this needs no
// configuration at all. That matters more than it sounds: the host is not
// knowable until after the first deploy, so anything you have to type here is
// a step you take while the service is already running and links are already
// being handed out. SHELF_WEB_BASE stays as the override for a custom domain.
//
// If NEITHER is known we emit no og:url rather than guessing one. A card with
// no canonical address degrades; a card pointing at the wrong host is a link
// that silently sends people somewhere else.
export const WEB_BASE = (process.env.SHELF_WEB_BASE || process.env.RENDER_EXTERNAL_URL || "").replace(/\/+$/, "");
export const canonical = (path) => (WEB_BASE ? `${WEB_BASE}${path}` : null);
const LIST_N = { books: "01", restaurants: "02", movies: "03", recipes: "04" };

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// The app's own jacket rules, in CSS. Kept as ONE block that reads the tokens
// so a change to the type ladder or the board thickness moves both surfaces.
function stylesheet() {
  const t = D.type;
  return `
:root{
  --paper:${D.light.bg}; --ink:${D.light.ink}; --soft:${D.light.inkSoft}; --faint:${D.light.inkFaint};
  --books:${D.light.books}; --restaurants:${D.light.restaurants}; --movies:${D.light.movies};
  --recipes:${D.light.recipes}; --unsorted:${D.light.unsorted};
  --on-books:${D.listOn.books}; --on-restaurants:${D.listOn.restaurants};
  --on-movies:${D.listOn.movies}; --on-recipes:${D.listOn.recipes};
  --board:${D.BOARD}px; --rule:${D.RULE}px; --key:${D.COVER_KEYLINE}px;
}
/* Dark is not a v2 thing here either. Only the STRUCTURE colour inverts; the
   four primaries are the brand and do not move, so every label that clears
   4.5:1 in one scheme clears it in both. */
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){ --paper:${D.dark.bg}; --ink:${D.dark.ink}; --soft:${D.dark.inkSoft}; --faint:${D.dark.inkFaint}; }
}
:root[data-theme="dark"]{ --paper:${D.dark.bg}; --ink:${D.dark.ink}; --soft:${D.dark.inkSoft}; --faint:${D.dark.inkFaint}; }
*{margin:0;padding:0;box-sizing:border-box;border-radius:0;-webkit-font-smoothing:antialiased}
body{background:var(--paper);color:var(--ink);font-family:Helvetica,Arial,sans-serif;font-kerning:normal}
.wrap{max-width:760px;margin:0 auto;padding:0 ${D.sp.lg}px ${D.sp.huge}px}
.bleed{margin-left:-${D.sp.lg}px;margin-right:-${D.sp.lg}px}
a{color:inherit}
.head{display:flex;align-items:baseline;gap:${D.sp.md}px;padding:${D.sp.xl}px 0 ${D.sp.md}px}
.wordmark{font-size:42px;line-height:38px;letter-spacing:-2.6px;font-weight:700;flex:1;text-decoration:none}
.micro{font-size:${t.micro.fontSize}px;line-height:${t.micro.lineHeight}px;letter-spacing:1.8px;font-weight:700;text-transform:uppercase}
.meta{font-size:${t.meta.fontSize}px;line-height:${t.meta.lineHeight}px;color:var(--soft)}
.faint{color:var(--faint)}

/* ── the plate ── */
.plate{display:flex;gap:${D.sp.lg}px;align-items:flex-start;padding:${D.sp.lg}px 0 ${D.sp.xl}px}
.plate svg{display:block;flex:none}
.who{flex:1;min-width:0}
.name{font-size:${t.title.fontSize}px;line-height:${t.title.lineHeight}px;letter-spacing:-1px;font-weight:700}
.handle{margin-top:${D.sp.xs}px}
.bio{margin-top:${D.sp.md}px;font-size:${t.body.fontSize}px;line-height:${t.body.lineHeight}px;color:var(--soft);max-width:44ch}
.rule{height:var(--rule);background:var(--ink)}

/* ── band + bookcase, exactly as the app builds them ── */
.band{display:flex;align-items:center;gap:${D.sp.md}px;padding:${D.sp.md}px ${D.sp.lg}px;margin-top:${D.sp.xl}px}
.band h2{font-size:31px;line-height:31px;letter-spacing:-1.5px;font-weight:700;text-transform:uppercase;flex:1}
/* Rows are chunked server-side, not laid out by a grid, for the same reason
   the app does it: a board has to be drawn under EACH row, and no grid can
   express that. flex-wrap is the narrow-screen escape — below ~360px three
   jackets cannot each hold their type, so they wrap to two and grow. */
.case{display:flex;flex-wrap:wrap;gap:${D.sp.sm}px;align-items:flex-end;padding-top:${D.sp.xl}px}
.board{height:var(--board);background:var(--ink);margin-top:0}
.jacket{position:relative;overflow:hidden;border:var(--key) solid var(--ink);display:flex;flex-direction:column;
  text-decoration:none;flex:1 1 ${D.cover.minW}px;min-width:${D.cover.minW}px;max-width:${Math.round(D.cover.minW * 1.6)}px;
  aspect-ratio:${D.cover.minW} / ${Math.max(...D.cover.heights)};
  /* Jacket type sizes itself to the JACKET, not the viewport — the page has no
     measuring pass, so the container query is how it does what jacketType()
     does on the phone. */
  container-type:inline-size}
.jacket img{width:100%;height:100%;object-fit:cover;display:block}
.strip{padding:4px ${D.sp.sm}px;font-size:${t.micro.fontSize}px;line-height:${t.micro.lineHeight}px;letter-spacing:.5px;font-weight:700;text-transform:uppercase}
.body{flex:1;padding:${D.sp.md}px ${D.sp.sm}px ${D.sp.sm}px;overflow:hidden}
.body.mid{display:flex;align-items:center}
.body.low{display:flex;align-items:flex-end}
/* 11cqw is not a taste value: a 12-letter word in bold sans needs about
   0.6em per character, and (100 - 2*pad)cqw / (12 * 0.6) lands there. The
   11px floor still outranks the fit, and overflow-wrap:anywhere is the
   last-resort guarantee that nothing escapes the trim — which is exactly
   what "The Dispossessed" did on the first render of this page. */
.jtitle{font-weight:700;letter-spacing:-.5px;font-size:clamp(${D.TYPE_FLOOR}px,11cqw,${t.heading.fontSize}px);
  line-height:1.05;overflow-wrap:anywhere;hyphens:auto;display:block}
.foot{padding:${D.sp.xs}px ${D.sp.sm}px;font-size:${t.micro.fontSize}px;line-height:${t.micro.lineHeight}px;letter-spacing:.5px;font-weight:700;text-transform:uppercase}
.empty{padding:${D.sp.xl}px 0;color:var(--faint)}

/* ── the colophon ── */
.colophon{margin-top:${D.sp.huge}px;border-top:var(--rule) solid var(--ink);padding-top:${D.sp.md}px;
  display:flex;flex-wrap:wrap;gap:${D.sp.md}px;align-items:baseline}
.cta{display:inline-flex;align-items:center;min-height:${D.TOUCH_MIN}px;padding:0 ${D.sp.lg}px;
  background:var(--ink);color:var(--paper);text-decoration:none}
.note{border:2px solid var(--ink);padding:${D.sp.md}px;margin-top:${D.sp.lg}px;
  font-size:${t.body.fontSize}px;line-height:${t.body.lineHeight}px}
.solo{max-width:420px;margin:0 auto}
.solo .jacket{aspect-ratio:2 / 3;max-width:none;flex:1 1 100%}
@media (max-width:400px){ .wordmark{font-size:34px;line-height:32px} .band h2{font-size:24px;line-height:24px} }
`;
}

/**
 * One jacket, using the app's own three compositions and the same hash, so a
 * shelf looks the same in a browser as it does on the phone it came from.
 */
function jacket(item) {
  const list = LIST_LABEL[item.list] ? item.list : "unsorted";
  const dims = D.coverFor(item.title ?? item.id);
  const fill = `var(--${list})`;
  const on = `var(--on-${list}, ${D.listOn.unsorted})`;
  const inverted = dims.comp === 2;
  const field = inverted ? on : fill;
  const mark = inverted ? fill : on;
  const title = esc(D.mainTitle(item.title ?? "") || "Untitled");

  if (item.image_url) {
    return `<div class="jacket" style="background:${field}"><img src="${esc(item.image_url)}" alt="${title}" loading="lazy"
      onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'body',style:'background:${field};color:${mark};padding:12px;font-weight:700',textContent:${JSON.stringify(D.mainTitle(item.title ?? "") || "Untitled")}}))"></div>`;
  }
  const strip = dims.comp !== 0
    ? `<div class="strip" style="background:${mark};color:${field}">${LIST_N[list] || "00"}</div>` : "";
  const foot = dims.comp !== 1 && item.subtitle
    ? `<div class="foot" style="background:${mark};color:${field}">${esc(item.subtitle)}</div>` : "";
  const bodyClass = dims.comp === 1 ? "body low" : dims.comp === 2 ? "body mid" : "body";
  return `<div class="jacket" style="background:${field}">${strip}
    <div class="${bodyClass}"><span class="jtitle" style="color:${mark}">${title}</span></div>${foot}</div>`;
}

/** Rows of at most `n`, order preserved, nothing dropped. */
export function chunk(rows, n) {
  const out = [];
  for (let i = 0; i < rows.length; i += n) out.push(rows.slice(i, i + n));
  return out;
}

function bookcase(list, items) {
  const fill = `var(--${list})`;
  const on = `var(--on-${list})`;
  return `<section>
    <div class="band bleed" style="background:${fill};color:${on}">
      <h2>${esc(LIST_LABEL[list] || list)}</h2>
      <span class="micro">${String(items.length).padStart(2, "0")}</span>
    </div>
    ${items.length
      ? chunk(items, 3).map((row) => `<div class="case">${row.map(jacket).join("")}</div><div class="board bleed"></div>`).join("")
      : `<p class="empty meta">Nothing on this shelf yet.</p>`}
  </section>`;
}

function plateBlock(owner) {
  const colours = plateColours(owner.plate_seed || owner.handle, D.light, D.listOn);
  const since = owner.since ? new Date(owner.since).toLocaleDateString("en-GB", { month: "short", year: "numeric" }) : null;
  return `<div class="plate">
    ${plateSvg(owner.plate_seed || owner.handle, colours, 96)}
    <div class="who">
      <div class="micro faint">Ex libris</div>
      <h1 class="name">${esc(owner.display_name)}</h1>
      <div class="handle micro faint">@${esc(owner.handle)}${since ? ` · shelving since ${esc(since)}` : ""}</div>
      ${owner.bio ? `<p class="bio">${esc(owner.bio)}</p>` : ""}
    </div>
  </div>`;
}

function shell({ title, description, image, body, url }) {
  // The preview card IS the share. A link pasted into a message with no card
  // is a grey rectangle, and no amount of design on the page fixes that.
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:type" content="profile"><meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
${url ? `<meta property="og:url" content="${esc(url)}">` : ""}
${image ? `<meta property="og:image" content="${esc(image)}">` : ""}
<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}">
<meta name="theme-color" content="${D.light.bg}" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="${D.dark.bg}" media="(prefers-color-scheme: dark)">
<style>${stylesheet()}</style>
</head><body><div class="wrap">
<div class="head"><a class="wordmark" href="/">shelf</a></div>
<div class="rule bleed"></div>
${body}
<div class="colophon">
  <span class="micro faint">Made with shelf</span>
  <span style="flex:1"></span>
  <a class="cta micro" href="/">Start your own →</a>
</div>
</div></body></html>`;
}

// ── the three pages ──────────────────────────────────────────────────────────

export function renderProfile({ owner, lists, note, url }) {
  const total = Object.values(lists).reduce((n, xs) => n + xs.length, 0);
  const body = `${plateBlock(owner)}
    ${note ? `<div class="note">${esc(note)}</div>` : ""}
    ${Object.entries(lists).map(([l, items]) => bookcase(l, items)).join("")}`;
  return shell({
    title: `${owner.display_name} on shelf`,
    description: owner.bio || `${total} things ${owner.display_name} has shelved — books, restaurants, movies and recipes.`,
    image: firstImage(Object.values(lists).flat()),
    url: url ?? canonical(`/@${owner.handle}`),
    body,
  });
}

export function renderShelf({ owner, list, items, note, url }) {
  const body = `${plateBlock(owner)}
    ${note ? `<div class="note">${esc(note)}</div>` : ""}
    ${bookcase(list, items)}`;
  return shell({
    title: `${owner.display_name}'s ${LIST_LABEL[list] || list} · shelf`,
    description: `${items.length} ${items.length === 1 ? "thing" : "things"} on ${owner.display_name}'s ${(LIST_LABEL[list] || list).toLowerCase()} shelf.`,
    image: firstImage(items),
    url: url ?? canonical(`/@${owner.handle}/${list}`),
    body,
  });
}

export function renderItem({ owner, item, note, url }) {
  const list = LIST_LABEL[item.list] ? item.list : "unsorted";
  const body = `${plateBlock(owner)}
    ${note ? `<div class="note">${esc(note)}</div>` : ""}
    <div class="band bleed" style="background:var(--${list});color:var(--on-${list}, ${D.listOn.unsorted})">
      <h2>${esc(LIST_LABEL[list] || "Unsorted")}</h2><span class="micro">${LIST_N[list] || "00"}</span>
    </div>
    <div class="case solo" style="grid-template-columns:1fr">${jacket(item)}</div>
    <div class="board bleed"></div>
    <div class="plate" style="padding-top:${D.sp.lg}px"><div class="who">
      <h1 class="name">${esc(item.title || "Untitled")}</h1>
      ${item.subtitle ? `<div class="handle micro faint">${esc(item.subtitle)}</div>` : ""}
      ${item.note ? `<p class="bio">${esc(item.note)}</p>` : ""}
      ${item.source_url ? `<p class="bio"><a href="${esc(item.source_url)}" rel="nofollow noopener">Where this came from →</a></p>` : ""}
    </div></div>`;
  return shell({
    title: `${item.title || "A thing"} · shelf`,
    description: [item.subtitle, item.note].filter(Boolean).join(" — ")
      || `${owner.display_name} put this on their ${(LIST_LABEL[list] || "").toLowerCase()} shelf.`,
    image: item.image_url,
    url,
    body,
  });
}

export const firstImage = (items) => items.find((i) => i.image_url)?.image_url || null;

/** 404 that is still a page, still on-brand, and says what to do next. */
export function renderGone() {
  return shell({
    title: "Nothing here · shelf",
    description: "This link is not live.",
    body: `<div class="plate"><div class="who">
      <h1 class="name">Nothing here</h1>
      <p class="bio">This link was revoked, or it never existed. Links are private by
      default and the person who made this one can turn it off at any time — so if
      you had it and it stopped working, that is the system doing its job.</p>
    </div></div>`,
  });
}

export function html(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    // Short and public. A shelf changes when its owner adds something, and a
    // day-long cache would make a link you just sent look stale on arrival.
    "Cache-Control": status === 200 ? "public, max-age=120" : "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(body);
}

export { plateFor };

// ── selftest ─────────────────────────────────────────────────────────────────

if (isMain(import.meta.url)) {
  if (process.argv.includes("--selftest")) {
    let n = 0, bad = 0;
    const ok = (cond, msg) => { n++; if (!cond) { bad++; console.error("FAIL", msg); } };

    const owner = { handle: "suren", display_name: "Suren", bio: "x", plate_seed: "suren", since: "2026-03-02T00:00:00Z" };
    const items = [{ id: "1", list: "books", title: "Piranesi", subtitle: "Susanna Clarke", image_url: null }];

    // THE DEPLOY TRAP. page.js imports app/src/*, so a deploy rooted at api/
    // cannot boot. This is here rather than in a comment because a comment has
    // never once stopped anybody editing a yaml file.
    const yaml = await readFile(new URL("../render.yaml", import.meta.url), "utf8");
    // Anchored to a line start: the file EXPLAINS the trap in prose above the
    // services block, and an unanchored match fired on the explanation.
    ok(!/^\s*rootDir:\s*api\b/m.test(yaml),
      "render.yaml sets rootDir: api — page.js imports app/src/design.js, so the server will not boot");
    ok(/node api\/serve\.js/.test(yaml), "render.yaml no longer starts the server from the repository root");

    const profile = renderProfile({ owner, lists: { books: items, restaurants: [], movies: [], recipes: [] } });
    ok(/Ex libris/.test(profile), "the plate block is missing from a profile page");
    ok(/<svg/.test(profile), "the ex-libris mark did not render");
    // The card IS the share. A link with no preview is a grey rectangle in a
    // message and no amount of design on the page fixes that.
    ok(/og:title/.test(profile) && /og:description/.test(profile), "a shared page shipped with no link preview");
    ok(/og:url" content="https?:\/\//.test(profile), "og:url is missing or not absolute — a relative one is ignored and the card has nothing to attach to");
    ok(canonical("/s/abc") === `${WEB_BASE}/s/abc`, "canonical url building");
    // Render tells the process its own address, so the common deploy needs no
    // configuration. Checked because "it defaults correctly" is the sort of
    // claim that is true right up until somebody reorders an expression.
    ok(WEB_BASE === (process.env.SHELF_WEB_BASE || process.env.RENDER_EXTERNAL_URL || "").replace(/\/+$/, ""),
      "WEB_BASE does not fall back to RENDER_EXTERNAL_URL");
    ok(profile.includes(D.light.books), "the page is not painting from the app's palette");

    // A revoked link and a link that never existed must be indistinguishable.
    // The strongest form of that guarantee a unit test can hold is that the
    // page CANNOT vary: renderGone takes no argument, so there is nothing for
    // it to branch on. (resolveShare returning null for both is the other
    // half, and lives in the end-to-end run.)
    ok(renderGone.length === 0, "renderGone takes an argument — it can therefore say which kind of dead link this is");
    ok(renderGone() === renderGone(), "renderGone is not deterministic");

    // Escaping, because every string on these pages came from a user.
    ok(esc('<script>x</script>') === "&lt;script&gt;x&lt;/script&gt;", "html escaping");
    const nasty = renderItem({ owner: { ...owner, display_name: '"><script>x</script>' }, item: items[0] });
    ok(!nasty.includes("<script>"), "a display name escaped into the page as markup");

    ok(chunk([1, 2, 3, 4, 5], 3).length === 2 && chunk([1, 2, 3, 4, 5], 3).flat().length === 5, "chunk dropped or duplicated a row");
    ok(chunk([], 3).length === 0, "chunk([])");

    // Long titles are the reason jacket type is solved, and the page has no
    // measuring pass — so it must at least be told never to overflow.
    ok(/overflow-wrap:anywhere/.test(profile), "a page jacket can let a long word escape its trim");

    console.log(bad ? `page selftest FAILED (${bad}/${n})` : `page selftest ok — ${n} assertions`);
    process.exit(bad ? 1 : 0);
  }
}
