# DEV-07 approved buyer assurance policy

Trade accepts a deployment-owned `BAOBAB_BUYER_ASSURANCE_POLICY_JSON` document
under the pinned Shared `identity/v1/assurance-policy.schema.json`. An explicitly
configured invalid, unapproved, suspended, retired, expired or wrong-issuer policy
fails closed. It never falls back to the interim ACR allowlist. When the variable
is absent, the existing approved interim allowlist remains restricted to
BUYER_SESSION operations.

The full policy preserves the canonical operation-to-profile mapping and checks
exact issuer and ACR values, every required AMR method, authentication age and
step-up freshness. Future and non-finite authentication timestamps are refused.
Phishing-resistant requirements are assertions of the governing approval about
the exact accepted issuer evidence; Trade does not infer resistance from a
method's name or rank arbitrary ACR strings. Provisioning must retain the IAM
evidence and approval provenance. Synthetic development policies are not
production approvals.

Only a verified, currently active IAM access token supplies the evidence. Neither
a request nor the BFF can provide a policy, AMR, authentication time or approval.
The loader snapshots and freezes requirements and hashes the complete approved
document, including its version and provenance, into a bounded decision revision.
Buyer context expires at the earliest of the policy interval, authentication
freshness, IAM, CP, estate, membership and existing 60-second context bounds.
Slow I/O cannot extend it.

This supplies assurance evaluation for RFQ, quotation, approvals and native
commitments. It grants no company membership, Market/Site scope, spend authority,
seller authority or documentary permission, and does not activate a route or the
native commitment enforcement gate. Qualified native IAM evidence, per-operation
policy, atomic receipt/reservation consumption and connected runtime acceptance
remain required. No full policy is installed by this source change.

Validation includes the exhaustive canonical operation mapping, exact/missing
methods and ACRs, future/stale/missing auth_time, policy intervals and schema,
explicit status and issuer mismatches, immutable snapshots, version-bound
revisions and context expiry across simulated I/O. These are source tests with
synthetic evidence; they are not issuer/provider qualification receipts.
