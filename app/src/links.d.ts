// links.d.ts — types for links.js. Same arrangement as find.d.ts.
import type { Item } from "./store";
import type { TagKind } from "./tags";

export type LinkGroup<T = Item> = {
  /** Why these belong together: `{ kind: "author", value: "Susanna Clarke" }`. */
  reason: { kind: TagKind; value: string };
  /** Never empty, and never the item that was asked about. */
  items: T[];
};

/** The kinds strong enough to connect two items, strongest first. */
export const LINK_KINDS: TagKind[];
export function linksFor<T extends Partial<Item>>(
  item: Partial<Item> | null | undefined,
  items: T[] | null | undefined
): LinkGroup<T>[];
