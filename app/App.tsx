// App.tsx — the four shelves, the Inbox, and pairing.
//
// Kept to one file deliberately: five screens' worth of state is less code
// than a navigation library's configuration, and the whole app is a list with
// a segmented control on top of it.
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, FlatList, Image, Pressable, RefreshControl,
  SafeAreaView, StatusBar, StyleSheet, Text, TextInput, View,
} from "react-native";
import {
  fetchInbox, fetchList, flushQueue, pair, updateItem,
  type Item, type ListName, LISTS,
} from "./src/api";
import { getToken, setToken, verifySharedAccess } from "./src/tokenStore";
import { c, lists, radius, t, touch } from "./src/theme";

type Tab = ListName | "inbox";
const TABS: Tab[] = ["inbox", ...LISTS];

export default function App() {
  const [ready, setReady] = useState(false);
  const [paired, setPaired] = useState(false);
  const [tab, setTab] = useState<Tab>("inbox");
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const token = await getToken();
      setPaired(!!token);
      setReady(true);
      if (token) {
        // Anything the share extension could not send while offline goes up
        // now. Silent when there is nothing to do.
        const sent = await flushQueue().catch(() => 0);
        if (sent) setFlash(`Synced ${sent} share${sent > 1 ? "s" : ""} saved offline`);
      }
    })();
  }, []);

  const load = useCallback(async () => {
    if (!paired) return;
    setBusy(true);
    try {
      setItems(tab === "inbox" ? await fetchInbox() : await fetchList(tab));
    } catch (e) {
      setFlash((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [tab, paired]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(null), 3500);
    return () => clearTimeout(id);
  }, [flash]);

  async function act(item: Item, body: Record<string, unknown>) {
    setItems((prev) => prev.filter((i) => i.id !== item.id)); // optimistic
    try {
      await updateItem({ id: item.id, ...body });
    } catch (e) {
      setFlash((e as Error).message);
      load();
    }
  }

  if (!ready) return <View style={s.boot}><ActivityIndicator color={c.accent} /></View>;
  if (!paired) return <Pairing onPaired={() => { setPaired(true); }} />;

  return (
    <SafeAreaView style={s.screen}>
      <StatusBar barStyle="dark-content" />
      <Text style={[t.title, s.h1]}>shelf</Text>

      <FlatList
        horizontal
        data={TABS}
        keyExtractor={(x) => x}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.tabs}
        renderItem={({ item: name }) => {
          const on = tab === name;
          return (
            <Pressable onPress={() => setTab(name)} style={[s.tab, on && s.tabOn]}>
              <Text style={[s.tabLabel, on && s.tabLabelOn]}>
                {name === "inbox" ? "📥 Inbox" : `${lists[name].glyph} ${lists[name].label}`}
              </Text>
            </Pressable>
          );
        }}
      />

      {flash ? <Text style={s.flash}>{flash}</Text> : null}

      <FlatList
        data={items}
        keyExtractor={(i) => i.id}
        refreshControl={<RefreshControl refreshing={busy} onRefresh={load} tintColor={c.accent} />}
        contentContainerStyle={items.length ? s.list : s.listEmpty}
        ListEmptyComponent={
          busy ? null : (
            <View style={s.empty}>
              <Text style={s.emptyGlyph}>{tab === "inbox" ? "📥" : lists[tab].glyph}</Text>
              <Text style={t.heading}>
                {tab === "inbox" ? "Nothing waiting" : `No ${lists[tab].label.toLowerCase()} yet`}
              </Text>
              <Text style={[t.meta, s.emptyHint]}>
                Share a reel from Instagram and pick a list — it'll show up here.
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => <Row item={item} inbox={tab === "inbox"} onAct={act} />}
      />
    </SafeAreaView>
  );
}

function Row({ item, inbox, onAct }: {
  item: Item; inbox: boolean;
  onAct: (i: Item, body: Record<string, unknown>) => void;
}) {
  const pending = item.status === "pending";
  return (
    <View style={s.card}>
      <View style={s.cardTop}>
        {item.image_url
          ? <Image source={{ uri: item.image_url }} style={s.thumb} />
          : <View style={[s.thumb, s.thumbBlank]}><Text style={s.glyph}>{lists[item.list].glyph}</Text></View>}
        <View style={s.cardText}>
          <Text style={s.cardTitle} numberOfLines={2}>
            {item.title ?? (pending ? "Working it out…" : "Couldn't read this one")}
          </Text>
          {item.subtitle ? <Text style={t.meta} numberOfLines={1}>{item.subtitle}</Text> : null}
          {item.note ? <Text style={[t.meta, s.note]} numberOfLines={2}>{item.note}</Text> : null}
        </View>
      </View>

      {/* Pending rows show no buttons: there is nothing to confirm until the
          worker has had its go, and offering "File" on a row with no title
          just files an empty item. */}
      {inbox && !pending ? (
        <View style={s.actions}>
          <Pressable style={[s.btn, s.btnPrimary]} onPress={() => onAct(item, { action: "file" })}>
            <Text style={s.btnPrimaryLabel}>Keep</Text>
          </Pressable>
          {LISTS.filter((l) => l !== item.list).map((l) => (
            <Pressable key={l} style={s.btn} onPress={() => onAct(item, { list: l, action: "file" })}>
              <Text style={s.btnLabel}>{lists[l].glyph}</Text>
            </Pressable>
          ))}
          <Pressable style={s.btn} onPress={() => onAct(item, { action: "discard" })}>
            <Text style={s.btnLabel}>🗑</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function Pairing({ onPaired }: { onPaired: () => void }) {
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
    <SafeAreaView style={[s.screen, s.pairWrap]}>
      <Text style={t.title}>shelf</Text>
      <Text style={[t.meta, s.pairHint]}>
        Run{"  "}<Text style={s.mono}>node auth.js --pair you@email</Text>{"  "}on the server and type the code.
      </Text>
      <TextInput
        value={code}
        onChangeText={setCode}
        autoCapitalize="characters"
        autoCorrect={false}
        placeholder="PAIRING CODE"
        placeholderTextColor={c.inkSoft}
        style={s.input}
        onSubmitEditing={submit}
      />
      <Pressable style={[s.btn, s.btnPrimary, s.pairBtn]} onPress={submit} disabled={busy || code.length < 4}>
        {busy ? <ActivityIndicator color={c.card} /> : <Text style={s.btnPrimaryLabel}>Pair this phone</Text>}
      </Pressable>
      {error ? <Text style={s.error}>{error}</Text> : null}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  boot: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.bg },
  h1: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 10 },

  tabs: { paddingHorizontal: 18, gap: 8, paddingBottom: 12 },
  tab: {
    paddingHorizontal: 14, height: 38, justifyContent: "center",
    borderRadius: radius, borderWidth: 1, borderColor: c.line, backgroundColor: c.card,
  },
  tabOn: { backgroundColor: c.ink, borderColor: c.ink },
  tabLabel: { ...t.body, fontWeight: "600" },
  tabLabelOn: { color: c.bg },

  flash: { ...t.meta, color: c.accent, paddingHorizontal: 18, paddingBottom: 8 },

  list: { paddingHorizontal: 18, paddingBottom: 40, gap: 10 },
  listEmpty: { flexGrow: 1, justifyContent: "center" },
  empty: { alignItems: "center", paddingHorizontal: 40, gap: 6 },
  emptyGlyph: { fontSize: 34, marginBottom: 4 },
  emptyHint: { textAlign: "center" },

  card: { backgroundColor: c.card, borderRadius: radius, borderWidth: 1, borderColor: c.line, padding: 12 },
  cardTop: { flexDirection: "row", gap: 12 },
  thumb: { width: 56, height: 76, borderRadius: 8, backgroundColor: c.accentSoft },
  thumbBlank: { alignItems: "center", justifyContent: "center" },
  glyph: { fontSize: 24 },
  cardText: { flex: 1, gap: 3 },
  cardTitle: { ...t.body, fontWeight: "600" },
  note: { fontStyle: "italic" },

  actions: { flexDirection: "row", gap: 8, marginTop: 12, flexWrap: "wrap" },
  btn: {
    minHeight: 40, minWidth: 44, paddingHorizontal: 12,
    alignItems: "center", justifyContent: "center",
    borderRadius: radius, borderWidth: 1, borderColor: c.line, backgroundColor: c.bg,
  },
  btnLabel: { ...t.body },
  btnPrimary: { backgroundColor: c.ink, borderColor: c.ink },
  btnPrimaryLabel: { ...t.body, color: c.bg, fontWeight: "600" },

  pairWrap: { alignItems: "center", justifyContent: "center", paddingHorizontal: 28, gap: 14 },
  pairHint: { textAlign: "center", lineHeight: 20 },
  mono: { fontFamily: "Menlo", fontSize: 12, color: c.ink },
  input: {
    ...t.body, width: "100%", height: touch, textAlign: "center", letterSpacing: 4,
    borderRadius: radius, borderWidth: 1, borderColor: c.line, backgroundColor: c.card,
  },
  pairBtn: { width: "100%", height: touch },
  error: { ...t.meta, color: c.accent, textAlign: "center" },
});
