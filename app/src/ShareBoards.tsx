// ShareBoards.tsx — the picker, on both platforms.
//
// One board per shelf, edge to edge, filling the sheet. No gaps, no radius, no
// shadows: a shelf unit is continuous, and the thing that makes a coloured
// field read as a SHELF rather than a rectangle is the board — a hard edge
// with visible thickness that things rest on. Every band has one.
//
// Type is the icon. At 31pt tight caps you hit the right band without reading
// it, which is the entire job: this is on screen for about a second, one
// handed, over whatever you were doing.
//
// ONE COMPONENT, TWO HOSTS. On iOS it is a share extension: a separate
// process, over Instagram, that closes itself. On Android there is no
// extension — ACTION_SEND opens the app itself — so the same boards render
// full screen inside it and hand back to the shelf. Two copies of this would
// drift within a week; the only differences are what "done" does and one line
// of copy, so those are the only two things passed in.
//
// It writes to the queue and nothing else. NO NETWORK. A failed write is the
// one thing this screen must never report as a save.
import React, { useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { queueShare, type ListName, LISTS } from "./api";
import { Press } from "./Press";
import {
  BAND_BOARD, lists, listOn, sp, t, TOUCH_MIN, useTheme, type Palette,
} from "./theme";

export type ShareBoardsProps = {
  url?: string | null;
  text?: string | null;
  images?: string[] | null;
  /** What to do once it is saved: close the extension, or return to the shelf. */
  onDone: () => void;
  /** True when this is running inside the app rather than as an iOS extension. */
  hosted?: boolean;
};

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

export function ShareBoards({ url, text, images, onDone, hosted }: ShareBoardsProps) {
  const { c } = useTheme();
  const s = useMemo(() => styles(c), [c]);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  const sharedUrl = url ?? text?.match(/https?:\/\/\S+/)?.[0] ?? null;
  const sharedImage = images?.[0] ?? null;   // reserved: the screenshot path

  // A shortcode means nothing to a human. Say what the thing IS.
  const source = sharedImage ? "Screenshot"
    : !sharedUrl ? "Nothing to save"
    : /instagram\.com/.test(sharedUrl) ? (/\/reel/.test(sharedUrl) ? "Instagram reel" : "Instagram post")
    : (() => { try { return new URL(sharedUrl).hostname.replace(/^www\./, ""); } catch { return "Link"; } })();

  async function save(list: ListName) {
    if (phase.kind === "saving") return;
    setPhase({ kind: "saving", list });

    // NO NETWORK IN HERE. This sheet is on top of Instagram and it has one
    // job: record what you tapped and get out of the way. It writes to the
    // Keychain group the app shares and closes — well under a second, on any
    // signal, including none.
    //
    // The previous version POSTed to the server from this process, which meant
    // the sheet's speed depended on a server waking up, and a share in a lift
    // was a share you had to be told about. The slow part — scrape, Claude,
    // catalogue — now happens in the app, where there is room to show it.
    if (!sharedUrl) {
      setPhase({ kind: "error", message: "Nothing to save — share a link" });
      return;
    }
    const kept = await queueShare(sharedUrl, list);
    if (!kept) {
      // The one honest failure left: this phone's Keychain group is not
      // shared, so the app will never see what was written. Saying "Saved"
      // here would be a receipt for nothing.
      setPhase({ kind: "error", message: hosted
        ? "Couldn't save — this phone's storage refused the write."
        : "Couldn't save — open shelf once, then try again." });
      return;
    }
    setPhase({ kind: "done", list, offline: false });
    // 420ms is long enough to read the colour and short enough that nobody
    // waits for it. The iOS sheet closes; in-app it hands back to the shelf,
    // which is already resolving what you just tapped.
    setTimeout(onDone, 420);
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
          <Text style={[s.doneKicker, { color: label }]}>Saved</Text>
          <Text style={[s.doneLabel, { color: label }]}>{lists[phase.list].label}</Text>
          <Text style={[s.doneNote, { color: label }]}>{hosted ? "reading it now" : "shelf reads it next time you open the app"}</Text>
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
