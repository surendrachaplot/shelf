// ShareSheet.tsx — handing part of yourself to someone.
//
// ONE verb now: a link anyone can open. Sending straight to another person
// needed an account to address it to, and there are no accounts — your shelves
// are on your phone.
//
// THIS SCREEN IS THE ONLY PLACE ANYTHING LEAVES THE DEVICE. Opening it uploads
// a frozen snapshot of exactly what you are sharing — this item, or this
// shelf, or your card — and nothing else. Turning the link off deletes it.
//
// The panel is the list's own colour at full bleed — the same field the jacket
// and the detail use — so sharing a red thing happens on red. It is the last
// screen before something of yours leaves your phone, and it should feel like
// the thing, not like a system dialog.
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { publish, revokePublish, shareUrl, type PublishKind } from "./api";
import { shelfOf, type Item, type Link, type Shelf } from "./store";
import { ExLibris } from "./ExLibris";
import { Press } from "./Press";
import { KeyboardSafe } from "./KeyboardSafe";
import * as D from "./design.js";
import { labelOf, listOn, placeholderOn, RULE, sp, t, TOUCH_MIN, useTheme, type Palette } from "./theme";

export function ShareSheet({ kind, item, list, title, shelf, onClose, onLinked }: {
  kind: PublishKind;
  item?: Item;                  // when sharing one thing
  list?: string;                // which colour this happens on
  title: string;                // what the user thinks they are sharing
  shelf: Shelf;                 // where the snapshot is built from
  onClose: () => void;
  onLinked: (link: Link) => void;
}) {
  const { c, dark } = useTheme();
  const s = styles(c);
  const listKey = list ?? item?.list ?? "unsorted";
  const fill = (c as Record<string, string>)[listKey] ?? c.unsorted;
  const on = (listOn as Record<string, string>)[listKey] ?? c.onList;
  // An empty field must READ as empty. Set in the full label colour, the
  // placeholder looked like something somebody had already typed.
  const ghost = placeholderOn(listKey, dark ? D.dark : D.light);

  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  // THE SNAPSHOT IS BUILT AND UPLOADED WHEN THE PANEL OPENS, not when you
  // press a button. By the time you decided to share something you had already
  // decided; a "generate link" step is a button that exists to be pressed.
  //
  // Only what is named here goes up. A single item sends that item; a shelf
  // sends that shelf; a card sends the four shelves and your name. Your notes
  // travel with the thing they are about — that is the point of sharing a
  // shelf rather than a list of titles — and nothing else is included.
  useEffect(() => {
    let live = true;
    const owner = { name: shelf.profile.name, bio: shelf.profile.bio, seed: shelf.profile.seed };
    const body =
      kind === "item" ? { kind, owner, item }
      : kind === "shelf" ? { kind, owner, target: listKey, items: shelfOf(shelf, listKey) }
      : { kind, owner, lists: Object.fromEntries(
            ["books", "restaurants", "movies", "recipes"].map((l) => [l, shelfOf(shelf, l)])) };

    publish(body)
      .then((r) => {
        if (!live) return;
        setCode(r.code);
        onLinked({ code: r.code, kind, target: kind === "shelf" ? listKey : null, title, at: new Date().toISOString() });
      })
      .catch((e) => live && setError((e as Error).message));
    return () => { live = false; };
    // Built once, on open. Rebuilding it as the shelf changes underneath would
    // silently publish something the person never looked at.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const url = code ? shareUrl(code) : null;

  async function handOver() {
    if (!url) return;
    // The OS sheet already has Copy, Messages, Mail and everything else the
    // person has installed. Rebuilding a row of those inside the app would be
    // a worse version of a thing iOS does perfectly.
    await Share.share({ message: note ? `${note}\n${url}` : url, url }).catch(() => {});
  }

  async function pull() {
    if (!code) return;
    await revokePublish(code).catch(() => {});
    onClose();
  }

  return (
    <KeyboardSafe style={[s.panel, { backgroundColor: fill }] as never}>
      <View style={s.head}>
        <Text style={[s.kicker, { color: on }]}>
          {kind === "profile" ? "Share your shelves" : kind === "shelf" ? `Share the ${labelOf(list)} shelf` : "Share this"}
        </Text>
        <Press onPress={onClose} style={s.close} size={TOUCH_MIN} label="Close">
          <Text style={[s.kicker, { color: on }]}>Close</Text>
        </Press>
      </View>
      <View style={[s.rule, { backgroundColor: on }]} />

      <Text style={[s.title, { color: on }]} numberOfLines={3}>{title}</Text>

      <TextInput
        value={note}
        onChangeText={setNote}
        placeholder="Say something about it (optional)"
        placeholderTextColor={ghost}
        style={[s.input, { color: on, borderColor: on }]}
        maxLength={200}
      />

      {/* §8 — three different states, three different renderings. A spinner, a
          real address, and a reason it failed are not interchangeable. */}
      {error ? (
        <Text style={[s.body, { color: on }]}>{error}</Text>
      ) : url ? (
        <Text style={[s.link, { color: on }]} numberOfLines={2}>{url}</Text>
      ) : (
        <ActivityIndicator color={on} style={s.spin} />
      )}

      <View style={s.actions}>
        <Press onPress={handOver} disabled={!url} style={[s.btn, { backgroundColor: on }]} size={TOUCH_MIN} label="Share the link">
          <Text style={[s.btnLabel, { color: fill }]}>Share link →</Text>
        </Press>
        {code ? (
          <Press onPress={pull} style={[s.btnGhost, { borderColor: on }]} size={TOUCH_MIN} label="Turn this link off">
            <Text style={[s.btnLabel, { color: on }]}>Turn it off</Text>
          </Press>
        ) : null}
      </View>

      <View style={[s.rule, s.ruleMid, { backgroundColor: on }]} />
      <Text style={[s.body, { color: on }]}>
        Everything else stays on your phone. This link is the only copy that leaves it,
        and turning it off deletes that copy.
      </Text>
    </KeyboardSafe>
  );
}

const styles = (c: Palette) => StyleSheet.create({
  panel: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, padding: sp.lg, paddingTop: sp.xxl },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  kicker: { ...t.micro },
  close: { minHeight: TOUCH_MIN, justifyContent: "center" },
  rule: { height: RULE, marginTop: sp.md, marginBottom: sp.lg },
  ruleMid: { marginTop: sp.xl },
  title: { ...t.itemTitle, marginBottom: sp.lg },
  body: { ...t.meta, marginTop: sp.sm },
  link: { ...t.bodyMed, marginTop: sp.md },
  spin: { alignSelf: "flex-start", marginTop: sp.md },
  input: {
    ...t.bodyMed, minHeight: TOUCH_MIN, paddingHorizontal: sp.md,
    borderWidth: 2, marginTop: sp.sm,
  },
  inputFlex: { flex: 1 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: sp.sm, marginTop: sp.lg },
  sendRow: { flexDirection: "row", gap: sp.sm, alignItems: "center", marginTop: sp.xs },
  btn: { minHeight: TOUCH_MIN, paddingHorizontal: sp.lg, alignItems: "center", justifyContent: "center" },
  btnGhost: { minHeight: TOUCH_MIN, paddingHorizontal: sp.lg, alignItems: "center", justifyContent: "center", borderWidth: 2 },
  btnLabel: { ...t.micro },
  fine: { ...t.meta, marginTop: sp.xl },
  seal: { marginTop: "auto", alignItems: "flex-start", gap: sp.sm, paddingTop: sp.xl },
  sealRule: { height: RULE, alignSelf: "stretch", marginBottom: sp.md },
});
