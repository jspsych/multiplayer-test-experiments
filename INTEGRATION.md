# Hawkins integration build

## Current combined preview — 2026-10-14

`test/hawkins-integration` contains every current open PR head listed below.
`test.jzip` at the repository root is the shared importable JATOS preview, built
with `npm run jzip`. Matcher coordination is enabled by default and DataPipe uses
the existing test experiment `wE2Zlitn0uhu`; JATOS per-round saving also remains
enabled. Coordination mode no longer clears the configured DataPipe ID on this
testing branch. The optional `COORDINATION_PROTOTYPE=1` packaging profile still
produces an isolated archive with DataPipe disabled.

| PR | Included head commit |
| --- | --- |
| #29 | aa0b7fb3e72b2f988193a02c98f302d6e6778b2b |
| #30 | 25817a7762ce5bfa874c628cef471ec32c9e86dd |
| #31 | 61b85e4b41111bd8fa12166429a154ae42fadcc6 |
| #32 | 173cbac7e3cbaeaac03df1fb16c25f0dbd2a5c41 |
| #34 | c47f92aef4f4b656a4aa2ebdc0b7a21a203b28c3 |
| #35 | 3016dcff4d301c1f481a722162b710fbfc8a704e |
| #36 | bd1638ee56722956c16dd91551ee5a302aa3d622 |
| #37 | 56aa191687be80327121bafe6a37a6d21c2e0414 |
| #38 | a7e87a405454b405a2bca60bf280b9a60ff65833 |

The PR #37 merge preserves the newer PR #38 implementations in overlapping
page, analysis, packaging and session-test changes. Its reminder focus behavior
was already present in PR #38 and is retained. All nine heads were checked as
ancestors of the integration branch. This combined configuration is a testing
choice, not authorization to merge the PRs into main.

The archive includes `build-info.json` with its source commit, build time,
packaging profile and SHA-256 hashes of source/assets. The archive commit follows
the source commit recorded inside it. Only `test.jzip` is exempted from the archive
ignore rule; raw participant/test datasets remain outside the commit.

Verification: `npm test` passed all 57 tests, including countdown, coordination
failure saving/routing and archive checks for coordination plus configured DataPipe.
Vendor files were SHA-verified against the pinned public-prototype manifest and
the source patch hash before packaging. All 16 pinned-plugin DOM simulations passed,
covering selection, timeout, phase delays, interruption and multi-round behavior.
These simulations do not run the page's DataPipe upload. No real DataPipe upload or new two-tab
browser/JATOS run has been verified for this combined configuration.

Operator test: import `test.jzip`, use the same JATOS study link for two workers,
complete the 18-round run, and compare both JATOS results and the linked Drive
JSON files. Check shared dyad/round IDs, matched target schedules and terminal
save status. Repeat timeout and interruption checks using fresh workers or a new
import (the archive batch caps total workers at two). Completion codes remain
placeholders. These checks do not establish paid-launch readiness.

## Earlier integration evidence

This branch combines the open PRs for testing. It does not authorize merging them into main.
PR heads fetched and integrated on 2026-10-11:

| PR | Head commit |
| --- | --- |
| #29 pre-game instructions | aa0b7fb3e72b2f988193a02c98f302d6e6778b2b |
| #30 Windows vendor build | 25817a7762ce5bfa874c628cef471ec32c9e86dd |
| #31 DataPipe extension and Google Drive test study | 61b85e4b41111bd8fa12166429a154ae42fadcc6 |
| #32 countdown and Prolific placeholders | 173cbac7e3cbaeaac03df1fb16c25f0dbd2a5c41 |
| #34 comprehension check | c47f92aef4f4b656a4aa2ebdc0b7a21a203b28c3 |
| #35 18-round pilot | 3016dcf (includes the JATOS description correction) |

Integration resolution retains comprehension configuration and data fields alongside
the six-target schedule configuration. DataPipe is configured for `wE2Zlitn0uhu`;
the linked Drive folder is primarily for testing and may be replaced for the main study.

Verification on 2026-10-11:

- All six PR heads are ancestors of the integration commit.
- `npm test`: 35 passed, including archive, comprehension, preparation, schedule,
  terminal routing, Prolific return, and JATOS saving checks.
- Inline HTML script syntax and `git diff --check` passed.
- Every vendor asset matched its SHA-256 in `vendor/manifest.json`; dependency pins
  are unchanged from the integrated PRs.
- Two-tab local browser smoke with the full shared `?mp_session=` URL: both passed
  comprehension, paired, shared the same 18-round/six-target schedule, displayed all
  12 shapes, completed all 18 rounds, and reached completion screens. Every saved
  row retained a shared dyad ID; no browser JavaScript errors occurred.

The automated browser smoke blocked DataPipe network requests to avoid uploading synthetic data
to the real Drive study. Subsequently, the requester completed one integrated JATOS run and
confirmed that the inspected JSON files came from the linked Google Drive folder. The two full
datasets represent one dyad: each has 28 rows, all 18 rounds completed, the same target schedule
and dyad ID, distinct participant IDs, six targets repeated three times, a first-attempt
comprehension pass, and a final `complete` outcome. Two older recovered partial files contain
preparation rows only; their stopping cause is not established. These findings are recorded
on PRs #31, #34, and #35. Raw test data is retained locally and is not committed.

This confirms the successful JATOS gameplay-to-DataPipe-to-Drive path for one integrated dyad;
it does not verify JATOS result-store consistency, manual retry/failure paths, or launch readiness.
The archive uses the existing single-dyad test batch (two workers, group size two)
and placeholder Prolific completion codes. Update and retest when source PRs change.
