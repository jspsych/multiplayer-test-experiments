/**
 * JATOS deployment bootstrap for the Hawkins paid pilot (portable-plan Part C).
 *
 * Design source of truth: `HAWKINS-PORTABLE-PLAN.md` §C in the adjacent
 * `jspsych-multiplayer` checkout. Mirrors the return-shape contract of
 * `connectLocalDeployment()` in `reference-game-hawkins.html` so the timeline
 * never inspects an adapter-specific API: `{ sessionId, participantId,
 * allocatedParticipantIds, finalizeAllocation }`, plus an optional
 * `bootstrapError` on the missing-group path.
 *
 * Stock JATOS presence is not an allocated roster, so both roster fields are
 * always `null`; the timeline's exactly-two roster validation remains the
 * safety gate.
 *
 * Intended JATOS batch (group study) configuration — enforced in JATOS
 * batch settings, NOT in code:
 * - single-dyad testing: max total workers = 2;
 * - paid run: max total workers = sample size, max total/active members = 2.
 *
 * Depends only on globals provided at runtime in a JATOS study: `jsPsych`
 * (with the multiplayer extension), the `jsPsychAdapterMultiplayerJatos` bundle global, and
 * the `jatos` object auto-injected by JATOS (`jatos.js` must be loaded and
 * the study run on a JATOS server for `groupResultId` to exist).
 */

export async function connectJatosDeployment() {
  // Held, not inlined, so the bootstrap can surface the adapter's stable
  // per-client id (studyResultId, falling back to workerId) behind the
  // portable `participantId` field — same as the local bootstrap does.
  // NOTE: the browser bundle exposes the class as the `jsPsychAdapterMultiplayerJatos`
  // global (bare `JatosAdapter` exists only inside the bundle); structural tests cannot
  // catch a wrong global name, so the JATOS smoke test owns this line.
  // Wait for jatos.js init BEFORE constructing the adapter (not just before
  // connecting): the constructor snapshots its identity from
  // `jatos.studyResultId ?? jatos.workerId` at construction time, and both fields are
  // only assigned during jatos.js's async init (URL parse + ID-cookie read). Constructing
  // early bakes in participantId "undefined" for every member, so all lobby pushes land
  // under one shared "undefined" key and the dyad can never form — while joinGroup itself
  // reads urlBasePath/studyResultUuid at call time, so it needs the same wait (live
  // symptom on cortex.jatos.org was "...undefinedpublix/undefined/group/join").
  // jatos.onLoad fires after init, or immediately if init already finished.
  await new Promise((resolve) => jatos.onLoad(resolve));
  const adapter = new jsPsychAdapterMultiplayerJatos();
  await jsPsych.multiplayer.connect(adapter);
  // Read AFTER connect: the group membership only exists once the adapter
  // has joined the JATOS group channel.
  const groupResultId = typeof jatos !== "undefined" ? jatos.groupResultId : undefined;
  if (groupResultId == null) {
    // Never throw before jsPsych.run() and never String()-coerce absence
    // into "null"/"undefined": return a null session so the timeline's
    // existing session-id validation routes to the no-match screen.
    return {
      sessionId: null,
      participantId: adapter.participantId ?? null,
      allocatedParticipantIds: null,
      finalizeAllocation: null,
      bootstrapError: "missing groupResultId after connect",
    };
  }
  return {
    // String-coerce only after the null check above, so every dyad member
    // derives the same schedule seed and dyad id from the shared group id.
    sessionId: String(groupResultId),
    participantId: adapter.participantId ?? null,
    allocatedParticipantIds: null,
    finalizeAllocation: null,
  };
}
