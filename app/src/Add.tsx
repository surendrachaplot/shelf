// Add.tsx — the other way things get on a shelf.
//
// Sharing a reel is how shelf gets used at 1am. This is how it gets used when
// somebody tells you about a restaurant over dinner, and it has to be just as
// short: type, tap, done. One field, all four shelves at once, the list colour
// doing the disambiguating that a row of filter chips would otherwise do.
//
// The screen's hardest job is telling the truth about what it CANNOT search.
// With no TMDB key there are no films — and "no films matched" and "films are
// switched off" must not render the same way (§8). So the server names the
// providers it could not reach and this screen says so in a sentence.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { addItem, search, type Item, type ListName, type SearchHit } from "./api";
import { Press } from "./Press";
import { Reveal } from "./Reveal";
import { KeyboardSafe, scrollKeyboardProps } from "./KeyboardSafe";
import { lists, listOn, RULE, sp, t, TOUCH_MIN, useTheme, type Palette } from "./theme";

// Long enough that a normal typing burst is one request, short enough that it
// never feels like the field is thinking about it. Every keystroke past this
// is a paid question against Places, which is the whole argument for a debounce
// rather than a search-on-every-change.
const DEBOUNCE_MS = 320;

export function Add({ onClose, onAdded }: { onClose: () => void; onAdded: (item: Item) => void }) {
  const { c } = useTheme();
  const s = styles(c);

  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [unavailable, setUnavailable] = useState<{ list: ListName; provider: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<Record<string, "adding" | "done">>({});
  // "Nothing matched" may only be shown for a query that actually ran. Before
  // that it is "we have not looked", which is a different sentence.
  const [searched, setSearched] = useState<string | null>(null);
  const seq = useRef(0);

  const run = useCallback(async (term: string) => {
    const mine = ++seq.current;
    if (term.trim().length < 2) {
      setHits([]); setUnavailable([]); setSearched(null); setBusy(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await search(term);
      // An answer to a query the user has already typed past is worse than no
      // answer: it repopulates the list under their fingers.
      if (mine !== seq.current) return;
      setHits(r.results);
      setUnavailable(r.unavailable);
      setSearched(term);
    } catch (e) {
      if (mine !== seq.current) return;
      setError((e as Error).message);
      setHits([]);
    } finally {
      if (mine === seq.current) setBusy(false);
    }
  }, []);

  useEffect(() => {
    const id = setTimeout(() => run(q), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [q, run]);

  async function add(hit: SearchHit) {
    setAdded((prev) => ({ ...prev, [hit.key]: "adding" }));
    try {
      const r = await addItem(hit);
      setAdded((prev) => ({ ...prev, [hit.key]: "done" }));
      onAdded(r.item);
    } catch (e) {
      setAdded((prev) => { const next = { ...prev }; delete next[hit.key]; return next; });
      setError((e as Error).message);
    }
  }

  return (
    <KeyboardSafe style={s.screen}>
      <View style={[s.head, s.inset]}>
        <Text style={s.wordmark}>Add</Text>
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
          placeholder="A book, a place, a film — or paste a recipe link"
          placeholderTextColor={c.inkFaint}
          style={s.input}
          returnKeyType="search"
          onSubmitEditing={() => run(q)}
        />
        {busy ? <ActivityIndicator color={c.inkFaint} style={s.busy} /> : null}
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false} {...scrollKeyboardProps}>
        {error ? <Text style={[s.error, s.inset]}>{error}</Text> : null}

        {hits.map((hit, i) => (
          <Reveal key={hit.key} index={i}>
            <Row hit={hit} state={added[hit.key]} onAdd={() => add(hit)} s={s} c={c} />
          </Reveal>
        ))}

        {/* Named absence, not silence. This is the sentence that stops the
            screen looking broken to somebody who never set a key. */}
        {unavailable.length ? (
          <View style={[s.inset, s.notice]}>
            <Text style={s.noticeTitle}>Not everything is searchable yet</Text>
            <Text style={s.body}>
              {unavailable.map((u) => `${lists[u.list].label} (${u.provider})`).join(" and ")}
              {unavailable.length > 1 ? " are" : " is"} switched off until a key is set on the server.
              Everything else here still works.
            </Text>
          </View>
        ) : null}

        {!busy && searched && hits.length === 0 && !error ? (
          <View style={[s.inset, s.notice]}>
            <Text style={s.noticeTitle}>Nothing matched “{searched}”</Text>
            <Text style={s.body}>
              Try fewer words, or the name as it is actually written. For a recipe,
              paste the link to the page — shelf reads it off the page itself.
            </Text>
          </View>
        ) : null}

        {!searched && !busy ? (
          <View style={[s.inset, s.notice]}>
            <Text style={s.noticeTitle}>Look something up</Text>
            <Text style={s.body}>
              Books and films by name, restaurants by name and city. Recipes are a
              link — paste the page and shelf takes the title, the picture and the
              timing off it.
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </KeyboardSafe>
  );
}

function Row({ hit, state, onAdd, s, c }: {
  hit: SearchHit; state?: "adding" | "done"; onAdd: () => void;
  s: ReturnType<typeof styles>; c: Palette;
}) {
  const fill = (c as Record<string, string>)[hit.list] ?? c.unsorted;
  const on = (listOn as Record<string, string>)[hit.list] ?? c.onList;
  const done = state === "done";
  // §6 — a cover URL that 404s must land on the SAME designed block a result
  // with no cover gets. An empty onError satisfies a grep and leaves a hole.
  const [artFailed, setArtFailed] = useState(false);
  const art = hit.image_url && !artFailed ? hit.image_url : null;
  return (
    <View style={[s.row, s.insetMargin]}>
      {/* The list colour runs down the left edge as a rule, not a chip. A row
          of coloured pills would be four more rounded corners in a system whose
          radius is zero everywhere. */}
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
          {[hit.subtitle, lists[hit.list].label].filter(Boolean).join(" · ")}
        </Text>
      </View>
      <Press
        onPress={onAdd}
        disabled={!!state}
        style={[s.addBtn, done ? { backgroundColor: fill } : null]}
        size={TOUCH_MIN}
        label={done ? "Already on your shelf" : `Put on ${lists[hit.list].label}`}
      >
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
  addBtn: { minHeight: TOUCH_MIN, paddingHorizontal: sp.md, alignItems: "center", justifyContent: "center" },

  notice: { marginTop: sp.xl },
  noticeTitle: { ...t.section, color: c.ink },
  body: { ...t.meta, color: c.inkSoft, marginTop: sp.xs },
  error: { ...t.meta, color: c.accent, marginTop: sp.md },
});
