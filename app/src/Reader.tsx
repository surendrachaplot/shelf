// Reader.tsx — the article, kept, and readable after the link is dead.
//
// The text was saved when the thing was shelved (`canonical.article`, built by
// api/article.js), so this screen makes NO network call. That is the point of
// it: a saved article that needs the site to still exist is a bookmark.
//
// Paper: file "shelf" → "Reader — light" / "Reader — dark". White paper and
// ink, not the list colour the Detail panel uses — six minutes of reading on
// poster red is a headache, and the shelf is still named by the chip.
import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import type { Item } from "./store";
import { Press } from "./Press";
import { Screen } from "./Screen";
import { COVER_KEYLINE, isPaper, onFor, numberOf, RULE, sp, t, TOUCH_MIN, useTheme, type Palette } from "./theme";

export type Article = {
  byline?: string | null; siteName?: string | null; text?: string | null;
  readingMinutes?: number | null; excerpt?: string | null; hero?: string | null;
  summary?: string | null;
};

/** The saved article on an item, or null. One place decides what "has one" means. */
export function articleOf(item: Pick<Item, "canonical">): Article | null {
  const a = (item.canonical as { article?: Article } | null)?.article;
  return a && typeof a.text === "string" && a.text.trim() ? a : null;
}

const savedOn = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};

export function Reader({ item, onClose, onOpenOriginal }: {
  item: Item; onClose: () => void; onOpenOriginal: (url: string) => void;
}) {
  const { c } = useTheme();
  const s = styles(c);
  const a = articleOf(item);
  const list = item.list ?? "unsorted";
  const fill = (c as Record<string, string>)[list] ?? c.unsorted;
  const on = onFor(list, c);
  const paragraphs = (a?.text ?? "").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const meta = [a?.byline, a?.readingMinutes ? `${a.readingMinutes} min` : null].filter(Boolean).join(" · ");
  const saved = savedOn(item.created_at);

  return (
    <Screen style={s.screen}>
      <View style={s.bar}>
        <View style={s.source}>
          <View style={[s.chip, { backgroundColor: fill }, isPaper(list, c) ? s.chipPaper : null]}>
            <Text style={[s.chipNum, { color: on }]}>{numberOf(list)}</Text>
          </View>
          {a?.siteName ? <Text style={s.site} numberOfLines={1}>{a.siteName}</Text> : null}
        </View>
        <Press onPress={onClose} style={s.close} size={TOUCH_MIN} label="Close">
          <Text style={s.micro}>Close</Text>
        </Press>
      </View>
      <View style={s.rule} />

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <Text style={s.title}>{item.title ?? "Saved article"}</Text>
        {meta ? <Text style={s.meta}>{meta}</Text> : null}

        {a?.summary ? (
          <View style={[s.summary, { borderLeftColor: fill }]}>
            <Text style={s.micro}>In short</Text>
            <Text style={s.summaryText}>{a.summary}</Text>
          </View>
        ) : null}

        <View style={s.body}>
          {paragraphs.map((p, i) => <Text key={i} style={s.para} selectable>{p}</Text>)}
        </View>
      </ScrollView>

      <View style={s.foot}>
        <Text style={s.kept}>
          {["Kept on this phone", saved ? `saved ${saved}` : null].filter(Boolean).join(" · ")}
        </Text>
        {item.source_url ? (
          <View style={s.actions}>
            <Press onPress={() => onOpenOriginal(item.source_url as string)} style={s.btn} size={TOUCH_MIN} label="Open the original page">
              <Text style={s.micro}>Open original →</Text>
            </Press>
          </View>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = (c: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  bar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: sp.lg, paddingTop: sp.sm, paddingBottom: sp.md, gap: sp.md,
  },
  source: { flexDirection: "row", alignItems: "center", gap: sp.sm, flex: 1, minWidth: 0 },
  chip: { width: sp.xl + sp.xs, height: sp.xl + sp.xs, alignItems: "center", justifyContent: "center" },
  chipPaper: { borderWidth: COVER_KEYLINE, borderColor: c.ink },
  chipNum: { ...t.tag },
  site: { ...t.micro, color: c.inkSoft, flex: 1, minWidth: 0 },
  close: { minHeight: TOUCH_MIN, justifyContent: "center" },
  micro: { ...t.micro, color: c.ink },
  rule: { height: RULE, backgroundColor: c.ink },

  scroll: { paddingHorizontal: sp.lg, paddingTop: sp.xl, paddingBottom: sp.huge },
  title: { ...t.title, color: c.ink },
  meta: { ...t.micro, color: c.inkSoft, marginTop: sp.md },
  summary: {
    marginTop: sp.lg, padding: sp.lg, gap: sp.sm,
    backgroundColor: c.surfaceSunk, borderLeftWidth: RULE,
  },
  summaryText: { ...t.body, color: c.ink },
  body: { marginTop: sp.xl, gap: sp.lg },
  para: { ...t.read, color: c.ink },

  foot: {
    paddingHorizontal: sp.lg, paddingTop: sp.md, paddingBottom: sp.lg, gap: sp.md,
    borderTopWidth: RULE, borderTopColor: c.ink, backgroundColor: c.bg,
  },
  kept: { ...t.micro, color: c.inkSoft },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: sp.sm },
  btn: {
    minHeight: TOUCH_MIN, paddingHorizontal: sp.lg, justifyContent: "center",
    borderWidth: 2, borderColor: c.ink,
  },
});
