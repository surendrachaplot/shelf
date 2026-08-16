// Find.tsx — one box for everything you have kept, and everything you have not.
//
// ── THE PROBLEM SIX SHELVES CREATE ──────────────────────────────────────────
//
// Tabs are a filing system. They are not a way to find anything. Past a
// hundred items the app knows exactly where your Korean place is and the only
// way to ask it was to remember whether you filed that one under Restaurants
// or Places and then scroll. The information was there; the question could not
// be asked.
//
// So: type, and every shelf answers at once. Books, restaurants, movies,
// recipes, quotes and places in one ranked list, with the shelf colour doing
// the sorting your eye does for free.
//
// ── TWO SEARCHES, ONE FIELD, IN THE RIGHT ORDER ─────────────────────────────
//
// YOURS comes first and it is instant. It runs on the phone against the file
// in memory — no network, no debounce, no spinner, results under the cursor as
// you type. `find.js` does the ranking and is asserted line by line in
// find-selftest.mjs, because "the right book is fourth" is invisible to every
// other check this project has.
//
// THE WORLD comes second and it is debounced. The same catalogue search the
// Add screen uses, folded in underneath, with anything already on a shelf
// removed — so the one box answers both "where did I put it" and "I have not
// saved this yet" without making you decide which question you are asking
// before you have typed anything.
//
// ── WHY A ROW EXPLAINS ITSELF ───────────────────────────────────────────────
//
// Searching notes and cities and authors means rows appear whose TITLE does
// not contain what you typed. "Ganapati" for the query "peckham" reads as a
// bug unless the row says where the match came from. §8: an answer you cannot
// account for is worse than no answer, so a non-title match carries the field
// and the words that matched.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { search, type ListName, type SearchHit } from "./api";
import { idFor, type Item } from "./store";
import { searchShelf, alreadyShelved, type FindHit } from "./find.js";
import { Press } from "./Press";
import { Reveal } from "./Reveal";
import { KeyboardSafe, scrollKeyboardProps } from "./KeyboardSafe";
import { labelOf, lists, listOn, numberOf, RULE, sp, t, TOUCH_MIN, useTheme, type Palette } from "./theme";

// Same debounce as Add, and for the same reason: every keystroke past it is a
// question somebody's quota pays for. The LOCAL half of this screen has no
// debounce at all — it costs nothing and a lag between typing and your own
// shelf answering is the thing that makes a search box feel broken.
const DEBOUNCE_MS = 320;

const FIELD_LABEL: Record<string, string> = {
  note: "your note",
  caption: "the caption",
  subtitle: "the details",
  facts: "the details",
  list: "the shelf",
};

export function Find({ items, onClose, onOpen, onAdded, city }: {
  items: Item[];
  onClose: () => void;
  onOpen: (item: Item) => void;
  onAdded: (item: Item) => void | Promise<void>;
  city?: string;
}) {
  const { c } = useTheme();
  const s = useMemo(() => styles(c), [c]);

  const [q, setQ] = useState("");
  const [only, setOnly] = useState<ListName | null>(null);
  const [world, setWorld] = useState<SearchHit[]>([]);
  const [looking, setLooking] = useState(false);
  const [worldError, setWorldError] = useState<string | null>(null);
  const [added, setAdded] = useState<Record<string, "adding" | "done">>({});
  const seq = useRef(0);

  // YOURS: recomputed on every keystroke, deliberately. 800 items takes single
  // -digit milliseconds — the selftest asserts it, so this can stay simple.
  const mine = useMemo(() => searchShelf(items, q, { list: only }), [items, q, only]);

  // THE WORLD: debounced, and only for a query worth asking about.
  const askCatalogues = useCallback(async (term: string) => {
    const mineNow = ++seq.current;
    if (term.trim().length < 2) { setWorld([]); setLooking(false); setWorldError(null); return; }
    setLooking(true);
    setWorldError(null);
    try {
      const r = await search(term, null, city);
      if (mineNow !== seq.current) return;   // an answer to a query already typed past
      setWorld(r.results);
    } catch (e) {
      if (mineNow !== seq.current) return;
      setWorld([]);
      setWorldError((e as Error).message);
    } finally {
      if (mineNow === seq.current) setLooking(false);
    }
  }, [city]);

  useEffect(() => {
    const id = setTimeout(() => askCatalogues(q), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [q, askCatalogues]);

  // Anything already on a shelf is not news. Offering somebody a book they
  // shelved last week, under a heading that says they have not got it, is the
  // screen telling them something untrue about their own shelf.
  const fresh = useMemo(
    () => world.filter((h) => !alreadyShelved(items, h)).filter((h) => !only || h.list === only),
    [world, items, only]
  );

  const chips = useMemo(
    () => Object.entries(mine.counts).sort((a, b) => b[1] - a[1]) as [ListName, number][],
    [mine.counts]
  );

  async function shelve(hit: SearchHit) {
    setAdded((prev) => ({ ...prev, [hit.key]: "adding" }));
    try {
      await onAdded({
        id: idFor(`catalogue:${hit.key}`),
        list: hit.list,
        status: "filed",
        title: hit.title,
        subtitle: hit.subtitle ?? "",
        note: "",
        image_url: hit.image_url ?? null,
        canonical: hit.canonical ?? {},
        confidence: 1,
        enriched: true,
        source_url: null,
        resolver: "search",
        created_at: new Date().toISOString(),
        resolved_at: new Date().toISOString(),
      });
      setAdded((prev) => ({ ...prev, [hit.key]: "done" }));
    } catch {
      setAdded((prev) => { const next = { ...prev }; delete next[hit.key]; return next; });
    }
  }

  const typed = q.trim().length > 0;

  return (
    <KeyboardSafe style={s.screen}>
      <View style={[s.head, s.inset]}>
        <Text style={s.wordmark}>Find</Text>
        <Press onPress={onClose} style={s.close} size={TOUCH_MIN} label="Close">
          <Text style={s.micro}>Close</Text>
        </Press>
      </View>

      <View style={s.rule} />

      <View style={[s.searchRow, s.inset]}>
        <TextInput
          value={q}
          onChangeText={setQ}
          autoFocus
          autoCorrect={false}
          autoCapitalize="none"
          placeholder="A title, a name, a city — or a word from your note"
          placeholderTextColor={c.inkFaint}
          style={s.input}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        {looking ? <ActivityIndicator color={c.inkFaint} style={s.busy} /> : null}
      </View>

      {/* The shelves that actually have something in them, with how much.
          A chip for an empty shelf is a button that promises nothing —
          and the counts come from BEFORE the filter, so picking one never
          changes what the others say. */}
      {chips.length > 1 ? (
        <View style={[s.chips, s.inset]}>
          <Press onPress={() => setOnly(null)} size={TOUCH_MIN} label="Everything"
                 style={[s.chip, only === null ? { backgroundColor: c.ink } : null]}>
            <Text style={[s.chipLabel, only === null ? { color: c.bg } : null]}>
              All {mine.total}
            </Text>
          </Press>
          {chips.map(([list, n]) => (
            <Press key={list} onPress={() => setOnly(only === list ? null : list)} size={TOUCH_MIN}
                   label={`${labelOf(list)}, ${n}`}
                   style={[s.chip, only === list ? { backgroundColor: c[list] ?? c.unsorted } : null]}>
              <Text style={[s.chipLabel, only === list ? { color: listOn[list] ?? c.onList } : null]}>
                {labelOf(list)} {n}
              </Text>
            </Press>
          ))}
        </View>
      ) : null}

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}
                  keyboardDismissMode="on-drag" {...scrollKeyboardProps}>
        {typed && mine.hits.length ? (
          <>
            <Text style={[s.section, s.inset]}>On your shelves</Text>
            {mine.hits.map((h, i) => (
              <Reveal key={h.item.id} index={i}>
                <MineRow hit={h} onOpen={() => onOpen(h.item)} s={s} c={c} />
              </Reveal>
            ))}
          </>
        ) : null}

        {typed && mine.hits.length === 0 ? (
          <View style={[s.inset, s.notice]}>
            <Text style={s.noticeTitle}>Nothing of yours matches “{q.trim()}”</Text>
            <Text style={s.body}>
              This looks at every shelf at once — titles, authors, cities, and the notes you
              wrote. {looking ? "Still asking the catalogues…" : "Anything found below is not on a shelf yet."}
            </Text>
          </View>
        ) : null}

        {/* THE WORLD. Second, always, and never mixed into the list above:
            a thing you own and a thing you could own are different answers
            and must not sit in one column pretending to be the same. */}
        {fresh.length ? (
          <>
            <Text style={[s.section, s.inset, s.sectionGap]}>Not on a shelf yet</Text>
            {fresh.map((hit, i) => (
              <Reveal key={hit.key} index={i}>
                <WorldRow hit={hit} state={added[hit.key]} onShelve={() => shelve(hit)} s={s} c={c} />
              </Reveal>
            ))}
          </>
        ) : null}

        {worldError && typed ? (
          <View style={[s.inset, s.notice]}>
            <Text style={s.noticeTitle}>Your shelves are here; the catalogues are not</Text>
            <Text style={s.body}>
              Everything above came off this phone and is complete. The lookup for things you
              have not saved could not reach the server ({worldError}).
            </Text>
          </View>
        ) : null}

        {!typed ? (
          <View style={[s.inset, s.notice]}>
            <Text style={s.noticeTitle}>Look through everything at once</Text>
            <Text style={s.body}>
              {items.length
                ? `${items.length} ${items.length === 1 ? "thing" : "things"} across your shelves. Search a title, an author, a neighbourhood, a cuisine, a year — or a word from a note you wrote. Type a shelf's name to see all of it.`
                : "Your shelves are empty for now. Share a reel from Instagram, or type a name here and shelve it straight from the catalogue."}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </KeyboardSafe>
  );
}

/** One thing you already have. Tapping it opens it — this is a way in, not a
 *  read-only report. */
function MineRow({ hit, onOpen, s, c }: {
  hit: FindHit; onOpen: () => void; s: ReturnType<typeof styles>; c: Palette;
}) {
  const item = hit.item;
  const fill = (c as Record<string, string>)[item.list] ?? c.unsorted;
  const on = (listOn as Record<string, string>)[item.list] ?? c.onList;
  // §6 — a cover that 404s lands on the same designed block a cover-less item
  // gets. An empty onError satisfies a grep and leaves a hole.
  const [artFailed, setArtFailed] = useState(false);
  const art = item.image_url && !artFailed ? item.image_url : null;
  return (
    <Press onPress={onOpen} style={[s.row, s.insetMargin]} size={TOUCH_MIN}
           label={`Open ${item.title ?? "this"} on ${labelOf(item.list)}`}>
      <View style={[s.rowEdge, { backgroundColor: fill }]} />
      {art ? (
        <Image source={{ uri: art }} style={s.thumb} resizeMode="cover" onError={() => setArtFailed(true)} />
      ) : (
        <View style={[s.thumb, { backgroundColor: fill }]}>
          <Text style={[s.thumbLetter, { color: on }]}>{numberOf(item.list)}</Text>
        </View>
      )}
      <View style={s.rowMain}>
        <Text style={s.rowTitle} numberOfLines={2}>{item.title ?? "Not read yet"}</Text>
        <Text style={s.rowSub} numberOfLines={1}>
          {[item.subtitle, labelOf(item.list)].filter(Boolean).join(" · ")}
        </Text>
        {/* WHY THIS ROW IS HERE. Only when the title does not say it — a row
            whose title holds the word you typed needs no caption. */}
        {hit.why && hit.snippet ? (
          <Text style={s.rowWhy} numberOfLines={2}>
            {FIELD_LABEL[hit.why] ?? hit.why}: {hit.snippet}
          </Text>
        ) : null}
      </View>
    </Press>
  );
}

/** One thing you do not have yet. */
function WorldRow({ hit, state, onShelve, s, c }: {
  hit: SearchHit; state?: "adding" | "done"; onShelve: () => void;
  s: ReturnType<typeof styles>; c: Palette;
}) {
  const fill = (c as Record<string, string>)[hit.list] ?? c.unsorted;
  const on = (listOn as Record<string, string>)[hit.list] ?? c.onList;
  const done = state === "done";
  const [artFailed, setArtFailed] = useState(false);
  const art = hit.image_url && !artFailed ? hit.image_url : null;
  return (
    <View style={[s.row, s.insetMargin]}>
      <View style={[s.rowEdge, { backgroundColor: fill }]} />
      {art ? (
        <Image source={{ uri: art }} style={s.thumb} resizeMode="cover" onError={() => setArtFailed(true)} />
      ) : (
        <View style={[s.thumb, { backgroundColor: fill }]}>
          <Text style={[s.thumbLetter, { color: on }]}>{lists[hit.list].n}</Text>
        </View>
      )}
      <View style={s.rowMain}>
        <Text style={s.rowTitle} numberOfLines={2}>{hit.title}</Text>
        <Text style={s.rowSub} numberOfLines={1}>
          {[hit.subtitle, labelOf(hit.list)].filter(Boolean).join(" · ")}
        </Text>
      </View>
      <Press onPress={onShelve} disabled={!!state} size={TOUCH_MIN}
             style={[s.addBtn, done ? { backgroundColor: fill } : null]}
             label={done ? "On your shelf" : `Put on ${labelOf(hit.list)}`}>
        {state === "adding"
          ? <ActivityIndicator color={c.ink} />
          : <Text style={[s.micro, done ? { color: on } : null]}>{done ? "Shelved" : "Shelve"}</Text>}
      </Press>
    </View>
  );
}

const styles = (c: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  scroll: { paddingTop: sp.md, paddingBottom: sp.huge },
  inset: { paddingHorizontal: sp.lg },
  insetMargin: { marginHorizontal: sp.lg },

  head: { flexDirection: "row", alignItems: "baseline", paddingTop: sp.xl, paddingBottom: sp.md },
  wordmark: { ...t.wordmark, color: c.ink, flex: 1 },
  close: { minHeight: TOUCH_MIN, justifyContent: "center" },
  micro: { ...t.micro, color: c.ink },
  rule: { height: RULE, backgroundColor: c.ink },

  searchRow: { flexDirection: "row", alignItems: "center", gap: sp.sm, paddingTop: sp.md },
  input: {
    ...t.bodyMed, color: c.ink, flex: 1, minHeight: TOUCH_MIN + 8, paddingHorizontal: sp.md,
    borderWidth: 2, borderColor: c.ink, backgroundColor: c.bg,
  },
  busy: { width: 24 },

  // Seven chips will not fit a phone's width on one line, so they wrap. §4.
  chips: { flexDirection: "row", flexWrap: "wrap", gap: sp.xs, paddingTop: sp.md },
  chip: {
    minHeight: TOUCH_MIN, paddingHorizontal: sp.md, alignItems: "center", justifyContent: "center",
    borderWidth: RULE, borderColor: c.ink,
  },
  chipLabel: { ...t.micro, color: c.ink },

  section: { ...t.section, color: c.inkSoft, marginTop: sp.md, marginBottom: sp.xs },
  sectionGap: { marginTop: sp.xl },

  row: {
    flexDirection: "row", alignItems: "stretch", borderWidth: 2, borderColor: c.ink,
    marginTop: sp.sm, minHeight: TOUCH_MIN + 20,
  },
  rowEdge: { width: 6 },
  thumb: { width: 44, alignItems: "center", justifyContent: "center" },
  thumbLetter: { ...t.tag },
  rowMain: { flex: 1, minWidth: 0, paddingHorizontal: sp.md, paddingVertical: sp.sm, justifyContent: "center" },
  rowTitle: { ...t.bodyMed, color: c.ink },
  rowSub: { ...t.meta, color: c.inkFaint, marginTop: 2 },
  rowWhy: { ...t.meta, color: c.inkSoft, marginTop: sp.xs },
  addBtn: { minHeight: TOUCH_MIN, paddingHorizontal: sp.md, alignItems: "center", justifyContent: "center" },

  notice: { marginTop: sp.xl },
  noticeTitle: { ...t.section, color: c.ink },
  body: { ...t.meta, color: c.inkSoft, marginTop: sp.xs },
});
