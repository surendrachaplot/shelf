// TagIndex.tsx — every fact your shelves share, and the things that share it.
//
// These are not labels somebody typed and not a model's guess at a mood. Each
// one is a FACT already on a resolved item — the author, the neighbourhood,
// the cuisine, the director — which is why "Peckham" can hold a restaurant and
// a bookshop without anybody filing either. `tags.js` decides what a tag is;
// this only draws it.
//
// Paper: file "shelf" → "Tags" and "Tag open — one tag, with links".
//
// One component, two states, because the second is the first with a row
// picked: `open` is a tag key or null. A separate screen would be a second
// header that exists to hold a back button.
import React, { useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import type { Item } from "./store";
import { tagIndex, itemsWithTag, type TagKind, type TagRow } from "./tags.js";
import { Press } from "./Press";
import { Reveal } from "./Reveal";
import { Screen } from "./Screen";
import { labelOf, listOn, numberOf, numeric, RULE, sp, t, TOUCH_MIN, useTheme, type Palette } from "./theme";

// What a person would look under, in the order they would look. `year` is
// deliberately absent: forty single years is a wall of chips, and the decade
// says the same thing. A year still links two items on the item page.
const GROUPS: { label: string; kinds: TagKind[] }[] = [
  { label: "People", kinds: ["author", "director", "cast"] },
  { label: "Where", kinds: ["area", "city"] },
  { label: "Kind", kinds: ["cuisine", "genre", "site"] },
  { label: "When", kinds: ["decade"] },
];
const GROUP_OF = (kind: string) => GROUPS.find((g) => (g.kinds as string[]).includes(kind))?.label ?? "Tag";

const two = (n: number) => String(n).padStart(2, "0");
// OpenStreetMap writes cuisines in lower case ("thai"); a catalogue writes
// "Fantasy". Side by side that reads as a mistake, so an all-lower-case value
// gets its first letter raised. Display only — the tag key is untouched.
const shown = (v: string) => (v && v === v.toLowerCase() ? v[0].toUpperCase() + v.slice(1) : v);

export function Tags({ items, start = null, onClose, onOpen }: {
  items: Item[];
  /** Open straight on one tag — how an item page gets here. */
  start?: string | null;
  onClose: () => void;
  onOpen: (item: Item) => void;
}) {
  const { c } = useTheme();
  const s = useMemo(() => styles(c), [c]);
  const [open, setOpen] = useState<string | null>(start);

  const index = useMemo(() => tagIndex(items) as TagRow[], [items]);
  const tag = open ? index.find((r) => r.key === open) ?? null : null;
  const tagged = useMemo(() => (tag ? itemsWithTag(items, tag.key) : []), [items, tag]);
  const shelves = new Set(tagged.map((i) => i.list)).size;

  return (
    <Screen style={s.screen}>
      <View style={[s.head, s.inset]}>
        <View style={s.headText}>
          {tag ? <Text style={s.kind}>{GROUP_OF(tag.kind)}</Text> : null}
          <Text style={s.wordmark} numberOfLines={2}>{tag ? shown(tag.value) : "Tags"}</Text>
        </View>
        {tag ? (
          <Press onPress={() => setOpen(null)} style={s.close} size={TOUCH_MIN} label="All tags">
            <Text style={s.micro}>All tags</Text>
          </Press>
        ) : null}
        <Press onPress={onClose} style={s.close} size={TOUCH_MIN} label="Close">
          <Text style={s.micro}>Close</Text>
        </Press>
      </View>
      <View style={s.rule} />

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {tag ? (
          <View style={s.inset}>
            <Text style={s.count}>
              {two(tagged.length)} {tagged.length === 1 ? "thing" : "things"}
              {shelves > 1 ? ` · ${shelves} shelves` : ""}
            </Text>
            {tagged.map((item, i) => {
              const fill = (c as Record<string, string>)[item.list] ?? c.unsorted;
              const on = (listOn as Record<string, string>)[item.list] ?? c.onList;
              return (
                <Reveal key={item.id} index={i}>
                  <Press onPress={() => onOpen(item)} style={s.row} size={TOUCH_MIN + 20}
                         label={`${item.title ?? "Not read yet"}, ${labelOf(item.list)}`}>
                    <View style={[s.block, { backgroundColor: fill }]}>
                      <Text style={[s.blockNum, { color: on }]}>{numberOf(item.list)}</Text>
                    </View>
                    <View style={s.rowMain}>
                      <Text style={s.rowTitle} numberOfLines={2}>{item.title ?? "Not read yet"}</Text>
                      {item.subtitle ? <Text style={s.rowSub} numberOfLines={1}>{item.subtitle}</Text> : null}
                    </View>
                  </Press>
                </Reveal>
              );
            })}
          </View>
        ) : index.length === 0 ? (
          // §Empty states: a title, what happens next, and no dead end.
          <View style={s.inset}>
            <Text style={s.emptyTitle}>No tags yet</Text>
            <Text style={s.emptyBody}>
              Tags come from what shelf finds out about a thing: its author, its city, its kind.
              Shelve a few things and they show here by themselves.
            </Text>
          </View>
        ) : (
          GROUPS.map((g) => {
            const rows = index.filter((r) => (g.kinds as string[]).includes(r.kind));
            if (!rows.length) return null;   // never an empty heading
            return (
              <View key={g.label} style={[s.inset, s.group]}>
                <Text style={s.groupLabel}>{g.label}</Text>
                <View style={s.chips}>
                  {rows.map((r) => (
                    <Press key={r.key} onPress={() => setOpen(r.key)} style={s.chip} size={TOUCH_MIN}
                           label={`${r.value}, ${r.count}`}>
                      <Text style={s.chipName}>{shown(r.value)}</Text>
                      <Text style={s.chipCount}>{two(r.count)}</Text>
                    </Press>
                  ))}
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = (c: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  inset: { paddingHorizontal: sp.lg },
  scroll: { paddingTop: sp.sm, paddingBottom: sp.huge },

  head: { flexDirection: "row", alignItems: "flex-end", gap: sp.lg, paddingTop: sp.xl, paddingBottom: sp.md },
  headText: { flex: 1, minWidth: 0 },
  kind: { ...t.micro, color: c.inkSoft },
  wordmark: { ...t.detailTitle, color: c.ink },
  close: { minHeight: TOUCH_MIN, justifyContent: "center" },
  micro: { ...t.micro, color: c.ink },
  rule: { height: RULE, backgroundColor: c.ink },

  group: { marginTop: sp.xl },
  groupLabel: { ...t.micro, color: c.inkSoft },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: sp.sm, marginTop: sp.md },
  chip: {
    flexDirection: "row", alignItems: "center", gap: sp.sm,
    minHeight: TOUCH_MIN, paddingHorizontal: sp.md, borderWidth: 2, borderColor: c.ink,
  },
  chipName: { ...t.bodyMed, fontWeight: "700", color: c.ink },
  chipCount: { ...t.tag, ...numeric, color: c.inkSoft },

  count: { ...t.micro, ...numeric, color: c.inkSoft, marginTop: sp.md, marginBottom: sp.xs },
  row: {
    flexDirection: "row", alignItems: "stretch", borderWidth: 2, borderColor: c.ink,
    marginTop: sp.sm, minHeight: TOUCH_MIN + 20,
  },
  block: { width: TOUCH_MIN + 6, alignItems: "center", justifyContent: "center" },
  blockNum: { ...t.tag },
  rowMain: { flex: 1, minWidth: 0, padding: sp.md, justifyContent: "center" },
  rowTitle: { ...t.bodyMed, fontWeight: "700", color: c.ink },
  rowSub: { ...t.meta, color: c.inkSoft, marginTop: 2 },

  emptyTitle: { ...t.section, color: c.ink, marginTop: sp.xl },
  emptyBody: { ...t.body, color: c.inkSoft, marginTop: sp.xs },
});
