# LA-05C — Seller-of-record enforcement port (candidate)

ADR-BCP-027 LA-05, Shared CP assessment `organisation/v2/legal-actor-enforcement.schema.json`, and CP PR #299.

## What this increment implements

- `HttpLegalActorAssessmentClient`: one uncached HTTPS call per regulated transaction to `POST /internal/legal-actor/v1/assess`, using Trade's service workload bearer and previously-issued canonical `context_id`.
- `GovernedMedusaOrderOrchestrationAdapter`: an opt-in decorator for the existing Medusa order port. It requires the exact operating business context, `SELLER_OF_RECORD`, activity, market code, capability, operation reference, fresh `AUTHORIZED` from CP, and `responsible_legal_entity_id == legalSellerKey`.
- **Independent mandatory** `LegalSellerProviderReadiness.assertReadyForSeller` port: legal-actor verification does not prove market, merchant, processor or commercial seller readiness. An absent or denied provider means no order placement.
- A replayed order is *still rechecked* before attempting Medusa's idempotent execution. Read-only retrieval is not a new obligation.
- **Post-readiness revalidation:** The decorator now requests a fresh current CP assessment after the provider/merchant readiness await and immediately before `native.place`, including replays. Both assessments must identify the same mandate and real LegalEntity. Revocation, expiry, mandate replacement or CP unavailability fails closed. This eliminates a time-of-check/time-of-use gap within the decorator; native Medusa checkout still needs its own non-bypassable integration and certification.
- Tests exercise bypass, revocation, expiry, mismatched legal actor, denied provider, invalid CP response, and never-cached HTTP.

## What this increment deliberately does not claim

This branch **does not retrofit every live Medusa checkout route**. It exposes a tested fail-closed execution adapter for adoption by the concrete order-commit workflow. Existing native `MedusaOrderOrchestrationAdapter` calls remain an **unaccepted bypass** for a regulated legal-actor operation; it must not be marked `PROVIDER_SUPPORTED` or deployed as legal-actor-enforced production checkout until the actual Medusa order route is routed through this decorator, an authoritative provider-readiness adapter is implemented, and end-to-end replay/revocation verification passes.

The current `OrderCommand.legalSellerKey` is not evidence of legal identity. Existing historical values, company aliases and subsidiary names cannot satisfy the governed path unless they exactly match the current CP canonical legal-entity identifier.

IAM must explicitly issue and register the Trade workload `legal-actor:assess` scope; it is neither default nor implied from `context:resolve`. The issuer must be the same canonical workload that owns the CP PlatformContext. The CP assessor itself is gated to nonproduction until LA-05 consumer acceptance.

No Nabhold, ZuriBeans, Thamani or Equator legal responsibility is inferred or configured by these adapters.
