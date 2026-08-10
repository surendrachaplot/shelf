// Icon.tsx — the icon set, drawn.
//
// NO EMOJI. Emoji as UI is the single loudest signal that nobody drew
// anything: they carry another vendor's illustration style, they refuse your
// colour, they render differently on every OS, and they sit at a weight and
// optical size you did not choose. Four of them in a row is not an icon set,
// it is a fallback.
//
// Everything below is on a 24 grid at one stroke weight with round caps, so
// the family reads as one hand. Each takes `color` so a list's own identity
// colour flows through it.
import React from "react";
import Svg, { Path, Rect, Line } from "react-native-svg";
import { icon as sizes, STROKE } from "./design.js";

export type IconName =
  | "books" | "restaurants" | "movies" | "recipes"
  | "inbox" | "trash" | "check" | "chevron" | "offline";

export function Icon({ name, size = sizes.md, color, strokeWidth = STROKE }: {
  name: IconName; size?: number; color: string; strokeWidth?: number;
}) {
  const common = {
    stroke: color, strokeWidth, strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const, fill: "none",
  };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === "books" && (
        <>
          {/* Spines on a shelf — the metaphor, drawn rather than described. */}
          <Rect x={4.5} y={6.25} width={3.6} height={12.25} rx={1} {...common} />
          <Rect x={10.2} y={3.75} width={3.6} height={14.75} rx={1} {...common} />
          <Rect x={15.9} y={8.25} width={3.6} height={10.25} rx={1} {...common} />
          <Line x1={3} y1={20.5} x2={21} y2={20.5} {...common} />
        </>
      )}
      {name === "restaurants" && (
        <>
          <Path d="M7.25 3.5 v4.4 a3 3 0 0 0 6 0 V3.5" {...common} />
          <Line x1={10.25} y1={3.5} x2={10.25} y2={7.9} {...common} />
          <Line x1={10.25} y1={10.9} x2={10.25} y2={20.5} {...common} />
          <Path d="M17.25 3.5 c1.9 2.1 1.9 6.1 0 8 V20.5" {...common} />
        </>
      )}
      {name === "movies" && (
        <>
          <Rect x={3.25} y={4.75} width={17.5} height={14.5} rx={2.5} {...common} />
          <Line x1={8} y1={4.75} x2={8} y2={19.25} {...common} />
          <Line x1={16} y1={4.75} x2={16} y2={19.25} {...common} />
          <Line x1={8} y1={12} x2={16} y2={12} {...common} />
        </>
      )}
      {name === "recipes" && (
        <>
          <Path d="M4.75 11.5 h11 v4.25 a3 3 0 0 1 -3 3 h-5 a3 3 0 0 1 -3 -3 Z" {...common} />
          <Line x1={15.75} y1={13} x2={19.5} y2={13} {...common} />
          <Path d="M8 8.5 c0 -1.5 1.5 -1.5 1.5 -3" {...common} />
          <Path d="M12 8.5 c0 -1.5 1.5 -1.5 1.5 -3" {...common} />
        </>
      )}
      {name === "inbox" && (
        <>
          <Path d="M3.5 13 h4.75 l1.5 2.5 h4.5 l1.5 -2.5 h4.75" {...common} />
          <Path d="M3.5 13 L6.25 5.75 a1.5 1.5 0 0 1 1.4 -1 h8.7 a1.5 1.5 0 0 1 1.4 1 L20.5 13 v4.25 a2 2 0 0 1 -2 2 H5.5 a2 2 0 0 1 -2 -2 Z" {...common} />
        </>
      )}
      {name === "trash" && (
        <>
          <Line x1={4.75} y1={7} x2={19.25} y2={7} {...common} />
          <Path d="M9 7 V5.25 A1.5 1.5 0 0 1 10.5 3.75 h3 A1.5 1.5 0 0 1 15 5.25 V7" {...common} />
          <Path d="M6.5 7 l.9 11.6 a1.75 1.75 0 0 0 1.75 1.65 h5.7 a1.75 1.75 0 0 0 1.75 -1.65 L17.5 7" {...common} />
        </>
      )}
      {name === "check" && <Path d="M5 12.5 L9.75 17.25 L19 6.5" {...common} />}
      {name === "chevron" && <Path d="M9.75 5.5 L16.25 12 L9.75 18.5" {...common} />}
      {name === "offline" && (
        <>
          <Path d="M4 9.5 a13 13 0 0 1 16 0" {...common} />
          <Path d="M7.5 13 a8 8 0 0 1 9 0" {...common} />
          <Line x1={12} y1={17.5} x2={12} y2={17.5} {...common} />
          <Line x1={4} y1={4} x2={20} y2={20} {...common} />
        </>
      )}
    </Svg>
  );
}

/** The four lists plus the Inbox, mapped to their marks. */
export const listIcon: Record<string, IconName> = {
  books: "books", restaurants: "restaurants", movies: "movies",
  recipes: "recipes", unsorted: "inbox",
};
