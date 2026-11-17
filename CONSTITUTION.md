# Constitution

Standing rules from Umesh. Read this file before changing anything in this
project, and follow it in every change. Add new rules here as he gives them.

## Buttons

A button has five parts: a shadow, a fill, a border, the label, and a focus ring.
Every button, on the website and in the app, follows these six rules.

1. **The tap target is at least 44 pixels tall**, even if the button looks smaller.
2. **The label says the action.** "Create workspace", not "Submit".
3. **One primary button per screen.** Cancel and other secondary actions go
   ghost (no fill), so the eye knows where to land.
4. **While it loads, keep the width, swap the label for a spinner, and ignore
   the second click.**
5. **The focus ring stays visible for keyboard users.** Never ship
   `outline: none` without a visible replacement.
6. **A disabled button says why.** "Name your workspace first."

### How to follow them here

- Website: use `Button` from `artifacts/gst-platform/src/components/ui/button.tsx`.
  It already carries the 44px tap target and the focus ring. Pass `loading`
  while the request runs (not a changed label such as "Saving…"), and
  `disabledReason` when the button cannot be pressed yet. Use
  `variant="ghost"` for Cancel, and one default-variant button per screen or dialog.
- App: use `Button` from `exports/GST-Pro-Android/lib/ui.tsx`. Pass `busy`
  while the request runs and `disabledReason` when it cannot be pressed yet.
  Use `variant="outline"` for secondary actions. A hand-made `Pressable` that
  acts as a button needs `minHeight: 44` (or `hitSlop` to reach it).
- App: nothing may sit under the phone's status bar or navigation buttons.
  Screens get their bottom padding from the root layout. A `Modal` does not,
  so put its content inside `ModalFrame` from `lib/ui.tsx`.

## Dashboards

1. **No decorative gradients.** One flat accent colour, used only for the
   single primary action on the screen.
2. **No icon tiles on stat cards.** The number is the largest thing on the
   card, with a small muted label above it.
3. **Real hierarchy.** The metric that matters most gets a large card with its
   own breakdown; the rest sit smaller in a secondary column.
4. **Shadows only on what floats.** Cards are a 1px border with no shadow.
   Dropdowns, modals and popovers keep their elevation.
5. **Copy carries data.** The heading names the period the figures cover
   ("Revenue · 1 Aug to 31 Aug 2026"). Every change says what it compares
   with and its unit ("+12.5% vs Jul"). No emoji.

## Commits and pull requests

No AI tool is named in commit messages, co-author lines, pull request titles
or descriptions, or code comments.
