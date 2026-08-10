// ShareExtension.tsx — the sheet that appears over Instagram.
//
// This is the whole product in one screen, and its only job is to be FAST.
// The interaction budget is: see it, tap a list, it is gone. Nothing here
// waits on a caption being parsed or a book being looked up — the server
// queues the share and the worker does the slow part while you carry on
// scrolling.
//
// It closes optimistically. If the POST fails the share is written to the
// shared Keychain queue and the main app flushes it on next launch, so a
// tunnel or a dead zone costs you nothing. The one thing this screen must
// never do is lose a save silently.
import React, { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { close, type InitialProps } from "expo-share-extension";
import * as FileSystem from "expo-file-system";
import { ingestImage, ingestUrl, queueShare, type ListName, LISTS } from "./src/api";
import { c, lists, radius, t, touch } from "./src/theme";

type Phase = { kind: "idle" } | { kind: "saving" } | { kind: "done"; offline: boolean } | { kind: "error"; message: string };

export default function ShareExtension({ url, text, images }: InitialProps) {
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
      setTimeout(close, 450);
    } catch (e) {
      // A URL share can wait for signal. An image cannot — the file lives in a
      // temporary container that is gone by the time the app next opens, so a
      // failed screenshot share is reported rather than silently queued.
      if (sharedUrl) {
        await queueShare(sharedUrl, list);
        setPhase({ kind: "done", offline: true });
        setTimeout(close, 900);
      } else {
        setPhase({ kind: "error", message: (e as Error).message });
      }
    }
  }

  if (phase.kind === "done") {
    return (
      <View style={[s.wrap, s.center]}>
        <Text style={s.tick}>✓</Text>
        <Text style={t.heading}>{phase.offline ? "Saved — will sync" : "Saved to shelf"}</Text>
        {phase.offline ? <Text style={[t.meta, s.gap]}>No signal. It'll go up next time you open shelf.</Text> : null}
      </View>
    );
  }

  return (
    <View style={s.wrap}>
      <Text style={t.tiny}>Save to</Text>
      <Text style={s.source} numberOfLines={1}>{label}</Text>

      <View style={s.grid}>
        {LISTS.map((list) => (
          <Pressable
            key={list}
            onPress={() => save(list)}
            disabled={phase.kind === "saving"}
            style={({ pressed }) => [s.tile, pressed && s.tilePressed]}
          >
            <Text style={s.glyph}>{lists[list].glyph}</Text>
            <Text style={s.tileLabel}>{lists[list].label}</Text>
          </Pressable>
        ))}
      </View>

      <Pressable
        onPress={() => save("unsorted")}
        disabled={phase.kind === "saving"}
        style={({ pressed }) => [s.decide, pressed && s.tilePressed]}
      >
        {phase.kind === "saving"
          ? <ActivityIndicator color={c.accent} />
          : <Text style={s.decideLabel}>Decide for me</Text>}
      </Pressable>

      {phase.kind === "error" ? <Text style={s.error}>{phase.message}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: 18, paddingTop: 16, paddingBottom: 12, backgroundColor: c.bg },
  center: { alignItems: "center", justifyContent: "center" },
  tick: { fontSize: 40, color: c.ok, marginBottom: 8 },
  gap: { marginTop: 6, textAlign: "center" },
  source: { ...t.meta, marginTop: 2, marginBottom: 14 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  tile: {
    flexGrow: 1, flexBasis: "45%", minHeight: touch + 20,
    alignItems: "center", justifyContent: "center",
    backgroundColor: c.card, borderRadius: radius,
    borderWidth: 1, borderColor: c.line, gap: 4,
  },
  tilePressed: { backgroundColor: c.accentSoft, borderColor: c.accent },
  glyph: { fontSize: 22 },
  tileLabel: { ...t.body, fontWeight: "600" },
  decide: {
    marginTop: 10, minHeight: touch, alignItems: "center", justifyContent: "center",
    borderRadius: radius, borderWidth: 1, borderColor: c.line, backgroundColor: "transparent",
  },
  decideLabel: { ...t.body, color: c.inkSoft, fontWeight: "600" },
  error: { ...t.meta, color: c.accent, marginTop: 8, textAlign: "center" },
});
