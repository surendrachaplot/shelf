// ShareSheet.tsx — handing part of yourself to someone.
//
// Two verbs, one panel, because they are the same act with different reach: a
// LINK anyone can open, and a SEND straight to another shelf user. Splitting
// them across two screens would make you decide how you are sharing before you
// have decided what you are sharing.
//
// The panel is the list's own colour at full bleed — the same field the jacket
// and the detail use — so sharing a red thing happens on red. It is the last
// screen before something of yours leaves your phone, and it should feel like
// the thing, not like a system dialog.
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { getProfile, makeShare, revokeShare, sendTo, shareUrl, type ShareKind } from "./api";
import { ExLibris } from "./ExLibris";
import { Press } from "./Press";
import * as D from "./design.js";
import { labelOf, listOn, placeholderOn, RULE, sp, t, TOUCH_MIN, useTheme, type Palette } from "./theme";

export function ShareSheet({ kind, target, list, title, onClose }: {
  kind: ShareKind;
  target: string | null;
  list: string;                 // which colour this happens on
  title: string;                // what the user thinks they are sharing
  onClose: () => void;
}) {
  const { c, dark } = useTheme();
  const s = styles(c);
  const fill = (c as Record<string, string>)[list] ?? c.unsorted;
  const on = (listOn as Record<string, string>)[list] ?? c.onList;
  // An empty field must READ as empty. Set in the full label colour, the
  // placeholder looked like something somebody had already typed.
  const ghost = placeholderOn(list, dark ? D.dark : D.light);

  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [seed, setSeed] = useState<string | null>(null);
  const [handle, setHandle] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    // Failing silently is right: the seal is a flourish, and a network hiccup
    // must not stop you sharing the thing you came here to share.
    getProfile()
      .then((p) => { if (live && p.profile) { setSeed(p.profile.plate_seed || p.profile.handle); setHandle(p.profile.handle); } })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  // The link is minted when the panel opens, not when you press a button. By
  // the time you have decided to share something you have already decided; a
  // "generate link" step is a button that exists to be pressed.
  useEffect(() => {
    let live = true;
    makeShare(kind, target)
      .then((r) => live && setCode(r.share.code))
      .catch((e) => live && setError((e as Error).message));
    return () => { live = false; };
  }, [kind, target]);

  const url = code ? shareUrl(code) : null;

  async function handOver() {
    if (!url) return;
    // The OS sheet already has Copy, Messages, Mail and everything else the
    // person has installed. Rebuilding a row of those inside the app would be
    // a worse version of a thing iOS does perfectly.
    await Share.share({ message: note ? `${note}\n${url}` : url, url }).catch(() => {});
  }

  async function send() {
    const handle = to.trim().replace(/^@/, "");
    if (!handle) return;
    setWorking(true);
    setStatus(null);
    try {
      const r = await sendTo(handle, kind, target, note || undefined);
      setStatus(r.duplicate ? `@${r.sent_to} already has this one` : `Sent to @${r.sent_to}`);
      setTo("");
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setWorking(false);
    }
  }

  async function pull() {
    if (!code) return;
    await revokeShare(code).catch(() => {});
    onClose();
  }

  return (
    <View style={[s.panel, { backgroundColor: fill }]}>
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
      <Text style={[s.kicker, { color: on }]}>Or straight to someone</Text>
      <View style={s.sendRow}>
        <TextInput
          value={to}
          onChangeText={setTo}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="@handle"
          placeholderTextColor={ghost}
          style={[s.input, s.inputFlex, { color: on, borderColor: on }]}
          onSubmitEditing={send}
        />
        <Press onPress={send} disabled={working || to.trim().length < 2} style={[s.btn, { backgroundColor: on }]} size={TOUCH_MIN} label="Send it">
          {working ? <ActivityIndicator color={fill} /> : <Text style={[s.btnLabel, { color: fill }]}>Send</Text>}
        </Press>
      </View>
      {status ? <Text style={[s.body, { color: on }]}>{status}</Text> : null}

      <Text style={[s.fine, { color: on }]}>
        Nothing of yours is reachable until you make a link, and turning it off takes it down for everyone at once.
      </Text>

      {/* The seal. A bookplate is what you paste inside the cover before the
          book leaves your hands, and this is the moment that happens — so the
          mark belongs here, at the foot of the field, not only on the profile
          screen where nobody is sending anything. */}
      <View style={s.seal}>
        <View style={[s.sealRule, { backgroundColor: on }]} />
        {seed ? <ExLibris seed={seed} size={40} /> : null}
        <Text style={[s.kicker, { color: on }]}>{handle ? `Ex libris @${handle}` : "Ex libris"}</Text>
      </View>
    </View>
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
