# ADR-0031: Buyer Invitation Delivery and Token Lifecycle

Status: Accepted  
Date: 2026-09-20  
Gate: ZB-04

## Decision

Buyer invitations are organisation-scoped, administrator-authorised, email-bound and single-use. Only a hash of the cryptographically random bearer token is persisted. Tokens expire after 48 hours and are removed on acceptance or revocation.

Notification delivery attempts are durable audit records. A failed provider call remains visible and does not silently become a successful invitation. Resend rotates the token, invalidating the prior link, and records a new attempt. If resend delivery fails, the previous usable token and expiry are restored. Raw tokens are delivered only through the configured notification provider and are never returned by APIs or written to events.

Acceptance requires the authenticated Medusa Customer email to match the normalised invited email and requires a distinct canonical Principal mapping. Email is an invitation-routing constraint, not canonical identity; the accepted membership remains keyed by Customer and Principal.

## Consequences

Provider outages are retryable without losing audit evidence. Stolen links cannot be claimed by a differently addressed authenticated customer. Revocation immediately makes an invitation unusable. Production still depends on the configured notification provider and template.
