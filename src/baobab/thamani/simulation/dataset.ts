/**
 * Gate 22: a deterministic Thamani Uganda-South Africa simulation pack,
 * the same idea as `src/baobab/simulation/zuribeans-dataset.ts` (Gate 18,
 * ZuriBeans-only) extended to cover the categories that plan explicitly
 * names for Thamani: consumers, orders, payments, returns/refunds, stock,
 * imports and ERP consequences. Product (`THAMANI_CATALOGUE`, currently 39)
 * and supplier (`THAMANI_SUPPLIERS`, currently 18) counts already fall
 * inside the plan's named 35-40/15-20 ranges from earlier Gates — this
 * module doesn't redefine them, it validates they still do and adds the
 * consumer/order-scenario data those Gates never needed.
 *
 * `assertThamaniSimulationDataset` is pure referential-integrity validation
 * over these compile-time constants, matching the ZuriBeans version's
 * scope. The scenarios below are given real, persisted consequences (a
 * captured payment, a real return+refund, a real cross-border-sourced
 * order) by `src/scripts/regression-thamani-simulation-pack.ts`, which is
 * the one thing the ZuriBeans version never did (its scenarios are
 * fabricated `SIM:...` ERP reference literals, never run through a real
 * workflow) — closing the gap where no return/refund workflow had ever
 * been exercised anywhere in this codebase.
 */
import { THAMANI_CATALOGUE } from "../catalogue"
import { THAMANI_SUPPLIERS } from "../suppliers"

export const THAMANI_SIMULATION_VERSION = "thamani-ug-za-2026-09-v1"

const FIRST_NAMES = [
  "Amara",
  "Baraka",
  "Chidi",
  "Dalia",
  "Efrem",
  "Farah",
  "Grace",
  "Hassan",
  "Imani",
  "Jengo",
  "Kioni",
  "Lerato",
  "Mariam",
  "Nakato",
  "Oduya",
  "Palesa",
  "Quinta",
  "Rehema",
  "Sipho",
  "Tendai",
  "Uzuri",
  "Vusi",
  "Wanjiru",
  "Xolani",
  "Yaseen",
] as const

const LAST_NAMES = [
  "Achieng",
  "Banda",
  "Chirwa",
  "Diallo",
  "Eze",
  "Fataki",
  "Gumede",
  "Hakizimana",
  "Iwu",
  "Juma",
  "Katana",
  "Lwanga",
  "Mbeki",
  "Ndlovu",
  "Okoro",
  "Peters",
  "Quansah",
  "Ruto",
  "Sithole",
  "Tumusiime",
  "Uwase",
  "Vilakazi",
  "Wafula",
  "Xaba",
  "Yusuf",
] as const

export type ThamaniSimulationConsumer = {
  reference: string
  marketKey: "thamani_ug" | "thamani_za"
  countryCode: "UG" | "ZA"
  email: string
  firstName: string
  lastName: string
  phone: string
}

const buildConsumers = (
  marketKey: "thamani_ug" | "thamani_za",
  countryCode: "UG" | "ZA",
  count: number,
  nameOffset: number,
): ThamaniSimulationConsumer[] =>
  Array.from({ length: count }, (_, index) => {
    const sequence = String(index + 1).padStart(2, "0")
    const countryKey = countryCode.toLowerCase()
    return {
      reference: `sim-thamani-consumer-${countryKey}-${sequence}`,
      marketKey,
      countryCode,
      email: `thamani.simulation.${countryKey}.${sequence}@example.invalid`,
      firstName: FIRST_NAMES[index % FIRST_NAMES.length],
      lastName: LAST_NAMES[(index + nameOffset) % LAST_NAMES.length],
      phone:
        countryCode === "UG"
          ? `+2567${(10000000 + index).toString().slice(-8)}`
          : `+2782${(1000000 + index).toString().slice(-7)}`,
    }
  })

/** 25 Uganda + 25 South Africa, deterministic, distinct references — the plan's "50 consumers." */
export const THAMANI_SIMULATION_CONSUMERS: readonly ThamaniSimulationConsumer[] = [
  ...buildConsumers("thamani_ug", "UG", 25, 0),
  ...buildConsumers("thamani_za", "ZA", 25, 13),
]

export type ThamaniSimulationOrderScenario = {
  reference: string
  consumerReference: string
  marketKey: "thamani_ug" | "thamani_za"
  countryCode: "UG" | "ZA"
  productHandle: string
  supplierKey: string
  quantity: number
  outcome: "CAPTURED" | "REFUNDED"
  crossBorderImport: boolean
  erp: {
    order: string
    payment: string
    financialConsequence: string
    returnRefund?: string
  }
}

export const THAMANI_SIMULATION_ORDER_SCENARIOS: readonly ThamaniSimulationOrderScenario[] = [
  {
    reference: "sim-thamani-ug-domestic-tea",
    consumerReference: "sim-thamani-consumer-ug-01",
    marketKey: "thamani_ug",
    countryCode: "UG",
    productHandle: "thamani-uganda-black-tea-250g",
    supplierKey: "sup_ug_kampala_sme",
    quantity: 2,
    outcome: "CAPTURED",
    crossBorderImport: false,
    erp: {
      order: "SIM:THAMANI:C_Order:UG-001",
      payment: "SIM:THAMANI:C_Payment:UG-001",
      financialConsequence: "SIM:THAMANI:C_Invoice:UG-001",
    },
  },
  {
    reference: "sim-thamani-za-domestic-soap-returned",
    consumerReference: "sim-thamani-consumer-za-01",
    marketKey: "thamani_za",
    countryCode: "ZA",
    productHandle: "thamani-natural-soap-bar-150g",
    supplierKey: "sup_ug_entebbe_personal_care",
    quantity: 1,
    outcome: "REFUNDED",
    crossBorderImport: false,
    erp: {
      order: "SIM:THAMANI:C_Order:ZA-001",
      payment: "SIM:THAMANI:C_Payment:ZA-001",
      financialConsequence: "SIM:THAMANI:C_Invoice:ZA-001",
      returnRefund: "SIM:THAMANI:C_CreditMemo:ZA-001",
    },
  },
  {
    reference: "sim-thamani-ug-import-coffee",
    consumerReference: "sim-thamani-consumer-ug-02",
    marketKey: "thamani_ug",
    countryCode: "UG",
    productHandle: "thamani-instant-coffee-200g",
    supplierKey: "sup_import_europe_fmcg",
    quantity: 1,
    outcome: "CAPTURED",
    crossBorderImport: true,
    erp: {
      order: "SIM:THAMANI:C_Order:UG-002",
      payment: "SIM:THAMANI:C_Payment:UG-002",
      financialConsequence: "SIM:THAMANI:C_Invoice:UG-002",
    },
  },
]

export const assertThamaniSimulationDataset = (): void => {
  if (THAMANI_CATALOGUE.length < 35 || THAMANI_CATALOGUE.length > 40)
    throw new Error(`Simulation requires 35-40 Thamani products, found ${THAMANI_CATALOGUE.length}`)
  if (THAMANI_SUPPLIERS.length < 15 || THAMANI_SUPPLIERS.length > 20)
    throw new Error(
      `Simulation requires 15-20 Thamani suppliers, found ${THAMANI_SUPPLIERS.length}`,
    )
  if (THAMANI_SIMULATION_CONSUMERS.length !== 50)
    throw new Error(
      `Simulation requires exactly fifty consumers, found ${THAMANI_SIMULATION_CONSUMERS.length}`,
    )

  const consumerRefs = new Set(THAMANI_SIMULATION_CONSUMERS.map((consumer) => consumer.reference))
  if (consumerRefs.size !== THAMANI_SIMULATION_CONSUMERS.length)
    throw new Error("Simulation consumer references must be unique")
  if (!THAMANI_SIMULATION_CONSUMERS.some((consumer) => consumer.marketKey === "thamani_ug"))
    throw new Error("Simulation consumers must include Uganda")
  if (!THAMANI_SIMULATION_CONSUMERS.some((consumer) => consumer.marketKey === "thamani_za"))
    throw new Error("Simulation consumers must include South Africa")

  const productHandles = new Set(THAMANI_CATALOGUE.map((product) => product.handle))
  const supplierByKey = new Map(
    THAMANI_SUPPLIERS.map((supplier) => [supplier.supplierKey, supplier]),
  )

  let hasReturnRefund = false
  let hasCrossBorderImport = false
  for (const scenario of THAMANI_SIMULATION_ORDER_SCENARIOS) {
    if (!consumerRefs.has(scenario.consumerReference))
      throw new Error(`Broken consumer reference: ${scenario.reference}`)
    if (!productHandles.has(scenario.productHandle))
      throw new Error(`Broken product reference: ${scenario.reference}`)
    const supplier = supplierByKey.get(scenario.supplierKey)
    if (!supplier) throw new Error(`Broken supplier reference: ${scenario.reference}`)
    if (!(scenario.erp.order && scenario.erp.payment && scenario.erp.financialConsequence))
      throw new Error(`Incomplete ERP expectations: ${scenario.reference}`)

    if (scenario.outcome === "REFUNDED") {
      hasReturnRefund = true
      if (!scenario.erp.returnRefund)
        throw new Error(
          `Refunded scenario missing return/refund ERP expectation: ${scenario.reference}`,
        )
    }
    if (scenario.crossBorderImport) {
      hasCrossBorderImport = true
      if (supplier.originCountry === scenario.countryCode)
        throw new Error(
          `Cross-border scenario sources from a domestic supplier: ${scenario.reference}`,
        )
    }
  }
  if (!hasReturnRefund) throw new Error("Simulation requires at least one return/refund scenario")
  if (!hasCrossBorderImport)
    throw new Error("Simulation requires at least one cross-border import scenario")
}
