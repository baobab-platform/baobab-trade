# ADR-0032 implementation audit — 9 November 2026

**Status:** Accepted; controls and machine-readable ZB-04 manifest already exist. No new certification is asserted.

## Audited baseline

conformance/zb04-certification.json declares eight ZB-04 repository controls and status IMPLEMENTED_AWAITING_ENVIRONMENT_CERTIFICATION. tests/zb04-certification.test.ts checks declared file existence and CI invocation. That is appropriate source certification, but file existence alone does not show that a referenced artifact is an executable test. Repository evidence must not be mistaken for an integrated IAM→CP→Trade→ERP→notification run.

## Bounded hardening

Extended the existing CI-conformance test to require distinct control IDs, conventional executable Vitest file paths and test registrations, forbid obvious pasted raw bearer/private-key/invitation token markers, retain explicit cross-repository dependencies, and refuse any implicit environment-certified marker without real evidence.

## Remaining

Real IAM principal tokens, iDempiere projection/readback, CP Organisation, malware-scanned document custody, email delivery, reconnect/replay and operator evidence bundle are still required. CI does not invent receipts or sign off independently. Status remains IMPLEMENTED_AWAITING_ENVIRONMENT_CERTIFICATION.

Validation:

    npm run test:zb04
    npm run typecheck
    npm run format:check

Draft; pending review.
