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
 * @returns {{lede: string|null, rows: Array<{label:string,value:string}>, links: Array<{label:string,url:string}>}}
 */
export function factsFor(item) {
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
    link("Map", c.map_url);
    link("Website", c.website);
    link("Call", c.phone ? `tel:${String(c.phone).replace(/\s+/g, "")}` : null);
  } else if (item?.list === "quotes") {
    // A quote's facts are almost nothing, and that is right: the words are on
    // the jacket and in the panel already. What is worth saying is WHO, and
    // where you found it — repeating the quote here would be printing it twice
    // on one screen.
    row("Said by", c.author);
    row("From", c.source);
  } else if (item?.list === "travel") {
    row("Where", [c.area, c.city].filter((v, i, a) => v && a.indexOf(v) === i).join(" · "));
    row("Address", c.address);
    row("Open", c.opening_hours);
    // TWO DIFFERENT PROMISES, said differently. A geocoded place opens the map
    // ON it; an unlocated one opens a search that should find it. Labelling
    // both "Map" would make the second one feel broken the first time it lands
    // you somewhere approximate.
    link(c.located === false ? "Find on map" : "Map", c.map_url);
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
