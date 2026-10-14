# Gameplay clarity review packet

Trial progress, number correct and time remaining have separate panels. The timer
uses larger text, a distinct background and an explicit warning during the last
`CONFIG.TIMER_WARNING_SECONDS` (10 by default). Coordinated countdowns retain
their approximate wording; no protocol clock or deadline is changed.

Both roles see explicit Correct/Incorrect feedback during the existing three-second
feedback window. Timeouts say that no choice was made and never appear as incorrect.
The cumulative display includes the current accepted correct choice without counting
repeated state notifications twice. Existing role-specific shape highlights remain.

Chat has a persistent label, role-specific help, a stronger input border/focus outline,
and an emphasized Send button. The message history has its own persistent
"Conversation with your partner" heading and an empty-state hint that disappears
as soon as messages arrive. A shared presentation helper is packaged into JATOS.
No stimulus geometry, response gate, transport, saving or study schedule is changed.

Verification: 60 repository tests passed. A fresh two-tab headless Chrome session
using the full identical `?coordination=matcher&mp_session=…` URL completed all
18 rounds with both roles and no JavaScript exceptions; screenshots and both
datasets were retained under ignored `.build/smoke-*`. DataPipe remains disabled
in the isolated review prototype. Real JATOS verification remains separate.

This explicit result wording and greater timing salience are intentional presentation
adaptations. This branch is a review packet based on the restored coordination PR,
not a request to merge into the integration preview or main.
