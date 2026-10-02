// AddScreen.swift — the other way things get on a shelf.
//
// A port of app/src/Add.tsx. Sharing a reel is how shelf gets used at 1am;
// this is how it gets used when somebody tells you about a restaurant over
// dinner: type, tap, done. One field, every shelf at once, the shelf colour
// doing the disambiguating a row of filter chips would otherwise do (so there
// is no shelf filter here, as there is none in the Expo app).
//
// The screen's hardest job is telling the truth about what it CANNOT search.
// "No films matched" and "films are switched off" must not render the same
// way, so the server names the catalogues it could not reach and this says so.
//
// Paper: file "shelf" → "Add".
import SwiftUI

struct AddScreen: View {
    @Environment(AppModel.self) private var model
    @Environment(Nav.self) private var nav
    @Environment(\.theme) private var theme

    @State private var q = ""
    @State private var hits: [SearchHit] = []
    @State private var unavailable: [SearchResponse.Unavailable] = []
    @State private var busy = false
    @State private var error: String?
    @State private var added: [String: Shelving] = [:]
    /// "Nothing matched" may only be shown for a query that actually ran.
    /// Before that it is "we have not looked", which is a different sentence.
    @State private var searched: String?
    /// Return asks at once; an answer to a query already typed past is dropped.
    @State private var seq = 0

    var body: some View {
        VStack(spacing: 0) {
            SearchHead(title: "Add", placeholder: "A book, a place, a film — or paste a recipe link",
                       text: $q, busy: busy, onSubmit: { Task { await run(q) } }) { nav.close() }

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    if let error {
                        Text(error).rowLine(T.meta).foregroundStyle(theme.accent)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.horizontal, Tokens.Space.lg)
                            .padding(.top, Tokens.Space.md)
                    }

                    ForEach(hits) { hit in
                        CatalogueRow(hit: hit, state: added[hit.key], doneLabel: "Already on your shelf") { add(hit) }
                    }

                    // Named absence, not silence.
                    if !unavailable.isEmpty {
                        Notice(title: "Not everything is searchable yet",
                               text: unavailable.map { "\(Lists.info($0.list).label) (\($0.provider))" }.joined(separator: " and ")
                               + (unavailable.count > 1 ? " are" : " is")
                               + " switched off until a key is set on the server. Everything else here still works.")
                    }

                    if !busy, let searched, hits.isEmpty, error == nil {
                        Notice(title: "Nothing matched “\(searched)”",
                               text: "Try fewer words, or the name as it is actually written. For a recipe, paste the link to the page — shelf reads it off the page itself.")
                    }

                    if searched == nil, !busy {
                        Notice(title: "Look something up",
                               text: "Books and films by name, restaurants by name and city. Recipes are a link — paste the page and shelf takes the title, the picture and the timing off it.")
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, Tokens.Space.md)
                .padding(.bottom, Tokens.Space.huge)
            }
            .scrollIndicators(.hidden)
            .scrollDismissesKeyboard(.interactively)
        }
        .background(theme.bg.ignoresSafeArea())
        // Long enough that a typing burst is one request, short enough that
        // the field never feels like it is thinking about it.
        .task(id: q) {
            try? await Task.sleep(for: searchDebounce)
            if Task.isCancelled { return }
            await run(q)
        }
    }

    private func run(_ term: String) async {
        seq += 1
        let mine = seq
        guard term.trimmingCharacters(in: .whitespacesAndNewlines).count >= 2 else {
            hits = []; unavailable = []; searched = nil; busy = false
            return
        }
        busy = true
        error = nil
        do {
            let r = try await model.api.search(term)
            guard mine == seq else { return }
            hits = r.results
            unavailable = r.unavailable
            searched = term
        } catch {
            guard mine == seq else { return }
            self.error = error.localizedDescription
            hits = []
        }
        busy = false
    }

    /// NOTHING IS SENT ANYWHERE. You picked it; it goes straight onto this
    /// phone, filed, with an id made from the catalogue key so adding the same
    /// book twice updates one row instead of growing a second.
    private func add(_ hit: SearchHit) {
        added[hit.key] = .adding
        let now = Drain.iso(Date())
        let seed = hit.key.isEmpty ? "manual:\(hit.list):\(hit.title.lowercased())" : "catalogue:\(hit.key)"
        model.add(Item(id: Store.idFor(seed), list: hit.list, status: .filed, title: hit.title, subtitle: hit.subtitle,
                       note: "", imageURL: hit.imageURL, canonical: hit.canonical, confidence: 1, enriched: !hit.key.isEmpty,
                       sourceURL: nil, resolver: "search", createdAt: now, resolvedAt: now))
        // The bookcase is on that shelf when this screen is closed.
        nav.tab = hit.list
        added[hit.key] = .done
    }
}

#if DEBUG
#Preview("Add") { FixtureStage { AddScreen() } }
#Preview("Add, dark") { FixtureStage { AddScreen() }.preferredColorScheme(.dark) }
#endif
