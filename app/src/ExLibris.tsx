// ExLibris.tsx — the plate, on the phone.
//
// The generator lives in `exlibris.js` and returns a description; this is one
// of its two renderers and `api/page.js` is the other. That split is the whole
// point: your mark on your phone and your mark on the page you sent someone
// have to be the same object down to the point, or it is not an identity.
import React from "react";
import { View } from "react-native";
import Svg, { Circle, Line, Path, Polygon, Rect, Text as SvgText } from "react-native-svg";
import { arcPath, PLATE, plateColours, plateShapes } from "./exlibris.js";
import * as D from "./design.js";
import { listOn, useTheme } from "./theme";

/**
 * `seed` is what the plate is derived from — the handle at the time it was
 * first set, not the current one. Someone can rename themselves without their
 * mark changing under the people who recognise it.
 */
export function ExLibris({ seed, size = 96 }: { seed: string; size?: number }) {
  const { dark } = useTheme();
  // Resolved against the LIVE palette rather than frozen at import: a mark that
  // could not follow the system appearance would be the one thing on screen
  // still in yesterday's scheme.
  const colours = plateColours(seed, dark ? D.dark : D.light, listOn);

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox={`0 0 ${PLATE} ${PLATE}`}>
        {plateShapes(seed).map((s: any, i: number) => {
          const fill = s.fill ? colours[s.fill as keyof typeof colours] : "none";
          const stroke = s.stroke ? colours[s.stroke as keyof typeof colours] : "none";
          if (s.k === "rect") return <Rect key={i} x={s.x} y={s.y} width={s.w} height={s.h} fill={fill} stroke={stroke} strokeWidth={s.sw ?? 0} />;
          if (s.k === "circle") return <Circle key={i} cx={s.cx} cy={s.cy} r={s.r} fill={fill} stroke={stroke} strokeWidth={s.sw ?? 0} />;
          if (s.k === "line") return <Line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={stroke} strokeWidth={s.sw ?? 0} />;
          if (s.k === "poly") return <Polygon key={i} points={s.pts.map((p: number[]) => p.join(",")).join(" ")} fill={fill} stroke={stroke} strokeWidth={s.sw ?? 0} />;
          if (s.k === "arc") return <Path key={i} d={arcPath(s)} fill="none" stroke={stroke} strokeWidth={s.sw ?? 0} />;
          if (s.k === "text") {
            return (
              <SvgText
                key={i} x={s.x} y={s.y} fill={fill} fontSize={s.size} fontWeight={s.weight}
                textAnchor={s.anchor} letterSpacing={-1}
              >
                {s.value}
              </SvgText>
            );
          }
          return null;
        })}
      </Svg>
    </View>
  );
}
