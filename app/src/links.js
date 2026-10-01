// links.js — the other things on your shelves that this one belongs with.
//
// The other app makes you draw these lines by hand. Here they are free: the
// entities are already resolved, so "you kept two more books by her" is a
// lookup and not a feature somebody has to remember to use.
//
// Pure, and the only import is tags.js — a link IS two items carrying the same
// tag, so there is one definition of "same author" and it is the tag's key.
//
// ── A LINK HAS TO BE A REASON, NOT A COINCIDENCE ────────────────────────────
//
// Only the kinds below connect things, strongest first. The same PERSON made
// both; the same person is IN both; they are in the same NEIGHBOURHOOD; they
// are in the same CITY. That is the whole list.
//
// A shared year, decade, genre, cuisine or website is deliberately not here.
// Those are filters — tags.js has them — and as links they are noise: every
// film from 2019 is not "related" to every book from 2019, and a row that says
// so teaches a person to stop reading the row.
import { tagsFor } from "./tags.js";

export const LINK_KINDS = ["author", "director", "cast", "area", "city"];

/**
 * @returns {Array<{reason: {kind: string, value: string}, items: object[]}>}
 * Never the item itself, never an empty group, strongest reason first. An item
 * in the same neighbourhood is also in the same city and appears under both —
 * each row is true on its own, and dropping it from "London" to avoid the
 * repeat would make that row a lie.
 */
export function linksFor(item, items) {
  const mine = tagsFor(item)
    .filter((t) => LINK_KINDS.includes(t.kind))
    .sort((a, b) => LINK_KINDS.indexOf(a.kind) - LINK_KINDS.indexOf(b.kind));
  if (!mine.length) return [];

  // One pass over the shelf, not one per reason.
  const groups = new Map(mine.map((t) => [t.key, []]));
  for (const other of items || []) {
    // By id as well as by identity: the open item is very often a COPY of the
    // one in the array, and "related to itself" is the silliest row there is.
    if (!other || other === item || (item.id && other.id === item.id)) continue;
    for (const t of tagsFor(other)) groups.get(t.key)?.push(other);
  }

  return mine
    .map((t) => ({ reason: { kind: t.kind, value: t.value }, items: groups.get(t.key) }))
    .filter((g) => g.items.length);
}
