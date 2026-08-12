// facts.js — what a catalogue knows, in the order a person wants it.
//
// Plain JS with no imports, like design.js, so the app renders it, a node
// selftest checks it, and the server can render the same rows into a public
// page. One place decides what a film's facts ARE.
//
// TWO RULES, both learned from screens that ignored them:
//
// 1. NEVER RENDER AN EMPTY FIELD. A row reading "Runtime —" is worse than no
//    row: it looks like the data is broken rather than absent. Everything here
//    is dropped unless it has a value.
//
// 2. ORDER BY WHAT DECIDES SOMETHING. A film's runtime settles "can I watch
//    this tonight"; its cast list rarely does. A recipe's time comes before
//    its author. This is not alphabetical and it is not the API's order.

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const list = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);

/**
 * A MAP LINK THE PHONE WILL ACTUALLY OPEN.
 *
 * `geo:` is an ANDROID scheme. iOS does not handle it, so every Map button in
 * this app opened nothing on an iPhone — silently, because `Linking.openURL`
 * on an unhandled scheme just fails. Reported as "map button on the
 * restaurants is not working", and it was broken on travel too: one server
 * built one URL for two platforms that do not agree about what a map link is.
 *
 * So the SERVER stores the facts — a name, a city, coordinates — and the
 * DEVICE builds the link, because only the device knows what it can open.
 * `canonical.map_url` is left alone and no longer read; it is the Android form
 * and this returns it verbatim on Android.
 *
 * The third case is not a phone at all: the public `/s/<code>` page is opened
 * on anything, and a `geo:` link in a browser is a dead link. That gets a
 * plain https maps URL, which works everywhere including as a fallback.
 */
export function mapUrl(item, platform) {
  const c = (item && item.canonical) || {};
  const name = (item && item.title) || "";
  const q = [name, c.city].filter(Boolean).join(", ");
  const pinned = isNum(c.lat) && isNum(c.lng);
  if (!q && !pinned) return null;
  const label = encodeURIComponent(name || q);

  // Apple Maps opens on the pin AND keeps the name on it, which is why both
  // parameters go in rather than just the coordinates.
  if (platform === "ios") {
    return pinned
      ? `https://maps.apple.com/?ll=${c.lat},${c.lng}&q=${label}`
      : `https://maps.apple.com/?q=${encodeURIComponent(q)}`;
  }
  // geo: is right here, and deliberately not a Google Maps URL: it opens
  // whichever map app the person actually uses.
  if (platform === "android") {
    return pinned ? `geo:${c.lat},${c.lng}?q=${label}` : `geo:0,0?q=${encodeURIComponent(q)}`;
  }
  return pinned
    ? `https://www.google.com/maps/search/?api=1&query=${c.lat},${c.lng}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

/**
 * @returns {{lede: string|null, rows: Array<{label:string,value:string}>, links: Array<{label:string,url:string}>}}
 */
export function factsFor(item, opts) {
  const platform = (opts && opts.platform) || null;
  const c = (item && item.canonical) || {};
  const rows = [];
  const links = [];
  let lede = null;

  const row = (label, value) => { if (value) rows.push({ label, value: String(value) }); };
  const link = (label, url) => { if (url) links.push({ label, url: String(url) }); };

  if (item?.list === "movies") {
    lede = c.overview || null;
    row("Runtime", isNum(c.runtime_min) ? `${c.runtime_min} min` : null);
    row("Rating", isNum(c.rating) ? `${c.rating} / 10` : null);
    row("Genre", list(c.genres).join(" · "));
    row("With", list(c.cast).join(", "));
    link("Trailer", c.trailer_url);
    // The provider names ARE the label. "Where to watch" makes you tap to find
    // out; "On Mubi, Netflix" has already answered the question.
    const on = list(c.streaming);
    link(on.length ? `On ${on.join(", ")}` : "Where to watch", c.watch_url);
  } else if (item?.list === "books") {
    // The opening line, not a blurb. It is the best single test of whether you
    // want the book, and no other free catalogue carries it.
    lede = c.first_sentence ? `“${c.first_sentence}”` : null;
    row("Author", c.author);
    row("First published", c.year ? String(c.year) : null);
    row("Length", isNum(c.pages) ? `${c.pages} pages` : null);
    row("Rating", isNum(c.rating) ? `${c.rating} / 5` : null);
    row("Shelved as", list(c.subjects).join(" · "));
    link("Open Library", c.read_url);
  } else if (item?.list === "restaurants") {
    row("Address", c.address);
    row("Open", c.opening_hours);
    row("Serves", list(c.cuisine).join(" · "));
    link("Map", mapUrl(item, platform));
    link("Website", c.website);
    link("Call", c.phone ? `tel:${String(c.phone).replace(/\s+/g, "")}` : null);
  } else if (item?.list === "quotes") {
    // A quote's facts are almost nothing, and that is right: the words are on
    // the jacket and in the panel already. What is worth saying is WHO, and
    // where you found it — repeating the quote here would be printing it twice
    // on one screen.
    row("Said by", c.author);
    row("From", c.source);
  } else if (item?.list === "places") {
    row("Where", [c.area, c.city].filter((v, i, a) => v && a.indexOf(v) === i).join(" · "));
    row("Address", c.address);
    row("Open", c.opening_hours);
    // TWO DIFFERENT PROMISES, said differently. A geocoded place opens the map
    // ON it; an unlocated one opens a search that should find it. Labelling
    // both "Map" would make the second one feel broken the first time it lands
    // you somewhere approximate.
    link(c.located === false ? "Find on map" : "Map", mapUrl(item, platform));
    link("Website", c.website);
  } else if (item?.list === "recipes") {
    row("Takes", c.total_time);
    row("Serves", c.serves);
    row("Steps", isNum(c.steps) ? `${c.steps}` : null);
    row("Ingredients", list(c.ingredients).length ? String(list(c.ingredients).length) : null);
    row("Per serving", c.calories);
    row("By", c.author);
    link("Full recipe", c.recipe_url);
  }

  return { lede, rows, links };
}

/** Is there anything at all to draw? Saves rendering a rule above nothing. */
export const hasFacts = (item) => {
  const f = factsFor(item);
  return !!(f.lede || f.rows.length || f.links.length);
};
