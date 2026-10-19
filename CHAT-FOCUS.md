# Director chat focus

Each Hawkins practice and main round calls `HawkinsUI.focusDirectorChat` from `on_load`,
after the chat labels are installed. It focuses the Director's enabled input once, with
`preventScroll`, and leaves the Matcher alone. Subsequent chat updates do not reclaim focus.
If the input is initially disabled, a MutationObserver waits for it to become enabled;
`on_finish` disconnects any pending observer. Missing chat is a no-op.

## Lifecycle and upstream direction

The study pins multiplayer commit `f6b359e30b45cd1edf3a28cfcb7bafc665b818ef`.
Its reference-game `trial()` is synchronous and calls `updateChatAvailability()` before
returning. The pinned jsPsych preview calls `on_load` after that return. Thus `on_load`
is late enough for this build; focusing in `on_start` or relying on an HTML autofocus
attribute would not express the enabled-input requirement. The observer also accommodates
a future plugin that holds the input disabled while coordinating round readiness.

A reusable API should live in `plugin-multiplayer-reference-game`: an opt-in boolean
`chat_autofocus` (default false), resolved per trial, so a study can enable it dynamically
for the Director. The plugin should focus once when the round is ready and sending is
allowed, after updating disabled state, and cancel pending work on trial end. Feedback,
message-cap changes and incoming messages should never reclaim focus. The standalone
chat plugin could adopt the same parameter and semantics. A shared utility is useful
only if those implementations actually share lifecycle code. This study change avoids
requiring a new upstream pin or changing other studies' keyboard behavior.

## Two-tab smoke check

Build the pinned assets with `npm run vendor`, serve this checkout, and open
`http://127.0.0.1:8123/reference-game-hawkins.html?mp_session=director-focus-20261019`
in two tabs. Use a fresh session value if repeating the test.

1. Complete instructions, comprehension checks, role recap and walkthrough in both tabs.
2. Keep the Director tab active when the first practice round starts. Type a description
   immediately without clicking the input, then press Enter. Confirm it reaches the Matcher.
3. Select a shape in the Matcher tab, then return to the Director during feedback. When
   the next round opens, type without clicking again. Repeat across both practice rounds
   and at least three main rounds, including the practice-to-main readiness barrier.
4. Confirm the Matcher can click shapes normally, chat remains disabled during feedback,
   and incoming messages do not pull focus back after the Director deliberately focuses
   another control during a round.

Browser verification is pending until an operator runs these steps. The automated helper
tests cover immediate and delayed enablement, repeated rounds, one-time focus, Matcher
exclusion, detached inputs and cancellation; they do not replace this browser check.
