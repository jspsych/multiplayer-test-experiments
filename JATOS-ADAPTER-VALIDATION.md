# JATOS adapter validation record

Status: **validated at the adapter boundary; C&WG integration not yet validated.**

This is the repository-side record of the live validation of
[`jspsych/jspsych-multiplayer` PR #88](https://github.com/jspsych/jspsych-multiplayer/pull/88).
It is deliberately more than a link to the upstream PR: C&WG relies on the observed lifecycle
ordering below, so the evidence and its limits need to travel with the study integration work.

## Scope and evidence

The probe was a direct adapter-only JATOS group study. It did **not** load jsPsych core,
multiplayer plugins, or either reference-game build. Therefore it establishes the adapter's
group/presence behavior, but not compatibility with the C&WG timeline.

The live probe observed:

- A and B received the same JATOS group ID.
- Every presence-event snapshot matched an independent `getPresence()` read.
- Either participant could seal the group.
- Once sealed, A's departure did not allow C to replace A in B's group; C was placed in a new
  group instead.
- Explicit disconnect completed in order: local disconnect, then left group, then promise
  resolution.
- On a member departure, the remaining peer received `member-leave` before `member-close`.
  In that interval the leaver was absent from assigned membership but still appeared in open
  channels.

The upstream PR documents this ordering and has 44 passing adapter tests at the time of this
record. The live probe and those upstream tests are the evidence for the claims above; a passing
C&WG structural test must not be represented as equivalent evidence.

## C&WG integration contract

The C&WG integration must:

1. derive both `dyad_id` and the deterministic schedule seed from the shared JATOS group ID;
2. wait for two *assigned live members*, then seal successfully before role assignment;
3. treat membership and leave events as authoritative for admission and departure decisions;
4. never use open-channel count alone to infer that a departed member remains part of the dyad;
5. retain the existing timeout-plus-silence rule only as a fallback while full-study disconnect
   behavior is being verified; and
6. send every pre-task failure through one existing no-match terminal route.

## Explicit dependency and merge gate

The C&WG branch depends on the exact `jspsych-multiplayer` PR #88 branch commit used to build the
JATOS adapter browser artifact. Record that full SHA and artifact provenance in the integration
commit that first loads the adapter. Do not replace this with an unpinned branch URL, and do not
claim launch readiness while the dependency is unpublished.

Before merging or piloting the C&WG integration, run the full study against that pinned artifact in
a deployed JATOS group study and demonstrate:

- shared group-derived seed and dyad ID for both partners;
- seal-before-role behavior for a normal pair;
- no-match routing when a peer leaves before sealing;
- no replacement in a sealed group after a task peer leaves; and
- exactly one terminal screen and one cleanup path per participant.

## Still owned upstream

These adapter hardening cases remain in PR #88 and are not evidence supplied by the probe above:

- transient reconnect;
- pending-join versus lobby-timeout race; and
- failed leave.

Until their behavior is documented and tested upstream, C&WG must preserve its bounded lobby and
defensive terminal routing rather than assuming an adapter operation is infallible.
