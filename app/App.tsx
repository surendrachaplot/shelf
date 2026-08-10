// App.tsx — the four shelves, the Inbox, and pairing.
//
// One file on purpose: five screens' worth of state is less code than a
// navigation library's configuration, and the whole app is a list with a
// segmented control above it.
//
// Every colour, size, spacing and spring comes from design.js. Styles are
// built from the live palette inside the component rather than frozen at
// import time, so both schemes are first-class rather than one being an
// afterthought that ships permanently wrong.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, FlatList, Image, RefreshControl, SafeAreaView,
  StatusBar, StyleSheet, Text, TextInput, View,
} from "react-native";
import {
  fetchInbox, fetchList, flushQueue, pair, updateItem,
  type Item, type ListName, LISTS,
} from "./src/api";
import { getToken, setToken, verifySharedAccess } from "./src/tokenStore";
import { Press } from "./src/Press";
import { Reveal } from "./src/Reveal";
import { LinearGradient } from "expo-linear-gradient";
import { glyph, lists, radius, sp, t, TOUCH, TOUCH_MIN, useTheme, type Palette } from "./src/theme";

type Tab = ListName | "inbox";
const TABS: Tab[] = ["inbox", ...LISTS];

export default function App() {
  const { c, dark } = useTheme();
  const s = useMemo(() => styles(c), [c]);

  const [ready, setReady] = useState(false);
  const [paired, setPaired] = useState(false);
  const [tab, setTab] = useState<Tab>("inbox");
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  // null means "the shelf really is empty". A string means "we could not look".
  // Rendering those the same way tells the user their saves vanished.
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
      setItems(tab === "inbox" ? await fetchInbox() : await fetchList(tab));
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
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
  if (!paired) return <Pairing onPaired={() => setPaired(true)} />;

  return (
    <SafeAreaView style={s.screen}>
      <StatusBar barStyle={dark ? "light-content" : "dark-content"} />

      <View style={s.header}>
        <Text style={s.h1}>shelf</Text>
      </View>

      {/* §4e — the strip overflows at every width and hides its scrollbar, so
          the cut edge is the only affordance left. A hard cut reads as broken
          layout; a short fade reads as "there is more". */}
      <View style={s.tabWrap}>
        <FlatList
          horizontal
          data={TABS}
          keyExtractor={(x) => x}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.tabs}
          // A horizontal list inside a flex column is still a flex CHILD and
          // will take flex:1 vertically, which left a ~200pt hole between the
          // tabs and the first card. It has to be told not to grow.
          style={s.tabList}
          renderItem={({ item: name }) => {
            const on = tab === name;
            return (
              <Press onPress={() => setTab(name)} style={[s.tab, on && s.tabOn]} size={100}>
                <Text style={[s.tabLabel, on && s.tabLabelOn]}>
                  {name === "inbox" ? "📥 Inbox" : `${lists[name].glyph} ${lists[name].label}`}
                </Text>
              </Press>
            );
          }}
        />
        <LinearGradient
          pointerEvents="none"
          colors={[c.bg + "00", c.bg]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={s.tabFade}
        />
      </View>

      {flash ? <Text style={s.flash}>{flash}</Text> : null}

      <FlatList
        data={items}
        keyExtractor={(i) => i.id}
        refreshControl={<RefreshControl refreshing={busy} onRefresh={load} tintColor={c.accent} />}
        contentContainerStyle={items.length ? s.list : s.listEmpty}
        ListEmptyComponent={
          busy ? null : loadError ? (
            <View style={s.empty}>
              <Text style={s.emptyGlyph}>📡</Text>
              <Text style={s.emptyTitle}>Couldn't reach your shelf</Text>
              <Text style={s.emptyHint}>{loadError}. Nothing has been lost — pull down to try again.</Text>
              <Press onPress={load} style={[s.btn, s.btnPrimary, s.retry]} size={TOUCH}>
                <Text style={s.btnPrimaryLabel}>Try again</Text>
              </Press>
            </View>
          ) : (
            <View style={s.empty}>
              <Text style={s.emptyGlyph}>{tab === "inbox" ? "📥" : lists[tab].glyph}</Text>
              <Text style={s.emptyTitle}>
                {tab === "inbox" ? "Nothing waiting" : `No ${lists[tab].label.toLowerCase()} yet`}
              </Text>
              <Text style={s.emptyHint}>
                Share a reel from Instagram and pick a list — it'll show up here.
              </Text>
            </View>
          )
        }
        renderItem={({ item, index }) => (
          <Reveal index={index}>
            <Row item={item} inbox={tab === "inbox"} onAct={act} s={s} />
          </Reveal>
        )}
      />
    </SafeAreaView>
  );
}

function Row({ item, inbox, onAct, s }: {
  item: Item; inbox: boolean; s: ReturnType<typeof styles>;
  onAct: (i: Item, body: Record<string, unknown>) => void;
}) {
  const pending = item.status === "pending";
  // MISSING and FAILED are two different states and both need the same
  // designed fallback. A cover URL that 404s (Open Library and TMDB both
  // serve dead paths) otherwise leaves an empty box that reads as breakage.
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = !!item.image_url && !imageFailed;

  return (
    <View style={s.card}>
      <View style={s.cardTop}>
        {showImage
          ? <Image source={{ uri: item.image_url! }} style={s.thumb} onError={() => setImageFailed(true)} />
          : <View style={[s.thumb, s.thumbBlank]}><Text style={s.glyph}>{lists[item.list].glyph}</Text></View>}
        <View style={s.cardText}>
          <Text style={s.cardTitle} numberOfLines={2}>
            {item.title ?? (pending ? "Working it out…" : "Couldn't read this one")}
          </Text>
          {item.subtitle ? <Text style={s.cardSub} numberOfLines={1}>{item.subtitle}</Text> : null}
          {item.note ? <Text style={s.note} numberOfLines={2}>{item.note}</Text> : null}
          {pending ? (
            <View style={s.skeleton}>
              <View style={[s.skelLine, s.skelWide]} />
              <View style={[s.skelLine, s.skelNarrow]} />
            </View>
          ) : null}
        </View>
      </View>

      {/* Pending rows show no buttons: there is nothing to confirm until the
          worker has had its go, and offering "Keep" on a row with no title
          just files an empty item. */}
      {inbox && !pending ? (
        <View style={s.actions}>
          <Press onPress={() => onAct(item, { action: "file" })} style={[s.btn, s.btnPrimary]} size={TOUCH}>
            <Text style={s.btnPrimaryLabel}>Keep</Text>
          </Press>
          {LISTS.filter((l) => l !== item.list).map((l) => (
            <Press key={l} onPress={() => onAct(item, { list: l, action: "file" })} style={[s.btn, s.btnIcon]} size={TOUCH} label={`Move to ${lists[l].label}`}>
              <Text style={s.btnLabel}>{lists[l].glyph}</Text>
            </Press>
          ))}
          <Press onPress={() => onAct(item, { action: "discard" })} style={[s.btn, s.btnIcon]} size={TOUCH} label="Discard">
            <Text style={s.btnLabel}>🗑</Text>
          </Press>
        </View>
      ) : null}
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
    <SafeAreaView style={[s.screen, s.pairWrap]}>
      <Reveal><Text style={s.pairTitle}>shelf</Text></Reveal>
      <Reveal index={1}>
        <Text style={s.pairHint}>
          Run{"  "}<Text style={s.mono}>node auth.js --pair you@email</Text>{"  "}on the server and type the code.
        </Text>
      </Reveal>
      <Reveal index={2}>
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
      </Reveal>
      <Reveal index={3}>
        <Press onPress={submit} disabled={busy || code.length < 4} style={[s.btn, s.btnPrimary, s.pairBtn]} size={TOUCH}>
          {busy ? <ActivityIndicator color={c.accentInk} /> : <Text style={s.btnPrimaryLabel}>Pair this phone</Text>}
        </Press>
      </Reveal>
      {error ? <Text style={s.error}>{error}</Text> : null}
    </SafeAreaView>
  );
}

const styles = (c: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  boot: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.bg },

  header: {
    flexDirection: "row", alignItems: "baseline", gap: sp.sm,
    paddingHorizontal: sp.lg, paddingTop: sp.sm, paddingBottom: sp.md,
  },
  h1: { ...t.title, color: c.ink },

  tabWrap: { position: "relative" },
  tabList: { flexGrow: 0, flexShrink: 0 },
  tabFade: { position: "absolute", right: 0, top: 0, bottom: 0, width: sp.xxl },
  tabs: { paddingHorizontal: sp.lg, gap: sp.sm, paddingBottom: sp.md },
  tab: {
    paddingHorizontal: sp.md, minHeight: TOUCH_MIN, justifyContent: "center",
    borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: c.line, backgroundColor: c.surface,
  },
  tabOn: { backgroundColor: c.ink, borderColor: c.ink },
  tabLabel: { ...t.bodyMed, color: c.ink },
  tabLabelOn: { color: c.bg },

  flash: { ...t.meta, color: c.accent, paddingHorizontal: sp.lg, paddingBottom: sp.sm },

  list: { paddingHorizontal: sp.lg, paddingBottom: sp.huge, gap: sp.md },
  listEmpty: { flexGrow: 1, justifyContent: "center" },
  empty: { alignItems: "center", paddingHorizontal: sp.xxl, gap: sp.xs },
  emptyGlyph: { fontSize: glyph.lg, marginBottom: sp.xs },
  emptyTitle: { ...t.heading, color: c.ink, textAlign: "center" },
  emptyHint: { ...t.meta, color: c.inkSoft, textAlign: "center" },
  retry: { marginTop: sp.md },

  card: {
    backgroundColor: c.surface, borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth * 2, borderColor: c.line, padding: sp.md,
  },
  cardTop: { flexDirection: "row", gap: sp.md },
  thumb: { width: 56, height: 76, borderRadius: radius.sm, backgroundColor: c.placeholder },
  thumbBlank: { alignItems: "center", justifyContent: "center" },
  glyph: { fontSize: glyph.sm },
  cardText: { flex: 1, gap: 2 },
  cardTitle: { ...t.bodyMed, color: c.ink },
  cardSub: { ...t.meta, color: c.inkSoft },
  note: { ...t.meta, color: c.inkFaint, fontStyle: "italic" },
  skeleton: { gap: sp.xs, marginTop: sp.xs },
  skelLine: { height: 10, borderRadius: radius.sm, backgroundColor: c.placeholder },
  skelWide: { width: "88%" },
  skelNarrow: { width: "54%" },

  actions: { flexDirection: "row", flexWrap: "wrap", gap: sp.xs, marginTop: sp.md },
  btn: {
    minHeight: TOUCH_MIN, minWidth: TOUCH_MIN, paddingHorizontal: sp.sm,
    alignItems: "center", justifyContent: "center",
    borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: c.line, backgroundColor: c.bg,
  },
  // Square, so five actions fit on one row even at 320pt. The 44pt floor is
  // held by minWidth/minHeight, not by padding.
  btnIcon: { paddingHorizontal: 0, width: TOUCH_MIN },
  btnLabel: { ...t.body, color: c.ink },
  btnPrimary: { backgroundColor: c.accent, borderColor: c.accent },
  btnPrimaryLabel: { ...t.bodyMed, color: c.accentInk },

  pairWrap: { alignItems: "center", justifyContent: "center", paddingHorizontal: sp.xxl, gap: sp.md },
  pairTitle: { ...t.title, color: c.ink, textAlign: "center" },
  pairHint: { ...t.meta, color: c.inkSoft, textAlign: "center" },
  mono: { ...t.code, color: c.ink },
  input: {
    ...t.body, color: c.ink, width: 260, height: TOUCH, textAlign: "center", letterSpacing: 4,
    borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: c.line, backgroundColor: c.surface,
  },
  pairBtn: { alignSelf: "center", paddingHorizontal: sp.xl, height: TOUCH },
  error: { ...t.meta, color: c.accent, textAlign: "center" },
});
