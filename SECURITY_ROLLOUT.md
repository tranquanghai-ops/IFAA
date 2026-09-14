# Firebase integrity rollout

## Phase 1 — this draft PR

Deployment order is intentionally:

1. Firestore transition rules.
2. Storage rules.
3. Firebase Hosting client.
4. GitHub Pages, only after the Firebase deployment workflow succeeds.

The transition rules accept both:

- the previous client, which does not write mutation markers; and
- the new client, which writes `counterMutationId`, `counterSourceId`, and
  `registrationMutationId`.

New pending-photo labelling is a transaction that soft-deletes the pending
document and creates or restores the deterministic `sessionId_MSSV` document.
Legacy documents are checked before the transaction; no bulk migration is run.

For compatibility with an already-open old browser tab, Phase 1 temporarily
retains bounded, non-negative legacy counter transitions and the old
noncanonical pending-label transition when the canonical document does not
exist. These compatibility branches are deliberately isolated in
`legacyAttendanceCounterMutation`,
`legacyRegistrationCounterMutation`, and the noncanonical label update rule.

## Phase 2 — follow-up PR after client retirement

Before Phase 2:

1. Confirm Firebase Hosting and GitHub Pages have served the Phase 1 client for
   the agreed retirement window.
2. Check logs/support reports for old-client permission errors.
3. Run the Rules Emulator matrix and inspect production counters read-only.

Phase 2 removes the compatibility branches:

1. Require `counterMutationId` for every check-in counter mutation.
2. Require `counterSourceId` for every pending-to-canonical conversion.
3. Disallow all active noncanonical check-ins with a non-empty MSSV.
4. Require `registrationMutationId` for every registration counter mutation.
5. Keep the Admin-only zero-count/missing-limit cleanup path for legacy data.

Phase 2 must be a separate reviewed PR; it must not be combined with the first
client rollout.
