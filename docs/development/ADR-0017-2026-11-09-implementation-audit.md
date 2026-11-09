# ADR-0017 — Customer/B2B organisation authority audit (2026-11-09)

**Accepted architecture:** ADR-0017 CUS-COM-001–030, §§132–133. User authenticated to Medusa is NOT an authorised IAM buyer Principal, and multi-organisation membership is not globally transferable.

**Defect:** The legacy `GET /store/b2b/capabilities` selected the first ACTIVE organisation for the authenticated customer from returned memberships without explicit selection, server-selected tenant comparison, Principal binding, membership effective dates or Control Plane buyer Organisation attestation. It also offered `team:true` on any membership. The result could disclose an unselected or foreign-tenant organisation and grant role-looking flags from a Medusa customer token.

**Implemented:** explicit organisation ID required for a selected account shell, exact Medusa customer and canonical Principal membership binding, unique ACTIVE time-bounded membership, selected-tenant and current CP Organisation attestation. No selection returns null/false without DB access. No CP verifier or unavailable attestation fails closed. Only `organisation` reports selected status; `team`, `catalogue`, `orders` and `documents` stay false until proper IAM/CP authorisation. Error and success responses are private/no-store. Negative tests cover revoked/foreign/ambiguous membership and missing selection.

**Remaining:** Actual IAM human token verification for the selected operation, CP estate and Market binding, buyer role grants, spend/approval limits, cart organisation switch and revalidation, cross-org price/product/order IDOR, historical attribution and all ADR §133 connected conformance. Trade #189, #202 and #204 remain separate and unmerged.

**Disposition:** Legacy capability read hardening only; production buyer authority HELD.