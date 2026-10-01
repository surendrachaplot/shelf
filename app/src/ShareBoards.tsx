// ShareBoards.tsx — the picker, on both platforms.
//
// One tile per shelf, two across, edge to edge, filling the sheet. No gaps, no
// radius, no shadows: a shelf unit is continuous, and the thing that makes a
// coloured field read as a SHELF rather than a rectangle is the board — a hard
// edge with visible thickness that things rest on. Every tile has one.
//
// IT WAS ONE BAND PER SHELF, full width, and six of those filled a 420pt sheet
// exactly. Eight do not: each band came out 35pt tall, under the 44pt floor,
// and the last one fell off the foot of the sheet. Two columns of four keep
// every tile at 76pt in the sheet and still fill an Android screen.
//
// Type is the icon. Tight caps, solved from the longest shelf name so all
// eight are one size (`capsType`), and you hit the right tile without reading
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
import { ActivityIndicator, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { queueShare, queueImage, type ListName, LISTS } from "./api";
import { Press } from "./Press";
import {
  BAND_BOARD, capsType, COVER_KEYLINE, isPaper, lists, onFor, rowsOf, sp, t, TOUCH_MIN, useTheme, type Palette,
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

// The board under a tile. Paper driven dark is grey in one scheme and
// invisible in the other, so a paper shelf stands on ink, like a jacket does.
const boardOf = (list: ListName, c: Palette) => (isPaper(list, c) ? c.ink : darken(c[list] ?? c.accent));

// Two across. Four rows of eight shelves is the most a 420pt sheet holds with
// every tile clear of the 44pt floor.
const COLS = 2;

export function ShareBoards({ url, text, images, onDone, hosted }: ShareBoardsProps) {
  const { c } = useTheme();
  const s = useMemo(() => styles(c), [c]);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  // The sheet is as wide as the window on both hosts, so the tile width is
  // known before the first frame: no measuring pass, no reflow on open.
  const tileW = useWindowDimensions().width / COLS;
  const label = useMemo(
    () => capsType(LISTS.map((l) => lists[l].label), tileW - sp.lg * 2, t.band.fontSize),
    [tileW]
  );

  const sharedUrl = url ?? text?.match(/https?:\/\/\S+/)?.[0] ?? null;
  // THE SCREENSHOT PATH, and it is no longer "reserved". This variable was
  // read, used to label the sheet "Screenshot", and then ignored by save() —
  // which bailed with "Nothing to save — share a link" on the one input it had
  // just finished naming. Sharing a screenshot did nothing, every time.
  const sharedImage = images?.[0] ?? null;

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
    // A LINK OR A PICTURE. The screenshot route is the one that does not
    // depend on Instagram's cooperation at all — the caption is read off the
    // pixels — so it matters most exactly when the scrape is blocked.
    //
    // Only the PATH is queued. See QueuedShare in api.ts: the bytes stay in
    // the App Group container, which both processes can read, and the app
    // picks them up when it resolves.
    if (!sharedUrl && !sharedImage) {
      setPhase({ kind: "error", message: "Nothing to save — share a link or a screenshot" });
      return;
    }
    const kept = sharedUrl
      ? await queueShare(sharedUrl, list)
      : await queueImage(sharedImage as string, list);
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
    const on = onFor(phase.list, c);
    return (
      <View style={[s.wrap, { backgroundColor: fill }]}>
        <View style={s.doneInner}>
          <Text style={[s.doneKicker, { color: on }]}>Saved</Text>
          <Text style={[s.doneLabel, { color: on }]}>{lists[phase.list].label}</Text>
          <Text style={[s.doneNote, { color: on }]}>{hosted ? "reading it now" : "shelf reads it next time you open the app"}</Text>
        </View>
        <View style={[s.board, { backgroundColor: boardOf(phase.list, c) }]} />
      </View>
    );
  }

  return (
    <View style={s.wrap}>
      <View style={s.head}>
        <Text style={s.kicker}>Put it on →</Text>
        <Text style={s.source} numberOfLines={1}>{source}</Text>
      </View>

      {rowsOf(LISTS.length, COLS).map((row: number[], r: number) => (
        <View key={r} style={s.row}>
          {row.map((i) => {
            const list = LISTS[i];
            const fill = c[list] ?? c.accent;
            const on = onFor(list, c);
            const busy = phase.kind === "saving" && phase.list === list;
            return (
              <Press
                key={list}
                onPress={() => save(list)}
                disabled={phase.kind === "saving"}
                containerStyle={s.tileOuter}
                style={s.tileOuter}
                size={tileW}
                hitSlop={0}
                label={`Put it on ${lists[list].label}`}
              >
                {/* Number at the head, name on the foot: the same two places a
                    jacket puts its series strip and its title. Paper gets an
                    ink keyline, because a white tile on a white sheet is a
                    hole in the grid. */}
                <View style={[s.tile, { backgroundColor: fill }, isPaper(list, c) ? s.tilePaper : null]}>
                  <View style={s.tileHead}>
                    <Text style={[s.tileNum, { color: on }]}>{lists[list].n}</Text>
                    {busy ? <ActivityIndicator color={on} /> : <Text style={[s.tileNum, { color: on }]}>→</Text>}
                  </View>
                  <Text style={[s.tileLabel, label, { color: on }]} numberOfLines={1}>{lists[list].label}</Text>
                </View>
                {/* The board. Six points of visible thickness is the difference
                    between a shelf and a rectangle. */}
                <View style={[s.board, { backgroundColor: boardOf(list, c) }]} />
              </Press>
            );
          })}
        </View>
      ))}

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

  // Each row takes an equal share of whatever height the sheet has, so the
  // unit always fills it — no dead space under the last shelf.
  row: { flex: 1, flexDirection: "row" },
  tileOuter: { flex: 1 },
  tile: { flex: 1, justifyContent: "space-between", paddingHorizontal: sp.lg, paddingVertical: sp.sm, minHeight: TOUCH_MIN },
  // The keyline is INSIDE the tile's padding, not added to it, so "08" and
  // "NOTES" start on the same x as every other tile's number and name.
  tilePaper: {
    borderWidth: COVER_KEYLINE, borderBottomWidth: 0, borderColor: c.ink,
    paddingHorizontal: sp.lg - COVER_KEYLINE, paddingTop: sp.sm - COVER_KEYLINE,
  },
  tileHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  tileNum: { ...t.micro },
  // The size comes from capsType at render; this is the rest of the band step.
  tileLabel: { fontFamily: t.band.fontFamily, fontWeight: "700", textTransform: "uppercase" },
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
