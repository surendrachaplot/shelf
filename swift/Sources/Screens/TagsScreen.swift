// TagsScreen.swift — every fact your shelves share, and the things that share it.
//
// A port of app/src/TagIndex.tsx. These are not labels somebody typed and not
// a model's guess at a mood. Each one is a FACT already on a resolved item —
// the author, the neighbourhood, the cuisine, the director — which is why
// "Peckham" can hold a restaurant and a bookshop without anybody filing
// either. `Tags` decides what a tag is; this only draws it.
//
// One screen, two states, because the second is the first with a row picked:
// `open` is a tag key or nil.
//
// Paper: file "shelf" → "Tags" and "Tag open — one tag, with links".
import SwiftUI

struct TagsScreen: View {
    @Environment(Nav.self) private var nav
    /// Starts on `nav.tagStart` — how an item page gets here.
    var body: some View { TagsBody(start: nav.tagStart) }
}

private struct TagsBody: View {
    @Environment(AppModel.self) private var model
    @Environment(Nav.self) private var nav
    @Environment(\.theme) private var theme
    @State private var open: String?

    init(start: String?) { _open = State(initialValue: start) }

    // What a person would look under, in the order they would look. `year` is
    // deliberately absent: forty single years is a wall of chips, and the
    // decade says the same thing.
    private static let groups: [(label: String, kinds: [String])] = [
        ("People", ["author", "director", "cast"]),
        ("Brands", ["brand"]),
        ("Where", ["area", "city"]),
        ("Kind", ["cuisine", "genre", "site"]),
        ("When", ["decade"]),
    ]
    private static func group(of kind: String) -> String { groups.first { $0.kinds.contains(kind) }?.label ?? "Tag" }
    private static func two(_ n: Int) -> String { String(format: "%02d", n) }
    /// OpenStreetMap writes cuisines in lower case ("thai"); a catalogue
    /// writes "Fantasy". Side by side that reads as a mistake, so an
    /// all-lower-case value gets its first letter raised. Display only.
    private static func shown(_ v: String) -> String {
        guard let first = v.first, v == v.lowercased() else { return v }
        return first.uppercased() + v.dropFirst()
    }
    private static let chipName = TextStyle(step: Tokens.Text.bodyMed, weight: .bold)

    var body: some View {
        let index = Tags.index(model.items)
        let tag = open.flatMap { key in index.first { $0.key == key } }
        let tagged = tag.map { Tags.items(model.items, withTag: $0.key) } ?? []
        let shelves = Set(tagged.map(\.list)).count

        VStack(spacing: 0) {
            ScreenHead(kicker: tag.map { Self.group(of: $0.kind) }, title: tag.map { Self.shown($0.value) } ?? "Tags") {
                HStack(spacing: Tokens.Space.lg) {
                    if tag != nil { TextAction(title: "All tags") { open = nil } }
                    TextAction(title: "Close") { nav.close() }
                }
            }

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    if tag != nil {
                        Text("\(Self.two(tagged.count)) \(tagged.count == 1 ? "thing" : "things")"
                             + (shelves > 1 ? " · \(shelves) shelves" : ""))
                            .style(T.micro).monospacedDigit().foregroundStyle(theme.inkSoft)
                            .padding(.top, Tokens.Space.md)
                            .padding(.bottom, Tokens.Space.xs)
                        ForEach(tagged) { item in
                            Press("\(item.title ?? "Not read yet"), \(Lists.info(item.list).label)",
                                  size: Tokens.touchMin + 20, action: { nav.show(item) }) {
                                ItemRow(list: item.list, title: item.title ?? "Not read yet", subtitle: item.subtitle)
                            }
                            .padding(.top, Tokens.Space.sm)
                        }
                    } else if index.isEmpty {
                        // A title, what happens next, and no dead end.
                        Text("No tags yet").style(T.section).foregroundStyle(theme.ink)
                            .padding(.top, Tokens.Space.xl)
                        Text("Tags come from what shelf finds out about a thing: its author, its city, its kind. Shelve a few things and they show here by themselves.")
                            .rowLine(T.body).foregroundStyle(theme.inkSoft)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.top, Tokens.Space.xs)
                    } else {
                        ForEach(Self.groups, id: \.label) { g in
                            let rows = index.filter { g.kinds.contains($0.kind) }
                            if !rows.isEmpty {   // never an empty heading
                                Micro(g.label, color: theme.inkSoft).padding(.top, Tokens.Space.xl)
                                Flow(spacing: Tokens.Space.sm, lineSpacing: Tokens.Space.sm) {
                                    ForEach(rows, id: \.key) { r in
                                        Press("\(r.value), \(r.count)", size: Tokens.touchMin, action: { open = r.key }) {
                                            HStack(spacing: Tokens.Space.sm) {
                                                Text(Self.shown(r.value)).style(Self.chipName).foregroundStyle(theme.ink)
                                                    .multilineTextAlignment(.leading)
                                                Text(Self.two(r.count)).style(T.tag).monospacedDigit().foregroundStyle(theme.inkSoft)
                                            }
                                            .modifier(InkBox())
                                        }
                                    }
                                }
                                .padding(.top, Tokens.Space.md)
                            }
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, Tokens.Space.lg)
                .padding(.top, Tokens.Space.sm)
                .padding(.bottom, Tokens.Space.huge)
            }
            .scrollIndicators(.hidden)
        }
        .background(theme.bg.ignoresSafeArea())
    }
}

#if DEBUG
#Preview("Tags") { FixtureStage { TagsScreen() } }
#Preview("Tags, dark") { FixtureStage { TagsScreen() }.preferredColorScheme(.dark) }
#Preview("One tag") { FixtureStage({ $0.tagStart = "city:lisbon" }) { TagsScreen() } }
#endif
