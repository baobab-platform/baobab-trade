# ADR-0036: Universal Native Commit Fence Behind an Inactive Enforcement Gate

Status: Proposed. This is Trade's implementation record for ADR-SHARED-042 §14 Decision 9 (Platform Owner ruling of 2026-10-23), covering the universal fence step. Where this record and ADR-SHARED-042 differ, ADR-SHARED-042 governs.
Date: 2026-10-23

## Context

Decision 9 requires one universal database fence covering every native commitment path, with no bypass. That includes BFF checkout, server applications, admin, jobs, callbacks and replays. It also orders the work: implement the fence behind an inactive enforcement gate, and do not activate it against the live checkout. Activation needs:

- connected evidence;
- an approved scope allocation;
- rollback safeguards.

An earlier attempt landed the Decision 8 commit check enforcing immediately. Nothing yet classifies a live commitment, so the check refused every checkout, broke the TA-08 runtime acceptance, and was reverted (f17ab85).

## Decision

`Migration20261023120000` adds the fence and its gate.

1. **One fence for every path.** The deferred constraint trigger on `trade_order_commitment` runs at COMMIT of the order's own transaction. The TA-07 fence writes that row for every cart commit and draft finalisation, whatever wrote the order. The trigger applies the ADR-0034 checks:

   | Verdict                   | Meaning                                                                                                                                   |
   | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
   | `CLASSIFICATION_ABSENT`   | No ACTIVE classification. A classification itself needs CP-verified estate provenance (ADR-0035).                                         |
   | `CLASSIFICATION_CHANGED`  | The resource's classification was retired.                                                                                                |
   | `CLASSIFICATION_CONFLICT` | The classification disagrees with the seller receipt.                                                                                     |
   | `PROFILE_NOT_ACTIVE`      | The CP commerce profile is withdrawn or stale.                                                                                            |
   | `BUYER_AUTHORITY_ABSENT`  | Any B2B commitment, until the CAA-06b composition consumes the buyer-authority receipt and its spend reservation in the same transaction. |

   Nothing ever falls through to B2C.

2. **Inactive enforcement gate.** `trade_commit_fence_enforcement` is one governed row:
   - **`SHADOW`, as shipped:** the fence evaluates every commitment and records its verdict, but refuses none.
   - **`ENFORCED`:** any refusal raises, and the order, the receipt consumption and the commitment roll back together.
   - A change needs the next revision and its own evidence reference. The row cannot be added, deleted or truncated.
   - The fence has no session, caller or path exemption: the gate is the only switch, and it is global.
   - The fence reads the gate `FOR SHARE`, so a switch and an in-flight verdict are serialized: no order commits under a mode it was not evaluated in.
3. **Evidence.** `trade_commit_fence_decision` is append-only, and only the fence can write it: an insert must come from inside the fence trigger, for an existing commitment with the same receipt and subject. Each evaluation records:
   - the subject;
   - the receipt;
   - the classification and model;
   - the verdict;
   - the gate's mode and revision at that moment.

   The row is written in the order's own transaction. In `SHADOW` every verdict is therefore evidence before the fence is ever enforced, and enforcement can be judged on them. Under `ENFORCED` a refusal rolls back with the order, so its evidence is the raised refusal; allowed commitments are still recorded.

The migration leaves the gate in `SHADOW`. Rolling the migration back is refused; the rollback safeguard is setting the gate back to `SHADOW` through a governed revision.

## Consequences

- The live checkout and TA-08 behave as before. Every native commitment now leaves a fence verdict that shows what enforcement would have done.
- Moving to `ENFORCED` is the activation step. It is not taken here, and it needs connected evidence, the approved scope allocation and the Platform Owner's approval. The canonical registry activation hold stays in place.
- B2B composition (buyer-authority receipt persistence, reservation consumption and the receipt check) is the next increment. Until it lands, an enforced fence refuses every B2B commitment.
- Existing TA-08 evidence remains a historical baseline only.

## Evidence

`regression:trade-a-commit-fences`, run on the real `completeCartWorkflow` and `convertDraftOrderWorkflow` with the real migrations:

- the gate ships in `SHADOW`;
- under `ENFORCED`:
  - classified B2C commitments complete and are recorded `ALLOWED`;
  - unclassified, B2B, retired, stale-profile and CP-withdrawn commitments are refused, and nothing commits;
  - an unclassified draft finalisation is refused;
  - a re-resolved attestation commits;
- under `SHADOW`, an unclassified commitment completes and is recorded `CLASSIFICATION_ABSENT`;
- an unversioned gate change, a second gate row, a gate deletion, and a forged, rewritten or deleted verdict are all refused;
- the regression leaves the gate in `SHADOW`.
