// ShareExtension.tsx — the sheet that appears over Instagram.
//
// This is the whole product in one screen and its only job is to be FAST:
// see it, tap a list, gone. The server queues the share and the worker does
// the slow part while you carry on scrolling.
//
// It is also the surface people actually see — several times a day, for about
// a second each. So it is four FILED ROWS, not four grey boxes: each list
// carries its own colour on a spine at the left edge, its own drawn mark, and
// its name set in the serif. You are choosing a shelf, and it should look like
// choosing a shelf.
//
// It closes optimistically. A failed POST is written to the shared Keychain
// queue and flushed on next launch. The one thing this screen must never do is
// lose a save silently.
import React, { useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { close, type InitialProps } from "expo-share-extension";
import * as FileSystem from "expo-file-system";
import { ingestImage, ingestUrl, queueShare, type ListName, LISTS } from "./src/api";
import { Icon, listIcon } from "./src/Icon";
import { Press } from "./src/Press";
import { Reveal } from "./src/Reveal";
import { elevation, icon, lists, radius, sp, t, TOUCH, useTheme, type Palette } from "./src/theme";

type Phase =
  | { kind: "idle" }
  | { kind: "saving"; list: ListName }
  | { kind: "done"; list: ListName; offline: boolean }
  | { kind: "error"; message: string };

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
      // Long enough to read, short enough that it never feels like a wait. The
      // confirmation is the reward for the tap; skipping it reads as failure.
      setTimeout(close, 520);
    } catch (e) {
      if (sharedUrl) {
        await queueShare(sharedUrl, list);
        setPhase({ kind: "done", list, offline: true });
        setTimeout(close, 1200);
      } else {
        setPhase({ kind: "error", message: (e as Error).message });
      }
    }
  }

  if (phase.kind === "done") {
    const tint = c[phase.list] ?? c.accent;
    return (
      <View style={[s.wrap, s.center]}>
        <Reveal>
          <View style={[s.doneMark, { borderColor: tint }]}>
            <Icon name={phase.offline ? "offline" : "check"} size={icon.lg} color={tint} />
          </View>
        </Reveal>
        <Reveal index={1}>
          <Text style={s.doneTitle}>
            {phase.offline ? "Saved — will sync" : `Saved to ${lists[phase.list].label}`}
          </Text>
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
      <Text style={s.source} numberOfLines={1}>{source}</Text>

      <View style={s.rows}>
        {LISTS.map((list, i) => {
          const tint = c[list] ?? c.accent;
          const active = phase.kind === "saving" && phase.list === list;
          return (
            <Reveal key={list} index={i}>
              <Press
                onPress={() => save(list)}
                disabled={phase.kind === "saving"}
                style={s.row}
                size={320}
                label={`Save to ${lists[list].label}`}
              >
                {/* The spine. Each list is a different thing and reads like one
                    before you have read a single word. */}
                <View style={[s.spine, { backgroundColor: tint }]} />
                <View style={s.rowIcon}><Icon name={listIcon[list]} size={icon.md} color={tint} /></View>
                <Text style={s.rowLabel}>{lists[list].label}</Text>
                {active
                  ? <ActivityIndicator color={tint} style={s.rowEnd} />
                  : <View style={s.rowEnd}><Icon name="chevron" size={icon.sm} color={c.inkFaint} /></View>}
              </Press>
            </Reveal>
          );
        })}
      </View>

      <Reveal index={LISTS.length}>
        <Press
          onPress={() => save("unsorted")}
          disabled={phase.kind === "saving"}
          style={s.decide}
          size={TOUCH}
          label="Let shelf decide which list"
        >
          <Text style={s.decideLabel}>Not sure — let shelf decide</Text>
        </Press>
      </Reveal>

      {phase.kind === "error" ? <Text style={s.error}>{phase.message}</Text> : null}
    </View>
  );
}

const styles = (c: Palette) => StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: sp.lg, paddingTop: sp.lg, paddingBottom: sp.md, backgroundColor: c.bg },
  center: { alignItems: "center", justifyContent: "center" },

  doneMark: {
    width: icon.xl + sp.md, height: icon.xl + sp.md, borderRadius: radius.pill,
    borderWidth: 2, alignItems: "center", justifyContent: "center",
  },
  doneTitle: { ...t.heading, color: c.ink, textAlign: "center", marginTop: sp.md },
  doneHint: { ...t.meta, color: c.inkSoft, textAlign: "center", marginTop: sp.xs },

  eyebrow: { ...t.micro, color: c.inkFaint },
  source: { ...t.meta, color: c.inkSoft, marginTop: 2, marginBottom: sp.lg },

  rows: { gap: sp.sm },
  row: {
    flexDirection: "row", alignItems: "center", minHeight: TOUCH + sp.md,
    backgroundColor: c.surface, borderRadius: radius.md,
    paddingRight: sp.md,
    ...elevation.card,
  },
  // A 4pt bar, full height, flush to the leading edge — a spine, not a badge.
  spine: {
    width: sp.xs, alignSelf: "stretch",
    borderTopLeftRadius: radius.md, borderBottomLeftRadius: radius.md,
  },
  rowIcon: { width: TOUCH, alignItems: "center" },
  rowLabel: { ...t.heading, color: c.ink, flex: 1 },
  rowEnd: { width: icon.md, alignItems: "flex-end" },

  decide: {
    marginTop: sp.lg, minHeight: TOUCH, alignSelf: "center",
    paddingHorizontal: sp.md, alignItems: "center", justifyContent: "center",
  },
  decideLabel: { ...t.meta, color: c.inkFaint },

  error: { ...t.meta, color: c.accent, marginTop: sp.sm, textAlign: "center" },
});
