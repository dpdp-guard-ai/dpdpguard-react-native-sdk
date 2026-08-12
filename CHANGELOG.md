# Changelog

All notable changes to `@dpdpguard/react-native` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.1.0] - 2026-08-12

### Changed

- Bumped `@dpdpguard/contract` dependency from `^1.0.1` to `^1.5.0`, syncing
  past the four intermediate releases (`1.1.0`-`1.5.0`). Per ADR-002 D3/D4,
  every one of these releases is classified additive (minor) — new
  endpoints, new schemas, and (`1.2.0`) new `/mcp/v1` error codes — with no
  breaking change to any existing endpoint, field, error code, or the
  audit-hash canonicalization. This SDK's own public API (`DpdpGuardClient`,
  `hasConsent`) is unchanged, so this is a minor bump rather than a major
  one.
- Regenerated `src/generated/api-types.ts` (gitignored, rebuilt by
  `scripts/codegen.mjs` on `postinstall`/`npm run codegen`) against
  `@dpdpguard/contract@1.5.0`'s `openapi/v1.yaml` (now `2.8.0`). The
  regenerated output picks up types for endpoints this SDK does not wrap
  with hand-written client methods and does not call:
  - `1.1.0`: `GET /api/v1/retention/due`, `GET /api/v1/breaches`,
    `GET /api/v1/cross-border/transfers`.
  - `1.3.0`: `POST /api/v1/offline-consent/links`.
  - `1.4.0`: `POST /api/v1/offline/captures`, `POST /api/v1/offline/pos`,
    `POST /api/v1/offline/ivr`.
  - `1.5.0`: `GET /api/v1/consent/gate/decisions`,
    `GET /api/v1/consent/gate/alerts`.

  None of these are Data-Principal-facing surfaces this SDK targets (see
  "What's here vs. what's not" in README.md); the generated types exist
  but nothing in `src/client.ts` or `src/index.ts` references them.
- `errorCatalog.test.ts` updated: `@dpdpguard/contract`'s
  `conformance/error-catalog.json` gained eleven codes in `1.2.0` for the
  `/mcp/v1` agent surface (`SCOPE_INSUFFICIENT`, `TOOL_NOT_AVAILABLE`,
  `ORG_DISABLED`, `APPROVAL_REQUIRED`, `APPROVAL_BACKLOG_FULL`,
  `PROPOSAL_EXPIRED`, `SECOND_REVIEWER_REQUIRED`,
  `PROPOSAL_ALREADY_REVIEWED`, `DATA_VOLUME_EXCEEDED`, `PLAN_LIMIT_REACHED`,
  `AGENT_WRITE_BLOCKED`), taking `ERROR_CATALOG`'s length from 10 to 21.
  The test's exact-list assertion was updated to match; this SDK does not
  call `/mcp/v1` and none of these codes are otherwise referenced.
- Does **not** touch audit-hash canonicalization or `ConsentRecord` shape
  in any of the synced contract versions; no DPO sign-off applies
  (ADR-002 D5).
- `npm run typecheck` (`tsc --noEmit`) passes clean against the
  regenerated types.
- `npm test` passes: 3 suites, 12 tests, all green.

## [1.0.0] - 2026-07-29

### Changed

- Major version bump forced by the upstream `@dpdpguard/contract` 1.0.0
  breaking change (tightened request-body validation on several fields,
  optional `Idempotency-Key` on grievance filing). No functional changes
  to this SDK's own code beyond the dependency bump to `^1.0.1` and
  regenerated codegen output.
- Bumped `@dpdpguard/contract` dependency from `^0.2.0` to `^1.0.1`.
- Regenerated `src/generated/api-types.ts` against the new contract. The
  regenerated output **did** differ from what `^0.2.0` produces:
  - Added two new operations/schemas that the contract's `openapi/v1.yaml`
    now documents for the first time (previously-undocumented,
    already-implemented server endpoints backing a website embed widget,
    version 2.0.0 → 2.1.1 of the OpenAPI doc): `GET /api/v1/widget/config`
    (`getWidgetConfig`, `WidgetConfig` schema) and `POST /api/v1/cm/signal`
    (`receiveCmSignal`, `CmSignalRecord` schema). These are out of scope for
    this SDK per its design spec and no client wrapper methods were added
    for them — they only appear in the generated type file.
  - Added an optional `Idempotency-Key` request header to the
    `createGrievance` operation's generated types
    (`POST /api/v1/grievances`). Note: `DpdpGuardClient.createGrievance()`
    (hand-written) does not yet expose a way to pass this header, unlike
    `createDsrRequest`/`giveConsentAnonymous` which already support an
    `idempotencyKey` parameter — this is a pre-existing gap, left
    untouched per this release's scope (dependency/codegen only, no
    hand-written logic changes) and flagged here for a follow-up PR.
  - Numerous doc-comment-only changes: many operation summaries/
    descriptions had their internal `ADR-00N D#` / `spec §N.N` citations
    stripped (e.g. "Mint a short-lived principal access token (ADR-004
    D1/D2, golden-path auth)." → "Mint a short-lived principal access
    token."). These are comment-only and have no effect on emitted types
    or runtime behavior.
  - The tightened field-length validation mentioned in the contract's own
    CHANGELOG is enforced server-side at runtime; `openapi-typescript`
    does not encode `maxLength`/`minLength` constraints into the emitted
    TypeScript types, so no `string` field types changed shape here.
  - No changes to `ConsentRecord`/`consentAuditTrail`-shaped types or
    audit-hash-related schemas (this SDK doesn't generate/expose those
    anyway — see "Deliberately excluded" in README.md).
- `npm run typecheck` (`tsc --noEmit`) passes clean against the
  regenerated types.
- `npm test` passes: 3 suites, 12 tests, all green.

## [0.1.0] - 2026-07-12 (backfilled)

> This entry did not exist in the repository; it is reconstructed
> best-effort from git history for the initial pre-1.0 release line.
> It was never published as a discrete git tag/GitHub release, and may not
> exactly match what (if anything) was published to npm under `0.1.0`.

### Added

- Initial scaffold of `dpdpguard-react-native-sdk` (2026-07-09).
- Typed `DpdpGuardClient` HTTP client over DPDP Guard's `/api/v1` surface,
  built on `@dpdpguard/contract` (2026-07-12): DSR requests, grievances,
  nomination, consent (including `giveConsentAnonymous` for pre-login
  guest consent capture and `linkAnonymousConsent` reconciliation),
  organizations/notices reads, and age-verification/parental-consent
  token verification.
- `src/errorCatalog.ts` statically importing
  `@dpdpguard/contract/conformance/error-catalog.json` for
  `DpdpGuardApiError` codes.
- Removed the dead `create-react-native-library` turbo-module scaffold
  (native Android/iOS folders, `multiply()` stub) — this SDK is a plain
  `fetch`-based HTTP client with no native module.
- CI: automated npm publishing workflow with OIDC/provenance support.

