# MindProbe automated load test — DO NOT MERGE

This branch is disposable test tooling and evidence, never intended for merging.
The experiment and archive are unchanged. Do not open a merge-targeted PR.

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
Pairing p95 was 3,708 ms; runner peak CPU was 71.1%, minimum available memory
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

In the repeat, participants 1 and 6 joined the same JATOS group (2148), both
passed comprehension and preparation, then both saved a `multiplayer-role`
timeout with null roles. Their terminal reason is `no_match` / `pairing_timeout`,
with zero gameplay rounds. Both saved the exit successfully; no HTTP or console
errors were captured for those clients. This is an observed role-assignment
failure, not proof of server saturation. All other started clients were allowed to drain.

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

| Pairs | Gameplay completed | Confirmed saves | Peak gameplay clients | Duration (s) | Pairing p95 (ms) | Min free GiB | Peak CPU % | HTTP / JS errors | Result |
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
