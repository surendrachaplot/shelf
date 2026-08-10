// App.tsx — the bookcase.
//
// ONE shelf at a time, filling the screen. The previous pass stacked all four
// lists down a scrolling page, each a horizontal carousel — so the page was a
// vertical queue of rows, and every row showed three of six things with the
// rest off the right-hand edge. A shelf you have to scroll sideways to read is
// a shelf you never look at.
//
// Now: a colour rail picks the list, a full-bleed band names it, and its
// jackets wrap left-to-right across as many boards as they need. That is what
// a bookcase does — and it means the count in the band is a promise, because
// everything it counts is on screen.
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
  fetchInbox, fetchList, flushQueue, getProfile, listReceived, pair, updateItem,
  type Item, type ListName, type ShareKind, LISTS,
} from "./src/api";
import { Add } from "./src/Add";
import { ExLibris } from "./src/ExLibris";
import { Profile } from "./src/Profile";
import { Received } from "./src/Received";
import { ShareSheet } from "./src/ShareSheet";
import { getToken, setToken, verifySharedAccess } from "./src/tokenStore";
import { Press } from "./src/Press";
import { Reveal } from "./src/Reveal";
import {
  BOARD, COVER_KEYLINE, coverFor, jacketType, lists, listOn, mainTitle, gridFor, rowsOf, emptyBoards, emptyPitch, EMPTY_BOARD_H, rowPitch,
  RULE, sp, t, TOUCH_MIN, useTheme, type Palette,
} from "./src/theme";

// The pile is a tab like any other, not a section bolted above the shelves.
// It is where a thing lives before it stands anywhere, which is a place — and
// giving it the same affordance as the four lists is what lets one screen hold
// the whole app.
type TabName = ListName | "unsorted";
const TABS: TabName[] = [...LISTS, "unsorted"];

// One screen at a time, held in one variable. A router for four destinations
// would be a dependency that hides where you are; this is four words.
type Screen = "case" | "add" | "profile" | "received";
type Sharing = { kind: ShareKind; target: string | null; list: string; title: string };

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
  const [tab, setTab] = useState<TabName>("books");
  const [viewportH, setViewportH] = useState(0);
  const [screen, setScreen] = useState<Screen>("case");
  const [sharing, setSharing] = useState<Sharing | null>(null);
  const [seed, setSeed] = useState<string>("shelf");
  const [waiting, setWaiting] = useState(0);
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

  // The plate and the delivery count are the two things the header needs and
  // the shelves do not, so they are fetched once rather than on every list
  // change. Both fail SILENTLY: a header is not a place to report a network
  // error, and neither is load-bearing for reading your own shelves.
  const loadHeader = useCallback(async () => {
    if (!paired) return;
    const [me, inbound] = await Promise.all([
      getProfile().catch(() => null),
      listReceived().catch(() => []),
    ]);
    if (me?.profile) setSeed(me.profile.plate_seed || me.profile.handle || "shelf");
    setWaiting(inbound.length);
  }, [paired]);

  useEffect(() => { loadHeader(); }, [loadHeader]);

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
  const showing = tab === "unsorted" ? inbox : (shelves[tab] ?? []);
  const fill = c[tab] ?? c.unsorted;
  const on = listOn[tab] ?? c.onList;

  return (
    <View style={s.screen}>
      <View style={[s.head, s.inset]}>
        <Text style={s.wordmark}>shelf</Text>
        <View style={s.headTools}>
          <Press onPress={() => setScreen("add")} style={s.tool} size={TOUCH_MIN} label="Add something by name">
            <Text style={s.toolLabel}>Add</Text>
          </Press>
          {/* A count of zero is not a badge. "Sent to you" with nothing behind
              it is a dot that trains you to ignore dots. */}
          {waiting > 0 ? (
            <Press onPress={() => setScreen("received")} style={s.toolLive} size={TOUCH_MIN} label={`${waiting} sent to you`}>
              <Text style={s.toolLiveLabel}>{waiting} sent you</Text>
            </Press>
          ) : (
            <Press onPress={() => setScreen("received")} style={s.tool} size={TOUCH_MIN} label="Things sent to you">
              <Text style={s.toolLabel}>Inbox</Text>
            </Press>
          )}
          <Press onPress={() => setScreen("profile")} style={s.plateBtn} size={TOUCH_MIN} label="Your card">
            <ExLibris seed={seed} size={36} />
          </Press>
        </View>
      </View>

      {/* The rail. Five flat blocks of colour carrying nothing but their series
          number — at 75pt wide "RESTAURANTS" does not fit, and a truncated
          label is worse than none when the band below already names it. The
          selected block bridges the 4pt gap into the band, so tab and panel
          read as one continuous field rather than as a chip above a header. */}
      <View style={[s.rail, s.inset]}>
        {TABS.map((k) => (
          <Press
            key={k}
            onPress={() => setTab(k)}
            style={[s.railTab, { backgroundColor: c[k] ?? c.unsorted }, k === tab ? s.railTabOn : null]}
            containerStyle={s.railSlot}
            size={TOUCH_MIN}
            label={`${lists[k].label}, ${(k === "unsorted" ? inbox : shelves[k] ?? []).length} items`}
          >
            <Text style={[s.railNum, { color: listOn[k] ?? c.onList }]}>{lists[k].n}</Text>
          </Press>
        ))}
      </View>

      <View style={[s.band, { backgroundColor: fill }]}>
        <Text style={[s.bandLabel, { color: on }]} numberOfLines={1}>{lists[tab].label}</Text>
        {/* The pile is not a shelf you can hand to anyone — it is the things
            you have not decided about yet. */}
        {tab !== "unsorted" ? (
          <Press
            onPress={() => setSharing({ kind: "shelf", target: tab, list: tab, title: `Your ${lists[tab].label.toLowerCase()} shelf` })}
            style={s.bandShare} size={TOUCH_MIN} label={`Share the ${lists[tab].label} shelf`}
          >
            <Text style={[s.bandCount, { color: on }]}>Share</Text>
          </Press>
        ) : null}
        <Text style={[s.bandCount, { color: on }]}>{String(showing.length).padStart(2, "0")}</Text>
      </View>

      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
        onLayout={(e) => setViewportH(e.nativeEvent.layout.height)}
      >
        {flash ? <Text style={[s.flash, s.inset]}>{flash}</Text> : null}

        {loadError ? (
          <View style={[s.errorBlock, s.insetMargin]}>
            <Text style={s.section}>Couldn't reach your shelves</Text>
            <Text style={s.errorNote}>{loadError}. Nothing has been lost.</Text>
            <Press onPress={load} style={s.retry} size={TOUCH_MIN} label="Try again">
              <Text style={s.retryLabel}>Try again →</Text>
            </Press>
          </View>
        ) : null}

        {tab === "unsorted" ? (
          /* The pile: things that came in but are not on a board yet. Flat
             rows, deliberately — a thing you have not filed is not standing
             anywhere, and the layout should say so before the label does. */
          <View style={[s.inset, s.pileTop]}>
            {inbox.length === 0 ? (
              <Empty
                title="Nothing waiting"
                body="Share a reel from Instagram and pick a shelf. Anything we can't read lands here first."
                s={s}
              />
            ) : inbox.map((item, i) => (
              <Reveal key={item.id} index={i}>
                <PileRow item={item} onAct={act} onOpen={setOpen} s={s} c={c} />
              </Reveal>
            ))}
          </View>
        ) : (
          <Bookcase list={tab} items={showing} viewportH={viewportH} onOpen={setOpen} s={s} c={c} />
        )}

        {busy ? <ActivityIndicator color={c.inkFaint} style={s.busy} /> : null}
      </ScrollView>

      {open ? (
        <Detail
          item={open}
          onClose={() => setOpen(null)}
          onAct={act}
          onShare={() => setSharing({
            kind: "item", target: open.id, list: open.list,
            title: open.title ?? "This one",
          })}
          s={s} c={c}
        />
      ) : null}

      {screen === "add" ? (
        <View style={s.over}>
          <Add onClose={() => { setScreen("case"); load(); }} onAdded={(it) => setTab(it.list)} />
        </View>
      ) : null}
      {screen === "profile" ? (
        <View style={s.over}>
          <Profile
            onClose={() => { setScreen("case"); loadHeader(); }}
            onShare={(handle) => setSharing({ kind: "profile", target: null, list: "books", title: `Everything on @${handle}` })}
          />
        </View>
      ) : null}
      {screen === "received" ? (
        <View style={s.over}>
          <Received
            onClose={() => { setScreen("case"); loadHeader(); }}
            onAccepted={() => { load(); loadHeader(); }}
          />
        </View>
      ) : null}

      {sharing ? (
        <View style={s.over}>
          <ShareSheet {...sharing} onClose={() => setSharing(null)} />
        </View>
      ) : null}
    </View>
  );
}

/**
 * One list, wrapped across as many boards as it needs.
 *
 * The column is solved by `gridFor` in design.js rather than by flexWrap, for
 * two reasons: a board has to be drawn under each row, which flexWrap cannot
 * express; and the gate can prove a pure function never overflows the shelf,
 * never sets a column too narrow to hold its type, and never paints before the
 * container is measured.
 */
function Bookcase({ list, items, viewportH, onOpen, s, c }: {
  list: ListName; items: Item[]; viewportH: number;
  onOpen: (i: Item) => void;
  s: ReturnType<typeof styles>; c: Palette;
}) {
  const [width, setWidth] = useState(0);
  const grid = useMemo(() => gridFor(width, sp.sm), [width]);
  const rows = useMemo(() => rowsOf(items.length, grid.cols), [items.length, grid.cols]);
  const spare = emptyBoards(viewportH, Math.max(rows.length, 1) * rowPitch(sp.xl), emptyPitch(sp.xl));

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width - sp.lg * 2)}>
      {items.length === 0 ? (
        <View style={s.inset}>
          <EmptyShelf list={list} width={grid.width} s={s} c={c} />
        </View>
      ) : rows.map((row, r) => (
        <Reveal key={r} index={r}>
          <View style={[s.caseRow, s.inset]}>
            {row.map((i) => (
              <Cover key={items[i].id} item={items[i]} width={grid.width} list={list} onOpen={onOpen} s={s} c={c} />
            ))}
          </View>
          <View style={s.board} />
        </Reveal>
      ))}

      {/* The rest of the case. Empty boards, same pitch — a bookcase with room
          left is a bookcase; two boards over a field of blank paper is a page
          that stopped. */}
      {Array.from({ length: spare }, (_, i) => (
        <View key={`spare-${i}`}>
          <View style={[s.caseRow, s.spareRow]} />
          <View style={s.board} />
        </View>
      ))}
    </View>
  );
}

/** A jacket. Artwork if we have it, type if we do not — never a grey box. */
function Cover({ item, width, list, onOpen, s, c }: {
  item: Item; width: number; list: ListName;
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
  const jacket = jacketType(title, width);

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
      style={[s.cover, { width, height: dims.height, backgroundColor: field, borderColor: c.ink }]}
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
              <Text style={[s.coverFootLabel, { color: field }]} numberOfLines={2}>{item.subtitle}</Text>
            </View>
          ) : null}
        </>
      )}
    </Press>
  );
}

/** §7 — a title, a sentence saying what happens next, and a way forward. */
function Empty({ title, body, s }: { title: string; body: string; s: ReturnType<typeof styles> }) {
  return (
    <View style={s.emptyCopy}>
      <Text style={s.emptyTitle}>{title}</Text>
      <Text style={s.emptyBody}>{body}</Text>
    </View>
  );
}

function EmptyShelf({ list, width, s, c }: { list: ListName; width: number; s: ReturnType<typeof styles>; c: Palette }) {
  const fill = c[list] ?? c.unsorted;
  const dims = coverFor(list);
  return (
    <View style={s.emptyShelf}>
      {/* An outline of the thing that is missing, at the exact trim a real one
          would have. It says "a cover goes here" in a way a sentence cannot. */}
      <View style={[s.ghost, { width, height: dims.height, borderColor: fill }]} />
      <Empty
        title="Nothing on this shelf"
        body={`Share a reel and pick ${lists[list].label} — the ${lists[list].one} lands here with a cover.`}
        s={s}
      />
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
        <Press onPress={() => onAct(item, { action: "file" })} style={s.pileBtn} size={TOUCH_MIN} label="Shelve it">
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
function Detail({ item, onClose, onAct, onShare, s, c }: {
  item: Item; onClose: () => void;
  onAct: (i: Item, body: Record<string, unknown>) => void;
  onShare: () => void;
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
            <Press onPress={onShare} style={[s.detailBtn, { backgroundColor: on }]} size={TOUCH_MIN} label="Share this">
              <Text style={[s.detailBtnLabel, { color: fill }]}>Share →</Text>
            </Press>
            {item.source_url ? (
              <Press onPress={() => Linking.openURL(item.source_url as string)} style={[s.detailBtnGhost, { borderColor: on }]} size={TOUCH_MIN} label="Open the reel">
                <Text style={[s.detailBtnLabel, { color: on }]}>Open reel →</Text>
              </Press>
            ) : null}
            {item.status !== "filed" ? (
              <Press onPress={() => onAct(item, { action: "file" })} style={[s.detailBtnGhost, { borderColor: on }]} size={TOUCH_MIN} label="Shelve it">
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
            {(item.canonical as { from?: string })?.from
              ? `From @${(item.canonical as { from?: string }).from}`
              : item.confidence == null
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
  scroll: { paddingBottom: sp.huge },
  inset: { paddingHorizontal: sp.lg },
  insetMargin: { marginHorizontal: sp.lg },

  head: { flexDirection: "row", alignItems: "center", paddingTop: sp.xl, paddingBottom: sp.md },
  wordmark: { ...t.wordmark, color: c.ink, flex: 1 },
  headTools: { flexDirection: "row", alignItems: "center", gap: sp.sm },
  tool: { minHeight: TOUCH_MIN, paddingHorizontal: sp.sm, justifyContent: "center" },
  toolLabel: { ...t.micro, color: c.inkFaint },
  toolLive: { minHeight: TOUCH_MIN, paddingHorizontal: sp.sm, justifyContent: "center", backgroundColor: c.accent },
  toolLiveLabel: { ...t.micro, color: c.accentInk },
  plateBtn: { minHeight: TOUCH_MIN, justifyContent: "center" },
  over: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: c.bg },

  // Five equal blocks of flat colour. The selected one drops 4pt to meet the
  // band below it, so the tab and its panel are one continuous field.
  rail: { flexDirection: "row", gap: 2, marginBottom: sp.xs },
  railSlot: { flex: 1 },
  railTab: { minHeight: TOUCH_MIN, alignItems: "center", justifyContent: "center" },
  railTabOn: { marginBottom: -sp.xs },
  railNum: { ...t.micro },

  band: { flexDirection: "row", alignItems: "center", gap: sp.md, paddingHorizontal: sp.lg, paddingVertical: sp.md },
  bandLabel: { ...t.band, flex: 1 },
  bandCount: { ...t.micro },
  bandShare: { minHeight: TOUCH_MIN, justifyContent: "center", paddingHorizontal: sp.sm },

  flash: { ...t.meta, color: c.accent, marginBottom: sp.sm },

  rule: { height: RULE, backgroundColor: c.ink },
  section: { ...t.section, color: c.ink },
  sectionNum: { ...t.micro, color: c.inkFaint },

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

  // One board's worth of jackets. flex-end so every trim rests on the board
  // rather than hanging from a common top edge.
  pileTop: { paddingTop: sp.xl },
  caseRow: { flexDirection: "row", alignItems: "flex-end", gap: sp.sm, marginTop: sp.xl },
  coverSlot: { alignSelf: "flex-end" },
  spareRow: { height: EMPTY_BOARD_H },
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

  emptyShelf: { flexDirection: "row", alignItems: "flex-end", gap: sp.md, marginTop: sp.xl },
  ghost: { borderWidth: COVER_KEYLINE },
  emptyCopy: { flex: 1, paddingBottom: sp.sm },
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
