// tags.d.ts — types for tags.js.
//
// Same arrangement as find.d.ts: the module is plain JS with no imports so the
// app, the node selftest and api/page.js can all read it, and this file states
// what it takes and returns.
import type { Item } from "./store";

/** A deliberate order: what a person would filter by first. */
export type TagKind =
  | "author" | "director" | "brand" | "area" | "city" | "cuisine"
  | "genre" | "cast" | "year" | "decade" | "site";

export type Tag = {
  kind: TagKind;
  /** As the catalogue spelled it: "Susanna Clarke". */
  value: string;
  /** Folded and stable: "author:susanna clarke". */
  key: string;
};

export type TagRow = Tag & { count: number; ids: string[] };

export function fold(s: unknown, useNormalize?: boolean): string;
/** "" when the value folds to nothing — never a key with an empty name. */
export function tagKey(kind: string, value: unknown): string;
export function tagsFor(item: Partial<Item> | null | undefined): Tag[];
export function tagIndex(items: Partial<Item>[] | null | undefined): TagRow[];
export function itemsWithTag<T extends Partial<Item>>(items: T[] | null | undefined, key: string): T[];
