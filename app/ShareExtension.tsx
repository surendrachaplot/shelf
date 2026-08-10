// ShareExtension.tsx — the sheet that appears over Instagram.
//
// This is the whole product in one screen and its only job is to be FAST.
// The interaction budget is: see it, tap a list, it is gone. Nothing here
// waits on a caption being parsed or a book being looked up — the server
// queues the share and the worker does the slow part while you carry on
// scrolling.
//
// It closes optimistically. If the POST fails the share is written to the
// shared Keychain queue and the app flushes it on next launch, so a tunnel or
// a dead zone costs you nothing. The one thing this screen must never do is
// lose a save silently.
//
// It is also the surface people actually see — several times a day, for about
// a second each time. Every value here comes from design.js and every
// transition is audited frame by frame by verify-design.mjs.
import React, { useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { close, type InitialProps } from "expo-share-extension";
import * as FileSystem from "expo-file-system";
import { ingestImage, ingestUrl, queueShare, type ListName, LISTS } from "./src/api";
import { Press } from "./src/Press";
import { Reveal } from "./src/Reveal";
import { glyph, lists, radius, sp, t, TOUCH, useTheme, type Palette } from "./src/theme";

type Phase =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "done"; offline: boolean }
  | { kind: "error"; message: string };

export default function ShareExtension({ url, text, images }: InitialProps) {
  const { c } = useTheme();
  const s = useMemo(() => styles(c), [c]);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  // Instagram hands over a URL. Some apps put the link in `text` instead, so
  // fall back to the first URL found there rather than showing an empty sheet.
  const sharedUrl = url ?? text?.match(/https?:\/\/\S+/)?.[0] ?? null;
  const sharedImage = images?.[0] ?? null;

  const label = sharedUrl
    ? sharedUrl.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "").slice(0, 48)
    : sharedImage
      ? "Screenshot"
      : "Nothing to save";

  async function save(list: ListName) {
    if (phase.kind === "saving") return;
    setPhase({ kind: "saving" });
    try {
      if (sharedUrl) {
        await ingestUrl(sharedUrl, list);
      } else if (sharedImage) {
        const b64 = await FileSystem.readAsStringAsync(sharedImage, {
          encoding: FileSystem.EncodingType.Base64,
        });
        await ingestImage(b64, "image/jpeg", list);
      } else {
        setPhase({ kind: "error", message: "Nothing was shared" });
        return;
      }
      setPhase({ kind: "done", offline: false });
      // Long enough to read the tick, short enough that it never feels like a
      // wait. The confirmation is the reward for the tap; skipping it makes
      // the sheet feel like it failed.
      setTimeout(close, 480);
    } catch (e) {
      // A URL share can wait for signal. An image cannot — the file lives in a
      // temporary container that is gone by the time the app next opens, so a
      // failed screenshot share is reported rather than silently queued.
      if (sharedUrl) {
        await queueShare(sharedUrl, list);
        setPhase({ kind: "done", offline: true });
        setTimeout(close, 1100);
      } else {
        setPhase({ kind: "error", message: (e as Error).message });
      }
    }
  }

  if (phase.kind === "done") {
    return (
      <View style={[s.wrap, s.center]}>
        <Reveal>
          <Text style={s.tick}>✓</Text>
        </Reveal>
        <Reveal index={1}>
          <Text style={s.doneTitle}>{phase.offline ? "Saved — will sync" : "Saved to shelf"}</Text>
        </Reveal>
        {phase.offline ? (
          <Reveal index={2}>
            <Text style={s.doneHint}>No signal. It'll go up next time you open shelf.</Text>
          </Reveal>
        ) : null}
      </View>
    );
  }

  return (
    <View style={s.wrap}>
      <Text style={s.eyebrow}>Save to</Text>
      <Text style={s.source} numberOfLines={1}>{label}</Text>

      <View style={s.grid}>
        {LISTS.map((list, i) => (
          <Reveal key={list} index={i} style={s.cell}>
            <Press
              onPress={() => save(list)}
              disabled={phase.kind === "saving"}
              containerStyle={s.cellFill}
              style={s.tile}
              size={160}
            >
              <Text style={s.glyph}>{lists[list].glyph}</Text>
              <Text style={s.tileLabel}>{lists[list].label}</Text>
            </Press>
          </Reveal>
        ))}
      </View>

      <Reveal index={LISTS.length}>
        <Press
          onPress={() => save("unsorted")}
          disabled={phase.kind === "saving"}
          style={s.decide}
          size={TOUCH}
        >
          {phase.kind === "saving"
            ? <ActivityIndicator color={c.accent} />
            : <Text style={s.decideLabel}>Decide for me</Text>}
        </Press>
      </Reveal>

      {phase.kind === "error" ? <Text style={s.error}>{phase.message}</Text> : null}
    </View>
  );
}

const styles = (c: Palette) => StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: sp.lg, paddingTop: sp.lg, paddingBottom: sp.md, backgroundColor: c.bg },
  center: { alignItems: "center", justifyContent: "center" },

  tick: { ...t.display, fontSize: glyph.lg, lineHeight: glyph.lg * 1.2, color: c.good, textAlign: "center" },
  doneTitle: { ...t.heading, color: c.ink, textAlign: "center", marginTop: sp.md },
  doneHint: { ...t.meta, color: c.inkSoft, textAlign: "center", marginTop: sp.xs },

  eyebrow: { ...t.micro, color: c.inkFaint },
  source: { ...t.meta, color: c.inkSoft, marginTop: sp.xs, marginBottom: sp.md },

  grid: { flexDirection: "row", flexWrap: "wrap", gap: sp.sm },
  // The sizing lives on the OUTERMOST wrapper and is passed down. Setting it
  // only on the painted tile resolves against a parent that has already
  // shrunk to content — the bug that turned this 2×2 into four narrow pills.
  cell: { width: "48%" },
  cellFill: { width: "100%" },
  tile: {
    // A 2×2 picker, not a row of CTAs — §3's "never stretched buttons" governs
    // `decide` below, which is the actual button.
    width: "100%", minHeight: TOUCH + sp.xxl,
    alignItems: "center", justifyContent: "center", gap: sp.xs,
    backgroundColor: c.surface, borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth * 2, borderColor: c.line,
  },
  glyph: { fontSize: glyph.lg, lineHeight: glyph.lg * 1.15 },
  tileLabel: { ...t.bodyMed, color: c.ink },

  decide: {
    marginTop: sp.md, minHeight: TOUCH, alignSelf: "center", paddingHorizontal: sp.xl,
    alignItems: "center", justifyContent: "center",
    borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: c.line,
  },
  decideLabel: { ...t.bodyMed, color: c.inkSoft },

  error: { ...t.meta, color: c.accent, marginTop: sp.sm, textAlign: "center" },
});
