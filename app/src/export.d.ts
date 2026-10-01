// export.d.ts — types for export.js.
//
// Same arrangement as find.d.ts: the module is plain JS so node can run its
// selftest, and this states what it takes and returns.
import type { Shelf } from "./store";

export const EXPORT_FORMAT: "shelf-export";
export const EXPORT_VERSION: 1;

export function esc(s: unknown): string;
export function exportJson(shelf: Shelf | null | undefined, opts: { now: Date }): string;
export function exportHtml(shelf: Shelf | null | undefined, opts: { now: Date }): string;
export function exportFilename(kind: "json" | "html", now: Date): string;
