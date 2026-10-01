// find.d.ts — types for find.js.
//
// The module itself is plain JS whose only import is tags.js (which imports
// nothing), so the app, the node selftest and (one day) the published page can
// all read it — the same arrangement design.js and facts.js have. TypeScript infers a shape from the defaults in
// that file, and the shape it infers is wrong in exactly the way that matters:
// `list = null` makes the parameter `null`, so passing a real shelf name is an
// error. This file states what the module actually takes and returns.
import type { Item } from "./store";

export type FindField =
  | "title" | "subtitle" | "tags" | "facts" | "note" | "caption" | "list"
  /** The words read off a screenshot: `canonical.ocr_text`. */
  | "ocr"
  /** The readable page: `canonical.article` — byline, summary and text. */
  | "article";

/** One item that matched, with what to say about WHY it matched. */
export type FindHit = {
  item: Item;
  score: number;
  /** The field that best explains this row — `null` when the title says it. */
  why: FindField | null;
  /** The words around the match, for a `why` that is not the title. */
  snippet: string | null;
};

export type FindResult = {
  hits: FindHit[];
  /** How many matched on each shelf, counted BEFORE any list filter. */
  counts: Record<string, number>;
  total: number;
  terms: string[];
};

export const W: Record<FindField, number>;
export function fold(s: unknown, useNormalize?: boolean): string;
export function words(s: unknown): string[];
export function initials(toks: string[]): string;
export function withinOneEdit(a: string, b: string): boolean;
export function tokenScore(q: string, tok: string): number;
export function factsText(canonical: unknown, depth?: number): string;
export function fieldsOf(item: Partial<Item>): { name: FindField; weight: number; text: string }[];
/** The raw prose of a long field, capped. "" when the item has none. */
export function bodyText(item: Partial<Item>, field: "ocr" | "article"): string;
/** A typed word in a FOLDED body: whole word 1, start of a word 0.85, else 0. */
export function bodyHit(hay: string, q: string): { score: number; at: number };
export function scoreItem(item: Item, terms: string[], phrase: string): FindHit | null;
export function snippetOf(item: Partial<Item>, field: FindField, terms: string[], width?: number): string | null;
export function searchShelf(
  items: Item[] | null | undefined,
  q: string,
  opts?: { limit?: number; list?: string | null }
): FindResult;
export function alreadyShelved(
  items: Item[] | null | undefined,
  hit: { list: string; key?: string; title: string }
): boolean;
