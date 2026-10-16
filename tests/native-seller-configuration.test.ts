import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import {
  canonicalNativeSellerConfiguration,
  NATIVE_CONFIGURATION_CANONICALIZATION,
  type NativeRegionFact,
  type NativeSalesChannelFact,
  type NativeSellerConfigurationScope,
} from "../src/baobab/orders/native-seller-configuration"

const scope: NativeSellerConfigurationScope = {
  reference: "trade/native-seller-configuration/zuribeans-ug",
  tenantId: "tn_zuribeans",
  organisationId: "0199a1b2-c3d4-7e8f-9a0b-1c2d3e4f5a6c",
  market: "UG",
  engineInstanceId: "ei_tradestaging01",
  currencyScope: ["UGX", "USD"],
  salesChannelIds: ["sc_b", "sc_a"],
  regionIds: ["reg_usd", "reg_ugx"],
}
const channels: NativeSalesChannelFact[] = [
  { id: "sc_a", is_disabled: false },
  { id: "sc_b", is_disabled: false },
]
const regions: NativeRegionFact[] = [
  { id: "reg_ugx", currency_code: "ugx", countries: ["ug"] },
  { id: "reg_usd", currency_code: "usd", countries: ["ug"] },
]

describe("ADR-SHARED-039 native seller configuration digest", () => {
  it("is the SHA-256 of a deterministic canonical document", () => {
    const result = canonicalNativeSellerConfiguration(scope, channels, regions)
    expect(result.digest).toBe(createHash("sha256").update(result.canonical, "utf8").digest("hex"))
    const doc = JSON.parse(result.canonical)
    expect(doc.canonicalization).toBe(NATIVE_CONFIGURATION_CANONICALIZATION)
    expect(doc.sales_channels.map((c: { id: string }) => c.id)).toEqual(["sc_a", "sc_b"])
    expect(doc.regions[0]).toEqual({ id: "reg_ugx", currency_code: "UGX", countries: ["UG"] })
    expect(result.currencyScope).toEqual(["UGX", "USD"])
  })

  it("does not depend on declaration or read order", () => {
    const a = canonicalNativeSellerConfiguration(scope, channels, regions)
    const b = canonicalNativeSellerConfiguration(
      {
        ...scope,
        salesChannelIds: ["sc_a", "sc_b"],
        regionIds: ["reg_ugx", "reg_usd"],
        currencyScope: ["USD", "UGX"],
      },
      [...channels].reverse(),
      [...regions].reverse(),
    )
    expect(b.digest).toBe(a.digest)
  })

  it("changes when any attested native fact or scope element changes", () => {
    const base = canonicalNativeSellerConfiguration(scope, channels, regions).digest
    const variants = [
      canonicalNativeSellerConfiguration({ ...scope, reference: "trade/other" }, channels, regions),
      canonicalNativeSellerConfiguration(
        { ...scope, engineInstanceId: "ei_tradeother01" },
        channels,
        regions,
      ),
      canonicalNativeSellerConfiguration(
        { ...scope, organisationId: "0199a1b2-c3d4-7e8f-9a0b-1c2d3e4f5a6d" },
        channels,
        regions,
      ),
      canonicalNativeSellerConfiguration(
        { ...scope, salesChannelIds: ["sc_a"] },
        [channels[0]],
        regions,
      ),
      canonicalNativeSellerConfiguration(
        { ...scope, regionIds: ["reg_ugx"], currencyScope: ["UGX"] },
        channels,
        [regions[0]],
      ),
    ]
    for (const v of variants) expect(v.digest).not.toBe(base)
  })

  it.each([
    ["disabled channel", scope, [{ id: "sc_a", is_disabled: true }, channels[1]], regions],
    ["missing channel", scope, [channels[0]], regions],
    ["undeclared extra channel", scope, [...channels, { id: "sc_c", is_disabled: false }], regions],
    ["channel read twice", scope, [...channels, channels[0]], regions],
    ["region currency outside scope", { ...scope, currencyScope: ["UGX"] }, channels, regions],
    [
      "scoped currency served by no region",
      { ...scope, currencyScope: ["UGX", "USD", "KES"] },
      channels,
      regions,
    ],
    [
      "region in another country",
      scope,
      channels,
      [regions[0], { id: "reg_usd", currency_code: "usd", countries: ["ug", "ke"] }],
    ],
    [
      "region with no country",
      scope,
      channels,
      [regions[0], { id: "reg_usd", currency_code: "usd", countries: [] }],
    ],
    [
      "duplicate declared channel",
      { ...scope, salesChannelIds: ["sc_a", "sc_a"] },
      channels,
      regions,
    ],
    ["empty region set", { ...scope, regionIds: [] }, channels, regions],
    ["invalid tenant", { ...scope, tenantId: "zuribeans" }, channels, regions],
    ["invalid Organisation", { ...scope, organisationId: "org-1" }, channels, regions],
    ["invalid market", { ...scope, market: "ug" }, channels, regions],
    ["invalid engine", { ...scope, engineInstanceId: "trade" }, channels, regions],
    ["invalid reference", { ...scope, reference: "/leading-slash" }, channels, regions],
    ["invalid currency", { ...scope, currencyScope: ["ugx"] }, channels, regions],
  ] as const)("denies %s", (_name, s, c, r) => {
    expect(() =>
      canonicalNativeSellerConfiguration(
        s as NativeSellerConfigurationScope,
        c as NativeSalesChannelFact[],
        r as NativeRegionFact[],
      ),
    ).toThrow(/Native seller configuration denied/)
  })
})
