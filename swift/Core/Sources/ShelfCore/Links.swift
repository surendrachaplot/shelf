// Links.swift — the other things on your shelves that this one belongs with.
// Port of app/src/links.js, checked against golden-links.json.
//
// A link IS two items carrying the same tag, so there is one definition of
// "same author" and it is the tag's key (Tags.swift).
import Foundation

enum Links {
    /// A LINK HAS TO BE A REASON, NOT A COINCIDENCE. The same person made both;
    /// the same person is in both; the same neighbourhood; the same city —
    /// strongest first, and that is the whole list. A shared year, genre,
    /// cuisine or website is a filter (Tags has them), and as a link it is
    /// noise: a row that says so teaches a person to stop reading the row.
    static let kinds = ["author", "director", "cast", "area", "city"]

    struct Reason: Equatable, Sendable {
        var kind: String
        var value: String
    }

    struct Group: Equatable, Sendable {
        var reason: Reason
        var items: [Item]
    }

    /// Never the item itself, never an empty group, strongest reason first. An
    /// item in the same neighbourhood is also in the same city and appears
    /// under both: each row is true on its own.
    static func `for`(_ item: Item, in items: [Item]) -> [Group] {
        let tags = Tags.for(item)
        // In `kinds` order, and inside one kind in the tags' own order.
        let mine = kinds.flatMap { kind in tags.filter { $0.kind == kind } }
        if mine.isEmpty { return [] }

        // One pass over the shelf, not one per reason.
        var groups: [String: [Item]] = [:]
        for t in mine { groups[t.key] = [] }
        for other in items {
            // The open item is very often a COPY of the one in the array, and
            // "related to itself" is the silliest row there is.
            if item.id.isEmpty ? other == item : other.id == item.id { continue }
            for t in Tags.for(other) where groups[t.key] != nil { groups[t.key]?.append(other) }
        }
        return mine.compactMap { t in
            guard let found = groups[t.key], !found.isEmpty else { return nil }
            return Group(reason: Reason(kind: t.kind, value: t.value), items: found)
        }
    }
}
