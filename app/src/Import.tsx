// Import.tsx — bring screenshots in from the camera roll.
//
// THE SHARE SHEET IS NOT THE ONLY WAY IN, and pretending it is costs the app
// the most common way people actually collect things. Screenshots accumulate:
// you screenshot a bookshop, a menu, a film poster, a page of a book, and by
// the end of a week the camera roll holds twenty things you meant to keep and
// a share sheet reaches exactly none of them retrospectively.
//
// So: pick many, read many, file many. The permission ask is the price and it
// is asked once, at the moment somebody taps a button that says what it does —
// never at launch, where a permission dialog with no context is a permission
// dialog people deny.
//
// LIMITED ACCESS IS A FIRST-CLASS OUTCOME. iOS lets somebody grant access to
// SOME photos rather than all of them, and a picker that treats that as a
// refusal is a picker that fails for the most privacy-careful users. The
// system picker handles the selection itself; all this needs to do is not
// mistake "limited" for "denied".
import React, { useMemo, useState } from "react";
import { ActivityIndicator, Image, ScrollView, Text, View, StyleSheet } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Press } from "./Press";
import { lists, listOn, sp, t, TOUCH_MIN, RULE, useTheme, type Palette } from "./theme";
import { LISTS, type ListName } from "./api";

export type Picked = { uri: string };

/**
 * A thumbnail that survives its own failure.
 *
 * A picked photo can refuse to render — an iCloud asset that has not been
 * downloaded, a file the OS revoked access to between picking and drawing.
 * §6: a hole where a picture should be is not a state, it is an accident. The
 * fallback is a plain block, so a strip of twelve still reads as twelve.
 */
function Thumb({ uri, s, c }: { uri: string; s: ReturnType<typeof styles>; c: Palette }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <View style={[s.thumb, s.thumbGone]}>
        <Text style={[s.thumbGoneMark, { color: c.inkFaint }]}>—</Text>
      </View>
    );
  }
  return (
    <Image source={{ uri }} style={s.thumb} resizeMode="cover" onError={() => setFailed(true)} />
  );
}

type Phase =
  | { kind: "idle" }
  | { kind: "denied" }
  | { kind: "chosen"; picked: Picked[] }
  | { kind: "reading"; done: number; total: number };

/**
 * `onImport` is handed the chosen files and the shelf to file them on. It does
 * the reading and the resolving — this component's whole job is choosing, and
 * a picker that also owned the network would be a second copy of drainShares.
 */
export function Import({ onImport, onClose }: {
  onImport: (uris: string[], list: ListName) => Promise<void>;
  onClose: () => void;
}) {
  const { c } = useTheme();
  const s = useMemo(() => styles(c), [c]);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  async function pick() {
    // Ask at the tap, not at launch. `granted` covers full access; `limited`
    // (iOS) means the person chose specific photos and the picker will show
    // exactly those — a perfectly good outcome, and treating it as a refusal
    // is the bug this branch exists to avoid.
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted && perm.status !== ImagePicker.PermissionStatus.GRANTED) {
      // `canAskAgain: false` means the OS will no longer show the dialog, so
      // "try again" is a lie — Settings is the only route left, and saying so
      // is the difference between a dead end and an instruction.
      setPhase({ kind: "denied" });
      return;
    }

    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      selectionLimit: 20,
      // No base64 here. The file is read — and shrunk if it is large — in
      // screenshots.ts, which is the one place that knows the size ceiling.
      // Asking the picker for base64 as well would hold twenty screenshots in
      // memory at once for no reason.
      quality: 1,
      exif: false,
    });
    if (res.canceled || !res.assets?.length) return;
    setPhase({ kind: "chosen", picked: res.assets.map((a) => ({ uri: a.uri })) });
  }

  async function file(list: ListName) {
    if (phase.kind !== "chosen") return;
    const uris = phase.picked.map((p) => p.uri);
    setPhase({ kind: "reading", done: 0, total: uris.length });
    try {
      await onImport(uris, list);
      onClose();
    } catch (e) {
      setPhase({ kind: "idle" });
    }
  }

  return (
    <View style={s.wrap}>
      <View style={s.head}>
        <Text style={s.title}>Import screenshots</Text>
        {/* `size` sets the hit slop; it does not make the BOX 44pt. Painted
            15pt tall, this measured 31pt effective in preview/measure.mjs —
            under the floor, and it shipped that way because the Import screen
            was not in the audit's screen list. Both are fixed. */}
        <Press onPress={onClose} size={TOUCH_MIN} label="Close" style={s.closeBtn}>
          <Text style={s.close}>Close</Text>
        </Press>
      </View>

      {phase.kind === "denied" ? (
        <View style={s.body}>
          <Text style={s.lead}>shelf can't see your photos</Text>
          <Text style={s.note}>
            Photo access is off for shelf. Turn it on in Settings → shelf → Photos, then come
            back. You can also share a screenshot straight from Photos instead.
          </Text>
        </View>
      ) : phase.kind === "reading" ? (
        <View style={s.body}>
          <ActivityIndicator color={c.ink} />
          <Text style={s.note}>Reading {phase.total} {phase.total === 1 ? "picture" : "pictures"}…</Text>
        </View>
      ) : phase.kind === "chosen" ? (
        <>
          <ScrollView horizontal contentContainerStyle={s.strip} showsHorizontalScrollIndicator={false}>
            {phase.picked.map((p) => (
              <Thumb key={p.uri} uri={p.uri} s={s} c={c} />
            ))}
          </ScrollView>
          <Text style={s.lead}>
            {phase.picked.length} {phase.picked.length === 1 ? "picture" : "pictures"} — which shelf?
          </Text>
          {/* Same six shelves, same colours, same order as the share sheet.
              A second way in that files things differently is a second app. */}
          <View style={s.boards}>
            {LISTS.map((l) => (
              <Press key={l} onPress={() => file(l)} size={TOUCH_MIN} label={`File on ${lists[l].label}`}
                     style={[s.board, { backgroundColor: c[l] ?? c.accent }]}>
                <Text style={[s.boardLabel, { color: listOn[l] ?? c.onList }]}>{lists[l].label}</Text>
              </Press>
            ))}
          </View>
        </>
      ) : (
        <View style={s.body}>
          <Text style={s.note}>
            Pick screenshots of posts, book covers, menus or posters. shelf reads the words in
            them and files what it finds.
          </Text>
          <Press onPress={pick} size={TOUCH_MIN} label="Choose screenshots" style={s.cta}>
            <Text style={s.ctaLabel}>Choose screenshots →</Text>
          </Press>
        </View>
      )}
    </View>
  );
}

const styles = (c: Palette) => StyleSheet.create({
  wrap: { flex: 1, backgroundColor: c.bg, paddingHorizontal: sp.lg, paddingTop: sp.xl },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: sp.lg },
  title: { ...t.section, color: c.ink },
  closeBtn: { minHeight: TOUCH_MIN, justifyContent: "center" },
  close: { ...t.micro, color: c.inkSoft },
  body: { gap: sp.md, alignItems: "flex-start" },
  lead: { ...t.section, color: c.ink, marginTop: sp.md },
  note: { ...t.meta, color: c.inkSoft },
  cta: { minHeight: TOUCH_MIN, paddingHorizontal: sp.lg, alignItems: "center", justifyContent: "center",
         borderWidth: RULE, borderColor: c.ink, marginTop: sp.sm },
  ctaLabel: { ...t.micro, color: c.ink },
  strip: { gap: sp.sm, paddingVertical: sp.sm },
  thumb: { width: 72, height: 128, backgroundColor: c.surfaceSunk },
  thumbGone: { alignItems: "center", justifyContent: "center" },
  thumbGoneMark: { ...t.meta },
  boards: { gap: sp.sm, marginTop: sp.md },
  board: { minHeight: TOUCH_MIN, paddingHorizontal: sp.lg, justifyContent: "center" },
  boardLabel: { ...t.micro },
});
