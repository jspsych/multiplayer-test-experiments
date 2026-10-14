# Interface walkthrough and paired practice

This review packet builds on gameplay clarity. After role assignment and recap,
each participant clicks through a seven-step preview: blank introduction, shapes,
chat, timer, score, round progress, and the complete interface. It uses the actual
shape assets and shared status/chat presentation. Inputs are disabled, choices are
unavailable, and no round countdown runs. Director and matcher explanations differ.
Step durations and the participant's role are saved. `CONFIG.INTERFACE_WALKTHROUGH`
can disable the preview.

Both partners then pass the existing readiness barrier and play
`CONFIG.PRACTICE_ROUNDS` paired rounds (default two). A shared shuffle selects
distinct targets from the shapes excluded from the dyad's main schedule. All
twelve shapes remain visible. Practice uses the same roles, message gate, timing,
layouts, presence reminder, coordination and feedback as main gameplay. It is
saved through the existing JATOS and configured Pipe paths; practice rows are
retained rather than discarded. The isolated coordination packet still disables
DataPipe; this PR does not change that policy or the integration preview.

Main gameplay starts after a separate transition and bounded shared readiness
barrier using `ready_for_main`. Earlier ready flags cannot release it. A partner
departure or readiness deadline ends the session through existing neutral
connection-loss routing and saving. An interruption during practice skips all
main-game nodes. Reload handling is unchanged.

Every game row saves `phase` (`practice` or `main`) and zero-based `phase_round`.
`round` is the unique protocol index across both phases: practice 0–1, main 2–19
with default configuration. `main_round` is 0–17 on main rows and null for practice.
Existing terminal counts, block progress, score and 18-trial schedule summaries
count main rows only. `n_practice_played`, `practice_target_ids`,
`config_practice_rounds` and `interrupted_phase` make practice exposure visible.
Practice score and progress reset for main gameplay.

This is an intentional study-design adaptation: unused targets reduce direct
target-description practice for the main set, but both partners still learn the
task and can develop shared language. Two timed rounds add up to two minutes plus
six seconds of feedback, walkthrough/transition reading and readiness waiting.
Recruitment time and payment estimates need to include that time. The main target
schedule remains unchanged; practice can be disabled by setting its count to zero.
Configurations requesting more practice targets than the excluded set fail
explicitly rather than silently practising main targets.

Verification covers excluded/shared targets, unique round IDs, main-only terminal
counts, a bounded main-readiness barrier, and skipping main after practice
interruption. A full shared-session two-tab Chrome smoke checks walkthrough
completion, two practice plus 18 main rows, progress/score for every round, separate
counts, and normal completion. Real JATOS failure paths and saving destinations
remain separate operator checks. No update to `test/hawkins-integration` or its
root `test.jzip` is part of this packet.

`npm test`: 66 passed. The coordinated Chrome run completed two practice and
18 main rounds on both clients with correct progress and score reset. A second
run exercised a wrong practice choice and a full 60-second practice timeout:
both clients displayed the timer warning and neutral timeout feedback, retained
null timeout scoring, and subsequently completed the main game. Browser results
also include a full two-practice/18-main completion in uncoordinated comparison
mode, with explicit result messages and progress/score checks. These artifacts
and screenshots remain under ignored `.build/smoke-*`; they are local simulation
evidence, not JATOS or Drive upload evidence.
