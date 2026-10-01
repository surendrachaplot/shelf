// links-selftest.mjs — what belongs with what, asserted.
//
// A SEPARATE FILE, same reason as facts-selftest.mjs. And the same worry as
// find-selftest.mjs: a wrong link does not look wrong. "Also by Susanna
// Clarke" over a book she did not write is a tidy, confident row.
//
// Fixtures carry the shapes api/enrich/index.js really returns — see
// tags-selftest.mjs for why that matters.
import { linksFor, LINK_KINDS } from "./src/links.js";
import { LIST_KEYS } from "./src/design.js";

let fail = 0;
const ok = (c, label, got) => { if (!c) { fail++; console.error("FAIL", label, got === undefined ? "" : `\n      got: ${JSON.stringify(got)}`); } };

const item = (o) => ({
  id: o.id, list: o.list, status: o.status || "filed", title: o.title ?? null,
  subtitle: o.subtitle || "", note: "", image_url: null,
  canonical: o.canonical || {}, confidence: 1, enriched: true,
  source_url: null, resolver: "test", created_at: "2026-01-01T00:00:00.000Z",
});
const show = (groups) => groups.map((g) => `${g.reason.kind}:${g.reason.value}=${g.items.map((x) => x.id).join("+")}`);

// books
const piranesi = item({ id: "p", list: "books", title: "Piranesi",
  canonical: { author: "Susanna Clarke", year: 2020, subjects: ["Fantasy"] } });
const strange = item({ id: "j", list: "books", title: "Jonathan Strange & Mr Norrell",
  canonical: { author: "susanna clarke", year: 2004, subjects: ["Fantasy"] } });
const klara = item({ id: "k", list: "books", title: "Klara and the Sun",
  canonical: { author: "Kazuo Ishiguro", year: 2020, subjects: ["Fantasy"] } });
// movies
const sinners = item({ id: "s", list: "movies", title: "Sinners",
  canonical: { year: "2025", director: "Ryan Coogler", genres: ["Horror"], cast: ["Michael B. Jordan", "Hailee Steinfeld"] } });
const creed = item({ id: "c", list: "movies", title: "Creed",
  canonical: { year: "2015", director: "Ryan Coogler", genres: ["Drama"], cast: ["Michael B. Jordan", "Sylvester Stallone"] } });
const justMercy = item({ id: "m", list: "movies", title: "Just Mercy",
  canonical: { year: "2019", director: "Destin Daniel Cretton", genres: ["Drama"], cast: ["Michael B. Jordan"] } });
// restaurants — an area and no city, which is what Nominatim's row carries.
const ganapati = item({ id: "g", list: "restaurants", title: "Ganapati",
  canonical: { area: "Peckham", cuisine: ["South indian"] } });
const dishoom = item({ id: "di", list: "restaurants", title: "Dishoom",
  canonical: { area: "Shoreditch", cuisine: ["South indian"] } });
// places
const multiStory = item({ id: "ms", list: "places", title: "Multi Story",
  canonical: { area: "Peckham", city: "London", located: true } });
const bookBar = item({ id: "bb", list: "places", title: "Book Bar",
  canonical: { area: "Bounds Green", city: "London", located: true } });
const belem = item({ id: "be", list: "places", title: "Belém Tower", canonical: { city: "Lisbon", located: true } });
// recipes
const dal = item({ id: "d", list: "recipes", title: "Lemon dal",
  canonical: { author: "Meera Sodha", cuisine: "Indian", article: { siteName: "The Guardian" } } });
const curry = item({ id: "cu", list: "recipes", title: "Aubergine curry",
  canonical: { author: "Meera Sodha", cuisine: "Indian", article: { siteName: "The Guardian" } } });
const toast = item({ id: "t", list: "recipes", title: "Cheese toast",
  canonical: { author: "Felicity Cloake", cuisine: "British", article: { siteName: "The Guardian" } } });
// quotes — canonical is {}, the author is the subtitle.
const devotion = item({ id: "q", list: "quotes", title: "Attention is the beginning of devotion.", subtitle: "Mary Oliver" });
const upstream = item({ id: "u", list: "books", title: "Upstream", canonical: { author: "Mary Oliver", year: 2016 } });

const SHELF = [piranesi, strange, klara, sinners, creed, justMercy, ganapati, dishoom,
               multiStory, bookBar, belem, dal, curry, toast, devotion, upstream];

// ── EVERY SHELF THAT CAN LINK has something in this test that links ─────────
// Wishlist and Notes cannot, and that is LINK_KINDS saying so rather than this
// loop forgetting them: a link is the same person or the same place, a thing
// to buy has a brand (a tag, not one of the link kinds), and a note has no
// facts at all. Both are asserted below.
// deliberate subset — the two shelves with nothing a link is made of.
const NO_LINKS = ["wishlist", "notes"];
{
  const shirt = item({ id: "w1", list: "wishlist", title: "Overshirt", canonical: { kind: "product", brand: "Northfield" } });
  const scarf = item({ id: "w2", list: "wishlist", title: "Scarf", canonical: { kind: "product", brand: "Northfield" } });
  const note = item({ id: "n1", list: "notes", title: "Ask Maya", note: "Ask Maya about the scarf", canonical: { kind: "note" } });
  ok(linksFor(shirt, [shirt, scarf, note]).length === 0, "wishlist: a shared brand is a tag, and is NOT a link", linksFor(shirt, [shirt, scarf, note]));
  ok(linksFor(note, [shirt, scarf, note]).length === 0, "notes: a note links to nothing", linksFor(note, [shirt, scarf, note]));
}
for (const list of LIST_KEYS.filter((k) => k !== "unsorted" && !NO_LINKS.includes(k))) {
  const linked = SHELF.filter((x) => x.list === list).some((x) => linksFor(x, SHELF).length > 0);
  ok(linked, `${list}: at least one fixture on this shelf has a link`);
}

// ── same author ─────────────────────────────────────────────────────────────
ok(show(linksFor(piranesi, SHELF)).join("|") === "author:Susanna Clarke=j",
   "same author, two spellings — and NOT the other 2020 fantasy novel", show(linksFor(piranesi, SHELF)));
ok(show(linksFor(dal, SHELF)).join("|") === "author:Meera Sodha=cu",
   "a recipe links by who wrote it — not by cuisine, and not by the website it is on", show(linksFor(dal, SHELF)));
ok(show(linksFor(devotion, SHELF)).join("|") === "author:Mary Oliver=u",
   "a quote finds the book by whoever said it, across shelves", show(linksFor(devotion, SHELF)));

// ── same director, same cast — strongest first ──────────────────────────────
ok(show(linksFor(sinners, SHELF)).join("|") === "director:Ryan Coogler=c|cast:Michael B. Jordan=c+m",
   "director before cast; a cast member nobody else shares makes no group", show(linksFor(sinners, SHELF)));

// The order is LINK_KINDS', not the order tags happen to come in — tags.js puts
// a place before the cast, because that is the order people FILTER in. No
// shelf carries both today, so this item is made up, and it is here so the
// order of links never quietly depends on that staying true.
const both = item({ id: "bt", list: "movies", title: "Shot on location", canonical: { cast: ["Michael B. Jordan"], city: "London" } });
ok(show(linksFor(both, SHELF)).join("|") === "cast:Michael B. Jordan=s+c+m|city:London=ms+bb",
   "a person before a place, whatever order the tags were in", show(linksFor(both, SHELF)));

// ── same neighbourhood, same city ───────────────────────────────────────────
ok(show(linksFor(multiStory, SHELF)).join("|") === "area:Peckham=g|city:London=bb",
   "the neighbourhood before the city, and a restaurant IS in a place's neighbourhood", show(linksFor(multiStory, SHELF)));
ok(show(linksFor(ganapati, SHELF)).join("|") === "area:Peckham=ms", "…and the other way round", show(linksFor(ganapati, SHELF)));
ok(linksFor(belem, SHELF).length === 0, "the only thing in Lisbon has no links — never an empty group", show(linksFor(belem, SHELF)));

// ── TOO WEAK TO BE A LINK ───────────────────────────────────────────────────
// Each pair below shares exactly one thing, and it is a filter, not a reason.
ok(linksFor(klara, SHELF).length === 0, "a shared YEAR and a shared GENRE are not a link", show(linksFor(klara, SHELF)));
ok(linksFor(dishoom, SHELF).length === 0, "a shared CUISINE is not a link", show(linksFor(dishoom, SHELF)));
ok(linksFor(toast, SHELF).length === 0, "a shared WEBSITE is not a link", show(linksFor(toast, SHELF)));
ok(LINK_KINDS.join() === "author,director,cast,area,city", "the whole list, strongest first — adding to it is a decision", LINK_KINDS);
ok(SHELF.every((it) => linksFor(it, SHELF).every((g) => LINK_KINDS.includes(g.reason.kind))), "no group has a reason outside the list");

// ── the shape ───────────────────────────────────────────────────────────────
ok(SHELF.every((it) => linksFor(it, SHELF).every((g) => g.items.length > 0)), "no empty groups, anywhere");
ok(SHELF.every((it) => linksFor(it, SHELF).every((g) => !g.items.includes(it))), "an item is never linked to itself");
// The open item is very often a COPY of the row in the array — same id, a
// different object. Identity alone would link it to itself.
ok(show(linksFor({ ...piranesi }, SHELF)).join("|") === "author:Susanna Clarke=j",
   "a copy of an item is still that item", show(linksFor({ ...piranesi }, SHELF)));
ok(linksFor(piranesi, SHELF)[0].items[0] === strange, "the linked items are the shelf's own objects, not copies");

// Only filed things link, in either direction.
const pending = { ...item({ id: "z", list: "books", canonical: { author: "Susanna Clarke" } }), status: "pending" };
ok(show(linksFor(piranesi, [...SHELF, pending])).join("|") === "author:Susanna Clarke=j", "a pending row is not offered as a link", show(linksFor(piranesi, [...SHELF, pending])));
ok(linksFor(pending, SHELF).length === 0, "and has none of its own");

ok(linksFor(null, SHELF).length === 0 && linksFor(piranesi, null).length === 0 && linksFor(piranesi, []).length === 0
   && linksFor(piranesi, [null, undefined, piranesi]).length === 0, "rubbish in, no crash, no links");

console.log(fail ? `links selftest FAILED (${fail})` : "links selftest ok");
process.exit(fail ? 1 : 0);
