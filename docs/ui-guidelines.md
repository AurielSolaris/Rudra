# Rudra — UI Guidelines

Rules for building the Flutter desktop GUI. **MUST / SHOULD / NEVER** are binding
in that order of strength.

Two sources, merged:

1. **General interface guidelines** (the web-oriented rules doc), translated to
   Flutter idiom. Where a rule was browser-specific it has been mapped to its
   Flutter equivalent, or listed under §11 as not applicable — never silently dropped.
2. **Hermes Desktop's `apps/desktop/DESIGN.md`**, whose visual and interaction
   contract we are deliberately replicating. Their principles are good and
   hard-won; we adopt them rather than re-deriving them.

Companion to `PLAN.MD` (scope) and `MAP.txt` (components).

---

## 1. Core principles — adopted from Hermes

These are durable. They hold as components come and go.

1. **Flat, not boxed.** No card-in-card. No divider borders inside a panel.
   Group with whitespace and a single hairline — never nested rounded boxes.
2. **Borderless elevation for floating surfaces.** Overlays float on a layered
   shadow plus a hairline, not thick framed boxes.
3. **One primitive per concern.** One `RudraButton`, one `SearchField`, one
   `Loader`, one `ErrorState`, one `EmptyState`, one `ConfirmDialog`. Migrate
   onto them; never fork one at a call site.
4. **Tokens, not literals.** Every color, stroke, radius, duration and spacing
   value comes from a `ThemeExtension`. A raw `Color(0xFF…)` in a widget is a bug.
5. **Style lives in the primitive.** Call sites pass `variant` and `size`. They
   do **not** pass padding, height, or icon size. If you need a new look, add a
   variant to the primitive.
6. **Intent before automation.** Surface actions and previews, but never open a
   pane, move focus, or navigate because a tool happened to produce output.
7. **Immediate feedback.** Direct manipulation paints first; persistence
   reconciles after and rolls back visibly on failure.

> When a rule here and the code disagree, fix whichever is wrong. Do not fork a
> one-off at the call site. A stale name in this file is a bug, exactly like a
> stale type.

## 2. Information architecture

- **MUST: Chat is the home surface.** The transcript and composer stay primary.
  Memory, search, files, and terminal complement the conversation; they never
  replace it.
- **MUST: Overlays are short tasks.** Settings, memory review, and session search
  render as overlay cards and return to the previous route on close. They are not
  navigation stacks.
- **MUST: Panes are working context.** A pane stays attached to the current task
  and survives temporary hiding.
- **MUST: One action, one home.** A command may be reachable by keyboard, palette,
  and a visible control, but all three invoke the same action and the same state.
  Never fork behavior per entry point.
- **MUST: Background work never steals the foreground.** A finishing stream or an
  arriving tool result may update a badge or cached data. It must not replace the
  visible transcript or move focus.
- **MUST: "New session" is a first-class, one-keystroke action** in the sidebar.
  Memory only pays off at session boundaries (`PLAN.MD` §5.6), so the UI has to
  make starting one feel cheap.

## 3. Keyboard & focus

- **MUST: Full keyboard operability.** Every action reachable by pointer is
  reachable by keyboard. Register shortcuts through one shared `Shortcuts`/`Actions`
  layer, never ad-hoc `RawKeyboardListener`s.
- **MUST: Visible, unobscured focus indication** on every focusable widget. Use
  `FocusableActionDetector` + a token-driven focus ring. Sticky headers and
  floating controls never cover the focused element — scroll it into view.
- **NEVER: Remove the focus indicator without replacing it** with something
  equally visible.
- **MUST: Manage focus deliberately** — trap it in modals, move it on open,
  return it to the invoker on close.
- **MUST: Keyboard ownership follows focus.** The focused surface wins its keys.
  Shell shortcuts must not steal the embedded terminal's or the editor's bindings.
- **MUST: Use `FocusTraversalGroup`** so tab order follows visual order, not
  widget-tree order.
- **SHOULD: Autofocus the composer** on window focus when it is the single primary
  input and nothing else holds focus.

## 4. Cancellation

- **MUST: One cancel gesture does one thing.** `Esc` either cancels the active
  interaction _or_ closes the topmost dismissible surface — never both, and never
  the control underneath.
- **MUST: Cancellation is synchronous in the UI** even when cleanup is async.
  Overlays, cursors, and pending gesture state clear in the same frame.
- **MUST: Interrupting a stream is instant and obvious.** The partial message
  stays visible, marked interrupted (`PLAN.MD` §7). It is never silently discarded
  and never presented as complete.
- **MUST: Flows that deliberately cannot be dismissed** (onboarding, destructive
  confirmation) say so explicitly.

## 5. Input & controls

- **MUST: Hit targets ≥24 logical px on desktop, ≥44 on coarse-pointer surfaces.**
  If the visual is smaller, expand the hit area — do not enlarge the paint.
- **MUST: Label and control share one hit target.** No dead zones on checkboxes,
  radios, or switch rows.
- **MUST: If it looks clickable, it is clickable.**
- **NEVER: Block paste** in any text field. `enableInteractiveSelection` stays on.
  Pasting a long transcript or an API key must work.
- **MUST: Enter submits a single-line field. `Ctrl`/`Cmd`+Enter submits the
  multiline composer.** Plain Enter in the composer inserts a newline.
- **MUST: Loading buttons keep their original label** and add a spinner. Never
  swap the label for "Loading…".
- **MUST: Keep submit enabled until the request actually starts**, then disable
  with a spinner.
- **MUST: Accept free text and validate after.** Never block typing.
- **MUST: Errors appear inline next to their field**, and submitting focuses the
  first error.
- **MUST: Warn before discarding unsaved changes** (an edited memory entry, a
  half-written composer draft) using `PopScope`.
- **MUST: Trim submitted values** — text expansion and paste leave trailing spaces.
- **SHOULD: Disable spellcheck** on API keys, model ids, paths, and codes.
- **SHOULD: Placeholders end with `…`** and show an example pattern.
- **SHOULD: Prefer uncontrolled text fields** (`TextEditingController` held by the
  field, not rebuilt from app state per keystroke).

### Control inventory — one per concern

| Primitive          | Rule                                                                                                                                                                                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RudraButton`      | The only button. Variants: `primary`, `destructive`, `secondary` (soft fill, the default non-primary), `outline`, `ghost`, `floating`, `text` (boxless inline — "Cancel"), `textStrong` (bold inline affordance — "Change"). Sizes own their padding. |
| `SearchField`      | Borderless, underline on focus, auto-width. The only search input. Never build a boxed search bar. Empty lists hide their search field.                                                                                                               |
| `SegmentedControl` | The choice control for small mutually-exclusive sets (theme mode, tool-call display). Replaces radio piles and pill rows.                                                                                                                             |
| `RudraSwitch`      | Bare, with a semantics label. No bordered text wrapper.                                                                                                                                                                                               |
| `ListRow`          | Label / description / action rows in settings. Flat, flush-left.                                                                                                                                                                                      |
| `ConfirmDialog`    | The **only** way to ask "are you sure". See §7.                                                                                                                                                                                                       |

## 6. State restoration & navigation

The source rules are built on URLs. Desktop has none, so they map to window and
route state:

- **MUST: Route state is restorable.** Active session, open panes, selected
  settings page, and scroll position survive a restart. Use `go_router` plus
  `RestorationMixin`; scroll offsets via `PageStorageKey`.
- **MUST: Back/forward (and the mouse back button) restore scroll position.**
- **MUST: Navigation goes through the router**, never a `GestureDetector` on a
  container. Navigable rows are real focusable, keyboard-activatable widgets.
- **MUST: Window geometry persists** — size, position, maximized state, per display.
- **SHOULD: Deep-linkable state** (a session id, a message anchor) is addressable
  internally so session search can jump straight to a message.

## 7. Feedback: loading, empty, error, confirm

- **MUST: One `Loader` primitive.** **NEVER ship the literal text "Loading…"** —
  Hermes uses animated ASCII/math curves; pick our own motif and use it everywhere.
- **MUST: Skeletons mirror final content** so nothing shifts when data lands.
- **MUST: One `ErrorState` primitive**, shared by the error boundary, in-dialog
  errors, and the sidecar-boot failure banner.
- **MUST: One `EmptyState` primitive.** Design the empty, sparse, dense, **and**
  error state of every surface. No surface ships with only its happy path.
- **MUST: No dead ends.** Every error offers a next step or a recovery action.
- **MUST: One `LogView`** for raw output: no background, hairline border, tight
  padding, small mono. Shell output and sidecar logs both use it.
- **MUST: `ConfirmDialog` is the only "are you sure".** It opens focused on
  Confirm so `Enter` confirms and `Esc` cancels; it owns the pending → done →
  close beat and its own inline error. A call site passes an async `onConfirm`
  and nothing else. A third way out goes in the single `secondaryAction` slot.
- **MUST: Confirm destructive actions, or offer an Undo window.** Deleting a
  session or a memory entry is destructive.
- **MUST: Announce transient status with `SemanticsService.announce`** — the
  equivalent of a polite `aria-live` region — for toasts and inline validation.
- **SHOULD: Optimistic UI**, reconciled on response, rolled back visibly or with
  an Undo on failure.
- **SHOULD: `…` for actions that open follow-ups** ("Rename…", "Add provider…").

## 8. Motion

- **MUST: Honor reduced motion.** Check `MediaQuery.disableAnimationsOf(context)`
  and provide a reduced variant or no animation. Nothing beyond a fade survives
  when it is set.
- **MUST: Motion follows state; it never delays state.** Selection, pressed
  feedback, drag targets, and cancellation paint in the current frame.
- **MUST: Quick and functional** — ~100 ms on controls.
- **MUST: Hover paints instantly; only the return eases.** Put the transition on
  the resting state and drop it while hovered.
- **MUST: Animate cheap properties** — opacity and transform. Use `AnimatedOpacity`,
  `Transform`, `SlideTransition`, `FadeTransition`.
- **NEVER: Animate layout geometry on a hot path.** Animating width, height, or
  constraints relayouts the subtree; during a live token stream that is visible
  jank.
- **MUST: Wrap independently-animating subtrees in `RepaintBoundary`**, especially
  the loader, the streaming message, and the terminal.
- **MUST: Correct transform origin** — motion starts where it physically should.
- **MUST: Animations are interruptible** and input-driven.
- **SHOULD: Animate only to clarify cause and effect, or for deliberate delight.**
- **SHOULD: Choreographed exits stagger per element, then settle the surface.**
  Delay the container's fade so it does not swallow the detail animation.

## 9. Layout & typography

- **MUST: Deliberate alignment** to a grid and to shared edges. No accidental
  placement.
- **MUST: One source for page gutters** — a `PAGE_INSET` token, never a hardcoded
  padding on a page.
- **MUST: Prefer spacing over dividers.** When a divider is genuinely needed it is
  a single hairline from the stroke token.
- **MUST: Verify at narrow (~900 px), laptop, and ultra-wide.** Transcript line
  length is capped — text never runs the full width of a 34" display.
- **MUST: Respect the titlebar band and native window-control geometry.** Empty
  header space drags the window; tabs and actions do not.
- **MUST: No unwanted scrollbars**; fix overflow at the source.
- **MUST: Flex and grid over measurement.** Reach for `LayoutBuilder` only when
  `Row`/`Column`/`Flex` genuinely cannot express it.
- **MUST: Text containers handle long content** — `maxLines` with
  `TextOverflow.ellipsis`, or explicit wrapping.
- **MUST: A `Row` child that can overflow is wrapped in `Expanded`/`Flexible`.**
  This is the Flutter form of the `min-w-0` rule, and it is the single most common
  overflow bug.
- **MUST: `FontFeature.tabularFigures()`** on any number meant to be compared —
  token counts, character usage, durations.
- **MUST: Use the `…` character**, never three periods.
- **MUST: Non-breaking spaces** in `10 MB`, `⌘ K`, and brand names.
- **MUST: Resilient to user content** — render short, average, and absurdly long
  values without breaking.
- **MUST: Locale-aware dates, times, and numbers** via `intl`.
- **SHOULD: Curly quotes in prose**; avoid widows and orphans in headings.
- **SHOULD: Optical alignment** — adjust ±1 px when perception beats geometry.

### Two independent text scales (from Hermes)

- **UI Scale** — whole-window zoom, default 100%. Affects everything.
- **Chat Text Size** — a separate multiplier on transcript and composer text,
  default 110%. Does **not** resize the sidebar, settings, toolbars, or pane geometry.

Derive conversation sizes from a transcript-local base token. **NEVER** multiply
the global token or nest scales.

## 10. Accessibility & content

- **MUST: Prefer real semantics** — `Semantics` with the right role, and real
  `TextField` / `Checkbox` / `Switch` widgets, before hand-rolled gesture widgets.
- **MUST: Accurate `Semantics(label:)`**; decorative elements are
  `ExcludeSemantics`.
- **MUST: Icon-only buttons have a descriptive semantics label and a tooltip.**
- **MUST: Accessible names exist even where the visual omits a label.**
- **MUST: Status is never color-only.** Pair color with an icon or text.
- **MUST: Meet contrast targets; prefer APCA** over WCAG 2 where they disagree.
- **MUST: Contrast increases on hover, press, and focus** — never decreases.
- **MUST: Keyboard navigation is the accessibility floor and is non-negotiable.**
  Flutter desktop's screen-reader support is thinner than a browser's
  (`PLAN.MD` §10); that is a documented limitation, not a licence to skip
  semantics labels.
- **SHOULD: Inline help first.** Tooltips are the last resort.
- **SHOULD: Delay the first tooltip in a group; subsequent peers appear instantly.**
- **SHOULD: Mark brand names, code tokens, and identifiers as untranslatable.**

## 11. Performance

The app must feel instant under **real** load — a 5,000-message transcript, a live
stream, and a busy terminal at once. A fast empty state proves nothing.

- **MUST: Virtualize any list over ~50 items.** `ListView.builder` or
  `SliverList`. **NEVER** a `Column` of all messages inside a `SingleChildScrollView`.
- **MUST: A streaming token must not rebuild the transcript.** The delta updates a
  per-message `ValueNotifier` consumed by a `ValueListenableBuilder` inside that
  one bubble. Routing stream deltas through a list-level provider is the
  performance bug this project is most likely to ship — see §12.
- **MUST: Track and minimize rebuilds** with Flutter DevTools. `const`
  constructors everywhere they apply; `RepaintBoundary` around hot subtrees.
- **MUST: Profile with CPU throttling**, and on a real cold start.
- **MUST: Mutations target <500 ms.** Local SQLite work should be an order of
  magnitude under that.
- **MUST: Explicit dimensions for images and avatars** so nothing shifts on load.
- **MUST: Expensive stateful surfaces stay mounted when hidden.** Visibility is
  not lifecycle — a hidden terminal keeps its scrollback.
- **MUST: Coalesce pointer work per frame.**
- **SHOULD: Decode images at display size** (`cacheWidth`/`cacheHeight`).
- **SHOULD: Prove it with the token-replay fixture** (`tooling/fixtures/token_replay.jsonl`)
  rather than a live model, so performance is measured reproducibly.

## 12. State management — Riverpod

Decided: **Riverpod** (`PLAN.MD` §11).

- **MUST: One provider per concern**, under `app/lib/state/` as mapped.
- **MUST: Keep streaming deltas out of the provider graph.** A `ValueNotifier`
  per in-flight message; the provider learns about the message when it is
  finalized. See §11.
- **MUST: Providers are the only place that talk to the API client.** Widgets
  never construct requests.
- **MUST: Derived state is a provider, not a computation in `build()`.**
- **MUST: `ref.watch` in build, `ref.read` in callbacks.** Never the reverse.
- **Plain `NotifierProvider` / `Provider`, not `riverpod_generator`.** The
  original rationale here was "so provider types are checked rather than inferred
  from strings" — but that only ever applied to the legacy string-keyed APIs.
  Modern plain providers are fully type-checked, so codegen would buy
  boilerplate reduction at the cost of a third build step (after
  `schema-to-dart` and `build_runner`). **NEVER** use the legacy string-keyed
  provider APIs. Revisit codegen if `family` and `autoDispose` combinations start
  getting verbose.
- **NEVER: Put widgets, `BuildContext`, or controllers in provider state.**
- **SHOULD: `autoDispose` by default**; keep alive only where a cache genuinely
  must survive navigation.

## 13. Theming & tokens

- **MUST: All tokens live in one `ThemeExtension`**, resolved for light and dark.
  Mirror Hermes' vocabulary so the two systems stay legible to each other:

| Token group | Members                                                                                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Stroke      | `strokePrimary` … `strokeQuaternary` (descending strength); `strokeTertiary` is the default in-panel hairline; `strokeOverlay` pairs with the overlay shadow |
| Text        | `textPrimary`, `textSecondary`, `textTertiary`                                                                                                               |
| Background  | `bgPrimary` … `bgQuaternary` (`bgQuaternary` = soft control fill); `widgetSurface` for inline chat widgets                                                   |
| Interaction | `actionHover` for quiet controls                                                                                                                             |
| Accent      | `accent`, `accentMuted`                                                                                                                                      |
| Elevation   | `shadowOverlay` (layered contact → ambient), `shadowMenu`                                                                                                    |
| Shape       | `radiusSm/Md/Lg`, concentric — a child radius is never larger than its parent's                                                                              |
| Motion      | `durationInstant`, `durationControl` (~100 ms), `durationSurface`                                                                                            |

- **NEVER: A raw color, shadow, radius, or duration literal in a widget.**
- **MUST: Follow the platform theme by default** (`MediaQuery.platformBrightnessOf`),
  with an explicit override in settings, and theme the native titlebar to match
  the window background.
- **MUST: One icon set.** Pick one (Tabler or Lucide) and re-export it through
  `ui/common/icons.dart` with a size scale. Feature code never imports an icon
  package directly, and a second set is never introduced.
- **SHOULD: Layered shadows** — an ambient layer plus a direct contact layer.
- **SHOULD: Crisp edges** via a semi-transparent border over a shadow.
- **SHOULD: Hue consistency** — tint borders, shadows, and secondary text toward
  the background hue.
- **SHOULD: Avoid gradient banding** on large dark fills.

## 14. Not applicable (web-only rules, recorded deliberately)

These rules from the source doc have no Flutter desktop equivalent. Listed so
nobody wonders whether they were missed:

- Hydration safety, SSR mismatch guards, `defaultValue`/`onChange` pairing — no SSR.
- iOS input zoom (`font-size ≥16px`), `user-scalable`, `touch-action`,
  `-webkit-tap-highlight-color`, `env(safe-area-inset-*)`, pull-to-refresh and
  rubber-band `overscroll-behavior` — no mobile target (`PLAN.MD` §3).
- `<a>` versus `<div onClick>`, Cmd/middle-click, `<title>`, "Skip to content",
  `scroll-margin-top`, `rel=preconnect`, font preload, `font-display: swap` — no
  DOM, no document, fonts are bundled assets.
- `color-scheme` on `<html>`, `<meta name="theme-color">`, native `<select>`
  styling — replaced by §13's theming rules.
- Animated-GIF-versus-`<video>` guidance, Safari H.264 fallbacks, browser-extension
  measurement noise — no browser.

The _principles_ behind the mobile and semantic rules are kept: generous hit
targets (§5), real semantics (§10), and restorable state (§6).

## 15. Before you add something — checklist

Adapted from Hermes' own.

1. Does a primitive already do this? Extend it instead of forking.
2. Is every color, stroke, radius, and duration a token?
3. Does it work entirely from the keyboard, with a visible focus ring?
4. Does `Esc` do exactly one correct thing?
5. Have you designed the empty, sparse, dense, and error states?
6. Does it survive a 5,000-message transcript and a live stream?
7. Does it rebuild only what changed? (Check DevTools, do not guess.)
8. Does it respect reduced motion?
9. Does it have a semantics label, especially if it is icon-only?
10. Does it hold up at 900 px wide and on an ultra-wide display?
11. Does it avoid stealing focus or replacing the foreground on background events?
12. If you changed a primitive, token, or variant — **did you update this file in
    the same change?**

---

**Attribution.** §1, §2, §5's inventory, §7, §8, §9's dual text scales, and §15
closely follow `apps/desktop/DESIGN.md` from
[NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) (MIT).
Adopted because the reasoning is sound and documented.
