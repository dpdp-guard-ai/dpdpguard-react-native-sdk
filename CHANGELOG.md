# Changelog

All notable changes to `@dpdpguard/react-native` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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

