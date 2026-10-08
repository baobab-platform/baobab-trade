import { describe, expect, it } from "vitest"
import { THAMANI_CATALOGUE } from "../src/baobab/thamani/catalogue"
import {
  THAMANI_INVENTORY_LOCATIONS,
  locationsForProduct,
  thamaniInventoryLocationMetadata,
} from "../src/baobab/thamani/inventory"

describe("Thamani Gate 10 inventory configuration", () => {
  it("defines two Uganda and three South Africa estate-isolated locations", () => {
    expect(
      THAMANI_INVENTORY_LOCATIONS.filter((location) => location.marketKey === "thamani_ug"),
    ).toHaveLength(2)
    expect(
      THAMANI_INVENTORY_LOCATIONS.filter((location) => location.marketKey === "thamani_za"),
    ).toHaveLength(3)
    expect(new Set(THAMANI_INVENTORY_LOCATIONS.map((location) => location.canonicalKey)).size).toBe(
      5,
    )
  })
  it("keeps canonical, Medusa, and ERP identity separate", () => {
    for (const location of THAMANI_INVENTORY_LOCATIONS) {
      const metadata = thamaniInventoryLocationMetadata(location)
      expect(metadata.baobab_digital_estate).toBe("thamani_b2c")
      expect(metadata.baobab_erp_warehouse_reference).not.toBe(location.canonicalKey)
      expect(metadata).not.toHaveProperty("stock_location_id")
    }
  })
  it("does not project single-Market products into the other Market", () => {
    const singleMarket = THAMANI_CATALOGUE.filter((product) => product.eligibleMarkets.length === 1)
    expect(singleMarket).toHaveLength(2)
    for (const product of singleMarket) {
      expect(new Set(locationsForProduct(product).map((location) => location.marketKey))).toEqual(
        new Set(product.eligibleMarkets),
      )
    }
  })
})
