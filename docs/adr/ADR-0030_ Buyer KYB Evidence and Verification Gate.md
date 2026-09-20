# ADR-0030: Buyer KYB Evidence and Verification Gate

Status: Accepted  
Date: 2026-09-20  
Gate: ZB-04

## Context

The ZuriBeans Go-Live plan places KYB details, documents and verification before commercial and credit review. ADR-0017 assigns buyer admission to Trade. ADR-0025 distinguishes document identity and evidence metadata from binary content and requires provenance, checksums, tenant isolation and explicit verification.

## Decision

Trade records application-scoped KYB evidence references; it does not store document binaries. Every reference identifies a canonical document and version and binds that representation with its SHA-256 digest, media type, size, provenance and validity dates.

Applicants may attach evidence only to their own application while it is accepting information. Staff verification creates an immutable decision and changes the evidence projection to VERIFIED or REJECTED. At-least-once canonical decision events are written through the Trade outbox.

The baseline package required before UNDER_REVIEW or APPROVED is:

- COMPANY_REGISTRATION
- TAX_REGISTRATION
- AUTHORIZED_REPRESENTATIVE

Evidence references are not canonical organisation state. Approval still requires Control Plane verification and ERP commercial clearance still governs later activation.

## Consequences

Trade gains auditable KYB readiness without becoming a file store. Binary upload, malware scanning, quarantine, residency routing, retention execution and canonical document registration remain responsibilities of the approved document capability. A reference cannot substitute for those controls.
