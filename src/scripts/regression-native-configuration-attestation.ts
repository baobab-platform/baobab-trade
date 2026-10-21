/**
 * ADR-SHARED-039 Trade-0 disposable PostgreSQL 17 / real Medusa acceptance of
 * Trade's native-configuration attestation. Real sales channel and region
 * records and the applied migration; the CP context and attestation ports are
 * explicitly SYNTHETIC. This is engine-local evidence: not EA Gate D, not L4,
 * and no binding, approval, activation or order authority is created.
 */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { Pool } from "pg"
import type {
  ExecArgs,
  IRegionModuleService,
  ISalesChannelModuleService,
} from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import {
  attestNativeSellerConfiguration,
  PostgresNativeConfigurationAttestationStore,
  type RecordedNativeConfigurationAttestation,
} from "../baobab/orders/native-configuration-attestation"
import {
  currentNativeSellerConfiguration,
  type NativeSellerConfigurationScope,
} from "../baobab/orders/native-seller-configuration"
import { medusaNativeSellerFacts } from "./attest-native-seller-configuration"
import { PostgresCommitmentAttributionStore } from "../baobab/orders/commitment-attribution"
import { PostgresOrderAuthorityReceiptStore } from "../baobab/orders/order-authority-enforcement"
import {
  PostgresAttestedNativeConfigurationReader,
  resolveNativeConfiguration,
} from "../baobab/orders/native-configuration-resolver"

const refused = async (what: string, run: () => Promise<unknown>, code?: string) => {
  try {
    await run()
  } catch (error) {
    if (code) assert.equal((error as { code?: string }).code, code, `${what}: wrong refusal`)
    return
  }
  assert.fail(`${what} was not refused`)
}

export default async function ({ container }: ExecArgs) {
  const url = process.env.DATABASE_URL
  const expected = process.env.BAOBAB_BINDING_LIFECYCLE_TEST_DB
  if (
    process.env.NODE_ENV !== "test" ||
    !expected ||
    !url ||
    new URL(url).pathname !== `/${expected}`
  ) {
    throw new Error(
      "Attestation regression requires the explicitly marked disposable test database",
    )
  }
  const channels = container.resolve<ISalesChannelModuleService>(Modules.SALES_CHANNEL)
  const regions = container.resolve<IRegionModuleService>(Modules.REGION)
  const pool = new Pool({ connectionString: url, max: 2 })
  const store = new PostgresNativeConfigurationAttestationStore({
    connect: async () => {
      const client = await pool.connect()
      return {
        query: (sql, values) => client.query(sql, values ? [...values] : []),
        release: () => client.release(),
      }
    },
  })
  // A market no bootstrap step uses, so the region's country stays free.
  const channel = await channels.createSalesChannels({
    name: `synthetic attestation ${randomUUID()}`,
  })
  const region = await regions.createRegions({
    name: `synthetic attestation ${randomUUID()}`,
    currency_code: "lsl",
    countries: ["ls"],
  })
  try {
    const facts = medusaNativeSellerFacts(container)
    const scope: NativeSellerConfigurationScope = {
      reference: `trade/native-seller-configuration/regression-${randomUUID()}`,
      tenantId: "tn_regressionattest",
      organisationId: randomUUID(),
      market: "LS",
      engineInstanceId: "ei_traderegression",
      currencyScope: ["LSL"],
      salesChannelIds: [channel.id],
      regionIds: [region.id],
    }

    // Live native records digest deterministically.
    const first = await currentNativeSellerConfiguration(scope, facts)
    const again = await currentNativeSellerConfiguration(scope, facts)
    assert.equal(first.digest, again.digest)
    assert.match(first.digest, /^[0-9a-f]{64}$/)

    // Drift in a live record is denied, not silently re-digested.
    await channels.updateSalesChannels(channel.id, { is_disabled: true })
    await refused("disabled channel", () => currentNativeSellerConfiguration(scope, facts))
    await channels.updateSalesChannels(channel.id, { is_disabled: false })
    await refused("currency outside scope", () =>
      currentNativeSellerConfiguration({ ...scope, currencyScope: ["LSL", "ZAR"] }, facts),
    )
    await refused("undeclared region", () =>
      currentNativeSellerConfiguration({ ...scope, regionIds: [region.id, "reg_missing"] }, facts),
    )

    // End to end with the REAL facts reader and store; CP ports are synthetic.
    let attested: Record<string, unknown> | undefined
    const recorded = await attestNativeSellerConfiguration(scope, {
      facts,
      store,
      tokens: { getAccessToken: async () => "synthetic-workload-token" },
      controlPlane: {
        resolvePlatformContext: async (
          tenantId,
          organisationId,
          _token,
          _correlation,
          _type,
          country,
        ) => ({
          context_id: randomUUID(),
          tenant_id: tenantId,
          organisation_id: organisationId,
          organisation_type: "ORGANISATION",
          country_code: country,
          resolved_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        }),
      },
      attestations: {
        attest: async (request, expectedScope) => {
          attested = request
          return {
            attestation_id: randomUUID(),
            tenant_id: expectedScope.tenantId,
            operating_organisation_id: expectedScope.organisationId,
            market: expectedScope.market,
            engine_instance_id: request.engine_instance_id,
            native_configuration_reference: request.native_configuration_reference,
            native_configuration_digest: request.native_configuration_digest,
            currency_scope: request.currency_scope,
            attested_at: request.attested_at,
            recorded_at: new Date().toISOString(),
          }
        },
      },
      environment: { node: "test", enabled: "true" },
    })
    assert.equal(attested?.native_configuration_digest, first.digest)
    const row = await pool.query(
      "SELECT native_configuration_digest, currency_scope FROM trade_native_configuration_attestation WHERE attestation_id = $1",
      [recorded.attestation_id],
    )
    assert.equal(row.rows[0]?.native_configuration_digest, first.digest)
    assert.deepEqual(row.rows[0]?.currency_scope, ["LSL"])

    // The database recomputes the digest and refuses any history rewrite.
    const forged: RecordedNativeConfigurationAttestation = {
      ...recorded,
      attestation_id: randomUUID(),
      native_configuration_digest: "0".repeat(64),
    }
    await refused(
      "digest that the canonical document does not produce",
      () => store.record(forged),
      "23514",
    )
    await refused(
      "canonical document for another tenant",
      () =>
        store.record({ ...recorded, attestation_id: randomUUID(), tenant_id: "tn_othertenant" }),
      "23514",
    )
    await refused(
      "currency scope the canonical document does not cover",
      () =>
        store.record({ ...recorded, attestation_id: randomUUID(), currency_scope: ["LSL", "ZAR"] }),
      "23514",
    )
    await refused("duplicate attestation", () => store.record(recorded), "23505")
    await refused("UPDATE", () =>
      pool.query(
        "UPDATE trade_native_configuration_attestation SET market = 'ZA' WHERE attestation_id = $1",
        [recorded.attestation_id],
      ),
    )
    await refused("DELETE", () =>
      pool.query("DELETE FROM trade_native_configuration_attestation WHERE attestation_id = $1", [
        recorded.attestation_id,
      ]),
    )
    await refused("TRUNCATE", () => pool.query("TRUNCATE trade_native_configuration_attestation"))

    // Trade-A TA-03: the real reader maps a native record to its attested
    // configuration and recomputes the live digest; drift is denied.
    const reader = new PostgresAttestedNativeConfigurationReader({
      connect: async () => {
        const client = await pool.connect()
        return {
          query: (sql, values) => client.query(sql, values ? [...values] : []),
          release: () => client.release(),
        }
      },
    })
    const mapped = await resolveNativeConfiguration(
      { salesChannelId: channel.id, regionId: region.id, currency: "lsl" },
      scope.engineInstanceId,
      reader,
      facts,
    )
    assert.equal(mapped.reference, scope.reference)
    assert.equal(mapped.digest, first.digest)
    assert.equal(mapped.attestationId, recorded.attestation_id)
    await refused("record outside every attested configuration", () =>
      resolveNativeConfiguration(
        { salesChannelId: "sc_unattested", regionId: region.id, currency: "LSL" },
        scope.engineInstanceId,
        reader,
        facts,
      ),
    )
    await channels.updateSalesChannels(channel.id, { is_disabled: true })
    await refused("drifted live configuration", () =>
      resolveNativeConfiguration(
        { salesChannelId: channel.id, regionId: region.id, currency: "LSL" },
        scope.engineInstanceId,
        reader,
        facts,
      ),
    )
    await channels.updateSalesChannels(channel.id, { is_disabled: false })

    // Trade-A TA-04: append-only attribution; the database refuses a seller
    // change, a version regression, an unattested configuration and rewrites.
    const attributions = new PostgresCommitmentAttributionStore({
      connect: async () => {
        const client = await pool.connect()
        return {
          query: (sql, values) => client.query(sql, values ? [...values] : []),
          release: () => client.release(),
        }
      },
    })
    const sellerA = randomUUID()
    const cartId = `cart_regression_${randomUUID().slice(0, 8)}`
    const base = {
      subject_type: "cart" as const,
      subject_id: cartId,
      attestation_id: recorded.attestation_id,
      native_configuration_reference: scope.reference,
      native_configuration_digest: first.digest,
      currency: "LSL",
      tenant_id: scope.tenantId,
      operating_organisation_id: scope.organisationId,
      market: scope.market,
      engine_instance_id: scope.engineInstanceId,
      binding_id: sellerA,
      binding_version: 2,
      context_id: randomUUID(),
      resolved_at: new Date().toISOString(),
      correlation_id: "regression/attribution",
    }
    const attributed = await attributions.record({ ...base, resolution_id: randomUUID() })
    assert.equal(
      (await attributions.current({ type: "cart", id: cartId }))?.attribution_id,
      attributed.attribution_id,
    )
    await attributions.record({ ...base, binding_version: 3, resolution_id: randomUUID() })
    assert.equal((await attributions.current({ type: "cart", id: cartId }))?.binding_version, 3)
    await refused("a different seller binding for the same cart", () =>
      attributions.record({
        ...base,
        binding_id: randomUUID(),
        binding_version: 3,
        resolution_id: randomUUID(),
      }),
    )
    await refused("a regression to an older binding version", () =>
      attributions.record({ ...base, binding_version: 1, resolution_id: randomUUID() }),
    )
    await refused("a digest Trade never attested", () =>
      attributions.record({
        ...base,
        binding_version: 3,
        native_configuration_digest: "0".repeat(64),
        resolution_id: randomUUID(),
      }),
    )
    await refused("a currency outside the attested scope", () =>
      attributions.record({
        ...base,
        binding_version: 3,
        currency: "ZAR",
        resolution_id: randomUUID(),
      }),
    )
    await refused("another tenant's scope", () =>
      attributions.record({
        ...base,
        binding_version: 3,
        tenant_id: "tn_othertenant",
        resolution_id: randomUUID(),
      }),
    )
    await refused(
      "a replayed resolution",
      () =>
        attributions.record({
          ...base,
          binding_version: 3,
          resolution_id: attributed.resolution_id,
        }),
      "23505",
    )
    await refused("UPDATE of attribution", () =>
      pool.query(
        "UPDATE trade_commitment_attribution SET binding_version = 9 WHERE attribution_id = $1",
        [attributed.attribution_id],
      ),
    )
    await refused("DELETE of attribution", () =>
      pool.query("DELETE FROM trade_commitment_attribution WHERE attribution_id = $1", [
        attributed.attribution_id,
      ]),
    )
    await refused("TRUNCATE of attribution", () =>
      pool.query("TRUNCATE trade_commitment_attribution"),
    )
    // Trade-A TA-05: an order-authority receipt matches its attribution, holds
    // at most a 30 s lease, is never replayed and is consumed at most once.
    const receipts = new PostgresOrderAuthorityReceiptStore({
      connect: async () => {
        const client = await pool.connect()
        return {
          query: (sql, values) => client.query(sql, values ? [...values] : []),
          release: () => client.release(),
        }
      },
    })
    const latest = await attributions.current({ type: "cart", id: cartId })
    assert.ok(latest)
    const received = Date.now()
    const receiptBase = {
      attribution_id: latest.attribution_id,
      operation_class: "trade.order.commit" as const,
      operation_reference: `trade/trade.order.commit/${cartId}/r1/a1`,
      binding_id: latest.binding_id,
      binding_version: latest.binding_version,
      native_configuration_digest: latest.native_configuration_digest,
      currency: latest.currency,
      context_id: latest.context_id,
      tenant_id: latest.tenant_id,
      operating_organisation_id: latest.operating_organisation_id,
      market: latest.market,
      mandate_id: randomUUID(),
      responsible_legal_entity_id: "SYNTHETIC-LE-REGRESSION",
      policy_reference: "ADR-SHARED-039/trade-order-authority:v1",
      evaluated_at: new Date(received).toISOString(),
      received_at: new Date(received).toISOString(),
      lease_expires_at: new Date(received + 20_000).toISOString(),
    }
    const receipt = await receipts.record({ ...receiptBase, decision_id: randomUUID() })
    await refused(
      "a second live receipt for the same operation",
      () => receipts.record({ ...receiptBase, decision_id: randomUUID() }),
      "23505",
    )
    for (const [what, over] of [
      ["another binding version", { binding_version: 9 }],
      ["another digest", { native_configuration_digest: "1".repeat(64) }],
      ["another context", { context_id: randomUUID() }],
      ["another tenant", { tenant_id: "tn_othertenant" }],
      ["a lease over 30 s", { lease_expires_at: new Date(received + 31_000).toISOString() }],
      [
        "an expired lease",
        {
          evaluated_at: new Date(received - 40_000).toISOString(),
          received_at: new Date(received - 40_000).toISOString(),
          lease_expires_at: new Date(received - 20_000).toISOString(),
        },
      ],
      ["a reserved class", { operation_class: "trade.payment-refund.request" }],
    ] as const) {
      await refused(`receipt for ${what}`, () =>
        receipts.record({
          ...receiptBase,
          ...(over as Record<string, unknown>),
          operation_reference: `trade/trade.order.commit/${cartId}/r1/${randomUUID().slice(0, 6)}`,
          decision_id: randomUUID(),
        } as never),
      )
    }
    await refused("rewriting a receipt", () =>
      pool.query("UPDATE trade_order_authority_receipt SET mandate_id = $2 WHERE receipt_id = $1", [
        receipt.receipt_id,
        randomUUID(),
      ]),
    )
    // TA-07: only the native commit fence consumes a receipt; a direct UPDATE
    // cannot (single consumption at the fence is proven by regression:trade-a-commit-fences).
    await refused("consuming a receipt outside the commit fence", () =>
      pool.query(
        "UPDATE trade_order_authority_receipt SET consumed_at = clock_timestamp() WHERE receipt_id = $1",
        [receipt.receipt_id],
      ),
    )
    await refused("DELETE of a receipt", () =>
      pool.query("DELETE FROM trade_order_authority_receipt WHERE receipt_id = $1", [
        receipt.receipt_id,
      ]),
    )
    await refused("TRUNCATE of receipts", () =>
      pool.query("TRUNCATE trade_order_authority_receipt"),
    )

    // Every class has exactly one native subject kind. Prove all six wrong
    // pairings through both the exported store and raw SQL, not just the
    // application PEP. Each attempted insert uses a fresh operation/decision
    // and lease, so uniqueness or expiry cannot masquerade as type checking.
    // These are synthetic attribution records, not committed native orders.
    const subjects = [
      { type: "cart", operationClass: "trade.order.commit", attribution: latest },
      {
        type: "order",
        operationClass: "trade.order.create",
        attribution: await attributions.record({
          ...base,
          binding_version: latest.binding_version,
          subject_type: "order",
          subject_id: `order_${cartId}`,
          resolution_id: randomUUID(),
        }),
      },
      {
        type: "draft_order",
        operationClass: "trade.draft-order.finalize",
        attribution: await attributions.record({
          ...base,
          binding_version: latest.binding_version,
          subject_type: "draft_order",
          subject_id: `draft_${cartId}`,
          resolution_id: randomUUID(),
        }),
      },
    ] as const
    const freshLease = () => {
      const at = Date.now()
      return {
        evaluated_at: new Date(at).toISOString(),
        received_at: new Date(at).toISOString(),
        lease_expires_at: new Date(at + 20_000).toISOString(),
      }
    }
    for (const subject of subjects) {
      // The corresponding class remains usable, ruling out an always-denying
      // guard or an unrelated scope mismatch as the reason negatives pass.
      await receipts.record({
        ...receiptBase,
        ...freshLease(),
        attribution_id: subject.attribution.attribution_id,
        operation_class: subject.operationClass,
        operation_reference: `regression/matched/${randomUUID()}`,
        decision_id: randomUUID(),
      })
      for (const candidate of subjects) {
        if (candidate.operationClass === subject.operationClass) continue
        await refused(
          `store ${candidate.operationClass} against ${subject.type}`,
          () =>
            receipts.record({
              ...receiptBase,
              ...freshLease(),
              attribution_id: subject.attribution.attribution_id,
              operation_class: candidate.operationClass,
              operation_reference: `regression/wrong-store/${randomUUID()}`,
              decision_id: randomUUID(),
            }),
          "P0001",
        )
        const decisionId = randomUUID()
        await refused(
          `SQL ${candidate.operationClass} against ${subject.type}`,
          () =>
            pool.query(
              `
          INSERT INTO trade_order_authority_receipt
            (attribution_id, operation_class, operation_reference, decision_id, binding_id, binding_version,
             native_configuration_digest, currency, context_id, tenant_id, operating_organisation_id, market,
             mandate_id, responsible_legal_entity_id, policy_reference, evaluated_at, received_at, lease_expires_at)
          SELECT $1::uuid, $2, $3, $4::uuid, binding_id, binding_version, native_configuration_digest,
             currency, context_id, tenant_id, operating_organisation_id, market, mandate_id,
             responsible_legal_entity_id, policy_reference, clock_timestamp(), clock_timestamp(),
             clock_timestamp() + interval '20 seconds'
          FROM trade_order_authority_receipt WHERE receipt_id = $5::uuid`,
              [
                subject.attribution.attribution_id,
                candidate.operationClass,
                `regression/wrong-sql/${randomUUID()}`,
                decisionId,
                receipt.receipt_id,
              ],
            ),
          "P0001",
        )
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int AS total FROM trade_order_authority_receipt WHERE decision_id=$1::uuid",
              [decisionId],
            )
          ).rows[0].total,
          0,
          "a rejected raw-SQL receipt must leave no evidence",
        )
      }
    }
    console.info(
      "Trade-0 native-configuration attestation regression passed (synthetic CP, engine-local)",
    )
  } finally {
    await regions.deleteRegions(region.id)
    await channels.deleteSalesChannels(channel.id)
    await pool.end()
  }
}
