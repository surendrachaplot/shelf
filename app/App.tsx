// App.tsx — the four shelves, the Inbox, and pairing.
//
// The register is a reading room, not a dashboard: warm paper, ink, a serif
// for the things you saved and a sans for the controls that file them. Each
// list owns a colour, so a shelf of books and a list of places do not look
// like one undifferentiated pile.
//
// No borders around everything. Cards sit ON the paper with a soft shadow —
// a hairline outline on every surface is the visual equivalent of underlining
// every sentence, and it is what makes an interface read as a wireframe that
// never got finished.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, FlatList, Image, RefreshControl, SafeAreaView,
  StatusBar, StyleSheet, Text, TextInput, View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import {
  fetchInbox, fetchList, flushQueue, pair, updateItem,
  type Item, type ListName, LISTS,
} from "./src/api";
import { getToken, setToken, verifySharedAccess } from "./src/tokenStore";
import { Icon, listIcon } from "./src/Icon";
import { Press } from "./src/Press";
import { Reveal } from "./src/Reveal";
import { coverHeight, elevation, icon, lists, radius, sp, t, TOUCH, TOUCH_MIN, useTheme, type Palette } from "./src/theme";

type Tab = ListName | "inbox";
const TABS: Tab[] = ["inbox", ...LISTS];
const tintOf = (c: Palette, tab: Tab) => (tab === "inbox" ? c.unsorted : c[tab] ?? c.accent);

export default function App() {
  const { c, dark } = useTheme();
  const s = useMemo(() => styles(c, dark), [c, dark]);

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

      <Text style={s.wordmark}>shelf</Text>

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
          // A horizontal list inside a flex column is still a flex child and
          // takes flex:1 vertically unless told not to.
          style={s.tabList}
          renderItem={({ item: name }) => {
            const on = tab === name;
            const tint = tintOf(c, name);
            return (
              <Press onPress={() => setTab(name)} style={s.tab} size={100} label={lists[name === "inbox" ? "unsorted" : name].label}>
                <View style={s.tabInner}>
                  <Icon name={name === "inbox" ? "inbox" : listIcon[name]} size={icon.sm} color={on ? tint : c.inkFaint} />
                  <Text style={[s.tabLabel, on && { color: c.ink }]}>
                    {lists[name === "inbox" ? "unsorted" : name].label}
                  </Text>
                </View>
                {/* Selection is a rule in the list's own colour, not a filled
                    black pill — the pill is the default look and it drowns
                    every colour the app just spent effort establishing. */}
                <View style={[s.tabRule, on && { backgroundColor: tint }]} />
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
              <View style={s.emptyMark}><Icon name="offline" size={icon.xl} color={c.inkFaint} /></View>
              <Text style={s.emptyTitle}>Couldn't reach your shelf</Text>
              <Text style={s.emptyHint}>{loadError}. Nothing has been lost.</Text>
              <Press onPress={load} style={[s.btn, s.btnPrimary, s.retry]} size={TOUCH} label="Try again">
                <Text style={s.btnPrimaryLabel}>Try again</Text>
              </Press>
            </View>
          ) : (
            <View style={s.empty}>
              <View style={s.emptyMark}>
                <Icon name={tab === "inbox" ? "inbox" : listIcon[tab]} size={icon.xl} color={tintOf(c, tab)} />
              </View>
              <Text style={s.emptyTitle}>
                {tab === "inbox" ? "Nothing waiting" : `No ${lists[tab].label.toLowerCase()} yet`}
              </Text>
              <Text style={s.emptyHint}>
                Share a reel from Instagram and pick a list — it'll arrive here.
              </Text>
            </View>
          )
        }
        renderItem={({ item, index }) => (
          <Reveal index={index}>
            <Row item={item} inbox={tab === "inbox"} onAct={act} s={s} c={c} />
          </Reveal>
        )}
      />
    </SafeAreaView>
  );
}

function Row({ item, inbox, onAct, s, c }: {
  item: Item; inbox: boolean; s: ReturnType<typeof styles>; c: Palette;
  onAct: (i: Item, body: Record<string, unknown>) => void;
}) {
  const pending = item.status === "pending";
  const tint = c[item.list] ?? c.accent;
  // MISSING and FAILED are two different states and both need the same
  // designed fallback. Open Library and TMDB both serve dead cover paths.
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = !!item.image_url && !imageFailed;

  return (
    <View style={s.card}>
      <View style={s.cardTop}>
        {showImage
          ? <Image source={{ uri: item.image_url! }} style={[s.cover, { height: coverHeight(item.list) }]} onError={() => setImageFailed(true)} />
          : <View style={[s.cover, s.coverBlank, { height: coverHeight(item.list) }]}>
              <Icon name={listIcon[item.list]} size={icon.lg} color={tint} />
            </View>}
        <View style={s.cardText}>
          <Text style={s.cardTitle} numberOfLines={2}>
            {item.title ?? (pending ? "Working it out…" : "Couldn't read this one")}
          </Text>
          {item.subtitle ? <Text style={s.cardSub} numberOfLines={2}>{item.subtitle}</Text> : null}
          {/* The note is the only part of a saved thing no catalogue knows —
              why it was worth keeping. It gets the pull-quote treatment. */}
          {item.note ? (
            <View style={[s.noteWrap, { borderLeftColor: tint }]}>
              <Text style={s.note} numberOfLines={3}>{item.note}</Text>
            </View>
          ) : null}
          {pending ? (
            <View style={s.skeleton}>
              <View style={[s.skelLine, s.skelWide]} />
              <View style={[s.skelLine, s.skelNarrow]} />
            </View>
          ) : null}
        </View>
      </View>

      {/* Pending rows show no buttons: nothing to confirm until the worker has
          had its go, and "Keep" on a row with no title files an empty item. */}
      {inbox && !pending ? (
        <View style={s.actions}>
          <Press onPress={() => onAct(item, { action: "file" })} style={[s.btn, { backgroundColor: tint }]} size={TOUCH} label="Keep">
            <Text style={s.btnPrimaryLabel}>Keep</Text>
          </Press>
          {LISTS.filter((l) => l !== item.list).map((l) => (
            <Press key={l} onPress={() => onAct(item, { list: l, action: "file" })} style={[s.btn, s.btnIcon]} size={TOUCH} label={`Move to ${lists[l].label}`}>
              <Icon name={listIcon[l]} size={icon.sm} color={c[l] ?? c.inkSoft} />
            </Press>
          ))}
          <Press onPress={() => onAct(item, { action: "discard" })} style={[s.btn, s.btnIcon]} size={TOUCH} label="Discard">
            <Icon name="trash" size={icon.sm} color={c.inkFaint} />
          </Press>
        </View>
      ) : null}
    </View>
  );
}

function Pairing({ onPaired }: { onPaired: () => void }) {
  const { c, dark } = useTheme();
  const s = useMemo(() => styles(c, dark), [c, dark]);
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
      <Reveal><Text style={s.pairMark}>shelf</Text></Reveal>
      <Reveal index={1}>
        <Text style={s.pairHint}>
          Run{"  "}<Text style={s.mono}>node auth.js --pair you@email</Text>{"  "}on the server, then type the code it prints.
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
        <Press onPress={submit} disabled={busy || code.length < 4} style={[s.btn, s.btnPrimary, s.pairBtn]} size={TOUCH} label="Pair this phone">
          {busy ? <ActivityIndicator color={c.accentInk} /> : <Text style={s.btnPrimaryLabel}>Pair this phone</Text>}
        </Press>
      </Reveal>
      {error ? <Text style={s.error}>{error}</Text> : null}
    </SafeAreaView>
  );
}

const styles = (c: Palette, _dark: boolean) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  boot: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.bg },

  wordmark: { ...t.display, color: c.ink, paddingHorizontal: sp.lg, paddingTop: sp.xs, paddingBottom: sp.md },

  tabWrap: { position: "relative" },
  tabList: { flexGrow: 0, flexShrink: 0 },
  tabFade: { position: "absolute", right: 0, top: 0, bottom: 0, width: sp.xxl },
  tabs: { paddingHorizontal: sp.lg, gap: sp.lg, paddingBottom: sp.md },
  tab: { minHeight: TOUCH_MIN, justifyContent: "space-between", alignItems: "center", gap: sp.sm },
  tabInner: { flexDirection: "row", alignItems: "center", gap: sp.xs, flex: 1 },
  tabLabel: { ...t.bodyMed, color: c.inkFaint },
  tabRule: { height: 2, alignSelf: "stretch", borderRadius: radius.pill, backgroundColor: "transparent" },

  flash: { ...t.meta, color: c.accent, paddingHorizontal: sp.lg, paddingBottom: sp.sm },

  list: { paddingHorizontal: sp.lg, paddingBottom: sp.huge, gap: sp.md, paddingTop: sp.xs },
  listEmpty: { flexGrow: 1, justifyContent: "center" },
  empty: { alignItems: "center", paddingHorizontal: sp.xxl, gap: sp.xs },
  emptyMark: { opacity: 0.4, marginBottom: sp.sm },
  emptyTitle: { ...t.heading, color: c.ink, textAlign: "center" },
  emptyHint: { ...t.meta, color: c.inkSoft, textAlign: "center" },
  retry: { marginTop: sp.lg },

  card: { backgroundColor: c.surface, borderRadius: radius.lg, padding: sp.md, ...elevation.card },
  cardTop: { flexDirection: "row", gap: sp.md },
  // 2:3, the proportion of a book cover and a film poster. It leads the row.
  cover: { width: 62, borderRadius: radius.sm, backgroundColor: c.placeholder, ...elevation.cover },
  coverBlank: { alignItems: "center", justifyContent: "center" },
  cardText: { flex: 1, gap: sp.xs },
  cardTitle: { ...t.itemTitle, color: c.ink },
  cardSub: { ...t.meta, color: c.inkSoft },
  noteWrap: { borderLeftWidth: 2, paddingLeft: sp.sm, marginTop: 2 },
  note: { ...t.quote, color: c.inkSoft },

  skeleton: { gap: sp.xs, marginTop: sp.xs },
  skelLine: { height: 9, borderRadius: radius.sm, backgroundColor: c.placeholder },
  skelWide: { width: "82%" },
  skelNarrow: { width: "48%" },

  actions: { flexDirection: "row", flexWrap: "wrap", gap: sp.xs, marginTop: sp.md },
  btn: {
    minHeight: TOUCH_MIN, minWidth: TOUCH_MIN, paddingHorizontal: sp.md,
    alignItems: "center", justifyContent: "center", borderRadius: radius.md,
  },
  // Square, so five actions fit on one row even at 320pt. The 44pt floor is
  // held by minWidth/minHeight, never by padding.
  // `placeholder`, not `surfaceSunk`: this sits ON the card, so it has to be
  // lighter than it in dark and darker in light. surfaceSunk is darker in both
  // and punched five holes through every Inbox card.
  btnIcon: { paddingHorizontal: 0, width: TOUCH_MIN, backgroundColor: c.placeholder },
  btnPrimary: { backgroundColor: c.accent },
  // On light the lists are deep, on dark they are bright — so the label flips.
  btnPrimaryLabel: { ...t.bodyMed, color: c.onList },

  pairWrap: { alignItems: "center", justifyContent: "center", paddingHorizontal: sp.xxl, gap: sp.md },
  pairMark: { ...t.display, color: c.ink, textAlign: "center" },
  pairHint: { ...t.meta, color: c.inkSoft, textAlign: "center" },
  mono: { ...t.code, color: c.ink },
  input: {
    ...t.body, color: c.ink, width: 264, height: TOUCH, textAlign: "center", letterSpacing: 4,
    borderRadius: radius.md, backgroundColor: c.surface, ...elevation.card,
  },
  pairBtn: { alignSelf: "center", paddingHorizontal: sp.xl, height: TOUCH, marginTop: sp.xs },
  error: { ...t.meta, color: c.accent, textAlign: "center" },
});
