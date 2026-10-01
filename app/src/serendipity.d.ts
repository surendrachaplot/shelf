// serendipity.d.ts — types for serendipity.js.
//
// Same arrangement as find.d.ts: the module is plain JS so node can run its
// selftest, and this states what it takes and returns.
import type { Item } from "./store";

export type LatLng = { lat: number; lng: number };

export type SurfaceKind = "open-now" | "near" | "year-ago" | "forgotten";

export type Surfaced = {
  kind: SurfaceKind;
  item: Item;
  /** One plain line saying why this card is here. */
  reason: string;
  /** Present on `open-now` and `near`. Build the URL with `mapUrl(item, Platform.OS)`. */
  action?: { type: "map"; label: string };
};

/** `null` means NOT KNOWN: print nothing about open or closed. */
export type OpenState = { open: boolean; until: string | null } | null;

export const WALK_M: number;
export const WEEK_HALF_MS: number;
export const FORGOTTEN_DAYS: number;

export function metresBetween(a: Partial<LatLng> | null | undefined, b: Partial<LatLng> | Record<string, unknown> | null | undefined): number | null;
export function openState(hours: unknown, now: Date): OpenState;
export function surface(
  items: Item[] | null | undefined,
  opts: { now: Date; here?: LatLng | null; limit?: number; seen?: string[] }
): Surfaced[];
