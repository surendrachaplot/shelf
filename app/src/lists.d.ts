// lists.d.ts — types for lists.js.
//
// Same arrangement as find.d.ts and tags.d.ts: the module is plain JS so the
// app and the node selftest both read it, and this file states what it takes
// and returns. A list is a `Board` in store.ts — that is the name of the field
// in the file on the phone, because `list` on an item already means its shelf.
import type { Item, Board } from "./store";

export type ListView = Board["view"];

export type Money = {
  /** ISO code, upper case: "GBP". */
  currency: string;
  /** In the currency's main unit: 12.5 is twelve pounds fifty. */
  amount: number;
  /** "£12.50", and "£12" when the amount is whole. */
  text: string;
};

export type Total = {
  /** One line per currency, largest amount first. Never added together. */
  byCurrency: Money[];
  priced: number;
  unpriced: number;
};

export type MoneyOpts = {
  /** Left out: the phone's own. */
  locale?: string;
  /** `null` takes the path of an engine with no Intl. For the selftest. */
  NumberFormat?: typeof Intl.NumberFormat | null;
};

export const NAME_MAX: number;
export const VIEWS: ListView[];

/** null when the name is empty after trimming. */
export function makeList(name: string, opts?: { now?: number | string | Date; id?: string }): Board | null;

// Every one of these returns a NEW array, or the SAME array when there was
// nothing to do — so `next === lists` means "do not save".
export function renameList(lists: Board[], listId: string, name: string): Board[];
export function removeList(lists: Board[], listId: string): Board[];
export function setView(lists: Board[], listId: string, view: ListView): Board[];
export function setQuery(lists: Board[], listId: string, query: string | null): Board[];
export function pin(lists: Board[], listId: string, itemId: string): Board[];
export function unpin(lists: Board[], listId: string, itemId: string): Board[];
export function togglePin(lists: Board[], listId: string, itemId: string): Board[];
/** `toIndex` is where the pin ends up; past either end is the end. */
export function movePin(lists: Board[], listId: string, itemId: string, toIndex: number): Board[];

/** Pins in pin order, then what the saved search finds. Dead pins are skipped. */
export function itemsOf<T extends Item>(list: Board | null | undefined, items: T[] | null | undefined): T[];
/** Only on a shelf whose state is "read" — see lists.js. */
export function prune(lists: Board[], items: Pick<Item, "id">[] | null | undefined): Board[];
/** The lists an item is PINNED on. A saved search finding it does not count. */
export function listsWith(lists: Board[] | null | undefined, itemId: string): Board[];

export function priceOf(item: Partial<Item> | null | undefined): { amount: number; currency: string } | null;
export function priceText(amount: number, currency: string, opts?: MoneyOpts): string;
export function totalOf(list: Board | null | undefined, items: Item[] | null | undefined, opts?: MoneyOpts): Total;
export function shelfTotal(items: Partial<Item>[] | null | undefined, opts?: MoneyOpts): Total;
