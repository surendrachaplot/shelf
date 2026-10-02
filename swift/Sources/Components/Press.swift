// Press.swift — the only way anything in this app answers a finger.
//
// One button style so the press feel cannot differ between a tile in the
// picker and a button on the item page. The spring is `Tokens.Spring.press`,
// critically damped on purpose: a control that bounces back reads as a bug.
//
// The scale DEPENDS ON SIZE. The same factor that is a gentle push on a 44pt
// button is a collapse on a 320pt card, so the scale is solved for roughly
// constant edge travel (design.js `pressScale`).
import SwiftUI

func pressScale(_ sizePt: CGFloat) -> CGFloat { max(0.96, 1 - 2.2 / max(sizePt, 40)) }

struct PressStyle: ButtonStyle {
    /// Longest edge in points; drives how far the press scales.
    var size: CGFloat = 48
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .contentShape(Rectangle())
            .scaleEffect(configuration.isPressed && !reduceMotion ? pressScale(size) : 1)
            .animation(reduceMotion ? nil : .interpolatingSpring(
                mass: Double(Tokens.Spring.press.mass),
                stiffness: Tokens.Spring.press.stiffness,
                damping: Tokens.Spring.press.damping), value: configuration.isPressed)
    }
}

/// A pressable thing with a label VoiceOver can read.
struct Press<Label: View>: View {
    var label: String
    var size: CGFloat = 48
    var disabled = false
    var action: () -> Void
    @ViewBuilder var content: () -> Label

    init(_ label: String, size: CGFloat = 48, disabled: Bool = false,
         action: @escaping () -> Void, @ViewBuilder content: @escaping () -> Label) {
        self.label = label; self.size = size; self.disabled = disabled; self.action = action; self.content = content
    }

    var body: some View {
        Button(action: action, label: content)
            .buttonStyle(PressStyle(size: size))
            .disabled(disabled)
            .accessibilityLabel(label)
    }
}
