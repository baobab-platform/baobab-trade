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
    console.info(
      "Trade-0 native-configuration attestation regression passed (synthetic CP, engine-local)",
    )
  } finally {
    await regions.deleteRegions(region.id)
    await channels.deleteSalesChannels(channel.id)
    await pool.end()
  }
}
