# ADR-0032: ZB-04 End-to-End Certification Evidence

Status: Accepted  
Date: 2026-09-20

## Decision

ZB-04 uses two certification layers. Repository certification maps every authority and lifecycle control to executable tests. Environment certification executes the real IAM → Control Plane → Trade → ERP/iDempiere → Trade → notification-provider path and retains attributable evidence.

Unit tests and mocks may prove deterministic policy behavior but SHALL NOT be reported as proof of real iDempiere projection, provider delivery, workload identity, migration safety or operational replay. Until those artifacts exist, the machine-readable status remains `IMPLEMENTED_AWAITING_ENVIRONMENT_CERTIFICATION`.

Certification evidence must contain public/canonical references, event and correlation IDs, timestamps and operator sign-off. It must exclude credentials, document binaries and raw invitation tokens.
