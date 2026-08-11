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
  legacyExport, resolveLink, takeQueue, type ListName, LISTS,
} from "./src/api";
import {
  load as loadShelf, save as saveShelf, upsert, patch, remove as removeItem,
  shelfOf, pileOf, idFor, emptyShelf, type Item, type Shelf,
} from "./src/store";
import { Add } from "./src/Add";
import { ExLibris } from "./src/ExLibris";
import { Profile } from "./src/Profile";
import { ShareSheet } from "./src/ShareSheet";
import { Press } from "./src/Press";
import { Reveal } from "./src/Reveal";
import { scrollKeyboardProps } from "./src/KeyboardSafe";
import { Screen } from "./src/Screen";
import {
  BOARD, COVER_KEYLINE, coverFor, placeholderOn, jacketType, quoteType, excerpt, lists, listOn, mainTitle, gridFor, rowsOf, emptyBoards, emptyPitch, EMPTY_BOARD_H, rowPitch,
  RULE, sp, t, TOUCH_MIN, useTheme, type Palette,
} from "./src/theme";
import * as D from "./src/design.js";
import { factsFor } from "./src/facts.js";

// The pile is a tab like any other, not a section bolted above the shelves.
// It is where a thing lives before it stands anywhere, which is a place — and
// giving it the same affordance as the four lists is what lets one screen hold
// the whole app.
type TabName = ListName | "unsorted";
const TABS: TabName[] = [...LISTS, "unsorted"];

// One screen at a time, held in one variable. A router for four destinations
// would be a dependency that hides where you are; this is four words.
// Named Route, not Screen: `Screen` is the safe-area root component now, and
// a type and a value cannot share a name.
type Route = "case" | "add" | "profile";

/**
 * Which items keep the caption they came from.
 *
 * Most do not: a film has a synopsis and a poster, and hoarding the reel's
 * hashtag wall alongside it is clutter you never read. TRAVEL is different —
 * one reel becomes ten places, and the caption is the only record of WHY those
 * ten were together and what was said about each. Losing it turns a trip into
 * a list of pins. Quotes keep theirs for the same reason: the surrounding text
 * is often where the attribution lives.
 */
const KEEPS_CAPTION = new Set(["travel", "quotes"]);
const keepCaption = (it: { list?: string; caption?: string }) =>
  KEEPS_CAPTION.has(it.list ?? "") ? (it.caption || "").slice(0, 4000) : undefined;
type Sharing = { kind: "item" | "shelf" | "profile"; item?: Item; list?: string; title: string };

export default function App() {
  const { c, dark } = useTheme();
  const s = useMemo(() => styles(c), [c]);

  // ONE PIECE OF STATE HOLDS EVERYTHING YOU HAVE SAVED, and it is a file on
  // this phone. There is no `paired`, no token, no server list to be out of
  // sync with — which removes an entire class of bug along with the login.
  const [shelf, setShelf] = useState<Shelf | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [open, setOpen] = useState<Item | null>(null);
  const [tab, setTab] = useState<TabName>("books");
  const [viewportH, setViewportH] = useState(0);
  const [screen, setScreen] = useState<Route>("case");
  const [sharing, setSharing] = useState<Sharing | null>(null);

  const ready = shelf !== null;
  const shelves = useMemo(
    () => Object.fromEntries(LISTS.map((l) => [l, shelf ? shelfOf(shelf, l) : []])),
    [shelf]
  );
  const inbox = useMemo(() => (shelf ? pileOf(shelf) : []), [shelf]);
  const seed = shelf?.profile.seed || shelf?.profile.name || "shelf";

  /**
   * Every mutation goes through here: change it in memory, write the file.
   *
   * Saving on every change rather than on a timer or at background time is
   * deliberate — iOS can kill a backgrounded app without warning, and a note
   * you typed being gone because the write was still pending is not a trade
   * worth making for a few milliseconds.
   */
  const commit = useCallback(async (next: Shelf) => {
    setShelf(next);
    await saveShelf(next).catch(() => {/* the in-memory copy is still right */});
    return next;
  }, []);

  /**
   * Drain what the share extension left and resolve each one.
   *
   * The row appears IMMEDIATELY as "Working it out…" and is saved before any
   * network happens — so a share is on your shelf the moment the app opens,
   * even if the resolve then fails, and even if you kill the app mid-way.
   * Resolving is the slow, optional half.
   */
  const drainShares = useCallback(async (base: Shelf) => {
    const queued = await takeQueue().catch(() => []);
    if (!queued.length) return base;

    let cur = base;
    const fresh: Item[] = queued.map((q) => ({
      id: idFor(q.url),
      list: q.list,
      status: "pending" as const,
      title: null, subtitle: "", note: "", image_url: null, canonical: {},
      confidence: null, enriched: false, source_url: q.url, resolver: null,
      created_at: new Date(q.at || Date.now()).toISOString(),
    }));
    for (const it of fresh) cur = upsert(cur, it);
    await commit(cur);

    for (const it of fresh) {
      try {
        const got = await resolveLink(it.source_url!, it.list as ListName, cur.profile.home_city);
        const first = got.items[0];
        cur = first
          ? patch(cur, it.id, {
              ...first,
              status: "filed",
              caption: keepCaption(first),
              resolved_at: new Date().toISOString(),
              error: null,
            })
          // Read, and there was nothing nameable in it. It stays in the pile
          // with its link, which is still a thing you saved.
          : patch(cur, it.id, { status: "unread", resolver: got.resolver, resolved_at: new Date().toISOString() });

        // A reel can hold several things — "5 books I read this month". The
        // extras become siblings rather than being thrown away.
        for (const extra of got.items.slice(1)) {
          cur = upsert(cur, {
            ...extra,
            id: idFor(`${it.source_url}#${extra.title}`),
            status: "filed",
            caption: keepCaption(extra),
            created_at: it.created_at,
            resolved_at: new Date().toISOString(),
          } as Item);
        }
      } catch (e) {
        cur = patch(cur, it.id, { status: "unread", error: (e as Error).message });
      }
      await commit(cur);
    }
    return cur;
  }, [commit]);

  // FIRST LAUNCH. Read the file, then take anything the extension left.
  useEffect(() => {
    (async () => {
      const loaded = await loadShelf();
      setShelf(loaded);
      await drainShares(loaded);
    })();
    // drainShares is stable; re-running this on every render would re-drain.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // COMING BACK FROM INSTAGRAM. iOS does not remount a backgrounded app, so
  // without this the shelf shows whatever it showed at the last cold start no
  // matter how many reels went in. This shipped once and was reported, exactly
  // right, as "nothing is coming to the shelf when I share".
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next !== "active" || !shelf) return;
      setBusy(true);
      drainShares(shelf).finally(() => setBusy(false));
    });
    return () => sub.remove();
  }, [shelf, drainShares]);

  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(null), 3500);
    return () => clearTimeout(id);
  }, [flash]);

  // ONE-TIME: pull anything the old server-side store still holds onto this
  // phone. Runs once, on an empty shelf, and never again — a shelf you have
  // curated must never be overwritten by a five-month-old export.
  useEffect(() => {
    if (!shelf || shelf.items.length) return;
    let live = true;
    (async () => {
      const got = await legacyExport().catch(() => null);
      if (!live || !got?.count) return;
      let cur = shelf;
      for (const row of got.items as Record<string, any>[]) {
        if (row.status === "discarded") continue;
        cur = upsert(cur, {
          id: String(row.id),
          list: row.list, status: row.title ? "filed" : "unread",
          title: row.title ?? null, subtitle: row.subtitle ?? "", note: row.note ?? "",
          image_url: row.image_url ?? null, canonical: row.canonical ?? {},
          confidence: row.confidence ?? null, enriched: !!row.enriched,
          source_url: row.source_url ?? null, resolver: row.resolver ?? null,
          created_at: row.created_at ?? new Date().toISOString(),
          resolved_at: row.resolved_at ?? null,
        });
      }
      await commit(cur);
      setFlash(`Moved ${got.count} item${got.count > 1 ? "s" : ""} onto this phone`);
    })();
    return () => { live = false; };
  }, [shelf, commit]);

  async function retry(item: Item) {
    if (!shelf || !item.source_url) return;
    let cur = await commit(patch(shelf, item.id, { status: "pending", error: null }));
    try {
      const got = await resolveLink(item.source_url, item.list as ListName, cur.profile.home_city);
      const first = got.items[0];
      cur = first
        ? patch(cur, item.id, { ...first, status: "filed", caption: undefined, error: null,
                                resolved_at: new Date().toISOString() })
        : patch(cur, item.id, { status: "unread", resolver: got.resolver });
    } catch (e) {
      cur = patch(cur, item.id, { status: "unread", error: (e as Error).message });
    }
    await commit(cur);
  }

  /** Move it, rename it, note it, bin it. All local, all instant. */
  async function act(item: Item, body: Record<string, unknown>) {
    if (!shelf) return;
    setOpen(null);
    if (body.action === "discard") return void commit(removeItem(shelf, item.id));
    const fields: Partial<Item> = {};
    if (body.action === "file") fields.status = "filed";
    if (typeof body.list === "string") { fields.list = body.list; fields.status = "filed"; }
    if (typeof body.note === "string") fields.note = body.note;
    if (typeof body.title === "string") fields.title = body.title;
    await commit(patch(shelf, item.id, fields));
  }

  // The only gate left is reading one file off the disk, which takes
  // milliseconds. No pairing screen, no code, no account: install it and it is
  // yours. That is the whole point of the shelves living here.
  if (!ready) return <Screen style={s.boot}><ActivityIndicator color={c.ink} /></Screen>;

  const total = Object.values(shelves).reduce((n, xs) => n + (xs?.length ?? 0), 0);
  const showing = tab === "unsorted" ? inbox : (shelves[tab] ?? []);
  const fill = c[tab] ?? c.unsorted;
  const on = listOn[tab] ?? c.onList;

  return (
    // The case is inset; the overlays below are NOT children of it. An
    // absolutely-positioned overlay measures from the top of the display, so
    // if it sat inside this it would be inset once here and again by its own
    // root — the notch paid for twice.
    <View style={s.screen}>
      <Screen>
      <View style={[s.head, s.inset]}>
        <Text style={s.wordmark}>shelf</Text>
        <View style={s.headTools}>
          <Press onPress={() => setScreen("add")} style={s.tool} size={TOUCH_MIN} label="Add something by name">
            <Text style={s.toolLabel}>Add</Text>
          </Press>
          {/* "Sent you" is gone with the accounts that made it possible.
              Receiving something from a person needed a users table to address
              it to, and there is no users table — a shared link is now the
              whole of how a thing travels between people. */}
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
            onPress={() => setSharing({ kind: "shelf", list: tab, title: `Your ${lists[tab].label.toLowerCase()} shelf` })}
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
        // Your shelves are on this phone, so there is nothing to re-fetch —
        // but pulling down still does the one useful thing left: takes
        // anything the share extension has written since you last looked.
        refreshControl={
          <RefreshControl
            refreshing={busy}
            onRefresh={() => {
              if (!shelf) return;
              setBusy(true);
              drainShares(shelf).finally(() => setBusy(false));
            }}
            tintColor={c.inkFaint}
          />
        }
      >
        {flash ? <Text style={[s.flash, s.inset]}>{flash}</Text> : null}

        {/* There is no "couldn't reach your shelves" any more. They are on
            this phone; the only thing that can fail is resolving a new share,
            and that failure belongs on the row it happened to. */}
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
      </Screen>

      {open ? (
        <Detail
          item={open}
          onClose={() => setOpen(null)}
          onAct={act}
          onShare={() => setSharing({
            kind: "item", list: open.list, item: open,
            title: open.title ?? "This one",
          })}
          dark={dark}
          s={s} c={c}
        />
      ) : null}

      {screen === "add" && shelf ? (
        <View style={s.over}>
          <Add
            onClose={() => setScreen("case")}
            city={shelf.profile.home_city}
            onAdded={async (it) => {
              await commit(upsert(shelf, it));
              setTab(it.list as TabName);
            }}
          />
        </View>
      ) : null}
      {screen === "profile" && shelf ? (
        <View style={s.over}>
          <Profile
            shelf={shelf}
            onClose={() => setScreen("case")}
            onChange={commit}
            onShare={() => setSharing({ kind: "profile", title: "Your whole card" })}
          />
        </View>
      ) : null}

      {sharing && shelf ? (
        <View style={s.over}>
          <ShareSheet
            {...sharing}
            shelf={shelf}
            onClose={() => setSharing(null)}
            onLinked={(link) => commit({ ...shelf, links: [link, ...shelf.links] })}
          />
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
  // A QUOTE'S JACKET IS THE QUOTE. Not a label for it, not who said it — the
  // words, as large as they will go, because a shelf of quotes you cannot read
  // is the spine-out shelf all over again. Solved by area rather than by the
  // longest word, and cut on a word boundary when even the floor will not hold
  // it, with the whole thing in the panel behind.
  const isQuote = list === "quotes";
  const raw = item.title ?? "";
  // THE BOX IS NOT THE JACKET. A cover carries a 22pt series strip at the top
  // (except composition 0) and a ~24pt foot holding the attribution (except
  // composition 1), plus its own padding. Solving the type against the full
  // height overran both: at 320 the quote was clipped mid-word and the
  // attribution sat on top of the last line. Measure what is actually left.
  const strip = dims.comp !== 0 ? 22 : 0;
  const foot = dims.comp !== 1 && item.subtitle ? 28 : 0;
  const q = isQuote ? quoteType(raw, width, dims.height - strip - foot - sp.md) : null;
  const title = isQuote
    ? (q!.fits ? raw.trim() : excerpt(raw, q!.chars ?? 80))
    : (mainTitle(raw) || "Untitled");
  // Sized from the longest word so nothing is ever split mid-syllable.
  const jacket = isQuote ? { fontSize: q!.fontSize, lineHeight: q!.lineHeight } : jacketType(title, width);

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
            <Text
              style={[s.coverTitle, isQuote ? s.coverQuote : null, jacket, { color: mark }]}
              // A quote is already cut to what fits; letting numberOfLines cut
              // it again would truncate the truncation.
              numberOfLines={isQuote ? (q!.lines ?? 12) : 5}
            >
              {title}
            </Text>

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
export function whyUnread(item: Pick<Item, "title" | "resolver" | "error">): string | null {
  if (item.title) return null;
  if (item.error) return `It went wrong while reading: ${item.error}`;
  if (item.resolver === "none" || !item.resolver) {
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
  const fill = pending ? "transparent" : ((c as Record<string, string>)[item.list] ?? c.unsorted);
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
      await onAct(item, { note });
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
    <Screen style={[s.detail, { backgroundColor: fill }] as never}>
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

        {/* What the catalogue knows. ABOVE your note and below the artwork:
            the facts are why you can decide something about this thing, and
            the note is why you kept it — they are different registers and the
            order says which is yours. */}
        <Facts item={item} on={on} fill={fill} s={s} />

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
    </Screen>
  );
}

/**
 * The catalogue's half of an entry: a lede, a short table, and the links that
 * do something — a trailer, a map, the recipe itself.
 *
 * Renders NOTHING when there is nothing known. A "Runtime —" row reads as
 * broken data rather than absent data, and an empty rule above an empty table
 * is a design apologising for itself.
 */
function Facts({ item, on, fill, s }: {
  item: Item; on: string; fill: string; s: ReturnType<typeof styles>;
}) {
  const { lede, rows, links } = factsFor(item);
  if (!lede && !rows.length && !links.length) return null;

  return (
    <View style={s.facts}>
      <View style={[s.detailRule, { backgroundColor: on }]} />
      {lede ? <Text style={[s.factsLede, { color: on }]}>{lede}</Text> : null}

      {rows.map((r) => (
        // Label left, value right, both on one baseline. The label column is
        // fixed so the values line up down the panel — a table that does not
        // align is a list of sentences.
        <View key={r.label} style={s.factRow}>
          <Text style={[s.factLabel, { color: on }]}>{r.label}</Text>
          <Text style={[s.factValue, { color: on }]}>{r.value}</Text>
        </View>
      ))}

      {links.length ? (
        <View style={s.factLinks}>
          {links.map((l) => (
            <Press
              key={l.label}
              onPress={() => Linking.openURL(l.url)}
              style={[s.detailBtnGhost, { borderColor: on }]}
              size={TOUCH_MIN}
              label={l.label}
            >
              <Text style={[s.detailBtnLabel, { color: on }]}>{l.label} →</Text>
            </Press>
          ))}
        </View>
      ) : null}
    </View>
  );
}

// `Pairing` used to live here: a whole screen, a claim path, a code path, a
// "waking the server" state, and a keychain probe — all so that a public URL
// was not a public shelf. None of it is needed now that the shelf is not on a
// URL at all. Deleting it removed the first thing the app ever asked of a
// person, which was a code.

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
  // A quote is read, not glanced: regular weight and normal tracking, against
  // the display weight every other jacket uses. Setting somebody's sentence in
  // tight bold caps would make it a slogan.
  coverQuote: { fontWeight: "400", letterSpacing: 0 },
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
  // The catalogue block. `facts` owns its top margin so the rule sits clear of
  // the artwork above it rather than touching it.
  facts: { marginTop: sp.xl },
  factsLede: { ...t.body, marginTop: sp.lg, opacity: 1 },
  factRow: { flexDirection: "row", alignItems: "baseline", gap: sp.md, marginTop: sp.md },
  // Fixed label column so every value starts on the same x. A ragged left edge
  // on the values turns a table back into prose.
  factLabel: { ...t.micro, width: 104 },
  factValue: { ...t.bodyMed, flex: 1 },
  factLinks: { flexDirection: "row", flexWrap: "wrap", gap: sp.sm, marginTop: sp.lg },

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
