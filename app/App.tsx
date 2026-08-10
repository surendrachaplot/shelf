// App.tsx — the shelves.
//
// The app is called shelf, so it shows you shelves: four boards running the
// full width of the screen with your things standing FACE-OUT on them, and the
// Inbox as the pile that has not been put away yet.
//
// Face-out is the whole correction. The first pass drew spine-out: 22pt slivers
// with the title rotated -90°, varying in height on a common baseline. That is
// a bar chart with a shelf metaphor written on it — nothing legible, two thirds
// of every row empty paper, and no trace of the thing you actually saved. A
// shelf you scan by eye is a shelf of jackets.
//
// So everything saved gets a cover. Real artwork when we have it; a typographic
// jacket when we do not — set on the list's own colour, in the label colour that
// list names for itself, in one of three compositions so a row of five books
// does not read as a swatch book. A missing cover is a design brief, not a hole.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, Image, Linking, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import {
  fetchInbox, fetchList, flushQueue, pair, updateItem,
  type Item, type ListName, LISTS,
} from "./src/api";
import { getToken, setToken, verifySharedAccess } from "./src/tokenStore";
import { Press } from "./src/Press";
import { Reveal } from "./src/Reveal";
import {
  BOARD, COVER_KEYLINE, coverFor, jacketType, lists, listOn, mainTitle, RULE, sp, t,
  TOUCH_MIN, useTheme, type Palette,
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
  const [open, setOpen] = useState<Item | null>(null);
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
    setOpen(null);
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
        <View style={s.inset}>
          <View style={s.head}>
            <Text style={s.wordmark}>shelf</Text>
            <Text style={s.headCount}>{total} shelved</Text>
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

          {/* The pile: things that came in but are not on a board yet. Flat
              rows, deliberately — a thing you have not filed is not standing
              anywhere, and the layout should say that before the label does. */}
          <View style={s.rule} />
          <View style={s.sectionRow}>
            <Text style={s.section}>Not shelved</Text>
            <View style={s.sectionRule} />
            <Text style={s.sectionNum}>{String(inbox.length).padStart(2, "0")}</Text>
          </View>
          {inbox.length === 0 ? (
            <Text style={s.emptyLine}>Nothing waiting. Share a reel and pick a shelf.</Text>
          ) : (
            inbox.map((item, i) => (
              <Reveal key={item.id} index={i}>
                <PileRow item={item} onAct={act} onOpen={setOpen} s={s} c={c} />
              </Reveal>
            ))
          )}
        </View>

        {LISTS.map((list, i) => (
          <Shelf key={list} list={list} items={shelves[list] ?? []} index={i} onOpen={setOpen} s={s} c={c} />
        ))}

        {busy ? <ActivityIndicator color={c.inkFaint} style={s.busy} /> : null}
      </ScrollView>

      {open ? <Detail item={open} onClose={() => setOpen(null)} onAct={act} s={s} c={c} /> : null}
    </View>
  );
}

/**
 * One shelf: a labelled row of face-out covers standing on a board that runs
 * to both screen edges. Full-bleed is not decoration — a board that stops at
 * the 16pt inset reads as a card, and four cards down a page is the generic
 * list this design exists to not be.
 */
function Shelf({ list, items, index, onOpen, s, c }: {
  list: ListName; items: Item[]; index: number;
  onOpen: (i: Item) => void;
  s: ReturnType<typeof styles>; c: Palette;
}) {
  const fill = c[list] ?? c.unsorted;
  const label = listOn[list] ?? c.onList;
  return (
    <Reveal index={index}>
      <View style={s.shelf}>
        <View style={[s.sectionRow, s.inset]}>
          <View style={[s.shelfTag, { backgroundColor: fill }]}>
            <Text style={[s.shelfTagLabel, { color: label }]}>{lists[list].label}</Text>
          </View>
          <View style={s.sectionRule} />
          <Text style={s.sectionNum}>{String(items.length).padStart(2, "0")}</Text>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={s.coverScroll}
          contentContainerStyle={s.coverRow}
        >
          {items.length === 0 ? (
            <EmptyShelf list={list} s={s} c={c} />
          ) : items.map((item) => (
            <Cover key={item.id} item={item} list={list} onOpen={onOpen} s={s} c={c} />
          ))}
        </ScrollView>
        <View style={s.board} />
      </View>
    </Reveal>
  );
}

/** A jacket. Artwork if we have it, type if we do not — never a grey box. */
function Cover({ item, list, onOpen, s, c }: {
  item: Item; list: ListName;
  onOpen: (i: Item) => void;
  s: ReturnType<typeof styles>; c: Palette;
}) {
  const dims = coverFor(item.title ?? item.id);
  const [failed, setFailed] = useState(false);
  const art = item.image_url && !failed ? item.image_url : null;

  const fill = c[list] ?? c.unsorted;
  const on = listOn[list] ?? c.onList;
  // Composition 2 inverts the jacket. Same two colours, opposite roles — so the
  // contrast is the pairing `list-label-contrast` already proves (≥4.95:1 in
  // both schemes), and a shelf of five blue books still has a white one on it.
  const inverted = dims.comp === 2;
  const field = inverted ? on : fill;
  const mark = inverted ? fill : on;
  const title = mainTitle(item.title ?? "") || "Untitled";
  // Sized from the longest word so nothing is ever split mid-syllable.
  const jacket = jacketType(title, dims.width);

  return (
    <Press
      onPress={() => onOpen(item)}
      size={dims.height}
      hitSlop={0}
      label={`${title}${item.subtitle ? `, ${item.subtitle}` : ""}`}
      containerStyle={s.coverSlot}
      // Trimmed in ink — the one colour that contrasts the paper in BOTH
      // schemes. Trimming in the jacket's own second colour was tried and is
      // wrong: on a red jacket the trim is white, so its white masthead strip
      // bled straight into white paper and the "02" floated with no left or
      // right edge. Ink also gives yellow the boundary it cannot get from a
      // 1.43:1 field, and the bottom edge merging into the board in dark mode
      // is not a defect — that is the book standing on the shelf.
      style={[s.cover, { width: dims.width, height: dims.height, backgroundColor: field, borderColor: c.ink }]}
    >
      {art ? (
        <Image
          source={{ uri: art }}
          style={s.coverArt}
          resizeMode="cover"
          // §6 — a 404 must land somewhere designed. It lands on the typographic
          // jacket below, which is the same fallback as having no artwork at all.
          onError={() => setFailed(true)}
        />
      ) : (
        <>
          {dims.comp !== 0 ? (
            <View style={[s.coverStrip, { backgroundColor: mark }]}>
              {/* The series number alone. The list name is already on the tag
                  directly above this shelf; repeating it here only bought a
                  truncated "02 · RESTA…" on every restaurant cover. */}
              <Text style={[s.coverStripLabel, { color: field }]} numberOfLines={1}>{lists[list].n}</Text>
            </View>
          ) : null}

          {/* Three places for the mass: top, foot, centre. Three silhouettes
              you can tell apart across a shelf without reading a word. */}
          <View style={[s.coverBody, dims.comp === 1 ? s.coverBodyBottom : null, dims.comp === 2 ? s.coverBodyMiddle : null]}>
            <Text style={[s.coverTitle, jacket, { color: mark }]} numberOfLines={5}>{title}</Text>
          </View>

          {/* The foot band carries the author / the neighbourhood — and it
              gives the inverted jackets a base to stand on, which a plain
              white rectangle on white paper badly needs. Comp 1 skips it
              because its title already occupies the foot. */}
          {dims.comp !== 1 && item.subtitle ? (
            <View style={[s.coverFoot, { backgroundColor: mark }]}>
              <Text style={[s.coverFootLabel, { color: field }]} numberOfLines={1}>{item.subtitle}</Text>
            </View>
          ) : null}
        </>
      )}
    </Press>
  );
}

/** §7 — a title, a sentence saying what happens next, and a way forward. */
function EmptyShelf({ list, s, c }: { list: ListName; s: ReturnType<typeof styles>; c: Palette }) {
  const fill = c[list] ?? c.unsorted;
  const dims = coverFor(list);
  return (
    <View style={s.emptyShelf}>
      <View style={[s.ghost, { width: dims.width, height: dims.height, borderColor: fill }]} />
      <View style={s.emptyCopy}>
        <Text style={s.emptyTitle}>Nothing on this shelf</Text>
        <Text style={s.emptyBody}>
          Share a reel from Instagram and pick {lists[list].label} — the {lists[list].one} shows up here with a cover.
        </Text>
      </View>
    </View>
  );
}

function PileRow({ item, onAct, onOpen, s, c }: {
  item: Item; s: ReturnType<typeof styles>; c: Palette;
  onOpen: (i: Item) => void;
  onAct: (i: Item, body: Record<string, unknown>) => void;
}) {
  const pending = item.status === "pending";
  // A pending item has no shelf yet. Painting it in a list colour is a lie the
  // eye reads before the words do — it gets an outline instead.
  const fill = pending ? "transparent" : (c[item.list] ?? c.unsorted);
  return (
    <View style={s.pile}>
      <View style={[s.pileSwatch, { backgroundColor: fill, borderColor: pending ? c.inkFaint : fill }]} />
      {pending ? (
        <Text style={s.pileTitle} numberOfLines={1}>Working it out…</Text>
      ) : (
        <Press onPress={() => onOpen(item)} containerStyle={s.pileMain} size={TOUCH_MIN} label={`Open ${item.title ?? "this item"}`}>
          <Text style={s.pileTitle} numberOfLines={1}>{item.title ?? "Couldn't read this one"}</Text>
        </Press>
      )}
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

/**
 * The jacket at full size — kicker at the head, everything else standing on
 * the foot, which is composition 1 at screen scale. The first version
 * top-aligned the block and left four fifths of the screen as an empty red
 * field, which is not "generous white space", it is a poster nobody finished.
 */
function Detail({ item, onClose, onAct, s, c }: {
  item: Item; onClose: () => void;
  onAct: (i: Item, body: Record<string, unknown>) => void;
  s: ReturnType<typeof styles>; c: Palette;
}) {
  const list = (item.list ?? "unsorted") as ListName;
  const fill = c[list] ?? c.unsorted;
  const [failed, setFailed] = useState(false);
  const art = item.image_url && !failed ? item.image_url : null;
  // Every word on this panel is `on` over the list colour — the one pairing
  // `list-label-contrast` proves in both schemes. No opacities: a label at 86%
  // is a contrast ratio nobody computed.
  const on = listOn[list] ?? c.onList;
  return (
    <View style={[s.detail, { backgroundColor: fill }]}>
      <ScrollView contentContainerStyle={s.detailScroll} showsVerticalScrollIndicator={false}>
        <View>
          <View style={s.detailHead}>
            <Text style={[s.detailKicker, { color: on }]}>{lists[list].n} · {lists[list].label}</Text>
            <Press onPress={onClose} style={s.detailClose} size={TOUCH_MIN} label="Close">
              <Text style={[s.detailKicker, { color: on }]}>Close</Text>
            </Press>
          </View>
          <View style={[s.detailRule, { backgroundColor: on }]} />
          <Text style={[s.detailTitle, { color: on }]}>{item.title ?? "Couldn't read this one"}</Text>
          {item.subtitle ? <Text style={[s.detailSub, { color: on }]}>{item.subtitle}</Text> : null}
        </View>

        {/* The field between head and colophon carries the frame we pulled off
            the reel. When there is none it stays empty on purpose — that gap
            is the composition, and filling it with a grey placeholder box
            would be the one thing worse than leaving it. */}
        {art ? (
          <Image
            source={{ uri: art }}
            style={[s.detailArt, { borderColor: on }]}
            resizeMode="cover"
            onError={() => setFailed(true)}
          />
        ) : null}

        <View>
          {item.note ? <Text style={[s.detailNote, { color: on }]}>{item.note}</Text> : null}

          <View style={s.detailActions}>
            {item.source_url ? (
              <Press onPress={() => Linking.openURL(item.source_url as string)} style={[s.detailBtn, { backgroundColor: on }]} size={TOUCH_MIN} label="Open the reel">
                <Text style={[s.detailBtnLabel, { color: fill }]}>Open reel →</Text>
              </Press>
            ) : null}
            {item.status !== "filed" ? (
              <Press onPress={() => onAct(item, { action: "file" })} style={[s.detailBtnGhost, { borderColor: on }]} size={TOUCH_MIN} label={`Shelve on ${lists[list].label}`}>
                <Text style={[s.detailBtnLabel, { color: on }]}>Shelve it →</Text>
              </Press>
            ) : null}
            <Press onPress={() => onAct(item, { action: "discard" })} style={[s.detailBtnGhost, { borderColor: on }]} size={TOUCH_MIN} label="Remove">
              <Text style={[s.detailBtnLabel, { color: on }]}>Remove</Text>
            </Press>
          </View>

          <View style={[s.detailFootRule, { backgroundColor: on }]} />
          {/* §8 — "no confidence recorded" and "low confidence" must never
              render the same way. One means we could not look at it; the other
              means we did and were unsure. */}
          <Text style={[s.detailMeta, { color: on }]}>
            {item.confidence == null
              ? "Not read yet"
              : `${Math.round(item.confidence * 100)}% sure · ${item.enriched ? "matched to a catalogue" : "from the caption only"}`}
          </Text>
        </View>
      </ScrollView>
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
  // Vertical only. The horizontal inset lives on the blocks, so a board can run
  // edge to edge while the type it labels still lines up with the wordmark.
  scroll: { paddingTop: sp.xl, paddingBottom: sp.huge },
  inset: { paddingHorizontal: sp.lg },

  head: { flexDirection: "row", alignItems: "baseline", marginBottom: sp.lg },
  wordmark: { ...t.wordmark, color: c.ink, flex: 1 },
  headCount: { ...t.micro, color: c.inkFaint },

  flash: { ...t.meta, color: c.accent, marginBottom: sp.sm },

  rule: { height: RULE, backgroundColor: c.ink },
  sectionRow: { flexDirection: "row", alignItems: "center", gap: sp.sm, paddingTop: sp.md, paddingBottom: sp.sm },
  section: { ...t.section, color: c.ink },
  sectionRule: { flex: 1, height: 1, backgroundColor: c.line },
  sectionNum: { ...t.micro, color: c.inkFaint },

  // The shelf-edge label: a colour tab carrying the list name, the way a shop
  // labels the board its stock stands on.
  shelfTag: { height: 24, paddingHorizontal: sp.sm, justifyContent: "center" },
  shelfTagLabel: { ...t.micro },

  emptyLine: { ...t.meta, color: c.inkFaint, paddingBottom: sp.md },

  pile: {
    flexDirection: "row", alignItems: "center", gap: sp.sm,
    borderWidth: 2, borderColor: c.ink, paddingHorizontal: sp.md,
    minHeight: TOUCH_MIN, marginBottom: sp.sm,
  },
  pileSwatch: { width: 9, height: 9, borderWidth: 2 },
  pileMain: { flex: 1, minHeight: TOUCH_MIN, justifyContent: "center" },
  pileTitle: { ...t.bodyMed, color: c.ink, flex: 1 },
  pileBtn: { minHeight: TOUCH_MIN, justifyContent: "center", paddingLeft: sp.sm },
  pileAction: { ...t.micro, color: c.inkFaint },

  shelf: { marginTop: sp.lg },
  // flexGrow:0 or a horizontal list claims the vertical space of its parent —
  // that is how a tab strip once ate 200pt of a 667pt screen.
  coverScroll: { flexGrow: 0 },
  coverRow: { flexDirection: "row", alignItems: "flex-end", gap: sp.sm, paddingHorizontal: sp.lg },
  coverSlot: { alignSelf: "flex-end" },
  cover: { overflow: "hidden", borderWidth: COVER_KEYLINE },
  coverArt: { width: "100%", height: "100%" },
  coverStrip: { height: 22, justifyContent: "center", paddingHorizontal: sp.sm },
  coverStripLabel: { ...t.tag },
  coverBody: { flex: 1, padding: sp.sm, paddingTop: sp.md },
  coverBodyBottom: { justifyContent: "flex-end" },
  coverBodyMiddle: { justifyContent: "center" },
  coverTitle: { ...t.coverTitle },
  coverFoot: { minHeight: 24, justifyContent: "center", paddingHorizontal: sp.sm, paddingVertical: sp.xs },
  coverFootLabel: { ...t.tag },
  board: { height: BOARD, backgroundColor: c.ink },

  emptyShelf: { flexDirection: "row", alignItems: "flex-end", gap: sp.md },
  ghost: { borderWidth: COVER_KEYLINE },
  emptyCopy: { flex: 1, paddingBottom: sp.sm, maxWidth: 200 },
  emptyTitle: { ...t.section, color: c.ink },
  emptyBody: { ...t.meta, color: c.inkSoft, marginTop: sp.xs },

  detail: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  // flexGrow + space-between is what puts the mass on the foot: the kicker
  // stays at the head, everything else sits on the bottom of the field, and a
  // long note simply scrolls instead of being clipped.
  detailScroll: { flexGrow: 1, justifyContent: "space-between", padding: sp.lg, paddingTop: sp.xxl, paddingBottom: sp.xl },
  detailHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  detailKicker: { ...t.micro },
  detailClose: { minHeight: TOUCH_MIN, justifyContent: "center" },
  detailRule: { height: RULE, marginTop: sp.md, marginBottom: sp.md },
  detailTitle: { ...t.detailTitle },
  detailSub: { ...t.bodyMed, marginTop: sp.md },
  detailArt: { width: "100%", aspectRatio: 3 / 4, marginVertical: sp.xl, borderWidth: COVER_KEYLINE },
  detailNote: { ...t.body, marginTop: sp.md },
  detailActions: { flexDirection: "row", flexWrap: "wrap", gap: sp.sm, marginTop: sp.xl },
  detailBtn: { minHeight: TOUCH_MIN, paddingHorizontal: sp.lg, alignItems: "center", justifyContent: "center" },
  detailBtnGhost: { minHeight: TOUCH_MIN, paddingHorizontal: sp.lg, alignItems: "center", justifyContent: "center", borderWidth: 2 },
  detailBtnLabel: { ...t.micro },
  detailFootRule: { height: RULE, marginTop: sp.xl },
  detailMeta: { ...t.micro, marginTop: sp.md },

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
