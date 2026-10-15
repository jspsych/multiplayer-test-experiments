# MindProbe automated load test — DO NOT MERGE

This branch is disposable test tooling and evidence, never intended for merging.
The experiment and archive are unchanged. Do not open a merge-targeted PR.

## Reader overview

This test asks whether the current Hawkins reference-game study can support 100
simultaneous pairs (200 participants) through its real hosted participant link.
It is an end-to-end pipeline test, not a benchmark of bare JATOS software.

The 1- and 2-pair checks passed. Two 10-pair attempts exposed final-upload failures
and, on the repeat, a dyad that failed before gameplay. We stopped at that point.
The evidence does **not** show that JATOS is limited to ten pairs, nor that every
failed save acknowledgement means data was lost. No real participants were recruited.

The systems have different responsibilities:

| System | Responsibility in this test | What was observed |
| --- | --- | --- |
| Playwright / local Chrome | Simulates participants and collects browser evidence | No sustained resource-stop trigger; first runner had an interruption flaw, disclosed below |
| MindProbe / JATOS | Hosts the experiment, groups participants, transports multiplayer state, stores JATOS results | Twenty clients played simultaneously in the first 10-pair run; a later dyad failed during preparation/role assignment; no captured JATOS HTTP errors |
| Study / multiplayer adapter and plugins | Coordinates preparation, assigns director/matcher roles, manages trials and exit routes | One dyad took inconsistent preparation/role paths; cause unproven |
| DataPipe (`pipe.jspsych.org`) | Stages trial data and handles the separate final upload to the configured test destination | Repeated final-upload errors; one explicit metadata contention response |
| Storage provider / result dashboards | Holds independently inspectable persisted results | Not read back during this test; JATOS exports and DataPipe/storage checks remain necessary |

Each **dyad** is a pair of participants. The **director** sees the target shape;
the **matcher** receives the director's chat description and selects a shape.
The live build used two practice rounds plus 18 main rounds. A gameplay completion
and an accepted final save are separate outcomes. The page combines JATOS and
DataPipe save results into one final message, so a failed DataPipe save can produce
an unsuccessful save message even when JATOS has not reported an error.
This behavior is implemented by `showTerminalScreen` in
[`reference-game-hawkins.html`](reference-game-hawkins.html) and
`combineSaveResults` in [`hawkins.js`](hawkins.js).

Authorized progression: 1–2, 10, 25, 50, 100 concurrent pairs, stopping on failures
or runner resource pressure. Actual executed stages and findings are recorded below.
The user confirmed batch caps of 1,000 total workers, two total group members,
and two active group members. Operator agreement is not an established prerequisite.

## Method

Playwright drives installed Chrome headlessly, one isolated context per participant,
at most 20 contexts per browser process. It uses the actual participant link and
normal instructions, quiz, walkthrough, chat and selection interfaces. It does not
change experiment settings, timers, adapters, network responses or saving logic.
Synthetic Prolific IDs start with `load-`; no Prolific completion links are clicked.
Actual JATOS pairing determines partners; launch order is not assumed to do so.
Director messages identify targets; matchers read received messages before clicking.
Short pauses emulate activity but cannot reproduce human behavior or diverse networks.

Install tooling: `npm install --prefix .build/load-tools --no-audit --no-fund --package-lock=false playwright`.
Set `STUDY_URL` to the authorized General Multiple link and `PAIRS` to a stage size,
then run `node scripts/load-mindprobe.mjs`. Each invocation runs one stage only.
Raw data, failure screenshots, events, metadata and summaries stay in ignored
`.build/load-*` directories; do not commit participant datasets or browser profiles.

The runner checks completion, save acknowledgement, HTTP/JavaScript errors, dyad
membership, 20 gameplay rounds (two practice, 18 main), and matching target schedules.
A client save acknowledgement is not independent JATOS/DataPipe result-store readback.
Independent exported results remain necessary to verify persisted data.

### Reproduction prerequisites and commands

Use this branch, a dedicated test study/batch, installed Google Chrome, Node.js,
and permission to generate synthetic traffic to the supplied MindProbe study.
The entry link must support repeated runs (General Multiple). Keep the study's
group setting enabled and use the confirmed batch caps above. Leave the deployed
study and its saving configuration unchanged when reproducing the integrated case.
The configured DataPipe test experiment in this checkout is `wE2Zlitn0uhu`.
The participant-link token is intentionally omitted from this public report.

```powershell
npm install --prefix .build/load-tools --no-audit --no-fund --package-lock=false playwright@1.64.1
$env:STUDY_URL = '<authorized MindProbe General Multiple participant link>'
$env:PAIRS = '1'
node scripts/load-mindprobe.mjs
# Inspect the new .build/load-*/summary.json before increasing PAIRS.
node scripts/summarize-mindprobe-load.mjs
```

For an approved progression after the failures are addressed, the stage driver is
`node scripts/run-mindprobe-load-stages.mjs`; it defaults to 2, 10, 25, 50, 100 pairs
and halts on a failing stage. Do not use it to skip investigating the failures here.
The runner opens a real browser context for each participant, fills the actual
quiz, advances the actual walkthrough, sends chat through the UI and clicks the
actual matcher target after reading the received message. There is no LLM in the
participant loop and no programmatic injection of trial results.

The tested environment was Windows, Node 24.13.0, Playwright 1.64.1, Chrome
155.0.8059.79, eight logical CPUs, and approximately 32 GiB total physical memory.
CPU percentages sample the whole host at ten-second intervals; event-loop delay
samples Node's timer, not each browser renderer or the server. Three consecutive
samples with less than 2 GiB available memory, more than 95% host CPU, or more than
five seconds of timer delay cause a resource stop. None occurred in these runs.

The local vendor manifest identifies multiplayer source
`193f95ca2df494692219c0616d6448a52f39013f`, jsPsych preview
`1e77da41966f22832ee0d133d137d81b3e50639a`, the
[`public-result-context.patch`](patches/public-result-context.patch), and Pipe
extension 0.2.0. These identify the local expected build, not an independently
verified hash of the hosted assets. MindProbe's server version/configuration and
server resource metrics were not available through the participant link.

## Findings

Study baseline: integration source `aeae8ea20777d80f269fbad0104fa3d47dee5a59`.
Live assets were not independently compared against that commit; browser data
confirms the two-practice/18-main schedule. The baseline identifies this checkout,
not a cryptographically verified remote deployment.

| Stage | UTC start | Completed | Duration | Findings |
| --- | --- | --- | --- | --- |
| 1 pair | 2026-10-15 02:07:41 | 2/2 | 233.1 s | Both saved; matching 20-round target sequences; zero HTTP/JS errors; no timeouts in participant 0's data. |

First run evidence: `.build/load-2026-10-15T02-07-41-604Z-1pairs/`.
This first run predates the added CPU/event-loop/request-latency instrumentation;
console samples reported approximately 16.6–17.4 GiB available memory.
All 68 repository tests passed during preparation; runner scripts pass Node syntax checks.
Escalation stopped at 10 pairs. No 100-pair capacity claim is established.

### First 10-pair stop

All 20 clients completed 20 correct gameplay rounds, with matching dyad schedules
and no saved coordination failures. Peak simultaneous gameplay clients was 20.
Group/session ID observation p95 was 3,708 ms; runner peak CPU was 71.1%, minimum available memory
13.52 GiB, and maximum sampled Node event-loop delay 16 ms.

Participant 3 reached the terminal with `ended_reason: complete` but an unsuccessful
final save message. Its DataPipe `/api/data/` request failed with `net::ERR_FAILED`.
Participant 13 also recorded HTTP 400 from DataPipe `/api/data/`; the response body
was not captured by the initial runner. No HTTP errors were recorded against JATOS.
These observations do not identify the underlying cause or prove a service capacity limit.

The initial runner stopped and closed other contexts at the first save failure.
Eight clients confirmed saving; one confirmed a failed final save; eleven were
stopped by the runner while saving. The latter are **test-induced interruptions**,
not eleven additional demonstrated service failures. All client datasets were retained.
The runner now stops escalation/new arrivals on failure while letting already-started
clients finish, and captures console errors plus HTTP error response bodies.
A diagnostic 10-pair repeat completed; 25/50/100 have not been attempted.

In the repeat, participants 1 and 6 joined the same JATOS group (2148) and passed
comprehension, but followed different preparation paths. Participant 1 passed
preparation and later timed out in `multiplayer-role`; participant 6 remained in
preparation and exited with `partner_left_before_start`, without entering the role
trial. Both ended as `no_match`, with zero gameplay rounds, and saved their exits.
No HTTP or console errors were captured for those clients. This is an observed
preparation/role-assignment failure, not proof of server saturation. All other
started clients were allowed to drain. Earlier progress updates that described
both clients as role timeouts were incorrect; this account follows the retained rows.

### Diagnostic repeat: final results

The repeat took 326.1 seconds. Nine dyads (18 participants) completed all 20 correct
rounds, with matching within-dyad target sequences; the remaining dyad exited
before gameplay as described above. Eleven clients confirmed saving: nine completed
games and the two no-match exits. Nine completed-game clients reported failed final
uploads, without runner-induced cancellations in this repeat:

- Eight DataPipe `/api/data/` requests failed with `net::ERR_FAILED`; browser console
  messages say the response lacked `Access-Control-Allow-Origin`. This observation
  alone cannot distinguish an upstream timeout/error response from a CORS setup issue.
- Participant 19 received HTTP 400 with response body:
  `{"success":false,"error":"METADATA_ERROR","message":"10 ABORTED: Too much contention on these documents. Please try again.","metadataMessage":"Metadata is in the storage provider and in Firestore"}`.
  This identifies a DataPipe metadata contention error for that request, not the
  root cause of every other failed request or proof of lost underlying result data.
- No JATOS HTTP failures or uncaught page JavaScript exceptions were captured.
  Some other clients logged `Can send only one group session patch at a time`.
  This warrants adapter/study investigation, but does not establish the cause of
  the role timeout (the two clients with that timeout had no captured console errors).
- Runner minimum available memory was 16.94 GiB, peak sampled host CPU 72.9%, and
  maximum sampled Node event-loop delay 51 ms. There was no resource-stop trigger.

The [DataPipe API reference](https://pipe.jspsych.org/docs/api) documents multiple
rejection reasons; HTTP status alone is insufficient to diagnose them. The captured
response body above is the primary evidence for the metadata failure.

### Failure case A: final DataPipe uploads

**Expected:** after gameplay finishes, both configured saving destinations accept
the completed dataset and the participant sees `Your responses have been saved.`
**Actual:** several completed games instead show `The final upload was not accepted.`
The full participant-facing message says trials may be recoverable and asks the
participant to submit anyway and contact the researcher. This is an acknowledgement
failure; it is not independent proof of absent JATOS or storage-provider files.

The strongest captured case is participant 19 in the repeat. The HTTP response
explicitly identifies `METADATA_ERROR` and document contention. It does not say
that MindProbe ran out of CPU, that the participant's filename was duplicated,
or that every failed request had the same underlying cause. Eight other failed
requests produced browser-level network/CORS errors without a readable HTTP error
body. A response generated by upstream error handling can also lack CORS headers;
changing browser security or disabling CORS would invalidate this participant test.

All rows in the following table refer to the repeat run
`load-2026-10-15T02-24-06-277Z-10pairs`:

| Runner participant index | Saved multiplayer participant ID | Dyad ID | Final result |
| --- | --- | --- | --- |
| 4 | 1271170 | 2147 | Gameplay complete; DataPipe network/CORS failure |
| 5 | 1271175 | 2149 | Gameplay complete; DataPipe network/CORS failure |
| 7 | 1271177 | 2151 | Gameplay complete; DataPipe network/CORS failure |
| 8 | 1271178 | 2149 | Gameplay complete; DataPipe network/CORS failure |
| 9 | 1271179 | 2150 | Gameplay complete; DataPipe network/CORS failure |
| 10 | 1271180 | 2150 | Gameplay complete; DataPipe network/CORS failure |
| 15 | 1271185 | 2153 | Gameplay complete; DataPipe network/CORS failure |
| 18 | 1271188 | 2155 | Gameplay complete; DataPipe network/CORS failure |
| 19 | 1271189 | 2155 | Gameplay complete; DataPipe HTTP 400 / METADATA_ERROR |

For each row, inspect `participant-<index>.json`: `httpFailures`, `consoleErrors`,
`terminal`, `rows`, `uploads`, and `requestDurations`. Failed requests are absent
from completed-request latency percentiles, which therefore understate the tail
when failures occur. The repeat's completed non-GET DataPipe requests had a p95
of 56.6 seconds versus approximately 282 ms for completed non-GET JATOS requests.
These aggregate different endpoints; they do not measure chat-delivery latency
or prove which operation caused a delay.

Next evidence to obtain is the DataPipe dashboard's per-request error/queue state,
metadata configuration, and destination files for the synthetic IDs. Compare both
partners' files with JATOS exports. A destination file may exist despite an error
acknowledgement; inspect contents and identifiers, not just file counts. Do not
blindly retry submissions or turn off metadata before preserving the original evidence.

### Failure case B: preparation and role assignment diverged

**Expected:** both members of a filled dyad pass preparation, acquire complementary
director/matcher roles, and enter the walkthrough and practice rounds.
**Actual:** dyad 2148 had no gameplay. Both clients saw the same two group members,
but only one proceeded from preparation into the role-assignment plugin.

These are excerpts of saved trial values, with times measured from each client's
own jsPsych start. They are not synchronized cross-client event timestamps:

| Step | Index 1 / multiplayer participant 1271171 | Index 6 / multiplayer participant 1271176 |
| --- | --- | --- |
| Quiz | Passed on first attempt | Passed on first attempt |
| Lobby | `waiting_room: matched`; members `[1271171,1271176]`; `time_elapsed: 2760` ms | Same members and status; `time_elapsed: 2009` ms |
| Preparation | `preparation_result: prepared`; wait 515 ms; `time_elapsed: 3276` ms | `preparation_result: partner_left_before_start`; wait 28,517 ms; `time_elapsed: 30528` ms |
| Role trial | `multiplayer_outcome: timeout`; `role: null`; `role_map: null`; `time_elapsed: 33289` ms | No `multiplayer-role` row; role assignment was skipped |
| Final outcome | `ended_reason: no_match`; `no_match_reason: pairing_timeout` | `ended_reason: no_match`; `no_match_reason: partner_left_before_start` |
| Saving | Success message observed | Success message observed |

The local page's `preparationBarrier` polls session-scoped `prepared` state and
presence every 500 ms, allows continuation only when both members appear connected
and prepared, and exits if a member appears `left`. Its configured preparation
timeout is five minutes, whereas role assignment has a 30-second timeout. The
observed 30-second role timeout and 28.5-second preparation wait are distinct
paths; this was not a five-minute preparation timeout.

A plausible hypothesis is asymmetric visibility of preparation state or a
membership/presence race, followed by one client's timeout/disconnection affecting
the other. This remains a hypothesis: the runner did not capture session-state
snapshots or WebSocket frames at those transitions, so causality and event ordering
cannot be reconstructed from these rows alone. No injected disconnection, reload,
or intentional participant closure was used for this dyad. The repeat's runner
allowed clients to finish after the first failure.

For a targeted reproduction, retain fast and staggered onboarding variants and
capture each client's session-scoped preparation state, member list, presence,
role-plugin entry/exit, and adapter group-session writes with monotonic timestamps.
Inspect update acknowledgement/serialization behavior against the pinned adapter
source before changing the experiment. The `Can send only one group session patch
at a time` messages elsewhere in the repeat are an investigation lead, not evidence
that those exact warnings caused this dyad's failure.

Saved outcome properties are attached to all rows by the page's final
`recordOutcome` call. Seeing `ended_reason: no_match` on a preload or quiz row does
not mean that trial itself exited early; inspect the row-specific `value` and the
terminal row when reconstructing this sequence.

### Disposition and next checks

The authorized progression stopped on reproduced failures. No 25-, 50-, or 100-pair
run was started. This result establishes problems in the tested integrated pipeline,
not a numerical maximum concurrency for JATOS or MindProbe.

Before resuming escalation, inspect DataPipe's dashboard/metadata settings and saved
files for the synthetic IDs, investigate the role-assignment timeout against the
pinned adapter/plugin, and independently export JATOS results. A separate JATOS-only
deployment could isolate saving services, but was not created or substituted here.
Preserve the original failed cases and distinguish dashboard/readback evidence from
client acknowledgements. Do not infer that failed acknowledgements prove data loss.

Raw synthetic data and failure screenshots remain locally under `.build/load-*`.
Only the runner, summary generator and this report are committed on the dedicated
do-not-merge branch; experiment source and `test.jzip` were not changed.

### Evidence access and interpretation

The four run-directory names in the generated section identify independent runs;
the two 10-pair rows are separate attempts, not a single 20-pair test. All directory
timestamps use UTC (the tests occurred on the evening of October 14 in Indiana).
There were 46 synthetic participant starts across all four attempts. Retained
client datasets show 44 gameplay completions; the two remaining clients are the
no-match dyad. Across all starts, 25 clients confirmed saving, ten showed failed
final-save acknowledgements, and eleven had saving interrupted by the initial
runner. The latter eleven must not be counted as demonstrated service failures.

For run directory `R`, the exact synthetic ID stored in `prolific_pid` is
`R-<runner participant index>`, `study_id` is `synthetic-load-test`, and the injected
Prolific-style `session_id` is `R`. These are test labels, not actual Prolific
accounts or submission sessions. `multiplayer_session_id` is the separate JATOS
dyad identifier and is the field to use for pairing saved rows.

Each local run has `summary.json`, `metadata.json`, `events.jsonl`, one
`participant-<index>.json` per client, and screenshots for failures. The participant
files contain the retained client dataset and network observations. `events.jsonl`
records group-ID observation and round entry, not complete WebSocket traffic.
`summary.json` is written after cleanup and is the authoritative run summary;
the initial `metadata.json` can lack fields collected later, such as browser version.
The generated table recalculates gameplay and save counts from participant files
because the runner's legacy `completed` counter also includes completed games whose
save acknowledgement failed.

The raw artifacts are ignored local files and are **not available to a reviewer
from a branch checkout alone**. This report includes selected observed values and
summary hashes so the original operator can supply the matching artifacts for
independent inspection. A hash identifies an artifact; it does not substitute for
access to it. No JATOS admin credentials, participant-link token, browser profiles,
or full datasets are published here.

The run summaries record a runner-source SHA-256 and the repository commit at launch.
Runner instrumentation evolved between attempts, and uncommitted runner changes
were present during some runs. Do not assume the recorded repository commit alone
reconstructs the exact runner; compare its recorded source hash. The first run did
not record a runner hash. This is a limitation of reproducibility, not evidence of a
change to the hosted study.

All clients originate from this machine/network. Shared-IP behavior, DataPipe,
browser/client resources, the study code and MindProbe are separate possible
contributors. Current evidence cannot attribute the failed upload to JATOS.

The raw summary's `pairingMs` measures when the runner first observes a JATOS
group/session ID; it does not measure successful completion of role assignment.
Onboarding is clicked quickly, arrivals are staggered approximately 200 ms, and
rounds use short scripted messages with 3–5 seconds before description/selection
plus normal experiment feedback. This is a short active-workload check, not a
full human-duration soak or a geographically distributed browser/network sample.

## Executed stages (generated from local artifacts)

| Pairs | Gameplay completed | Confirmed saves | Peak gameplay clients | Duration (s) | Group ID observed p95 (ms) | Min free GiB | Peak CPU % | HTTP / JS errors | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 2/2 | 2/2 | not sampled | 233.1 | not sampled | not sampled | not sampled | 0 / 0 | PASS (client evidence) |
| 2 | 4/4 | 4/4 | not sampled | 281.9 | 3006 | 15.96 | 40.5 | 0 / 0 | PASS (client evidence) |
| 10 | 20/20 | 8/20 | 20 | 284.3 | 3708 | 13.52 | 71.1 | 2 / 0 | STOP / investigate |
| 10 | 18/20 | 11/20 | 18 | 326.1 | 5031 | 16.94 | 72.9 | 9 / 0 | STOP / investigate |

- `load-2026-10-15T02-07-41-604Z-1pairs`: summary SHA-256 `a3f90041789b3b75138657894168b69d56e62dbfdac0acb11faec229464afb83`; runner SHA-256 `not recorded in first run`; source commit `aeae8ea20777d80f269fbad0104fa3d47dee5a59`.
- `load-2026-10-15T02-12-53-402Z-2pairs`: summary SHA-256 `bc5d66da1a8e0b03a94a25f541f7ef652bda9012cd9636ee8cbd056f3edae5cd`; runner SHA-256 `de59da01da4d5517426a31fde5b456cf6595a16e771396fb9b8c685729895adb`; source commit `aeae8ea20777d80f269fbad0104fa3d47dee5a59`.
  jatos.mindprobe.eu: 114 completed non-GET requests; p95 duration 284.9 ms (mixed endpoints, not message delivery latency).
  pipe.jspsych.org: 8 completed non-GET requests; p95 duration 26539.7 ms (mixed endpoints, not message delivery latency).
- `load-2026-10-15T02-17-55-809Z-10pairs`: summary SHA-256 `4816a191529283ad2590402a82cf07821b2211aafd40c45714383cd125e8c83e`; runner SHA-256 `fb09ab53790f7d12c7d0372b09711a6ebbfc060582c28f518359f0d902965bf1`; source commit `9c677b204dd141b043d67d9fa83c451464049663`.
  jatos.mindprobe.eu: 567 completed non-GET requests; p95 duration 287.7 ms (mixed endpoints, not message delivery latency).
  pipe.jspsych.org: 29 completed non-GET requests; p95 duration 48101.0 ms (mixed endpoints, not message delivery latency).
- `load-2026-10-15T02-24-06-277Z-10pairs`: summary SHA-256 `56caf81c4bed834e5d883e2ed099820e5ab3d80d1bdb12e9f1cffe56f08eda1f`; runner SHA-256 `69f64c62b8ab975126c40d5d344244d0d10ee391946baffbb989af099e5cb3a7`; source commit `9c677b204dd141b043d67d9fa83c451464049663`.
  Additional audit findings: [{"participant":1,"issue":"round counts"},{"participant":6,"issue":"round counts"}].
  jatos.mindprobe.eu: 533 completed non-GET requests; p95 duration 281.7 ms (mixed endpoints, not message delivery latency).
  pipe.jspsych.org: 32 completed non-GET requests; p95 duration 56641.3 ms (mixed endpoints, not message delivery latency).
