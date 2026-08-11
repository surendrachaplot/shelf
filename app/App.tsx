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
  ActivityIndicator, AppState, Image, Linking, RefreshControl, ScrollView, StyleSheet,
  Text, TextInput, View,
} from "react-native";
import {
  claim, fetchInbox, fetchList, flushQueue, getProfile, listReceived, pair, retryItem,
  serverState, updateItem,
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
import { KeyboardSafe, scrollKeyboardProps } from "./src/KeyboardSafe";
import {
  BOARD, COVER_KEYLINE, coverFor, placeholderOn, jacketType, lists, listOn, mainTitle, gridFor, rowsOf, emptyBoards, emptyPitch, EMPTY_BOARD_H, rowPitch,
  RULE, sp, t, TOUCH_MIN, useTheme, type Palette,
} from "./src/theme";
import * as D from "./src/design.js";

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
  const { c, dark } = useTheme();
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

  const syncQueue = useCallback(async () => {
    const sent = await flushQueue().catch(() => 0);
    if (sent) setFlash(`Synced ${sent} share${sent > 1 ? "s" : ""} saved offline`);
  }, []);

  useEffect(() => {
    (async () => {
      // `ready` is set in a finally, not after the await. A Keychain read that
      // throws would otherwise leave this screen on its boot spinner forever,
      // and a boot spinner on this app looks exactly like the splash — which
      // is what "stuck on the splash screen" turned out to mean.
      let token: string | null = null;
      try {
        token = await getToken();
      } finally {
        setPaired(!!token);
        setReady(true);
      }
      if (token) await syncQueue();
    })();
  }, [syncQueue]);

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

  // SHARING HAPPENS IN ANOTHER APP. You leave shelf, share a reel from
  // Instagram, and come back — and iOS does not remount a backgrounded app, so
  // every effect above ran once, at cold start, and never again. The shelves
  // then show whatever they showed when you last launched, no matter how many
  // reels went up in between. Reported, accurately, as "nothing is coming to
  // the shelf when I share".
  //
  // Returning to the app is the one moment we KNOW something may have arrived,
  // so it is the one moment worth spending a fetch on. The queue is flushed
  // here too: a share sent with no signal is stranded until the app asks.
  useEffect(() => {
    if (!paired) return;
    const sub = AppState.addEventListener("change", (next) => {
      if (next !== "active") return;
      load();
      loadHeader();
      syncQueue();
    });
    return () => sub.remove();
  }, [paired, load, loadHeader, syncQueue]);

  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(null), 3500);
    return () => clearTimeout(id);
  }, [flash]);

  async function retry(item: Item) {
    // Optimistic: the row flips to "Working it out…" immediately, because the
    // queue is drained on an interval and a button that looks inert for five
    // seconds gets pressed four more times.
    setInbox((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: "pending", last_error: null } : i)));
    try {
      await retryItem(item.id);
      setFlash("Reading it again — pull down in a moment to see.");
    } catch (e) {
      setFlash((e as Error).message);
      load();
    }
  }

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
            /* NOT "Inbox". The fifth rail tab below is already where your own
               unfiled things pile up, and two Inboxes on one screen means the
               one you tap is the wrong one. This button is other people. */
            <Press onPress={() => setScreen("received")} style={s.tool} size={TOUCH_MIN} label="Things sent to you">
              <Text style={s.toolLabel}>Sent you</Text>
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
        // The gesture everybody already tries when a list looks stale. It is
        // also the only way to ask again while the app stays in the
        // foreground — a reel resolves seconds after it is shared, so "pull
        // once more" is a real answer rather than a placebo.
        refreshControl={
          <RefreshControl
            refreshing={busy}
            onRefresh={() => { load(); loadHeader(); syncQueue(); }}
            tintColor={c.inkFaint}
          />
        }
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
                <PileRow item={item} onAct={act} onOpen={setOpen} onRetry={retry} s={s} c={c} />
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
          dark={dark}
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

/**
 * Why this one has no name — in words, and different words per cause, because
 * the thing you should do next differs. "Couldn't read this one" told nobody
 * anything, which is how a blocked scrape and a caption-less reel spent a day
 * looking like the same bug.
 */
export function whyUnread(item: Pick<Item, "title" | "resolver" | "last_error" | "had_caption">): string | null {
  if (item.title) return null;
  if (item.last_error) return `It threw an error while reading: ${item.last_error}`;
  if (!item.had_caption) {
    return "Instagram gave us nothing to read. Screenshot the reel and share the picture instead — that path never touches Instagram.";
  }
  return "We got the caption but couldn't tell what it was about.";
}

function PileRow({ item, onAct, onOpen, onRetry, s, c }: {
  item: Item; s: ReturnType<typeof styles>; c: Palette;
  onOpen: (i: Item) => void;
  onRetry: (i: Item) => void;
  onAct: (i: Item, body: Record<string, unknown>) => void;
}) {
  const pending = item.status === "pending";
  // A pending item has no shelf yet. Painting it in a list colour is a lie the
  // eye reads before the words do — it gets an outline instead.
  const fill = pending ? "transparent" : (c[item.list] ?? c.unsorted);
  const why = pending ? null : whyUnread(item);
  return (
    <View style={s.pile}>
      {/* The swatch sits in a 44pt box rather than carrying a magic top
          margin, so it lands on the FIRST LINE whether the row is one line or
          five. Hand-tuned to the two-line case, it floated under the one-line
          rows — visible immediately in the contact sheet. */}
      <View style={s.pileSwatchBox}>
        <View style={[s.pileSwatch, { backgroundColor: fill, borderColor: pending ? c.inkFaint : fill }]} />
      </View>
      {pending ? (
        // flex:1 lives HERE, not on pileTitle: the title is now a heading with
        // a paragraph under it, and a flexed Text inside that column stops the
        // row from pushing the action to the right-hand edge.
        <View style={s.pileMain}>
          <Text style={s.pileTitle} numberOfLines={1}>Working it out…</Text>
        </View>
      ) : (
        <Press onPress={() => onOpen(item)} containerStyle={s.pileMain} size={TOUCH_MIN} label={`Open ${item.title ?? "the one we couldn't read"}`}>
          <Text style={s.pileTitle} numberOfLines={1}>{item.title ?? "Couldn't read this one"}</Text>
          {/* The reason, under the row, in full. Truncating an explanation to
              one line makes it decoration. */}
          {why ? <Text style={s.pileWhy}>{why}</Text> : null}
        </Press>
      )}
      {pending ? (
        // In the same 44pt box the buttons use, or it rides at the very top of
        // the row while the title is centred below it.
        <View style={s.pileBtn}><Text style={s.pileAction}>Reading</Text></View>
      ) : why ? (
        // Shelving something with no name puts a blank jacket on a board. The
        // useful action on an unread item is to read it again — Instagram's
        // mood changes, and a resolver fix has to be applicable to what is
        // already here or it fixes nothing you have already lost.
        <Press onPress={() => onRetry(item)} style={s.pileBtn} size={TOUCH_MIN} label="Try reading it again">
          <Text style={s.pileAction}>Read again</Text>
        </Press>
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
function Detail({ item, onClose, onAct, onShare, dark, s, c }: {
  item: Item; onClose: () => void;
  onAct: (i: Item, body: Record<string, unknown>) => void;
  onShare: () => void;
  dark: boolean;
  s: ReturnType<typeof styles>; c: Palette;
}) {
  const list = (item.list ?? "unsorted") as ListName;
  const fill = c[list] ?? c.unsorted;
  const [failed, setFailed] = useState(false);
  const art = item.image_url && !failed ? item.image_url : null;
  const [note, setNote] = useState(item.note ?? "");
  const [editingNote, setEditingNote] = useState(false);
  const [savingNote, setSavingNote] = useState(false);

  async function saveNote() {
    setSavingNote(true);
    try {
      await updateItem({ id: item.id, note });
      setEditingNote(false);
    } finally {
      setSavingNote(false);
    }
  }

  // Every word on this panel is `on` over the list colour — the one pairing
  // `list-label-contrast` proves in both schemes. No opacities: a label at 86%
  // is a contrast ratio nobody computed.
  const on = listOn[list] ?? c.onList;
  const ghost = placeholderOn(list, dark ? D.dark : D.light);
  return (
    <View style={[s.detail, { backgroundColor: fill }]}>
      <ScrollView contentContainerStyle={s.detailScroll} showsVerticalScrollIndicator={false} {...scrollKeyboardProps}>
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
          {/* YOUR note. The thing a catalogue cannot give you and the reason a
              shelf you share is a part of yourself rather than a list of
              titles — so it is editable in place, on the field, not behind an
              edit screen. */}
          {editingNote ? (
            <>
              <TextInput
                value={note}
                onChangeText={setNote}
                autoFocus
                multiline
                maxLength={1000}
                placeholder="What you thought about it"
                placeholderTextColor={ghost}
                style={[s.detailNoteInput, { color: on, borderColor: on }]}
              />
              <View style={s.detailActions}>
                <Press onPress={saveNote} disabled={savingNote} style={[s.detailBtn, { backgroundColor: on }]} size={TOUCH_MIN} label="Save the note">
                  {savingNote ? <ActivityIndicator color={fill} /> : <Text style={[s.detailBtnLabel, { color: fill }]}>Save note</Text>}
                </Press>
                <Press onPress={() => { setNote(item.note ?? ""); setEditingNote(false); }} style={[s.detailBtnGhost, { borderColor: on }]} size={TOUCH_MIN} label="Cancel">
                  <Text style={[s.detailBtnLabel, { color: on }]}>Cancel</Text>
                </Press>
              </View>
            </>
          ) : (
            <Press onPress={() => setEditingNote(true)} containerStyle={s.detailNoteTap} size={TOUCH_MIN} label={note ? "Edit your note" : "Add a note"}>
              <Text style={[s.detailNote, { color: note ? on : ghost }]}>
                {note || "Add a note — what you thought, why you saved it"}
              </Text>
            </Press>
          )}

          {/* Auto-classification gets it wrong sometimes, and a thing on the
              wrong shelf is the one defect the owner can see and nobody else
              can fix. Four blocks, current one marked. */}
          <Text style={[s.detailKicker, s.detailMoveLabel, { color: on }]}>Shelf</Text>
          <View style={s.detailMove}>
            {LISTS.map((l) => (
              <Press
                key={l}
                onPress={() => onAct(item, { list: l })}
                containerStyle={s.detailMoveSlot}
                style={[s.detailMoveTab, { backgroundColor: c[l] }, l === list ? { borderColor: on } : null]}
                size={TOUCH_MIN}
                label={`Move to ${lists[l].label}`}
              >
                <Text style={[s.detailMoveNum, { color: listOn[l] }]}>{lists[l].n}</Text>
              </Press>
            ))}
          </View>

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
  // undefined = we have not asked the server yet. A spinner is the honest
  // rendering of that; showing the code field first and swapping it out under
  // somebody's fingers is not.
  const [unclaimed, setUnclaimed] = useState<boolean | undefined>(undefined);
  // The server is asleep and we are waiting on it. Worth saying out loud.
  const [waking, setWaking] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      // The API is on a free tier that sleeps after about fifteen minutes idle
      // and takes up to a minute to get back up. ASK REPEATEDLY WITH A SHORT
      // TIMEOUT rather than once with a long one: one long wait is a spinner
      // that cannot tell you anything, and this screen — wordmark over a
      // spinner — is visually identical to the splash, so a hang here reads as
      // "the app never started". It did; it was waiting on a sleeping server.
      for (let attempt = 0; live && attempt < 8; attempt++) {
        try {
          const r = await serverState();
          if (live) { setUnclaimed(!!r.unclaimed); setWaking(false); }
          return;
        } catch {
          if (!live) return;
          setWaking(true);
          await new Promise((r) => setTimeout(r, 2500));
        }
      }
      // Eight tries, about eighty seconds. Whatever is wrong is not a nap.
      // Fall through to the code field: a screen you can act on beats a screen
      // that is still deciding.
      if (live) { setUnclaimed(false); setWaking(false); }
    })();
    return () => { live = false; };
  }, []);

  async function finish(get: () => Promise<string>) {
    setBusy(true);
    setError(null);
    try {
      // AWAITED. Unawaited, the app moves on to its shelves while the write is
      // still in flight — and if it fails, nothing catches it: the next launch
      // is back on this screen with no explanation, and the share extension
      // reads a key that was never written.
      await setToken(await get());
      // Confirm the extension can actually read what we just wrote. Finding
      // this out here is the difference between a one-line fix and a week of
      // "why does sharing do nothing".
      if (!(await verifySharedAccess())) {
        setError("Paired, but the share extension can't read the Keychain — check the app group entitlement.");
      }
      onPaired();
    } catch (e) {
      setError((e as Error).message);
      setUnclaimed(false);   // a failed claim usually means somebody got there first
    } finally {
      setBusy(false);
    }
  }

  return (
    // The field you type the code into is the whole screen. It shipped under
    // the keyboard once; that is the entire reason KeyboardSafe exists.
    // ONE flex container, not two. Nesting a flex:1 View inside KeyboardSafe's
    // own flex:1 broke the centring and dropped everything to the bottom of
    // the screen — the render harness caught it immediately.
    <KeyboardSafe style={[s.screen, s.pairWrap] as never}>
        {/* NOT s.wordmark: that carries flex:1 so it pushes the count to the
            right of the header ROW. In a column it ate 701 of 812 points and
            pinned everything else to the bottom of the screen. A style is only
            reusable in the axis it was written for. */}
        <Text style={s.pairMark}>shelf</Text>

        {unclaimed === undefined ? (
          <>
            <ActivityIndicator color={c.inkFaint} style={s.pairSpin} />
            {/* Only once we KNOW it is asleep. Saying "waking the server" the
                instant the screen appears would be a guess presented as a
                fact, and on a warm server it would flash for 200ms. */}
            {waking ? (
              <Text style={s.pairHint}>
                Waking the server. It sleeps when nobody has used it for a while —
                this takes up to a minute.
              </Text>
            ) : null}
          </>
        ) : unclaimed ? (
          <>
            {/* Nobody has ever paired with this server, so there is nobody to
                protect it from yet. One tap, no code, and the window shuts
                permanently the moment it is used. */}
            <Text style={s.pairHint}>
              This shelf is new and nobody has claimed it. Take it — after this, any
              other device needs a code from you.
            </Text>
            <Press onPress={() => finish(() => claim("iPhone"))} disabled={busy} style={s.pairBtn} size={TOUCH_MIN} label="Claim this shelf">
              {busy ? <ActivityIndicator color={c.bg} /> : <Text style={s.pairBtnLabel}>This is my shelf →</Text>}
            </Press>
          </>
        ) : (
          <>
            <Text style={s.pairHint}>Type the pairing code for this shelf.</Text>
            <TextInput
              value={code}
              onChangeText={setCode}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="PAIRING CODE"
              placeholderTextColor={c.inkFaint}
              style={s.input}
              onSubmitEditing={() => finish(() => pair(code.trim().toUpperCase(), "iPhone"))}
            />
            <Press
              onPress={() => finish(() => pair(code.trim().toUpperCase(), "iPhone"))}
              disabled={busy || code.length < 4}
              style={s.pairBtn} size={TOUCH_MIN} label="Pair this phone"
            >
              {busy ? <ActivityIndicator color={c.bg} /> : <Text style={s.pairBtnLabel}>Pair this phone →</Text>}
            </Press>
          </>
        )}

        {error ? <Text style={s.errorNote}>{error}</Text> : null}
    </KeyboardSafe>
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
    // flex-start, not center: a row carrying a two-line reason must not push
    // the swatch and the button to the vertical middle of a tall block.
    flexDirection: "row", alignItems: "flex-start", gap: sp.sm,
    borderWidth: 2, borderColor: c.ink, paddingHorizontal: sp.md,
    minHeight: TOUCH_MIN, marginBottom: sp.sm,
  },
  pileSwatchBox: { minHeight: TOUCH_MIN, justifyContent: "center" },
  pileSwatch: { width: 9, height: 9, borderWidth: 2 },
  pileMain: { flex: 1, minHeight: TOUCH_MIN, justifyContent: "center", paddingVertical: sp.sm },
  pileTitle: { ...t.bodyMed, color: c.ink },
  pileWhy: { ...t.meta, color: c.inkSoft, marginTop: sp.xs },
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
  detailNoteTap: { minHeight: TOUCH_MIN, justifyContent: "center" },
  detailNoteInput: {
    ...t.body, minHeight: TOUCH_MIN + 32, marginTop: sp.md, padding: sp.md,
    borderWidth: 2, textAlignVertical: "top",
  },
  detailMoveLabel: { marginTop: sp.xl },
  detailMove: { flexDirection: "row", gap: 2, marginTop: sp.sm },
  detailMoveSlot: { flex: 1 },
  detailMoveTab: { minHeight: TOUCH_MIN, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "transparent" },
  detailMoveNum: { ...t.micro },
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
  pairMark: { ...t.wordmark, color: c.ink },
  pairHint: { ...t.meta, color: c.inkSoft },
  // The column is stretched, so a spinner centres itself in it while the
  // wordmark and the sentence sit on the left margin. Pinned to the same edge.
  pairSpin: { alignSelf: "flex-start" },
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
