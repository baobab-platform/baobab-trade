/**
 * ADR-SHARED-042 section 14 Decision 8: the NativeCommitmentClassification
 * store, its database guards (Migration20261022210000) and the classifier on
 * a disposable PostgreSQL 17 database with the real Trade migrations.
 *
 * Synthetic estate, Tenant, Market, profile, binding and buyer identifiers;
 * the CP commerce profile answer is EXPLICITLY SYNTHETIC. This proves Trade's
 * record and rules, never CP, IAM, a registered profile, the commit fence or
 * connected acceptance. Refuses a non-test or unmarked database. Rows are
 * append-only and stay until CI disposes the database.
 */
import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { Pool } from "pg"
import type { TradeBuyerExecutionContext } from "../baobab/b2b/buyer-authority"
import { nativeCommitmentClassificationSchema } from "../baobab/contracts/authority-validation"
import type { CommerceProfileAttestation } from "../baobab/control-plane/estate-commerce-profile"
import type { CommitmentAttribution } from "../baobab/orders/commitment-attribution"
import {
  classifyNativeCommitment,
  PostgresClassificationStore,
  type ClassificationBuyer,
  type ClassifiedResourceType,
} from "../baobab/orders/native-commitment-classification"
import type { PgPool } from "../baobab/orders/postgres-governed-binding-persistence"

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export async function runClassificationRegression(pool: Pool): Promise<string[]> {
  const pg: PgPool = {
    connect: async () => {
      const client = await pool.connect()
      return {
        query: (sql, values) => client.query(sql, values ? [...values] : []),
        release: () => client.release(),
      }
    },
  }
  const store = new PostgresClassificationStore(pg)
  const passed: string[] = []
  const pass = (name: string) => passed.push(name)
  const run = randomUUID().replaceAll("-", "").slice(0, 12)
  const tenant = `tn_dec8${run}`
  const engine = `ei_dec8${run}`
  const estate = `estate_dec8_${run}`
  const market = `market_dec8_${run}`
  const binding = randomUUID()
  const sql = (text: string, values: unknown[] = []) => pool.query(text, values)
  const refused = async (what: string, text: string, values: unknown[] = []) => {
    const error = await sql(text, values).then(
      () => undefined,
      (e: unknown) => e,
    )
    assert.ok(error, `${what} was accepted`)
  }

  // A synthetic native configuration attestation and seller attributions.
  const organisation = randomUUID()
  const attestationId = randomUUID()
  const reference = `trade/native-seller-configuration/dec8-${run}`
  const canonical = JSON.stringify({
    native_configuration_reference: reference,
    tenant_id: tenant,
    operating_organisation_id: organisation,
    market: "UG",
    engine_instance_id: engine,
    currency_scope: ["UGX"],
  })
  const digest = createHash("sha256").update(canonical, "utf8").digest("hex")
  await sql(
    `INSERT INTO trade_native_configuration_attestation (attestation_id, native_configuration_reference,
       native_configuration_digest, canonical_configuration, tenant_id, operating_organisation_id, market,
       engine_instance_id, currency_scope, context_id, attested_at, cp_recorded_at, correlation_id)
     VALUES ($1, $2, $3, $4, $5, $6, 'UG', $7, '{UGX}', $8, now(), now(), 'regression')`,
    [attestationId, reference, digest, canonical, tenant, organisation, engine, randomUUID()],
  )
  const sellerBinding = randomUUID()
  const attribute = async (
    type: "cart" | "draft_order" | "order",
    id: string,
    bindingId = sellerBinding,
  ): Promise<CommitmentAttribution> => {
    const row = (
      await sql(
        `INSERT INTO trade_commitment_attribution (subject_type, subject_id, attestation_id,
           native_configuration_reference, native_configuration_digest, currency, tenant_id,
           operating_organisation_id, market, engine_instance_id, binding_id, binding_version, resolution_id,
           context_id, resolved_at, correlation_id)
         VALUES ($1, $2, $3, $4, $5, 'UGX', $6, $7, 'UG', $8, $9, 1, $10, $11, now(), 'regression')
         RETURNING attribution_id::text, context_id::text, resolved_at`,
        [
          type,
          id,
          attestationId,
          reference,
          digest,
          tenant,
          organisation,
          engine,
          bindingId,
          randomUUID(),
          randomUUID(),
        ],
      )
    ).rows[0]
    return {
      attribution_id: row.attribution_id,
      subject_type: type,
      subject_id: id,
      attestation_id: attestationId,
      native_configuration_reference: reference,
      native_configuration_digest: digest,
      currency: "UGX",
      tenant_id: tenant,
      operating_organisation_id: organisation,
      market: "UG",
      engine_instance_id: engine,
      binding_id: bindingId,
      binding_version: 1,
      resolution_id: randomUUID(),
      context_id: row.context_id,
      resolved_at: new Date(row.resolved_at).toISOString(),
      correlation_id: "regression",
    }
  }

  const profileId = randomUUID()
  // In CP a change of model is a new, superseding profile.
  const successorProfileId = randomUUID()
  let revision = 2
  let model: "B2B" | "B2C" = "B2B"
  let lifetimeMs = 60_000
  const answer = (): CommerceProfileAttestation => {
    const now = Date.now()
    return {
      attestationId: randomUUID(),
      commerceProfileId: model === "B2B" ? profileId : successorProfileId,
      profileRevision: model === "B2B" ? revision : 1,
      digitalEstateId: estate,
      tenantId: tenant,
      engineInstanceId: engine,
      marketId: market,
      commerceModel: model,
      issuedAt: new Date(now),
      expiresAt: new Date(now + lifetimeMs),
      profileEffectiveUntil: null,
      evidenceReference: "synthetic:regression-profile",
    }
  }
  const estateBinding = () => ({
    bindingId: binding,
    revision: 1,
    digitalEstateId: estate,
    tenantId: tenant,
    engineInstanceId: engine,
    expiresAt: new Date(Date.now() + 60_000),
  })
  const b2b: ClassificationBuyer = {
    model: "BUYER_ORGANISATION",
    context: {
      context_id: randomUUID(),
      digital_estate_id: estate,
      tenant_id: tenant,
      engine_instance_id: engine,
      buyer_organisation_id: `b2borg_${run}`,
      buyer_membership_id: `b2bmem_${run}`,
      expires_at: new Date(Date.now() + 600_000).toISOString(),
      evidence_references: [`cp-estate-binding:${binding}@r1`],
    } as TradeBuyerExecutionContext,
  }
  const consumer: ClassificationBuyer = { model: "CONSUMER", consumerReference: `consumer:${run}` }
  const classify = (
    resource: { type: ClassifiedResourceType; id: string },
    attribution: CommitmentAttribution,
    buyer: ClassificationBuyer = b2b,
  ) =>
    classifyNativeCommitment(
      { engineInstanceId: engine, store, profiles: { resolve: async () => answer() } },
      {
        resource,
        attribution,
        sellerContext: { contextId: attribution.context_id, marketId: market },
        estate: estateBinding(),
        buyer,
        correlationId: randomUUID(),
      },
    )

  // 1. A B2B cart classified from the attestation, persisted and contract-valid.
  const cartA = `cart_dec8a${run}`
  const attributionA = await attribute("cart", cartA)
  const first = await classify({ type: "cart", id: cartA }, attributionA)
  assert.equal(first.outcome, "CLASSIFIED")
  if (first.outcome !== "CLASSIFIED") throw new Error("unreachable")
  assert.equal(first.classification.commerce_model, "B2B")
  assert.ok(nativeCommitmentClassificationSchema(first.classification))
  assert.equal(
    (
      await sql(
        `SELECT count(*)::int AS n FROM trade_commerce_profile_observation
          WHERE commerce_profile_id = $1 AND outcome = 'ATTESTED'`,
        [profileId],
      )
    ).rows[0].n,
    1,
  )
  pass("a B2B cart is classified from a live attestation and is contract-valid")

  // 2. The same answer again returns the same classification.
  const again = await classify({ type: "cart", id: cartA }, attributionA)
  assert.equal(again.outcome, "CLASSIFIED")
  if (again.outcome === "CLASSIFIED")
    assert.equal(again.classification.classification_id, first.classification.classification_id)
  pass("re-classifying with the same answer returns the existing record")

  // 3. Concurrent first classifications of one resource create exactly one.
  const cartC = `cart_dec8c${run}`
  const attributionC = await attribute("cart", cartC)
  const raced = await Promise.all(
    Array.from({ length: 5 }, () => classify({ type: "cart", id: cartC }, attributionC)),
  )
  const ids = new Set(
    raced.map((r) => (r.outcome === "CLASSIFIED" ? r.classification.classification_id : r.reason)),
  )
  assert.equal(ids.size, 1)
  assert.equal(
    (
      await sql(
        `SELECT count(*)::int AS n FROM trade_native_commitment_classification WHERE resource_id = $1`,
        [cartC],
      )
    ).rows[0].n,
    1,
  )
  pass("concurrent classifications of one resource record exactly one")

  // 4. A different model for a classified resource quarantines it; it stays retired.
  model = "B2C"
  assert.deepEqual(await classify({ type: "cart", id: cartC }, attributionC, consumer), {
    outcome: "REFUSED",
    reason: "CLASSIFICATION_CHANGED",
  })
  model = "B2B"
  const quarantined = (
    await sql(
      `SELECT status, revision FROM trade_native_commitment_classification WHERE resource_id = $1`,
      [cartC],
    )
  ).rows[0]
  assert.deepEqual(quarantined, { status: "QUARANTINED", revision: 2 })
  assert.deepEqual(await classify({ type: "cart", id: cartC }, attributionC), {
    outcome: "REFUSED",
    reason: "CLASSIFICATION_CHANGED",
  })
  pass("a changed model quarantines the classification and it stays retired")

  // 5. Observation guards.
  const observe = (change: Record<string, unknown> = {}) => {
    const a = { ...answer(), ...change } as CommerceProfileAttestation
    return sql(
      `INSERT INTO trade_commerce_profile_observation (digital_estate_id, engine_instance_id, market_id,
         estate_binding_id, outcome, attestation_id, commerce_profile_id, profile_revision, tenant_id,
         commerce_model, issued_at, expires_at, evidence_reference, correlation_id)
       VALUES ($1, $2, $3, $4, 'ATTESTED', $5, $6, $7, $8, $9, $10, $11, 'synthetic', $12)`,
      [
        a.digitalEstateId,
        engine,
        market,
        binding,
        a.attestationId,
        a.commerceProfileId,
        a.profileRevision,
        a.tenantId,
        a.commerceModel,
        a.issuedAt,
        a.expiresAt,
        randomUUID(),
      ],
    )
  }
  {
    const error = await observe({ profileRevision: 1 }).then(
      () => undefined,
      (e: unknown) => e,
    )
    assert.match(String(error), /older than one already seen/)
  }
  {
    const error = await observe({ tenantId: "tn_other01" }).then(
      () => undefined,
      (e: unknown) => e,
    )
    assert.match(String(error), /contradicts an earlier attestation/)
  }
  {
    const error = await observe({
      expiresAt: new Date(Date.now() - 1000),
      issuedAt: new Date(Date.now() - 5000),
    }).then(
      () => undefined,
      (e: unknown) => e,
    )
    assert.match(String(error), /expired/)
  }
  {
    const error = await observe({ expiresAt: new Date(Date.now() + 120_000) }).then(
      () => undefined,
      (e: unknown) => e,
    )
    assert.ok(error, "an attestation longer than 60 s was accepted")
  }
  await refused(
    "a denial naming a profile",
    `INSERT INTO trade_commerce_profile_observation (digital_estate_id, engine_instance_id, market_id,
       estate_binding_id, outcome, commerce_profile_id, correlation_id)
     VALUES ($1, $2, $3, $4, 'PROFILE_NOT_ACTIVE', $5, $6)`,
    [estate, engine, market, binding, profileId, randomUUID()],
  )
  await refused(
    "an observation update",
    `UPDATE trade_commerce_profile_observation SET commerce_model = 'B2C' WHERE commerce_profile_id = $1`,
    [profileId],
  )
  await refused(
    "an observation delete",
    `DELETE FROM trade_commerce_profile_observation WHERE commerce_profile_id = $1`,
    [profileId],
  )
  await refused("an observation truncate", `TRUNCATE trade_commerce_profile_observation CASCADE`)
  pass("observations are append-only, current, never stale and never contradictory")

  // 6. Classification guards, by direct SQL.
  const live = answer()
  await observe({ attestationId: live.attestationId, profileRevision: live.profileRevision })
  const insert = (change: Record<string, unknown>) => {
    const row: Record<string, unknown> = {
      resource_type: "cart",
      resource_id: `cart_dec8raw${randomUUID().slice(0, 8)}`,
      origin: "DIRECT",
      parent_classification_id: null,
      lineage_relation: null,
      digital_estate_id: estate,
      tenant_id: tenant,
      trade_engine_instance_id: engine,
      market_id: market,
      commerce_model: "B2B",
      commerce_profile_id: profileId,
      profile_revision: live.profileRevision,
      profile_attestation_id: live.attestationId,
      attribution_id: attributionA.attribution_id,
      seller_binding_id: sellerBinding,
      seller_binding_version: 1,
      seller_context_id: attributionA.context_id,
      buyer_account_model: "BUYER_ORGANISATION",
      buyer_organisation_id: `b2borg_${run}`,
      buyer_membership_id: `b2bmem_${run}`,
      machine_mandate_reference: null,
      consumer_reference: null,
      buyer_context_id: randomUUID(),
      status: "ACTIVE",
      revision: 1,
      evidence_references: ["synthetic:regression"],
      correlation_id: randomUUID(),
      ...change,
    }
    const columns = Object.keys(row)
    return sql(
      `INSERT INTO trade_native_commitment_classification (${columns.join(", ")})
       VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING classification_id::text`,
      Object.values(row),
    )
  }
  const raw = async (what: string, change: Record<string, unknown>, pattern?: RegExp) => {
    const error = await insert(change).then(
      () => undefined,
      (e: unknown) => e,
    )
    assert.ok(error, `${what} was accepted`)
    if (pattern) assert.match(String(error), pattern, what)
  }
  const cartR = `cart_dec8r${run}`
  const attributionR = await attribute("cart", cartR)
  const base = {
    resource_id: cartR,
    attribution_id: attributionR.attribution_id,
    seller_context_id: attributionR.context_id,
  }
  await raw(
    "another resource's attribution",
    { resource_id: `cart_other${run}` },
    /seller attribution/,
  )
  await raw(
    "another seller binding",
    { ...base, seller_binding_id: randomUUID() },
    /seller attribution/,
  )
  await raw(
    "another CP context",
    { ...base, seller_context_id: randomUUID() },
    /seller attribution/,
  )
  await raw(
    "another Market",
    { ...base, market_id: `market_other_${run}` },
    /live CP commerce profile/,
  )
  await raw(
    "another model",
    {
      ...base,
      commerce_model: "B2C",
      buyer_account_model: "CONSUMER",
      buyer_organisation_id: null,
      buyer_membership_id: null,
      buyer_context_id: null,
      consumer_reference: "consumer:x",
    },
    /live CP commerce profile/,
  )
  await raw("an older revision", { ...base, profile_revision: 1 }, /live CP commerce profile/)
  await raw("B2B without a membership or mandate", { ...base, buyer_membership_id: null })
  await raw("B2B with both a membership and a mandate", {
    ...base,
    machine_mandate_reference: "mandate:x",
  })
  await raw("B2B with a consumer", { ...base, consumer_reference: "consumer:x" })
  await raw("B2C with a buyer Organisation", {
    ...base,
    commerce_model: "B2C",
    buyer_account_model: "CONSUMER",
    consumer_reference: "consumer:x",
  })
  await raw("a conversion without a parent", { ...base, origin: "CONVERTED" })
  await raw("a direct record with lineage", {
    ...base,
    lineage_relation: "CONVERTED_FROM",
    parent_classification_id: first.classification.classification_id,
  })
  await raw("a non-ACTIVE start", { ...base, status: "QUARANTINED" }, /starts ACTIVE/)
  await raw("a quotation", { ...base, resource_type: "quotation" }, /quotation/)
  const direct = (await insert(base)).rows[0].classification_id as string
  await raw("a second classification of the resource", base, /already classified/)
  pass("a classification matches its attestation, seller attribution and buyer model")

  // Immutable, and retired only once.
  for (const [what, set] of [
    ["a model change", "commerce_model = 'B2C'"],
    ["a Market change", `market_id = 'market_other_${run}'`],
    ["a revision-only change", "revision = 2"],
    ["an unversioned retirement", "status = 'SUPERSEDED'"],
  ] as const) {
    await refused(
      what,
      `UPDATE trade_native_commitment_classification SET ${set} WHERE classification_id = $1`,
      [direct],
    )
  }
  await sql(
    `UPDATE trade_native_commitment_classification SET status = 'QUARANTINED', revision = 2
      WHERE classification_id = $1`,
    [direct],
  )
  await refused(
    "a reactivation",
    `UPDATE trade_native_commitment_classification SET status = 'ACTIVE', revision = 3 WHERE classification_id = $1`,
    [direct],
  )
  await refused(
    "a delete",
    `DELETE FROM trade_native_commitment_classification WHERE classification_id = $1`,
    [direct],
  )
  await refused("a truncate", `TRUNCATE trade_native_commitment_classification CASCADE`)
  await raw("a fresh direct record after quarantine", base, /already classified/)
  pass("a classification never changes, is retired once and never deleted")

  // A governed replacement names the retired record; only one may be ACTIVE.
  const replacement = (
    await insert({
      ...base,
      origin: "REPLACEMENT",
      lineage_relation: "REPLACES",
      parent_classification_id: direct,
    })
  ).rows[0].classification_id as string
  await raw("a replacement of an ACTIVE record", {
    ...base,
    origin: "REPLACEMENT",
    lineage_relation: "REPLACES",
    parent_classification_id: replacement,
  })
  await raw("a second ACTIVE replacement", {
    ...base,
    origin: "REPLACEMENT",
    lineage_relation: "REPLACES",
    parent_classification_id: direct,
  })
  await raw("a replacement of another resource's record", {
    ...base,
    resource_id: cartA,
    attribution_id: attributionA.attribution_id,
    seller_context_id: attributionA.context_id,
    origin: "REPLACEMENT",
    lineage_relation: "REPLACES",
    parent_classification_id: direct,
  })
  pass("a governed replacement names the retired record and never runs alongside it")

  // A conversion carries its parent's model forward, at most once.
  const orderO = `order_dec8o${run}`
  const attributionO = await attribute("order", orderO)
  const converted = {
    resource_type: "order",
    resource_id: orderO,
    attribution_id: attributionO.attribution_id,
    seller_context_id: attributionO.context_id,
    origin: "CONVERTED",
    lineage_relation: "CONVERTED_FROM",
    parent_classification_id: first.classification.classification_id,
  }
  await raw(
    "a conversion to another buyer",
    { ...converted, buyer_organisation_id: `b2borg_other${run}` },
    /continues its parent/,
  )
  await raw(
    "a conversion from a quarantined parent",
    { ...converted, parent_classification_id: direct },
    /continues its parent/,
  )
  await insert(converted)
  const orderP = `order_dec8p${run}`
  const attributionP = await attribute("order", orderP)
  await raw("a second conversion of one parent", {
    ...converted,
    resource_id: orderP,
    attribution_id: attributionP.attribution_id,
    seller_context_id: attributionP.context_id,
  })
  pass("a conversion continues its parent unchanged and is taken at most once")

  // 7. An attestation that expires before the classification is refused.
  lifetimeMs = 1_000
  const cartE = `cart_dec8e${run}`
  const attributionE = await attribute("cart", cartE)
  const short = answer()
  await observe({
    attestationId: short.attestationId,
    issuedAt: short.issuedAt,
    expiresAt: short.expiresAt,
  })
  await sleep(1_200)
  await raw(
    "a classification after its attestation expired",
    {
      resource_id: cartE,
      attribution_id: attributionE.attribution_id,
      seller_context_id: attributionE.context_id,
      profile_attestation_id: short.attestationId,
    },
    /live CP commerce profile/,
  )
  lifetimeMs = 60_000
  pass("an expired attestation never classifies")

  return passed
}

export default async function () {
  const url = process.env.DATABASE_URL
  const expected = process.env.BAOBAB_CLASSIFICATION_TEST_DB
  if (
    process.env.NODE_ENV !== "test" ||
    !expected ||
    !url ||
    new URL(url).pathname !== `/${expected}`
  ) {
    throw new Error(
      "Native commitment classification regression requires the explicitly marked disposable test database",
    )
  }
  const pool = new Pool({ connectionString: url, max: 8 })
  try {
    for (const name of await runClassificationRegression(pool)) console.log(`PASS ${name}`)
  } finally {
    await pool.end()
  }
}
