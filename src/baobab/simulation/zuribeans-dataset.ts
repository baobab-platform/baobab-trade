import { ZURIBEANS_CATALOGUE } from "../catalogue"
import { ZURIBEANS_INVENTORY_LOCATIONS } from "../inventory"

export const SIMULATION_VERSION = "zuribeans-ug-za-2026-09-v1"
export const SIMULATION_ORGANISATIONS = [
  { id: "sim-org-ug-roaster", market: "zuribeans_ug", type: "ROASTER" },
  { id: "sim-org-ug-exporter", market: "zuribeans_ug", type: "EXPORTER" },
  { id: "sim-org-za-roaster", market: "zuribeans_za", type: "ROASTER" },
  { id: "sim-org-za-food-maker", market: "zuribeans_za", type: "MANUFACTURER" },
] as const
export const SIMULATION_BUYERS = SIMULATION_ORGANISATIONS.map((organisation, index) => ({
  id: `sim-buyer-${index + 1}`,
  organisationId: organisation.id,
  roles: index % 2 ? ["BUYER", "APPROVER"] : ["BUYER"],
}))
export const SIMULATION_SUPPLIERS = [
  { id: "sim-supplier-elgon", country: "UG", commodities: ["COFFEE"] },
  { id: "sim-supplier-rwenzori", country: "UG", commodities: ["COFFEE", "VANILLA"] },
  { id: "sim-supplier-central", country: "UG", commodities: ["COCOA", "TEA", "GINGER"] },
] as const

export const SIMULATION_ASSUMPTIONS = {
  asOf: "2026-09-08",
  authority: "SIMULATION_ONLY_NOT_TAX_OR_CUSTOMS_ADVICE",
  tax: { UG: { standardVatBasisPoints: 1800 }, ZA: { standardVatBasisPoints: 1500 } },
  tariff: {
    "UG-ZA": { defaultImportDutyBasisPoints: 0, treatment: "VERIFY_PER_HS_AND_ORIGIN_BEFORE_USE" },
  },
} as const

export const SIMULATION_SCENARIOS = [
  {
    id: "sim-ug-domestic-coffee",
    origin: "UG",
    destination: "UG",
    market: "zuribeans_ug",
    buyerOrganisationId: "sim-org-ug-roaster",
    supplierId: "sim-supplier-elgon",
    sku: "ZB-UG-COF-ARA-AA-60",
    quantity: 5,
    currency: "UGX",
    sourceWarehouse: "UG-KLA-01",
    incoterm: "DAP",
    taxBasisPoints: 1800,
    tariffBasisPoints: 0,
    erp: {
      order: "SIM:C_Order:UG-001",
      shipment: "SIM:M_InOut:UG-001",
      financialConsequence: "SIM:C_Invoice:UG-001",
    },
  },
  {
    id: "sim-ug-za-coffee",
    origin: "UG",
    destination: "ZA",
    market: "zuribeans_za",
    buyerOrganisationId: "sim-org-za-roaster",
    supplierId: "sim-supplier-elgon",
    sku: "ZB-UG-COF-ROB-S18-60",
    quantity: 20,
    currency: "ZAR",
    sourceWarehouse: "UG-EBB-01",
    destinationWarehouse: "ZA-DUR-01",
    incoterm: "CIF",
    taxBasisPoints: 1500,
    tariffBasisPoints: 0,
    erp: {
      order: "SIM:C_Order:ZA-001",
      shipment: "SIM:M_InOut:ZA-001",
      financialConsequence: "SIM:C_Invoice:ZA-001",
    },
  },
  {
    id: "sim-ug-za-vanilla",
    origin: "UG",
    destination: "ZA",
    market: "zuribeans_za",
    buyerOrganisationId: "sim-org-za-food-maker",
    supplierId: "sim-supplier-rwenzori",
    sku: "ZB-UG-VAN-BRB-A-05",
    quantity: 10,
    currency: "ZAR",
    sourceWarehouse: "UG-EBB-01",
    destinationWarehouse: "ZA-CPT-01",
    incoterm: "DAP",
    taxBasisPoints: 1500,
    tariffBasisPoints: 0,
    erp: {
      order: "SIM:C_Order:ZA-002",
      shipment: "SIM:M_InOut:ZA-002",
      financialConsequence: "SIM:C_Invoice:ZA-002",
    },
  },
  {
    id: "sim-ug-za-cocoa",
    origin: "UG",
    destination: "ZA",
    market: "zuribeans_za",
    buyerOrganisationId: "sim-org-za-food-maker",
    supplierId: "sim-supplier-central",
    sku: "ZB-UG-COC-BEAN-60",
    quantity: 5,
    currency: "ZAR",
    sourceWarehouse: "UG-JIN-01",
    destinationWarehouse: "ZA-JNB-01",
    incoterm: "FCA",
    taxBasisPoints: 1500,
    tariffBasisPoints: 0,
    erp: {
      order: "SIM:C_Order:ZA-003",
      shipment: "SIM:M_InOut:ZA-003",
      financialConsequence: "SIM:C_Invoice:ZA-003",
    },
  },
] as const

export const assertSimulationDataset = (): void => {
  if (ZURIBEANS_CATALOGUE.length !== 10)
    throw new Error("Simulation requires exactly ten ZuriBeans products")
  const kinds = new Set(ZURIBEANS_CATALOGUE.map((product) => product.attributes.kind))
  for (const kind of ["COFFEE", "VANILLA", "COCOA", "TEA", "GINGER"])
    if (!kinds.has(kind as never)) throw new Error(`Missing simulation commodity: ${kind}`)
  if (ZURIBEANS_INVENTORY_LOCATIONS.length !== 6)
    throw new Error("Simulation requires six warehouses")
  const sku = new Set(ZURIBEANS_CATALOGUE.map((product) => product.sku))
  const locations = new Set(ZURIBEANS_INVENTORY_LOCATIONS.map((location) => location.code))
  const organisations = new Set(SIMULATION_ORGANISATIONS.map((item) => item.id))
  const suppliers = new Set(SIMULATION_SUPPLIERS.map((item) => item.id))
  for (const scenario of SIMULATION_SCENARIOS) {
    if (
      !sku.has(scenario.sku) ||
      !locations.has(scenario.sourceWarehouse) ||
      !organisations.has(scenario.buyerOrganisationId) ||
      !suppliers.has(scenario.supplierId)
    )
      throw new Error(`Broken scenario reference: ${scenario.id}`)
    if (!(scenario.erp.order && scenario.erp.shipment && scenario.erp.financialConsequence))
      throw new Error(`Incomplete ERP expectations: ${scenario.id}`)
    if (
      scenario.origin !== scenario.destination &&
      !("destinationWarehouse" in scenario && locations.has(scenario.destinationWarehouse))
    )
      throw new Error(`Cross-border destination missing: ${scenario.id}`)
  }
}
