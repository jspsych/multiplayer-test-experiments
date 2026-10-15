# Interface walkthrough and paired practice

Ported from PR #41 by @htsukamoto5, onto main's connection, barrier, round and exit code.

## Sequence

After pairing, each participant sees:

1. **Role recap** (unchanged).
2. **Interface walkthrough** (`hawkins-onboarding.js`). Seven steps reveal a preview of the game
   screen one part at a time: a blank introduction, the shapes, the chat, the timer, the number
   correct, the round progress, and the complete screen. It uses the real tangram images and the
   round header and chat labels from `hawkins-ui.js`. The chat is disabled, the shapes can't be
   chosen, and no countdown runs. The Director and the Matcher get different explanations, and only
   the Director's preview outlines a target (the first practice target, never a main-game target).
   `CONFIG.INTERFACE_WALKTHROUGH: false` turns it off.
3. **Ready barrier** (flag `ready`). Unchanged except for its time limit and its waiting message,
   below. A failure here is still a no-match exit.
4. **Practice**: `CONFIG.PRACTICE_ROUNDS` paired rounds (default 2). They run the main game's round
   unchanged: same roles, message gate, 60s timer and warning, presence check, `classifyRound`
   fields, deadline witness and "Correct!" / "Incorrect." / "Time's up!" feedback. The header reads
   "Practice: Round 1 of 2" and "Practice correct". `PRACTICE_ROUNDS: 0` turns practice off, along
   with the transition and the second barrier.
5. **Main-game transition** screen: practice is over, the main game has 18 trials, and progress and
   the number correct start again from zero.
6. **Main-game barrier** (flag `ready_for_main`), then the 18 main rounds as before.

The walkthrough comes after pairing because its copy is role-specific. Each partner reads at their
own pace, and the ready barrier lines them up afterwards.

## Practice targets

`Hawkins.phaseSchedules` draws the practice targets from the tangrams the dyad's main schedule
leaves out (six of the twelve with the default config), with the session-seeded
`jsPsych.multiplayer.shuffle` under the key `schedule-practice-targets`, so both partners practice
on the same shapes without any messages. Each practice round has a different target. All twelve
tangrams stay visible, as in the main game. Asking for more practice rounds than there are
unassigned tangrams fails at connect time with `noMatchReason: "schedule_error"` rather than
practicing on main targets. The main schedule itself is unchanged.

This is a deliberate trade-off: practicing on unused targets gives no head start on describing the
main targets, but both partners still learn the interface and the task, and can start building
shared ways of describing shapes.

## Pair barriers

Both barriers share one implementation, `Hawkins.waitForPair`, with main's hardened logic:

- A partner whose presence is `left` ends the wait at once.
- Only the two pair members count, and only while `connected`.
- Unreadable state never counts as ready (fails closed); the deadline bounds the wait.
- On timeout, this side withdraws its flag before leaving.
- Each barrier has its own flag, so a stale `ready` can never release `ready_for_main`.

`CONFIG.READY_TIMEOUT_MS` is now **3 minutes** (was 2), so a slow reader can finish the walkthrough.
While waiting, the screen says what it is waiting for, based on the partner's presence:

| Partner presence | Before practice | Before the main game |
| --- | --- | --- |
| `connected` | "Your partner is still reading the instructions. The game will start as soon as they're done." | "Your partner is still reading. The main game will start as soon as they continue." |
| `away` (dropped, not yet gone) | "Your partner seems to have lost their connection. We're waiting for them to come back." | same |

Each screen also states the limit: before practice, that after 3 minutes the study ends and pays
the no-match amount; before the main game, that it ends with payment unaffected.

A tab reloaded at a barrier withdraws both flags as soon as it reconnects, so its partner can't
start on a flag left from before the reload.

## Exits

| Where | What happened | Exit (`ended_reason`) | Code |
| --- | --- | --- | --- |
| Ready barrier | partner left | `no_match` (`partner_left_before_start`) | `no_match` |
| Ready barrier | timeout | `no_match` (`partner_not_ready`) | `no_match` |
| Practice round | partner left / own connection lost | `partner_left` / `connection_lost` | `partner_dropped` |
| Main-game barrier | partner left | `partner_left` | `partner_dropped` |
| Main-game barrier | timeout | `partner_not_ready_for_main` | `partner_dropped` |

The two main-game barrier exits pay `partner_dropped`, not `no_match`. By then the pair was
matched and has played together. The participant has spent the instructions, the lobby, the
walkthrough and two practice rounds, far longer than the lobby wait the no-match payment covers,
and was stranded by their partner, as in a game that ends part-way. The no-match copy ("We could
not match you with a partner") would also be untrue.

The wording follows what happened. A partner who left gets the partner-left message, never "We lost
the connection to the game", which describes this participant's own connection. A timeout gets a
neutral message ("We couldn't start the main game together"). Any exit during practice or at the
main-game barrier says "This happened before the main game started" instead of "You completed 0 of
18 rounds together". An interruption during practice skips the transition, the barrier and the main
game.

## Saved data

Every game row has:

- `phase`: `"practice"` or `"main"`.
- `phase_round`: the zero-based index within that phase.
- `round`: unchanged for main rounds (0–17). Practice rounds count up to -1, so with two they are
  -2 and -1. The plugin seeds each round's layouts with `round` and tags its chat messages with it,
  so `round` must be unique. Negative IDs can never collide with a main round, and sorting by
  `round` still gives play order. Main-game analysis can keep using `round`, or filter on
  `phase === "main"`.

New session-level fields (on every row): `config_interface_walkthrough`, `config_practice_rounds`,
`config_ready_timeout_ms`, `practice_target_ids` (in play order), and at the end
`n_practice_played` and `interrupted_phase` (`"practice"`, `"main_ready"`, `"main"` or null).

`n_trials_completed`, `n_trials_timed_out`, `n_trials_played`, `blocks_completed`, the in-game
progress and score, and the terminal screen's counts include main-game rows only.

The walkthrough row's `value` has `instruction_screen: "interface_walkthrough"`, `walkthrough_role`,
`walkthrough_steps` (each step's name and `duration_ms`) and `rt`. The main-game transition is
`instruction_screen: "main_transition"`. The barriers' `value`s are `{ waiting_ready, ready_wait_ms }`
and `{ waiting_ready_for_main, ready_wait_ms }`, with `waiting_ready_for_main` one of `matched`,
`partner_left` or `timeout`.

## Time and payment

The walkthrough, two timed practice rounds (up to 2 × 60s plus 3s of feedback each), the transition
screen and up to two barrier waits (each now up to 3 minutes) add to the session. The advertised
duration and the reward (DECISIONS.md B1, B5) need to include that time.
