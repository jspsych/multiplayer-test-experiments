# Gameplay clarity

The Hawkins round display (`hawkins-ui.js`), ported from PR #40 by @htsukamoto5. It changes only
what participants see. Stimulus geometry, roles, the response gate, deadlines, the three-second
feedback window, scoring and saving are unchanged.

## Round header

Trial progress, number correct and time remaining each have a panel. The timer panel has larger
text and its own background. During the last `CONFIG.TIMER_WARNING_SECONDS` (10 by default) of a
running round it turns amber and says "Less than 10 seconds left". The warning uses the countdown's
own deadline (`CONFIG.ROUND_TIMEOUT_MS` from the round's `on_load`) and clears once the round has a
result.

## Result

Both roles see the round's result under the panels during feedback:

- "Correct!" or "Incorrect." after a choice. The page scores the submitted assignment against the
  round's targets (`Hawkins.submissionResult`), as the plugin scores the saved row, so the message
  always matches the row's `correct` and `round_result`. It never uses the `n_correct` the matcher
  reports.
- "Time's up! …" after a `selection_timeout`, naming who did not act, as before. A timeout is amber,
  not the red of an incorrect choice, and never counts as incorrect.

The number-correct panel starts each round at the count of saved `correct: true` rows (timed-out
rows have `correct: null`). A correct round adds one during feedback. The panel is recomputed from
the saved count on every refresh, so a round is never counted twice.

The role-specific shape highlights are unchanged. Green on the director's screen marks the
matcher's pick, not necessarily the right shape; the walkthrough's "Time, score and progress" step
says so (the role recap that used to explain it is now a one-sentence reminder).

## Chat

The chat has a "Conversation with your partner" heading with an empty-state hint, a "Message your
partner" label, role-specific help, a stronger input border and focus outline, and an emphasized
Send button. The plugin's "You are the …" line is hidden; the prompt already names the role.

The chat sits to the right of the shapes (`chat_position: "beside"`), in a fixed-height column whose
message log scrolls, so a whole round fits a 1280×720 window without the page scrolling. The header
panels are a single compact row for the same reason.

## Not ported

PR #40 was based on the matcher-coordination prototype (#39), which depends on an unmerged
jspsych-multiplayer change. Its coordinated-mode wiring (`hawkins-coordination.js`,
`?coordination=`) is not part of this build. `scripts/smoke-hawkins.mjs` is not ported either: it
hard-codes a Windows Chrome path and the coordination flow.
