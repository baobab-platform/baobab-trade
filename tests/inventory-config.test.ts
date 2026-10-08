import { describe, expect, it } from "vitest"
import { ZURIBEANS_INVENTORY_LOCATIONS, inventoryLocationMetadata } from "../src/baobab/inventory"

describe("ZuriBeans inventory locations", () => {
  it("defines the approved three Uganda and three South Africa locations", () => {
    expect(ZURIBEANS_INVENTORY_LOCATIONS.map((location) => location.code)).toEqual([
      "UG-KLA-01",
      "UG-EBB-01",
      "UG-JIN-01",
      "ZA-CPT-01",
      "ZA-JNB-01",
      "ZA-DUR-01",
    ])
  })

  it("keeps canonical, Medusa, and ERP location identities distinct", () => {
    const erpReferences = ZURIBEANS_INVENTORY_LOCATIONS.map(
      (location) => location.erpWarehouseReference,
    )
    expect(new Set(erpReferences).size).toBe(6)
    expect(erpReferences.every((reference) => reference.startsWith("IDEMPIERE:"))).toBe(true)
  })

  it("maps every location to exactly one launch Market", () => {
    expect(
      ZURIBEANS_INVENTORY_LOCATIONS.filter((location) => location.marketKey === "zuribeans_ug"),
    ).toHaveLength(3)
    expect(
      ZURIBEANS_INVENTORY_LOCATIONS.filter((location) => location.marketKey === "zuribeans_za"),
    ).toHaveLength(3)
  })

  it("marks only the Gate 4 primary locations for reuse", () => {
    expect(
      ZURIBEANS_INVENTORY_LOCATIONS.filter((location) => location.reusesMarketPrimary).map(
        (location) => location.code,
      ),
    ).toEqual(["UG-KLA-01", "ZA-JNB-01"])
  })

  it("writes mapping breadcrumbs without using an engine ID as canonical identity", () => {
    const metadata = inventoryLocationMetadata(ZURIBEANS_INVENTORY_LOCATIONS[0])
    expect(metadata.baobab_canonical_location_key).toBe("UG-KLA-01")
    expect(metadata.baobab_erp_warehouse_reference).toBe("IDEMPIERE:UG-KLA-01")
    expect(metadata).not.toHaveProperty("stock_location_id")
  })
})
