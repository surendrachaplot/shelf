// App.tsx — the shelves.
//
// The app is called shelf, so it shows you shelves. Not a tab bar over a list
// of cards: four boards, your things standing on them as spines, and the
// Inbox as the pile that has not been put away yet. That single structural
// choice is the whole design — everything else is Swiss discipline around it
// (radius zero, four flat primaries, black reserved for boards/rules/type,
// and type doing the work an icon set would otherwise do).
//
// A spine's THICKNESS varies and its height barely does, which is how a real
// shelf looks. Getting that backwards makes the row read as a bar chart.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import {
  fetchInbox, fetchList, flushQueue, pair, updateItem,
  type Item, type ListName, LISTS,
} from "./src/api";
import { getToken, setToken, verifySharedAccess } from "./src/tokenStore";
import { Press } from "./src/Press";
import { Reveal } from "./src/Reveal";
import {
  BOARD, lists, listOn, RULE, sp, spineFor, t, TOUCH_MIN, useTheme, type Palette,
} from "./src/theme";

export default function App() {
  const { c } = useTheme();
  const s = useMemo(() => styles(c), [c]);

  const [ready, setReady] = useState(false);
  const [paired, setPaired] = useState(false);
  const [shelves, setShelves] = useState<Record<string, Item[]>>({});
  const [inbox, setInbox] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  // null means the shelves really are empty. A string means we could not look.
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const token = await getToken();
      setPaired(!!token);
      setReady(true);
      if (token) {
        const sent = await flushQueue().catch(() => 0);
        if (sent) setFlash(`Synced ${sent} share${sent > 1 ? "s" : ""} saved offline`);
      }
    })();
  }, []);

  const load = useCallback(async () => {
    if (!paired) return;
    setBusy(true);
    try {
      const [ib, ...rest] = await Promise.all([fetchInbox(), ...LISTS.map((l) => fetchList(l))]);
      setInbox(ib);
      setShelves(Object.fromEntries(LISTS.map((l, i) => [l, rest[i]])));
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [paired]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(null), 3500);
    return () => clearTimeout(id);
  }, [flash]);

  async function act(item: Item, body: Record<string, unknown>) {
    setInbox((prev) => prev.filter((i) => i.id !== item.id)); // optimistic
    try {
      await updateItem({ id: item.id, ...body });
      load();
    } catch (e) {
      setFlash((e as Error).message);
      load();
    }
  }

  if (!ready) return <View style={s.boot}><ActivityIndicator color={c.ink} /></View>;
  if (!paired) return <Pairing onPaired={() => setPaired(true)} />;

  const total = Object.values(shelves).reduce((n, xs) => n + (xs?.length ?? 0), 0);

  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <View style={s.head}>
          <Text style={s.wordmark}>shelf</Text>
          <Text style={s.headCount}>{total} saved</Text>
        </View>

        {flash ? <Text style={s.flash}>{flash}</Text> : null}

        {loadError ? (
          <View style={s.errorBlock}>
            <Text style={s.section}>Couldn't reach your shelves</Text>
            <Text style={s.errorNote}>{loadError}. Nothing has been lost.</Text>
            <Press onPress={load} style={s.retry} size={TOUCH_MIN} label="Try again">
              <Text style={s.retryLabel}>Try again →</Text>
            </Press>
          </View>
        ) : null}

        {/* Not shelved: the pile. Flat cards, not spines — a thing you have
            not filed is not standing on a board yet, and the layout should
            say so before the label does. */}
        <View style={s.rule} />
        <View style={s.sectionRow}>
          <Text style={s.section}>Not shelved</Text>
          <Text style={s.sectionNum}>{String(inbox.length).padStart(2, "0")}</Text>
        </View>
        {inbox.length === 0 ? (
          <Text style={s.emptyLine}>Nothing waiting. Share a reel and pick a shelf.</Text>
        ) : (
          inbox.map((item, i) => (
            <Reveal key={item.id} index={i}>
              <PileRow item={item} onAct={act} s={s} c={c} />
            </Reveal>
          ))
        )}

        {LISTS.map((list, i) => (
          <Shelf key={list} list={list} items={shelves[list] ?? []} index={i} s={s} c={c} />
        ))}

        {busy ? <ActivityIndicator color={c.inkFaint} style={s.busy} /> : null}
      </ScrollView>
    </View>
  );
}

function Shelf({ list, items, index, s, c }: {
  list: ListName; items: Item[]; index: number;
  s: ReturnType<typeof styles>; c: Palette;
}) {
  const fill = c[list] ?? c.accent;
  const label = listOn[list] ?? c.onList;
  return (
    <Reveal index={index}>
      <View style={s.shelf}>
        <View style={s.sectionRow}>
          <View style={[s.swatch, { backgroundColor: fill }]} />
          <Text style={s.section}>{lists[list].label}</Text>
          <View style={s.sectionRule} />
          <Text style={s.sectionNum}>{String(items.length).padStart(2, "0")}</Text>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.spineScroll} contentContainerStyle={s.spineRow}>
          {items.length === 0 ? (
            <Text style={s.shelfEmpty}>Nothing on this shelf yet</Text>
          ) : items.map((item, i) => {
            const dims = spineFor(item.title ?? item.id);
            // Every third spine takes a light or dark wash so a run of the
            // same colour still reads as separate objects.
            const wash = i % 3 === 1 ? "rgba(255,255,255,.14)" : i % 3 === 2 ? "rgba(0,0,0,.14)" : "transparent";
            return (
              <View key={item.id} style={[s.spine, { width: dims.width, height: dims.height, backgroundColor: fill }]}>
                <View style={[s.spineWash, { backgroundColor: wash }]} />
                <View style={[s.spineTextBox, {
                  width: dims.height, height: dims.width,
                  left: (dims.width - dims.height) / 2, top: (dims.height - dims.width) / 2,
                }]}>
                  <Text style={[s.spineText, { color: label, maxWidth: dims.height - sp.lg }]} numberOfLines={1}>
                    {item.title ?? "Untitled"}
                  </Text>
                </View>
              </View>
            );
          })}
        </ScrollView>
        <View style={s.board} />
      </View>
    </Reveal>
  );
}

function PileRow({ item, onAct, s, c }: {
  item: Item; s: ReturnType<typeof styles>; c: Palette;
  onAct: (i: Item, body: Record<string, unknown>) => void;
}) {
  const pending = item.status === "pending";
  // A pending item has no shelf yet. Painting it in a list colour is a lie the
  // eye reads before the words do — it gets an outline instead.
  const fill = pending ? "transparent" : (c[item.list] ?? c.unsorted);
  return (
    <View style={s.pile}>
      <View style={[s.pileSwatch, { backgroundColor: fill, borderColor: pending ? c.line : fill }]} />
      <Text style={s.pileTitle} numberOfLines={1}>
        {item.title ?? (pending ? "Working it out…" : "Couldn't read this one")}
      </Text>
      {pending ? (
        <Text style={s.pileAction}>Reading</Text>
      ) : (
        <Press onPress={() => onAct(item, { action: "file" })} style={s.pileBtn} size={TOUCH_MIN} label={`Shelve on ${lists[item.list].label}`}>
          <Text style={s.pileAction}>Shelve →</Text>
        </Press>
      )}
    </View>
  );
}

function Pairing({ onPaired }: { onPaired: () => void }) {
  const { c } = useTheme();
  const s = useMemo(() => styles(c), [c]);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      setToken(await pair(code.trim().toUpperCase(), "iPhone"));
      // Confirm the extension can actually read what we just wrote. Finding
      // this out here is the difference between a one-line fix and a week of
      // "why does sharing do nothing".
      if (!(await verifySharedAccess())) {
        setError("Paired, but the share extension can't read the Keychain — check the app group entitlement.");
      }
      onPaired();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[s.screen, s.pairWrap]}>
      <Text style={s.wordmark}>shelf</Text>
      <Text style={s.pairHint}>Run <Text style={s.mono}>node auth.js --pair you@email</Text> on the server, then type the code.</Text>
      <TextInput
        value={code}
        onChangeText={setCode}
        autoCapitalize="characters"
        autoCorrect={false}
        placeholder="PAIRING CODE"
        placeholderTextColor={c.inkFaint}
        style={s.input}
        onSubmitEditing={submit}
      />
      <Press onPress={submit} disabled={busy || code.length < 4} style={s.pairBtn} size={TOUCH_MIN} label="Pair this phone">
        {busy ? <ActivityIndicator color={c.onList} /> : <Text style={s.pairBtnLabel}>Pair this phone →</Text>}
      </Press>
      {error ? <Text style={s.errorNote}>{error}</Text> : null}
    </View>
  );
}

const styles = (c: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  boot: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.bg },
  scroll: { paddingHorizontal: sp.lg, paddingTop: sp.xl, paddingBottom: sp.huge },

  head: { flexDirection: "row", alignItems: "baseline", marginBottom: sp.lg },
  wordmark: { ...t.wordmark, color: c.ink, flex: 1 },
  headCount: { ...t.micro, color: c.inkFaint },

  flash: { ...t.meta, color: c.accent, marginBottom: sp.sm },

  rule: { height: RULE, backgroundColor: c.ink },
  sectionRow: { flexDirection: "row", alignItems: "center", gap: sp.sm, paddingTop: sp.md, paddingBottom: sp.sm },
  section: { ...t.section, color: c.ink },
  sectionRule: { flex: 1, height: 1, backgroundColor: c.line },
  sectionNum: { ...t.micro, color: c.inkFaint },
  swatch: { width: 11, height: 11 },

  emptyLine: { ...t.meta, color: c.inkFaint, paddingBottom: sp.md },

  pile: {
    flexDirection: "row", alignItems: "center", gap: sp.sm,
    borderWidth: 2, borderColor: c.ink, paddingHorizontal: sp.md,
    minHeight: TOUCH_MIN, marginBottom: sp.sm,
  },
  pileSwatch: { width: 9, height: 9, borderWidth: 2 },
  pileTitle: { ...t.bodyMed, color: c.ink, flex: 1 },
  pileBtn: { minHeight: TOUCH_MIN, justifyContent: "center", paddingLeft: sp.sm },
  pileAction: { ...t.micro, color: c.inkFaint },

  shelf: { marginTop: sp.lg },
  spineScroll: { flexGrow: 0 },
  spineRow: { flexDirection: "row", alignItems: "flex-end", gap: 2, minHeight: 118 },
  spine: { position: "relative", overflow: "hidden" },
  spineWash: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  // Rotated inside its own box so the spine itself stays a simple rect.
  spineTextBox: { position: "absolute", transform: [{ rotate: "-90deg" }], flexDirection: "row", alignItems: "center", paddingLeft: sp.sm },
  spineText: { ...t.spine },
  board: { height: BOARD, backgroundColor: c.ink },
  shelfEmpty: { ...t.meta, color: c.inkFaint, alignSelf: "flex-end", paddingBottom: sp.sm },

  errorBlock: { borderWidth: 2, borderColor: c.ink, padding: sp.md, marginBottom: sp.md },
  errorNote: { ...t.meta, color: c.inkSoft, marginTop: sp.xs },
  retry: { marginTop: sp.md, minHeight: TOUCH_MIN, justifyContent: "center", alignSelf: "flex-start" },
  retryLabel: { ...t.micro, color: c.ink },

  busy: { marginTop: sp.lg },

  pairWrap: { justifyContent: "center", paddingHorizontal: sp.xl, gap: sp.md },
  pairHint: { ...t.meta, color: c.inkSoft },
  mono: { ...t.code, color: c.ink },
  input: {
    ...t.bodyMed, color: c.ink, height: TOUCH_MIN + 8, paddingHorizontal: sp.md,
    letterSpacing: 4, borderWidth: 2, borderColor: c.ink, backgroundColor: c.bg,
  },
  pairBtn: {
    minHeight: TOUCH_MIN + 8, backgroundColor: c.ink, alignItems: "center", justifyContent: "center",
    alignSelf: "flex-start", paddingHorizontal: sp.lg,
  },
  pairBtnLabel: { ...t.micro, color: c.bg },
});
