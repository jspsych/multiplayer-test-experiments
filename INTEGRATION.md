# Hawkins integration build

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
