# Gate ZB-04 end-to-end certification

Status: Implemented — awaiting environment certification  
Date: 2026-09-20

## Certification boundary

This pack certifies the governed chain:

```text
IAM Principal
  -> Control Plane tenant/canonical organisation
  -> Trade application and verified KYB
  -> ERP Business Partner and commercial decision
  -> Trade activation
  -> organisation membership and invitation lifecycle
```

Automated repository evidence is declared in `conformance/zb04-certification.json` and executed by `npm run test:zb04`.

## Pass rule

A green repository pack proves the implemented controls and regression coverage. It does **not** by itself prove production readiness. Final certification additionally requires real IAM, Control Plane, document-capability, notification-provider and iDempiere evidence. Each run must retain correlation IDs, event IDs, public business-partner references, timestamps and operator sign-off. Secrets, raw invitation tokens and document binaries must not appear in the evidence bundle.

## Required environment scenario

1. Authenticate a real applicant Customer mapped to a canonical IAM Principal.
2. Submit a buyer application in the configured ZuriBeans tenant.
3. Attach canonical document references for the baseline KYB package after malware/quarantine processing.
4. Verify each evidence item and retain immutable decision references.
5. Move the complete application into review and record an admission decision.
6. Verify the bounded `BUYER_ORGANISATION` in Control Plane.
7. Project the pending buyer to ERP and reconcile the public Business Partner reference.
8. Record an ERP commercial decision and publish the signed profile event.
9. Confirm that only `APPROVED` activates the Trade organisation; hold/rejection must not.
10. Invite, resend, accept and revoke a secondary membership using the real notification provider.
11. Redeliver the same ERP and invitation requests and prove idempotent outcomes.
12. Exercise outbox retry/reconciliation and retain the resulting evidence.

## Stop conditions

Certification fails on tenant mismatch, unverified/expired KYB, missing canonical linkage, unsigned ERP events, activation without ERP approval, reusable/revealed invitation tokens, unreconciled dead letters, or missing production-shaped migration evidence.
