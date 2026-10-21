// TA-08 harness seeding of the REAL Control Plane (adapted from the ERP-A
// harness, baobab-erp idempiere/acceptance/erp-a/driver/seed.py).
//
// CP is seeded through its own admin API wherever one exists: tenant
// bootstrap and activation, market create and four-eyes activation, mandate
// propose/decide/activate by three distinct humans, and (in the driver) the
// Seller Operating Binding propose/approve/activate/suspend lifecycle. Where
// CP has no admin API the row is inserted directly and recorded as SYNTHETIC
// in the evidence:
//   - the human identities (IAM user provisioning),
//   - the legal-entity verification (an independent legal registry),
//   - the tenant's market assignment (tenant provisioning),
//   - the baobab-trade engine instance and its capability binding,
//   - the three humans' exact organisation.seller-operating-binding.* grants
//     (ADR-SHARED-039 §3: registered, assigned to no profile).
import { CP, ISS, ISSUER, call, key, must } from "./lib.mjs"

export const LEGAL_ENTITY = "LE-TA08UG"
export const MARKET = "UG"
export const CURRENCY = "UGX"
const ADMIN_SCOPES = [
  "tenant:bootstrap",
  "tenant:write",
  "market:write",
  "market:approve",
  "legal-actor-mandate:propose",
  "legal-actor-mandate:decide",
  "legal-actor-mandate:activate",
  "legal-actor-mandate:terminate",
  "seller-operating-binding:propose",
  "seller-operating-binding:approve",
  "seller-operating-binding:activate",
  "seller-operating-binding:suspend",
  "seller-operating-binding:revoke",
]
// ADR-SHARED-039 §2: the activatable Trade-A activities, one mandate each, so
// a missing activity is a real CP denial rather than a harness assumption.
export const CHECKOUT = "CHECKOUT_ORDER_COMMITMENT"
export const DRAFT_FINALISATION = "DRAFT_ORDER_FINALISATION"

const iso = (offsetSeconds) =>
  new Date(Date.now() + offsetSeconds * 1000).toISOString().replace(/\.\d{3}Z$/, "Z")

/**
 * A human administrator token. HIGH-risk grants need the MFA level
 * (assurance-policy.yaml: acr "gold"), which IAM's step-up flow asserts.
 */
async function humanToken(subject) {
  const minted = await call("POST", `${ISSUER}/_mint`, {
    subject,
    audience: "baobab-control-plane-admin",
    scopes: ADMIN_SCOPES,
    actor_type: "human",
    roles: ["cp:platform-admin"],
    acr: "gold",
  })
  return must(minted, 200).access_token
}

export class ControlPlane {
  constructor(compose, evidence, engineInstanceUuid) {
    this.c = compose
    this.evidence = evidence
    this.engineInstanceUuid = engineInstanceUuid
    this.engineInstance = `ei_${engineInstanceUuid.replace(/-/g, "")}`
    ;[this.maker, this.checker, this.operator] = [key(), key(), key()]
  }

  sql(statement, label) {
    this.evidence.note("synthetic-cp-seed", { label })
    return this.c.sql("cpdb", "controlplane", "controlplane", statement)
  }

  scalar(statement) {
    return this.c.scalar("cpdb", "controlplane", "controlplane", statement)
  }

  async admin(method, path, who, body, headers = {}, ok = [200, 201, 202]) {
    const response = await call(method, `${CP}${path}`, body, {
      Authorization: `Bearer ${await humanToken(who)}`,
      ...headers,
    })
    return { ...response, body: must(response, ...ok) }
  }

  async seed() {
    const people = [this.maker, this.checker, this.operator]
    this.sql(
      `INSERT INTO identity.principal (principal_id, actor_type, status) VALUES ${people.map((p) => `('${p}','human','ACTIVE')`).join(", ")};
       INSERT INTO identity.external_identity (principal_id, issuer, subject, status) VALUES ${people.map((p) => `('${p}','${ISS}','${p}','ACTIVE')`).join(", ")}`,
      "three human administrators (IAM user provisioning)",
    )

    const { body: registration } = await this.admin(
      "POST",
      "/v1/tenants/bootstrap-registrations",
      this.maker,
      {
        legal_entity_id: LEGAL_ENTITY,
        display_name: "TA-08 Synthetic Seller Ltd",
        isolation_strategy: "row_level_security",
        residency_region: "af-south-1",
        bootstrap_reason:
          "EA-R03 Trade-A TA-08 synthetic seller for engine-local order-commitment acceptance",
        evidence_reference: "ta08/synthetic-registration",
      },
      { "Idempotency-Key": key() },
    )
    this.tenant = registration.tenant_id
    for (let i = 0; i < 60 && !this.organisation; i++) {
      this.organisation = this.scalar(
        `SELECT organisation_id FROM registry.tenant_organisation_mapping
          WHERE tenant_id='${this.tenant}' AND mapping_role='PRIMARY_ORGANISATION' AND status='ACTIVE'`,
      )
      if (!this.organisation) await new Promise((r) => setTimeout(r, 1000))
    }
    if (!this.organisation)
      throw new Error(`tenant registration did not complete: ${JSON.stringify(registration)}`)
    await this.admin("POST", `/v1/tenants/${this.tenant}/activate`, this.maker)

    const created = await this.admin(
      "POST",
      "/v1/markets",
      this.maker,
      {
        canonical_key: "ug.gate.ta08",
        name: "Uganda (TA-08)",
        owner_tenant_id: this.tenant,
        market_type: "MARKETPLACE",
        default_country: MARKET,
        default_currency: CURRENCY,
        default_locale: "en-UG",
        timezone: "Africa/Kampala",
        effective_from: iso(-3600),
      },
      { "Idempotency-Key": key() },
      [201],
    )
    this.marketId = created.body.market_id
    await this.admin(
      "POST",
      `/v1/markets/${this.marketId}/activate`,
      this.checker,
      {},
      {
        "If-Match": created.headers.get("etag") ?? '"1"',
      },
    )
    this.sql(
      `INSERT INTO market.market_assignment (tenant_id, market_id, status, source, policy_version, effective_from)
       SELECT '${this.tenant}', m.market_id, 'ACTIVE', 'PROVISIONING', '1', now() - interval '1 hour'
         FROM market.market m WHERE m.code = '${MARKET}' AND m.is_active;
       INSERT INTO market.market_participation_capability (market_assignment_id, capability)
       SELECT market_assignment_id, 'SELLING' FROM market.market_assignment WHERE tenant_id='${this.tenant}'`,
      "tenant market assignment (tenant provisioning has no admin API)",
    )

    this.sql(
      `UPDATE registry.legal_entity_profile
          SET verification_state='VERIFIED', legal_status='ACTIVE',
              source_authority='synthetic-independent-legal-registry',
              evidence_references='["ta08/synthetic-legal-registry"]'::jsonb,
              verified_by='${this.checker}', verified_at=clock_timestamp() - interval '1 minute',
              updated_at=clock_timestamp()
        WHERE legal_entity_id='${LEGAL_ENTITY}'`,
      "legal-entity verification (an independent legal registry)",
    )

    this.sql(
      `WITH e AS (
         INSERT INTO topology.engine (code, name) VALUES ('baobab-trade', 'Baobab Trade')
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING engine_id),
       i AS (
         INSERT INTO topology.engine_instance (engine_instance_id, engine_id, region, environment, status)
         SELECT '${this.engineInstanceUuid}'::uuid, engine_id, 'af-south-1', 'integration', 'ACTIVE' FROM e
         RETURNING engine_instance_id),
       c AS (INSERT INTO capability.capability (code, name) VALUES ('trade.trade-a', 'Trade-A order commitment')
             RETURNING capability_id),
       s AS (INSERT INTO capability.capability_scope (tenant_id) VALUES ('${this.tenant}') RETURNING scope_id),
       p AS (
         INSERT INTO capability.capability_provider (provider_key, name, provider_type, engine_id, status)
         SELECT 'trade-a.trade', 'TA-08 Medusa', 'BAOBAB_ENGINE', engine_id, 'ACTIVE' FROM e
         RETURNING provider_id)
       INSERT INTO capability.capability_binding (capability_id, engine_instance_id, scope_id, binding_mode,
           status, contract_version, effective_from, provider_id)
       SELECT c.capability_id, i.engine_instance_id, s.scope_id, 'PRIMARY', 'ACTIVE', '1',
              now() - interval '1 hour', p.provider_id FROM c, i, s, p`,
      "baobab-trade engine instance and its capability binding",
    )
    const actual = this.scalar(
      `SELECT engine_instance_key FROM topology.engine_instance WHERE engine_instance_id='${this.engineInstanceUuid}'`,
    )
    if (actual !== this.engineInstance)
      throw new Error(`engine instance key ${actual} != ${this.engineInstance}`)

    const grants = [
      [this.maker, "propose"],
      [this.checker, "approve"],
      [this.operator, "activate"],
      [this.operator, "suspend"],
      [this.operator, "revoke"],
    ]
    this.sql(
      `INSERT INTO policy.administrative_grant (grant_id, principal_id, permission, scope_level, scope, grant_type,
         source, risk_class, valid_from, status, granted_by, reason)
       VALUES ${grants
         .map(
           ([who, action]) =>
             `(gen_random_uuid(), '${who}', 'organisation.seller-operating-binding.${action}', 'ORGANISATION',
               '{"level":"ORGANISATION","organisation_id":"${this.organisation}"}', 'STANDING', 'DIRECT', 'HIGH',
               now() - interval '1 hour', 'ACTIVE', 'ta08-harness', 'TA-08 synthetic seller binding ${action}')`,
         )
         .join(", ")}`,
      "exact HIGH ORGANISATION seller-operating-binding grants for maker, checker and operator",
    )

    this.checkoutMandate = await this.mandate([CHECKOUT], "ta08/mandate-checkout")
    this.evidence.note("cp", {
      tenant_id: this.tenant,
      organisation_id: this.organisation,
      legal_entity_id: LEGAL_ENTITY,
      market_id: this.marketId,
      checkout_mandate_id: this.checkoutMandate,
      engine_instance_key: this.engineInstance,
    })
  }

  /**
   * Propose (maker), approve (checker) and activate (operator) one
   * SELLER_OF_RECORD mandate. capability_scope is omitted: the Trade classes
   * name no capability key, which matches only an unrestricted mandate.
   */
  async mandate(activities, evidence) {
    const { body: proposed } = await this.admin(
      "POST",
      "/v2/legal-actor-mandates",
      this.maker,
      {
        tenant_id: this.tenant,
        operating_organisation_id: this.organisation,
        responsible_legal_entity_id: LEGAL_ENTITY,
        roles: ["SELLER_OF_RECORD"],
        activity_scope: activities,
        market_scope: [MARKET],
        authority_basis_reference: "ta08/board-resolution",
        evidence_references: [evidence],
        effective_from: iso(-300),
      },
      { "Idempotency-Key": key() },
    )
    const id = proposed.mandate_id
    await this.admin(
      "POST",
      `/v2/legal-actor-mandates/${id}/decision`,
      this.checker,
      {
        decision: "APPROVE",
        decision_basis_reference: "ta08/four-eyes-review",
        evidence_references: [evidence],
        legal_actor_verification_reference: "ta08/synthetic-legal-registry",
      },
      { "Idempotency-Key": key() },
    )
    await this.admin(
      "POST",
      `/v2/legal-actor-mandates/${id}/activate`,
      this.operator,
      {
        action: "ACTIVATE",
        authority_basis_reference: "ta08/activation",
        evidence_references: [evidence],
      },
      { "Idempotency-Key": key() },
    )
    return id
  }

  async revokeMandate(id) {
    await this.admin(
      "POST",
      `/v2/legal-actor-mandates/${id}/terminate`,
      this.operator,
      {
        action: "REVOKE",
        authority_basis_reference: "ta08/revocation",
        evidence_references: ["ta08/revocation-evidence"],
      },
      { "Idempotency-Key": key() },
    )
  }

  /** The binding lifecycle (ADR-SHARED-039 §3); `who` must hold the exact grant. */
  async propose(attestationId, who = this.maker) {
    return this.admin(
      "POST",
      "/v2/seller-operating-bindings",
      who,
      {
        attestation_id: attestationId,
        responsible_legal_entity_id: LEGAL_ENTITY,
        effective_from: iso(-60),
        evidence_references: ["ta08/binding-proposal"],
      },
      { "Idempotency-Key": key() },
      [200, 201, 202],
    )
  }

  async transition(binding, action, transition, expected, who) {
    return call(
      "POST",
      `${CP}/v2/seller-operating-bindings/${binding.binding_id}/versions/${binding.binding_version}/${action}`,
      {
        binding_reference: {
          binding_id: binding.binding_id,
          binding_version: binding.binding_version,
        },
        transition,
        expected_status: expected,
        reason: `TA-08 ${action}`,
        evidence_references: [`ta08/binding-${action}`],
      },
      { Authorization: `Bearer ${await humanToken(who)}`, "Idempotency-Key": key() },
    )
  }

  /** CP's immutable Trade order-authority decision history. */
  decisions(where = "true") {
    return this.c.sql(
      "cpdb",
      "controlplane",
      "controlplane",
      `SELECT decision_id, operation_class, outcome, operation_reference, coalesce(mandate_id::text, ''),
              binding_id::text, binding_version
         FROM registry.trade_order_authority_decision WHERE ${where} ORDER BY evaluated_at`,
    )
  }
}
