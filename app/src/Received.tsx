// Received.tsx — things people sent you.
//
// Accepting COPIES onto your shelf; it does not share a row. Two people who
// saved the same restaurant hold two opinions of it, and a shared row would let
// one person's note overwrite the other's. What the copy does keep is who it
// came from, because that is the entire reason a recommendation from a friend
// is different from a search result.
//
// Every delivery leads with the sender's ex-libris plate. You recognise the
// mark before you read the handle — which is what a mark is for.
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { actOnSend, listReceived, type Received as Delivery } from "./api";
import { ExLibris } from "./ExLibris";
import { Press } from "./Press";
import { Screen } from "./Screen";
import { Reveal } from "./Reveal";
import { labelOf, RULE, sp, t, TOUCH_MIN, useTheme, type Palette } from "./theme";

export function Received({ onClose, onAccepted }: { onClose: () => void; onAccepted: () => void }) {
  const { c } = useTheme();
  const s = styles(c);

  const [rows, setRows] = useState<Delivery[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setRows(await listReceived()); setError(null); }
    catch (e) { setError((e as Error).message); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function act(row: Delivery, action: "accept" | "decline") {
    setRows((prev) => (prev ?? []).filter((r) => r.id !== row.id));   // optimistic
    try {
      const r = await actOnSend(row.id, action);
      if (action === "accept") {
        setFlash(r.copied ? `${r.copied} on your shelves, from @${row.from_handle}` : "Already had that one");
        onAccepted();
      }
    } catch (e) {
      setFlash((e as Error).message);
      load();
    }
  }

  const what = (row: Delivery) =>
    row.kind === "profile" ? "their whole card"
      : row.kind === "shelf" ? `their ${labelOf(row.target).toLowerCase()} shelf`
      : "one thing";

  return (
    <Screen style={s.screen}>
      <View style={[s.head, s.inset]}>
        <Text style={s.wordmark}>Sent to you</Text>
        <Press onPress={onClose} style={s.close} size={TOUCH_MIN} label="Close">
          <Text style={s.micro}>Close</Text>
        </Press>
      </View>
      <View style={s.rule} />

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {flash ? <Text style={[s.flash, s.inset]}>{flash}</Text> : null}

        {error ? (
          <View style={s.inset}>
            <Text style={s.h2}>Couldn't check</Text>
            <Text style={s.body}>{error}. Nothing has been lost.</Text>
            <Press onPress={load} style={s.retry} size={TOUCH_MIN} label="Try again">
              <Text style={s.micro}>Try again →</Text>
            </Press>
          </View>
        ) : rows === null ? (
          <ActivityIndicator color={c.inkFaint} style={s.spin} />
        ) : rows.length === 0 ? (
          <View style={s.inset}>
            <Text style={s.h2}>Nothing waiting</Text>
            <Text style={s.body}>
              When somebody sends you a shelf or a single thing, it lands here first —
              nothing goes onto your shelves without you saying so.
            </Text>
          </View>
        ) : rows.map((row, i) => (
          <Reveal key={row.id} index={i}>
            <View style={[s.card, s.insetMargin]}>
              <View style={s.from}>
                <ExLibris seed={row.from_seed || row.from_handle} size={44} />
                <View style={s.fromWho}>
                  <Text style={s.fromName} numberOfLines={1}>{row.from_name || `@${row.from_handle}`}</Text>
                  <Text style={s.fromMeta} numberOfLines={1}>sent you {what(row)}</Text>
                </View>
              </View>
              {row.note ? <Text style={s.note}>“{row.note}”</Text> : null}
              <View style={s.actions}>
                <Press onPress={() => act(row, "accept")} style={s.btn} size={TOUCH_MIN} label={`Put it on your shelves`}>
                  <Text style={s.btnLabel}>Shelve it →</Text>
                </Press>
                <Press onPress={() => act(row, "decline")} style={s.btnGhost} size={TOUCH_MIN} label="No thanks">
                  <Text style={s.micro}>No thanks</Text>
                </Press>
              </View>
            </View>
          </Reveal>
        ))}
      </ScrollView>
    </Screen>
  );
}

const styles = (c: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  scroll: { paddingTop: sp.lg, paddingBottom: sp.huge },
  inset: { paddingHorizontal: sp.lg },
  insetMargin: { marginHorizontal: sp.lg },

  head: { flexDirection: "row", alignItems: "baseline", paddingTop: sp.xl, paddingBottom: sp.md },
  wordmark: { ...t.wordmark, color: c.ink, flex: 1 },
  close: { minHeight: TOUCH_MIN, justifyContent: "center" },
  rule: { height: RULE, backgroundColor: c.ink },
  micro: { ...t.micro, color: c.ink },
  flash: { ...t.meta, color: c.accent, marginBottom: sp.sm },

  card: { borderWidth: 2, borderColor: c.ink, padding: sp.md, marginBottom: sp.md },
  from: { flexDirection: "row", gap: sp.md, alignItems: "center" },
  fromWho: { flex: 1, minWidth: 0 },
  fromName: { ...t.bodyMed, color: c.ink },
  fromMeta: { ...t.meta, color: c.inkFaint },
  note: { ...t.body, color: c.inkSoft, marginTop: sp.md },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: sp.sm, marginTop: sp.md },
  btn: { minHeight: TOUCH_MIN, paddingHorizontal: sp.lg, backgroundColor: c.ink, alignItems: "center", justifyContent: "center" },
  btnGhost: { minHeight: TOUCH_MIN, paddingHorizontal: sp.lg, borderWidth: 2, borderColor: c.ink, alignItems: "center", justifyContent: "center" },
  btnLabel: { ...t.micro, color: c.bg },

  h2: { ...t.section, color: c.ink },
  body: { ...t.meta, color: c.inkSoft, marginTop: sp.xs },
  retry: { marginTop: sp.md, minHeight: TOUCH_MIN, justifyContent: "center", alignSelf: "flex-start" },
  spin: { marginTop: sp.huge },
});
