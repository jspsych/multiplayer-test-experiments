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
Larger stages are in progress. No 100-pair capacity claim is established yet.
