// ProfileScreen.swift — the library card.
//
// A port of app/src/Profile.tsx. Not a settings screen with an avatar on top:
// it is the object people see when you hand them a shelf, so it is built as
// one — an ex-libris plate, a name, a line about yourself, the shelves as a
// spread of colour, and the links you have handed out with how many times each
// was opened.
//
// EVERYTHING HERE IS ON THIS PHONE. There is no handle, because there is no
// users table — nobody looks you up, you hand somebody a link. The name and the
// line about yourself travel only inside a snapshot you deliberately publish.
//
// Editing happens in place. A separate "edit profile" screen for three fields
// is a second screen that exists to hold a Save button.
import SwiftUI

/// The numbers Profile.tsx writes out by hand.
private enum M {
    /// The same 2pt the rail leaves between its blocks.
    static let spreadGap: CGFloat = 2
    static let plate: CGFloat = 96
    static let cellMinHeight: CGFloat = 72
    /// `linkSwatch` / `factSwatch`, and the nudge that sits it on the x-height.
    static let swatch: CGFloat = 9
    static let swatchDrop: CGFloat = 5
    static let border: CGFloat = 2
    static let linkRow = Tokens.touchMin + 12
    static let inputTall = Tokens.touchMin + 24
    static let nameMax = 60
    static let bioMax = 200
}

struct ProfileScreen: View {
    @Environment(AppModel.self) private var model
    @Environment(Nav.self) private var nav
    @Environment(\.theme) private var theme

    @State private var editing = false
    @State private var draft = Profile()
    /// Open counts. Nil = not asked or could not ask: "—", never a zero.
    @State private var views: [String: Int]?
    /// Two local facts, no network: can the share sheet reach this app, and is
    /// anything it left still waiting.
    @State private var wiring: (shared: Bool, queued: Int)?

    private enum Copy: Equatable { case idle, busy, saved, failed(String) }
    @State private var copy = Copy.idle
    @State private var share: ShareItems?

    private var profile: Profile { model.shelf.profile }

    var body: some View {
        let counts = model.counts
        let total = counts.values.reduce(0, +)
        GeometryReader { geo in
            VStack(spacing: 0) {
                ScreenHead(title: "Your card", style: T.wordmark) {
                    TextAction(title: "Close") { nav.close() }
                }
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        plateRow(total).padding(.horizontal, Tokens.Space.lg)
                        if !profile.bio.isEmpty, !editing {
                            Text(profile.bio).style(T.body).foregroundStyle(theme.inkSoft)
                                .fixedSize(horizontal: false, vertical: true)
                                .padding(.top, Tokens.Space.md)
                                .padding(.horizontal, Tokens.Space.lg)
                        }
                        Group {
                            if editing { editBlock } else { actions(total) }
                        }
                        .padding(.horizontal, Tokens.Space.lg)
                        spread(counts, width: geo.size.width - Tokens.Space.lg * 2)
                        Group {
                            linksBlock
                            livesBlock
                            copyBlock
                        }
                        .padding(.horizontal, Tokens.Space.lg)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.bottom, Tokens.Space.huge)
                }
                .scrollIndicators(.hidden)
                .scrollDismissesKeyboard(.interactively)
            }
        }
        .background(theme.bg.ignoresSafeArea())
        .onAppear {
            draft = profile
            editing = profile.name.isEmpty
            wiring = (ShareQueue.reachable, ShareQueue.count)
        }
        // View counts are the ONE thing here the phone cannot know: they are
        // counted where the page is served. Fails silently — a card is not a
        // place to report a network error — but a count we do not have is "—".
        .task(id: model.shelf.links.map(\.code)) {
            let codes = model.shelf.links.map(\.code)
            guard !codes.isEmpty else { return }
            if let got = try? await model.api.publishStats(codes: codes) { views = got }
        }
        .shareSheet($share) { completed in copy = completed ? .saved : .idle }
    }

    // ── the plate ───────────────────────────────────────────────────────────

    private func plateRow(_ total: Int) -> some View {
        let seed = !profile.seed.isEmpty ? profile.seed : !profile.name.isEmpty ? profile.name : "shelf"
        return HStack(alignment: .top, spacing: Tokens.Space.lg) {
            PlateView(seed: seed, size: M.plate)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 0) {
                Micro("Ex libris")
                Text(profile.name.isEmpty ? "Nobody yet" : profile.name).style(T.itemTitle).foregroundStyle(theme.ink)
                    .lineLimit(2).fixedSize(horizontal: false, vertical: true)
                    .padding(.top, Tokens.Space.xs)
                Micro("\(total) shelved · on this phone", color: theme.inkFaint).monospacedDigit()
                    .padding(.top, Tokens.Space.xs)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.top, Tokens.Space.lg)
    }

    // ── edit in place ───────────────────────────────────────────────────────

    private var editBlock: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.sm) {
            para("This is what somebody sees on a link you hand them. It stays on this phone until you share something.")
            field("Name", text: $draft.name, placeholder: "Suren Chaplot", max: M.nameMax)
            field("A line about you", text: $draft.bio, placeholder: "Mostly things I saw at 1am", max: M.bioMax, tall: true)
            // Not vanity: the city disambiguates a restaurant search, and
            // "Ganapati" exists in several.
            field("Where you are", text: $draft.homeCity, placeholder: "London", max: M.nameMax)
            HStack(spacing: Tokens.Space.sm) {
                ShelfButton(title: "Save →", kind: .fill, label: "Save your card", action: save)
                if !profile.name.isEmpty {
                    ShelfButton(title: "Cancel") { draft = profile; editing = false }
                }
            }
            .padding(.top, Tokens.Space.lg)
        }
        .padding(.top, Tokens.Space.lg)
    }

    private func field(_ label: String, text: Binding<String>, placeholder: String, max: Int, tall: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Micro(label, color: theme.inkFaint).padding(.top, Tokens.Space.xs)
            TextField("", text: text, prompt: Text(placeholder).foregroundStyle(theme.inkFaint), axis: tall ? .vertical : .horizontal)
                .style(T.bodyMed).foregroundStyle(theme.ink).tint(theme.ink)
                .lineLimit(tall ? 2...8 : 1...1)
                .autocorrectionDisabled(!tall)
                .padding(.horizontal, Tokens.Space.md)
                .padding(.top, tall ? Tokens.Space.sm : 0)
                .frame(minHeight: tall ? M.inputTall : Tokens.touchMin, alignment: tall ? .topLeading : .leading)
                .background(theme.bg)
                .overlay(Rectangle().strokeBorder(theme.ink, lineWidth: M.border))
                .padding(.top, Tokens.Space.xs)
                .onChange(of: text.wrappedValue) { _, now in
                    if now.count > max { text.wrappedValue = String(now.prefix(max)) }
                }
                .accessibilityLabel(label)
        }
        .padding(.top, Tokens.Space.sm)
    }

    private func save() {
        var next = draft
        next.name = draft.name.trimmingCharacters(in: .whitespacesAndNewlines)
        // The plate is drawn from the seed, and a plate never changes: the
        // first name you give is the seed for good.
        next.seed = profile.seed.isEmpty ? next.name : profile.seed
        model.setProfile(next)
        draft = next
        editing = false
    }

    private func actions(_ total: Int) -> some View {
        HStack(spacing: Tokens.Space.sm) {
            ShelfButton(title: "Edit", label: "Edit your card") { draft = profile; editing = true }
            ShelfButton(title: "Share your shelves →", kind: .fill, disabled: total == 0, label: "Share your shelves") {
                nav.sharing = Sharing(kind: .profile, title: "Your whole card")
            }
        }
        .padding(.top, Tokens.Space.lg)
    }

    // ── the spread ──────────────────────────────────────────────────────────

    /// The shelves as a spread of colour, standing on boards — the same
    /// language as the app itself.
    ///
    /// THE COLUMN IS SOLVED, with the bookcase's own `gridFor`. `cover.minW` is
    /// the narrowest box that holds a twelve-letter word at the 11pt floor, so
    /// the same number gives three across on a 375pt phone and two on a 320pt
    /// one. Cells keep one width, so a row that is not full leaves room on its
    /// board — which is a shelf.
    private func spread(_ counts: [String: Int], width: CGFloat) -> some View {
        let grid = DesignMath.gridFor(available: Double(width), gap: Double(M.spreadGap))
        let rows = DesignMath.rowsOf(Lists.shelves.count, cols: grid.cols)
        return VStack(spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.offset) { r, row in
                HStack(alignment: .bottom, spacing: M.spreadGap) {
                    ForEach(row, id: \.self) { i in
                        cell(Lists.shelves[i], count: counts[Lists.shelves[i].key] ?? 0, width: CGFloat(grid.width))
                    }
                }
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, Tokens.Space.lg)
                .padding(.top, r == 0 ? Tokens.Space.xxl : Tokens.Space.lg)
                // Full bleed, exactly like the bookcase. A board that stops at
                // the inset is a card.
                BoardEdge()
            }
        }
    }

    private func cell(_ l: ListInfo, count: Int, width: CGFloat) -> some View {
        let paper = theme.isPaper(l.key)
        let edge = paper ? Tokens.coverKeyline : 0
        return VStack(alignment: .leading, spacing: 0) {
            Text(String(format: "%02d", count)).style(T.itemTitle).monospacedDigit().foregroundStyle(theme.on(l.key))
            Text(l.label).style(T.tag).foregroundStyle(theme.on(l.key)).lineLimit(1)
                .padding(.top, Tokens.Space.xs)
        }
        .padding(.vertical, Tokens.Space.md)
        .padding(.horizontal, Tokens.Space.sm)
        .padding(.top, edge).padding(.horizontal, edge)
        .frame(width: width, alignment: .bottomLeading)
        .frame(minHeight: M.cellMinHeight, maxHeight: .infinity, alignment: .bottomLeading)
        .background(theme.field(l.key))
        // Paper has no edge of its own. Open at the foot: it stands on the board.
        .overlay(alignment: .top) { theme.ink.frame(height: edge) }
        .overlay(alignment: .leading) { theme.ink.frame(width: edge) }
        .overlay(alignment: .trailing) { theme.ink.frame(width: edge) }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(l.label), \(count)")
    }

    // ── links you have handed out ───────────────────────────────────────────

    private var linksBlock: some View {
        VStack(alignment: .leading, spacing: 0) {
            h2("Links you have handed out")
            if model.shelf.links.isEmpty {
                para("None yet. Nothing of yours is on the internet until you share it — and when you do, only that one thing goes up. It shows up here with how many times it has been opened, and a way to pull it back.")
            }
            ForEach(model.shelf.links) { link in
                HStack(spacing: Tokens.Space.sm) {
                    swatchColour(link).frame(width: M.swatch, height: M.swatch)
                    VStack(alignment: .leading, spacing: 0) {
                        Text(link.title).style(T.bodyMed).foregroundStyle(theme.ink).lineLimit(1)
                        Text(model.api.shareURL(code: link.code).absoluteString).style(T.meta).foregroundStyle(theme.inkFaint).lineLimit(1)
                    }
                    .padding(.vertical, Tokens.Space.sm)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    // "Opened 0 times" and "we have not counted" are different
                    // facts, and a link nobody has opened says so in words.
                    Micro(opened(link.code), color: theme.inkFaint).monospacedDigit().lineLimit(1)
                        .fixedSize()
                    TextAction(title: "Off", label: "Turn this link off") {
                        Task { await model.revoke(link.code) }
                    }
                    .padding(.horizontal, Tokens.Space.md)
                }
                .padding(.leading, Tokens.Space.md)
                .frame(minHeight: M.linkRow)
                .overlay(Rectangle().strokeBorder(theme.ink, lineWidth: M.border))
                .padding(.top, Tokens.Space.sm)
            }
        }
        .padding(.top, Tokens.Space.xxl)
    }

    private func swatchColour(_ link: PublishedLink) -> Color {
        if let target = link.target, Tokens.listKeys.contains(target) { return theme.field(target) }
        return theme.ink
    }

    private func opened(_ code: String) -> String {
        guard let n = views?[code] else { return "—" }
        return n == 0 ? "unopened" : "\(n)×"
    }

    // ── where your things live ──────────────────────────────────────────────

    private var livesBlock: some View {
        VStack(alignment: .leading, spacing: 0) {
            h2("Where your things live")
            para("On this phone, in one file. Nothing is uploaded and there is no account — which also means shelf cannot get it back for you if you delete the app.")
            if let wiring {
                // This proves two PROCESSES can see one container — the thing
                // that silently breaks and takes a week to find.
                fact(wiring.shared,
                     good: "The share sheet can hand things to this app.",
                     bad: "The share sheet cannot reach this app. Sharing from Instagram will not work — install the latest build.")
                fact(wiring.queued == 0,
                     good: "Nothing waiting to be read.",
                     bad: "\(wiring.queued) share\(wiring.queued == 1 ? "" : "s") waiting. They are read the next time shelf comes to the front.")
            }
            // Which build is this. One quiet line: there is no over-the-air
            // update to fetch in the Swift app, so there is no button.
            Text("Version \(Self.bundle("CFBundleShortVersionString")) · build \(Self.bundle("CFBundleVersion"))")
                .style(T.meta).monospacedDigit().foregroundStyle(theme.inkFaint)
                .padding(.top, Tokens.Space.lg)
        }
        .padding(.top, Tokens.Space.xxl)
    }

    private static func bundle(_ key: String) -> String {
        Bundle.main.object(forInfoDictionaryKey: key) as? String ?? "—"
    }

    // ── take a copy ─────────────────────────────────────────────────────────

    /// Never hold a shelf hostage. Built from the shelf in memory, on the
    /// device — no server sees it. "Saved" and "failed" are said in words: an
    /// export that fails silently is the worst kind, because the person
    /// believes they have a backup.
    private var copyBlock: some View {
        // EVERY item, not the shelved ones: the copy also holds the pile, and
        // the number here is a promise about what is in the file.
        let n = model.items.count
        return VStack(alignment: .leading, spacing: 0) {
            Rule()
            h2("Take a copy").padding(.top, Tokens.Space.lg)
            Text("\(n) \(n == 1 ? "thing" : "things"), with your notes and the saved articles.")
                .style(T.title).monospacedDigit().foregroundStyle(theme.ink)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, Tokens.Space.md)
            Text("Keep it in Files, or send it to yourself. It is yours.").style(T.body).foregroundStyle(theme.inkSoft)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, Tokens.Space.md)
            Flow(spacing: Tokens.Space.sm, lineSpacing: Tokens.Space.sm) {
                ShelfButton(title: "A page you can read →", kind: .fill, disabled: copy == .busy, label: "Save a page you can read") {
                    takeCopy(.html)
                }
                ShelfButton(title: "The data →", disabled: copy == .busy, label: "Save the data") {
                    takeCopy(.json)
                }
            }
            .padding(.top, Tokens.Space.lg)
            para("One .html file that opens anywhere. One .json file for other apps.")
            if copy == .saved { fact(true, good: "Copy saved.", bad: "") }
            if case .failed(let why) = copy {
                fact(false, good: "", bad: "The copy was not saved. \(why)".trimmingCharacters(in: .whitespaces))
            }
        }
        .padding(.top, Tokens.Space.xxl)
    }

    private func takeCopy(_ kind: Export.Kind) {
        copy = .busy
        let now = Date()
        do {
            let text = kind == .html ? Export.html(model.shelf, now: now) : Export.json(model.shelf, now: now)
            let url = try writeTemporaryFile(named: Export.filename(kind, now: now), text: text)
            share = ShareItems(items: [url])
        } catch {
            copy = .failed(error.localizedDescription)
        }
    }

    // ── small pieces ────────────────────────────────────────────────────────

    private func h2(_ text: String) -> some View {
        Text(text).style(T.section).foregroundStyle(theme.ink)
            .accessibilityAddTraits(.isHeader)
    }

    private func para(_ text: String) -> some View {
        Text(text).style(T.meta).foregroundStyle(theme.inkSoft)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.top, Tokens.Space.sm)
    }

    /// A fact about the plumbing. The swatch carries the state and the
    /// sentence carries the meaning — never a bare tick, which says a thing
    /// passed without saying what the thing was.
    private func fact(_ ok: Bool, good: String, bad: String) -> some View {
        HStack(alignment: .top, spacing: Tokens.Space.sm) {
            (ok ? theme.good : theme.accent)
                .frame(width: M.swatch, height: M.swatch)
                .padding(.top, M.swatchDrop)
            Text(ok ? good : bad).style(T.meta).foregroundStyle(ok ? theme.inkSoft : theme.ink)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.top, Tokens.Space.md)
        .accessibilityElement(children: .combine)
    }
}

#if DEBUG
#Preview("Your card") { FixturePreviewHost { _ in ProfileScreen() } }
#Preview("Your card, dark") { FixturePreviewHost { _ in ProfileScreen() }.preferredColorScheme(.dark) }
#endif
