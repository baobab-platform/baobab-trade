# ADR-0035: Governed Estate Resource Assignment Provenance

Status: Proposed. This is Trade's implementation record for ADR-SHARED-042 §14 Decision 9 (Platform Owner ruling of 2026-10-23), covering the Trade provenance step. Where this record and ADR-SHARED-042 differ, ADR-SHARED-042 governs.
Date: 2026-10-23

## Context

ADR-0034 classifies a native commitment only on a CP commerce profile attestation for the estate that the commitment's CP-verified provenance names. Until now the only provenance was the CP estate-client binding of a governed BFF request (CAA-04).

Decision 9 extends this to commitments that do not come through a BFF:

- authenticated server applications;
- native operations, jobs, callbacks and replays.

These use the CP **Governed Estate Resource Assignment** (CP ADR-BCP-031). There is no second registry and Trade never certifies itself. A commitment with neither provenance is refused once the fence is active. It never falls back to B2C, to implicit authority or to a weaker fence.

Implementation order: Shared → CP (merged) → IAM server workload identity (ADR-IAM-0034) and Trade provenance (this record) → universal commit fence → acceptance → activation.

Contracts: Shared at `1517429bcae601a1b0288ca0279e524ce48a3d77`, adding `control-plane/v1/estate-resource-assignment.schema.json`.

## Decision

1. **Assignment client.** `ControlPlaneResourceAssignmentResolver` (`src/baobab/control-plane/estate-resource-assignment.ts`) calls `POST /internal/estate/v1/resource-assignments/resolve` with Trade's own workload token (`estate:resource-assignment:resolve`). The subject is one of:
   - **WORKLOAD:** the server application's own IAM token (audience `baobab-trade`, scope `trade:native-commitment:submit`), forwarded as evidence for CP to verify. A Medusa publishable key is never evidence.
   - **NATIVE_RESOURCE:** the native seller configuration reference and live digest, exactly as Trade attested them under Trade-0.

   The request names the estate, Trade's engine instance, the Market and the operation, never a Tenant or an assignment. The client validates the request before sending and the answer against the Shared contract. It accepts an answer only if it is exactly what was asked and current: at most 60 s, within the assignment's end and not future-dated. Any other answer is `RESOLUTION_UNAVAILABLE`. The client is off unless `BAOBAB_RESOURCE_ASSIGNMENT_ENABLED=true` in development or staging.

2. **Commerce profile provenance.** The commerce profile request now carries `estate_provenance` of either kind, `ESTATE_CLIENT_BINDING` or `GOVERNED_RESOURCE_ASSIGNMENT`, with its CP reference. CP re-verifies it from its own record.
3. **Classification.** `classifyNativeCommitment` takes an `EstateProof` of either kind. If neither is present, or one is malformed, the result is `CLASSIFICATION_ABSENT`.
   - An assignment must match the resource's Tenant, Trade's engine instance, the seller context's Market and the operation being classified (an assignment attests exactly one operation), and must be unexpired. Otherwise the result is `CLASSIFICATION_CONFLICT`.
   - A B2B assigned commitment still needs a buyer context that Trade established itself for the same estate, Tenant and engine. Only a BFF-proven commitment additionally requires the buyer context to name that BFF's binding.
   - The classification's evidence names the assignment and its attestation instead of an estate binding.
4. **Evidence (migration `Migration20261023090000`).** `trade_commerce_profile_observation` records each answer's `estate_provenance_kind` and `estate_provenance_reference`; the latter is the renamed `estate_binding_id`. Existing rows are estate-client bindings. Rolling back is refused once an assignment observation exists.

This step does not touch the commit fence. Fence enforcement, the reservation and buyer-receipt composition, and the TA-08 rerun come in later steps behind an inactive enforcement gate.

## Consequences

- Nothing is registered, allocated or activated:
  - no workload holds `estate:resource-assignment:resolve` or `trade:native-commitment:submit`;
  - no assignment exists;
  - the switch defaults off.
- Existing TA-08 evidence remains a historical baseline only. It does not qualify any assigned or logistics-native commitment.

## Evidence

- **`tests/estate-resource-assignment.test.ts`:**
  - the request shape for both subjects, with no assertion of Tenant or assignment;
  - malformed requests refused before sending, including a publishable key or short token as evidence;
  - every closed CP denial passed through, and any other failure treated as `RESOLUTION_UNAVAILABLE`;
  - a 200 rejected if it does not answer the question asked, is stale or too long-lived, has the wrong scope, or carries an extra field.
- **`tests/native-commitment-classification.test.ts`:**
  - classification via assignment, with its evidence and the provenance passed to CP;
  - B2B assigned commitments still require a matching buyer context;
  - refusal of an assignment for another Market, Tenant, engine or operation (or none), or one that has expired;
  - a missing or unknown provenance gives `CLASSIFICATION_ABSENT`.
- **`regression:native-commitment-classification` (case 10), against PostgreSQL with the real migrations:** the same refusals, a contract-valid B2C classification on an assignment, the recorded provenance, and refusal of an unknown provenance kind.
