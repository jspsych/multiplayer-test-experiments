# Decision register

Every open decision for the first paid Prolific run, with a suggested answer, why, and what it costs
to change your mind later. **All of these are suggestions, not settled calls** — the point of this
file is to make them reviewable in one pass rather than scattered across
[`READINESS.md`](READINESS.md) and issues #3–#13.

Grouped by **when the decision stops being deferrable**, because that is what determines what needs
attention first. Reversal cost is the column to read if you are short on time: cheap ones can be
changed after launch, expensive ones cannot.

---

## A. Before writing code

| # | Decision | Suggested | Why | Reversal cost |
| --- | --- | --- | --- | --- |
| A1 | Which experiment runs first | **C&WG**, not Hawkins | ~25 min vs ~55 min; ~$465 vs ~$1,500 for 20 dyads, and it bounds the survivor-grind failure at 15 min instead of 71 (§5) | Low — Hawkins is a separate file, unchanged |
| A2 | Where phase-1 work lands | **`reference-game-cwg.html` only** | The two files are near-duplicates; back-porting before the pilot means writing every fix twice against assumptions the pilot may invalidate | Low, but rework grows the longer both drift |
| A3 | Does the abort path flush data | **Yes, unconditionally** | The only irreversible bit. Unflushed rows are gone forever; flushed rows can always be ignored. #12 needs them to characterise attrition regardless | **High** — data not saved cannot be recovered |
| A4 | DataPipe save shape | **Per-round chunks**, nonce-suffixed filenames | OSF 409 on a duplicate filename is the one failure path that is *not* retried, so a collision loses that round permanently (§3, #3) | Medium — changes analysis-side reassembly |
| A5 | Screening mechanism | **Prolific's built-in custom screening**, not a two-study design | Fits an external link with branching logic; one funnel instead of two; screen-outs auto-approve and pay | Medium — switching means re-running recruitment |
| A6 | Timeline ordering | consent → short description → exposure item → commitment gate → full instructions → comprehension → lobby | Consent must precede storing screening responses; everything pre-gate counts as paid screening time; instructions must precede the lobby so nobody waits while their partner reads (#13) | Low |
| A7 | Screening exits and codes | **One shared `screened-out` code**, separated in data by `screened_out_reason` | Prolific configures only one screen-out code per study. The two rates answer different questions and must stay separable (#7) | Low if the field exists from the start; high if retrofitted after data collection |

## B. Locked at publish — cannot be changed afterwards

**These are the expensive ones.** Each is fixed when the study goes live.

| # | Decision | Suggested | Why | Reversal cost |
| --- | --- | --- | --- | --- |
| B1 | Participant pay rate | **$15.00/hr** ($6.25 per 25-min session, $8.31 all-in) | Above Prolific's $12.00/hr recommendation. Sustained real-time coordination, no pausing, and attention *is* the measurement. Partly self-funding: better pay → lower dropout → fewer dyads needed, since attrition is multiplicative (§5) | **Cannot change** for a published study |
| B2 | No-match payment | **Full task rate** (~$1.25 for a 5-min wait), not the $0.14/min floor | A floor-rate payment loses to returning the study and taking a short survey, which teaches people to abandon the lobby exactly when we need them to stay. Costs ~$10–15 across a whole run (§4) | **Cannot change** |
| B3 | Screen-out reward | **~$0.14/min of screener length**, measured in the pilot, **rounded up** | Prolific's $0.14 minimum is benchmarked to a one-minute screener, so ~$0.28 at two minutes. Above-norm rewards attract screen-out farmers, who also consume slots | **Cannot change** — round up |
| B4 | `limitSessions` | **Off** | DataPipe's counter increments per *save call*, not per participant, so per-round saving uses 7 sessions per C&WG participant. Sizing it to a participant count caps the run a seventh of the way through and drops every later save silently (§3) | Medium — but the failure it prevents is silent and mid-run |
| B5 | Advertised study duration | Must **include expected lobby wait** | Prolific policy, and it is what the lobby timeout actually sets (§4) | **Cannot change** |
| B6 | Lobby timeout | **~5 min** as a starting point, refined from observed arrival rate | Sets both B2 and B5, so it is not merely a UX number (#6) | **Cannot change** once advertised |
| B7 | Prescreeners | Desktop-only; exclude previous participants from **all** prior runs | A 6×2 grid on a phone is a different task. Tangram tasks have large practice effects, so a repeat participant is contaminated invisibly — and the pilot poisons the pool for the real run if this is not set from the very first launch | **Cannot change** |
| B8 | Screen-out slot limit | Set with headroom against expected screen-out rate | Hitting it **auto-pauses the study** — worst case mid-burst-launch, when simultaneous arrival is the whole ballgame | Medium |

## C. Before the first paid participant — pre-registration

Locked by the pre-registration, not by the code. See §7.

| # | Decision | Suggested | Why | Reversal cost |
| --- | --- | --- | --- | --- |
| C1 | Analysis form | **Mixed-effects, trial as a continuous predictor**, partial dyads included and weighted | The claim is about a curve, not a two-point contrast. Partial dyads then contribute naturally with no exclusion rule | **Cannot change** after pre-registration without disclosure |
| C2 | Minimum usable partial dyad | **2 completed trials** (`ended_by: "submit"` only) | One trial informs only the intercept and contributes nothing to a slope | Same |
| C3 | Robustness check | Completers-only fit, **mandatory not optional** | Dropout is almost certainly not ignorable: dyads that break are plausibly those struggling, i.e. biased toward the high end of the DV | Same |
| C4 | Recruitment target | Power for **completers-only** (the conservative target) | Surplus power is harmless; a shortfall means topping up after seeing data, which is optional stopping | **High** — cannot be fixed after launch without breaking the pre-registration |
| C5 | Sample-size justification | Either a power analysis or an explicit statement that 20 dyads is **resource-constrained** | The 20-dyad figure is currently an assumption carried through the cost model, not a derivation (§7) | Low now, awkward at submission |
| C6 | Staged launch | **Declare it in the pre-registration** as an operational-only check | An undeclared mid-collection pause reads as a peek regardless of intent (#12) | **High** — cannot be declared retroactively |

## D. Before IRB submission

Open questions to put *to* IRB rather than settle unilaterally. See §6.

| # | Question | Suggested position |
| --- | --- | --- |
| D1 | Withdrawal in a dyad | Most likely to come back with revisions. One participant withdrawing takes their partner's data with them, since the transcript is joint and every DV is dyad-level. Decide whether withdrawal deletes the whole dyad or retains the partner's rows — and state it in the consent text before they play |
| D2 | Post-hoc re-consent | **No.** Consent once, up front; withdrawal via the normal route. A post-hoc opt-in is a selection filter biased against exactly the sessions we most want. If IRB prefers it, offer it identically to *everyone*, and log decline rate by exit type |
| D3 | Chat as retained user-generated content | Needs an answer on abuse/self-identifying text and on researcher review before analysis |
| D4 | Display names | Assign neutral labels ("Partner A") rather than free text — cheaper than defending participant-entered PII shown to a stranger |
| D5 | Data transfer | DataPipe → OSF is third-party, likely US-hosted. A GDPR question with a UK/EU pool, and it lands on #3, which is first in the build order |
| D6 | Transcript retention | Decide retention period and whether transcripts can ever be published verbatim or only in aggregate |

---

## Launch checklist

Everything that must be set correctly **at publish time**. Each links to the reasoning rather than
restating it, so there is still one source of explanation.

**Prolific study configuration**

- [ ] Reward set to **$15.00/hr equivalent** for the advertised duration — B1
- [ ] Advertised duration **includes expected lobby wait** — B5
- [ ] Screen-out reward set from **measured** screener length, rounded up — B3
- [ ] Screen-out slot limit set with headroom (hitting it auto-pauses the study) — B8
- [ ] Desktop-only prescreener enabled — B7
- [ ] Previous participants from **all** earlier runs excluded — B7
- [ ] Study description states the partner/waiting arrangement — [`READINESS.md` §4](READINESS.md)
- [ ] Schedule-publish time chosen for a burst launch, not left open — [§4](READINESS.md)
- [ ] Places capped at the **first tranche only** (~3–4 dyads), not the full target — [#12](https://github.com/jspsych/multiplayer-test-experiments/issues/12)

**DataPipe / OSF**

- [ ] `limitSessions` **off** (or sized to *saves*, not participants) — B4
- [ ] Experiment ID present in the study config block, and a test save round-trips
- [ ] Filenames carry a nonce, verified not to collide on a replayed round — A4
- [ ] If `useValidation` is on, `requiredFields` are present on **every** row — [#4](https://github.com/jspsych/multiplayer-test-experiments/issues/4)
- [ ] Pre-registration linked to the same OSF project — [§7](READINESS.md)

**Experiment build**

- [ ] All four completion codes present and matching the Prolific study — [#7](https://github.com/jspsych/multiplayer-test-experiments/issues/7)
- [ ] Lobby copy's stated payment matches the configured amount (templated from one constant, not hardcoded) — B2
- [ ] Save fires on **every** exit path: complete, partner-dropped, no-match, screened-out — [#3](https://github.com/jspsych/multiplayer-test-experiments/issues/3)
- [ ] Redirect never blocks on a save completing — [#5](https://github.com/jspsych/multiplayer-test-experiments/issues/5)
- [ ] `round_timeout` confirmed not to truncate genuine trials — [#12](https://github.com/jspsych/multiplayer-test-experiments/issues/12)

**Governance**

- [ ] IRB approval in hand — [§6](READINESS.md)
- [ ] Pre-registration locked, including the staged-launch declaration — C6
