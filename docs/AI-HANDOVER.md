# Project

- Repository: `tranquanghai-ops/IFAA`
- Current branch: `security/firestore-integrity-hardening`
- Related PR: PR #2

# Current Goal

Finish the existing Firestore integrity hardening PR with all Firebase Emulator security tests passing. The remaining work was limited to concurrent student registration and cancellation, the event capacity counter, and directly related rules behavior.

# Current State

- The known concurrent registration failure has been reproduced and fixed.
- Student registration and cancellation now update `events.registeredCount` with Firestore `increment(1)` and `increment(-1)` transforms inside the existing transaction. The transaction still reads the event and enforces status, time window, faculty, group-limit, and capacity checks before writing.
- Registration writes still carry `registrationMutationId` and remain paired with the event counter mutation required by the existing Firestore Rules.
- A registration transaction is retried at most once when concurrent marker evaluation returns Firestore `permission-denied`. Other errors are not retried. This handles the existing rules engine contention without weakening rules.
- Firestore Rules were not changed by the final fix.
- Production was not deployed and PR #2 was not merged.
- Latest result: 19/19 Emulator tests pass, 0 fail.

# Decisions Already Made

- Keep the existing client-side Firestore transaction architecture; do not redesign registration around Cloud Functions.
- Use atomic Firestore increments for the shared event registration counter. Do not restore snapshot-derived absolute counter writes.
- Preserve the existing event, registration, and registration-limit schema and backward compatibility for cached/legacy clients.
- Preserve server-side capacity, schedule, faculty, ownership, group-limit, mutation-pairing, and cancellation enforcement in Firestore Rules.
- Keep Phase 1 compatibility paths already present in the rules until a separately approved rollout removes them.
- Do not weaken Firestore Rules to make tests pass.
- Do not work on the Excel export or Firebase Storage Admin/Sub-admin issue as part of this task.
- Do not change auth or role architecture, add Cloud Functions, enable Blaze, deploy production, merge PR #2, migrate schema, or perform broad refactors without explicit approval.

# Files Changed

Files directly changed by the final concurrency fix:

- `student.mjs`: imports Firestore `increment`, uses atomic increments for registration/cancellation counters, and adds one bounded retry for the known concurrent marker permission denial.
- `tests/firebase-rules.test.mjs`: mirrors the atomic counter operations and bounded retry in the concurrent student registration/cancellation test.
- `docs/AI-HANDOVER.md`: records the cross-machine continuation state and verified result.

Other security PR files already changed before this continuation include `firestore.rules`, `storage.rules`, `admin/admin.mjs`, `check-in/check-in.mjs`, `firebase.json`, `package.json`, `pnpm-lock.yaml`, security test/validation scripts, CI workflows, and `SECURITY_ROLLOUT.md`. Do not re-audit or refactor them for this completed concurrency task unless a new test or PR review finding requires it.

# Tests

Tests run during this continuation:

- Targeted reproduction before the fix:
  - Command: `firebase emulators:exec --only firestore,storage --project ifa-activities "node --test --test-name-pattern=Concurrent tests/firebase-rules.test.mjs"`
  - Result: 0 pass, 1 fail.
  - Exact failure: `Concurrent students register and cancel without losing event counter updates` failed with Firestore `PERMISSION_DENIED`; rule evaluation reached the maximum of 1000 expressions during the concurrent event update/registration create.
- Single-client diagnostic after atomic increments: 1/1 pass. This confirmed that the remaining denial was concurrency-related marker contention.
- Targeted test after atomic increments and bounded retry: 1/1 pass.
- Full Emulator security suite after the final fix:
  - Command: `firebase emulators:exec --only firestore,storage --project ifa-activities "node --test tests/firebase-rules.test.mjs"`
  - Result: 19/19 pass, 0 fail, 0 cancelled, 0 skipped.
- Syntax checks: `node --check admin/admin.mjs`, `node --check student.mjs`, and `node --check check-in/check-in.mjs` all passed.
- Static security checks: `node scripts/validate-security-static.mjs` passed with `Static security assertions passed.`
- `git diff --check` passed.

There is no remaining failing test.

Local setup note for another Windows machine: the Firestore Emulator requires Java. This machine used Microsoft OpenJDK 21 and the repository dependencies from `pnpm-lock.yaml`. The Firebase CLI may print warnings about unauthenticated use and the legacy multi-bucket storage config; the local Firestore and Storage emulators still start and the full suite passes without Firebase login or production access.

# Next Action

Fetch `security/firestore-integrity-hardening`, verify that the branch contains implementation commit `6d6534b8586b3c184b2474f21b2d45234c2af068` and the subsequent handover commit, then review PR #2 and its CI checks. No further technical change is currently required. Do not merge or deploy without explicit user approval.

# Safety Constraints

- No production deploy.
- No PR merge.
- No schema migration.
- No weakening Firestore Rules.
- No unrelated refactor.
- No Blaze or Cloud Functions without approval.
- No Excel export / Firebase Storage Admin/Sub-admin work in this task.

# Last Updated

- Implementation commit SHA: `6d6534b8586b3c184b2474f21b2d45234c2af068`
- Branch: `security/firestore-integrity-hardening`
- Status: concurrency fix complete; targeted test passes; full Emulator suite passes 19/19; syntax and static security checks pass; ready for PR review, not merge.
