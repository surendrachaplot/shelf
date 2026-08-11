// ShareExtension.tsx — the sheet that appears over Instagram.
//
// Four boards, edge to edge, filling the sheet. No gaps, no radius, no
// shadows: a shelf unit is continuous, and the thing that makes a coloured
// field read as a SHELF rather than a rectangle is the board — a hard edge
// with visible thickness that things rest on. Every band has one.
//
// Type is the icon. At 31pt tight caps you hit the right band without reading
// it, which is the entire job: this is on screen for about a second, over
// another app, one-handed.
//
// It closes optimistically. A failed POST goes to the shared Keychain queue
// and is flushed on next launch. The one thing this screen must never do is
// lose a save silently.
import React, { useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { close, type InitialProps } from "expo-share-extension";
import * as FileSystem from "expo-file-system";
import { ingestImage, ingestUrl, NOT_PAIRED, queueShare, type ListName, LISTS } from "./src/api";
import { Press } from "./src/Press";
import {
  BAND_BOARD, lists, listOn, sp, t, TOUCH_MIN, useTheme, type Palette,
} from "./src/theme";

type Phase =
  | { kind: "idle" }
  | { kind: "saving"; list: ListName }
  | { kind: "done"; list: ListName; offline: boolean }
  | { kind: "error"; message: string };

// The board is the same hue driven dark. Derived, not hand-picked, so a new
// list cannot arrive without one.
function darken(hex: string, amount = 0.34) {
  const h = hex.replace("#", "");
  const v = [0, 2, 4].map((i) => Math.round(parseInt(h.slice(i, i + 2), 16) * (1 - amount)));
  return "#" + v.map((x) => x.toString(16).padStart(2, "0")).join("");
}

export default function ShareExtension({ url, text, images }: InitialProps) {
  const { c } = useTheme();
  const s = useMemo(() => styles(c), [c]);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  const sharedUrl = url ?? text?.match(/https?:\/\/\S+/)?.[0] ?? null;
  const sharedImage = images?.[0] ?? null;

  // A shortcode means nothing to a human. Say what the thing IS.
  const source = sharedImage ? "Screenshot"
    : !sharedUrl ? "Nothing to save"
    : /instagram\.com/.test(sharedUrl) ? (/\/reel/.test(sharedUrl) ? "Instagram reel" : "Instagram post")
    : (() => { try { return new URL(sharedUrl).hostname.replace(/^www\./, ""); } catch { return "Link"; } })();

  async function save(list: ListName) {
    if (phase.kind === "saving") return;
    setPhase({ kind: "saving", list });
    try {
      if (sharedUrl) {
        await ingestUrl(sharedUrl, list);
      } else if (sharedImage) {
        const b64 = await FileSystem.readAsStringAsync(sharedImage, { encoding: FileSystem.EncodingType.Base64 });
        await ingestImage(b64, "image/jpeg", list);
      } else {
        setPhase({ kind: "error", message: "Nothing was shared" });
        return;
      }
      setPhase({ kind: "done", list, offline: false });
      setTimeout(close, 520);
    } catch (e) {
      const why = (e as Error).message;
      // No key on this phone. Queuing would be theatre: the queue lives in the
      // same shared Keychain the key is missing from, so it would either fail
      // too or land somewhere the app can never read — and the sheet would
      // have said "Queued" either way. Say the true thing instead.
      if (why === NOT_PAIRED) {
        setPhase({ kind: "error", message: "Open shelf on this phone once, then share again." });
        return;
      }
      // Anything else is the network. Keep it, but only claim to have kept it
      // if the write is actually readable back.
      if (sharedUrl && (await queueShare(sharedUrl, list))) {
        setPhase({ kind: "done", list, offline: true });
        setTimeout(close, 1200);
      } else {
        setPhase({ kind: "error", message: why });
      }
    }
  }

  // The confirmation is the band you just hit, filling the whole sheet. No
  // tick, no dialog — the colour IS the receipt, and it is unmistakable at
  // arm's length.
  if (phase.kind === "done") {
    const fill = c[phase.list] ?? c.accent;
    const label = listOn[phase.list] ?? c.onList;
    return (
      <View style={[s.wrap, { backgroundColor: fill }]}>
        <View style={s.doneInner}>
          <Text style={[s.doneKicker, { color: label }]}>{phase.offline ? "Queued" : "Shelved"}</Text>
          <Text style={[s.doneLabel, { color: label }]}>{lists[phase.list].label}</Text>
          {phase.offline ? (
            <Text style={[s.doneNote, { color: label }]}>No signal — it goes up next time you open shelf</Text>
          ) : null}
        </View>
        <View style={[s.board, { backgroundColor: darken(fill) }]} />
      </View>
    );
  }

  return (
    <View style={s.wrap}>
      <View style={s.head}>
        <Text style={s.kicker}>Put it on →</Text>
        <Text style={s.source} numberOfLines={1}>{source}</Text>
      </View>

      {LISTS.map((list) => {
        const fill = c[list] ?? c.accent;
        const label = listOn[list] ?? c.onList;
        const busy = phase.kind === "saving" && phase.list === list;
        return (
          <Press
            key={list}
            onPress={() => save(list)}
            disabled={phase.kind === "saving"}
            containerStyle={s.bandOuter}
            style={s.bandOuter}
            size={340}
            label={`Put it on ${lists[list].label}`}
          >
            <View style={[s.band, { backgroundColor: fill }]}>
              <Text style={[s.bandNum, { color: label }]}>{lists[list].n}</Text>
              <Text style={[s.bandLabel, { color: label }]} numberOfLines={1}>{lists[list].label}</Text>
              {busy
                ? <ActivityIndicator color={label} />
                : <Text style={[s.bandNum, { color: label }]}>→</Text>}
            </View>
            {/* The board. Six points of visible thickness is the difference
                between a shelf and a rectangle. */}
            <View style={[s.board, { backgroundColor: darken(fill) }]} />
          </Press>
        );
      })}

      <Press
        onPress={() => save("unsorted")}
        disabled={phase.kind === "saving"}
        style={s.foot}
        size={340}
        label="Let shelf decide which list"
      >
        <Text style={s.footLeft}>Not sure</Text>
        <Text style={s.footRight}>Decide for me →</Text>
      </Press>

      {phase.kind === "error" ? <Text style={s.error}>{phase.message}</Text> : null}
    </View>
  );
}

const styles = (c: Palette) => StyleSheet.create({
  wrap: { flex: 1, backgroundColor: c.bg },

  head: { flexDirection: "row", alignItems: "baseline", paddingHorizontal: sp.lg, paddingTop: sp.lg, paddingBottom: sp.md },
  kicker: { ...t.micro, color: c.ink, flex: 1 },
  source: { ...t.meta, color: c.inkFaint },

  // Each band takes an equal share of whatever height the sheet has, so the
  // unit always fills it — no dead space under the last shelf.
  bandOuter: { flex: 1 },
  band: { flex: 1, flexDirection: "row", alignItems: "center", gap: sp.md, paddingHorizontal: sp.lg, minHeight: TOUCH_MIN },
  bandNum: { ...t.micro, opacity: 0.55 },
  bandLabel: { ...t.band, flex: 1 },
  board: { height: BAND_BOARD },

  foot: { flexDirection: "row", alignItems: "center", paddingHorizontal: sp.lg, minHeight: TOUCH + 0 },
  footLeft: { ...t.micro, color: c.ink, flex: 1 },
  footRight: { ...t.micro, color: c.inkFaint },

  doneInner: { flex: 1, justifyContent: "center", paddingHorizontal: sp.lg },
  doneKicker: { ...t.micro, opacity: 0.6 },
  doneLabel: { ...t.wordmark, marginTop: sp.sm },
  doneNote: { ...t.meta, marginTop: sp.md, opacity: 0.8 },

  error: { ...t.meta, color: c.accent, textAlign: "center", paddingVertical: sp.sm },
});

const TOUCH = TOUCH_MIN + 4;
