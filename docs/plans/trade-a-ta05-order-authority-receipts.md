# Trade-A TA-05 — central order authority and durable receipts

Date: 17 October 2026. Programme: EA v2.2 EA-R03 / LA-05 / P0-04B.
Governing decision: Accepted Shared ADR-SHARED-039 §§2, 4, 6–7;
Trade ADR-0010 §28, ADR-0014 and ADR-0015.

## Scope and dependency

This is the central enforcement kernel, not route activation. For an attributed
native record it requests a fresh operation-specific CP decision, accepts only
current AUTHORIZED authority and persists its binding/mandate/legal-entity
provenance under a lease bounded by CP expiry and receipt plus 30 seconds.
Production, unknown runtime profiles and missing explicit non-production
opt-in stay denied. No new human grant, binding, workload or provider support
is created. Infrastructure #35 is not a build or test prerequisite: the native
regression uses an explicitly synthetic CP and disposable real Medusa/PostgreSQL.
That evidence is neither L4 nor EA Gate D nor protected staging.

## Review corrections in Trade #153

1. **Durable evidence is required.** A successful CP decision followed by a
   rejected receipt insert cannot return authority. The PEP awaits persistence
   inside its error boundary and returns OrderAuthorityDenied with outcome
   UNAVAILABLE / HTTP 503 / TRADE_AUTHORITY_UNAVAILABLE for connection and
   insert failures. It neither leaks SQL/connection details nor retries an old
   CP decision. No specific business denial is inferred from a database error.
2. **The database binds class to record type.** The INSERT trigger checks this
   relation alongside all existing binding, version, digest, currency, context,
   tenant, Organisation and market checks:

| Operation class            | Required attribution subject_type |
| -------------------------- | --------------------------------- |
| trade.order.commit         | cart                              |
| trade.order.create         | order                             |
| trade.draft-order.finalize | draft_order                       |

A typed TypeScript caller is not the sole writer of evidence. The same rule
must hold through the exported PostgreSQL store and raw SQL. Unknown classes
have no matching subject and remain independently rejected by the table CHECK.
The append-only history, decision uniqueness, lease and single-consumption
rules remain in force. These receipts are not themselves an order COMMIT.

## Validation and evidence limits

- Eighteen focused PEP tests cover current authority, runtime/class denials,
  attribution errors and asynchronous connection/unique/trigger rejection;
  persistence failures expose no original error or cause and perform no retry.
- The mandatory core-module integration job runs the actual migration and
  regression-native-configuration-attestation on disposable PostgreSQL 17.
  The expanded regression accepts all three correct class/type pairs and
  refuses all six wrong pairs through both the store and direct SQL, requiring
  trigger SQLSTATE P0001 and checking rejected SQL leaves no receipt row.
  Fresh decision IDs, operation references and leases prevent unrelated
  uniqueness/expiry errors from satisfying those negatives.
- Full formatting, lint, type, unit, build, pinned Shared conformance and native
  CI checks must pass on the final PR head before merge. Real database results
  are recorded from CI; no local Docker/PostgreSQL run is claimed.

## Migration and rollback

Migration20261016140000 is new in the still-unmerged PR #153. Its initial
receipt guard is corrected before release; no previously merged migration is
rewritten. A disposable checkout that already applied the earlier candidate
must be recreated for qualification. For a persistent deployment of that
unreleased candidate, use an independently reviewed forward repair; do not
reapply or erase durable receipt history. down() deliberately refuses history
deletion. Immediate containment is to retain the existing denied runtime
posture and withhold TA-06/07/08 activation.

## Remaining Trade-A work

TA-06 must wire every relevant HTTP/workflow/service entry point, TA-07 must
consume receipts at the actual native persistence COMMIT with bypass closure,
and TA-08 must provide the agreed acceptance evidence. Later Trade-B/C/D,
actual IAM/CP qualification, real mandates/bindings and protected/production
release decisions remain separate. A green source PR activates none of them.
