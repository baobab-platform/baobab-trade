import { describe, expect, it } from "vitest"
import { withBuyerRecordIds } from "../src/baobab/b2b/buyer-record-id"
import domain from "../src/baobab/contracts/shared/contracts/buyer-organisation/v1/domain.schema.json"

// Source-only: native persistence and handler execution remain the DEV-07 CI proof.
describe("native buyer record identifiers", () => {
  it("mints Shared-conforming identities before persistence and forwards the transaction", async () => {
    for (const [prefix, definition] of [
      ["b2borg", "buyerOrganisationId"],
      ["b2bmem", "buyerMembershipId"],
    ] as const) {
      const context = { transactionManager: "source-test-transaction" }
      const receiver = { marker: "native-service" }
      const input = { status: "ACTIVE" }
      const create = withBuyerRecordIds(async function (
        this: typeof receiver,
        data: { status: string; id?: string },
        forwarded?: typeof context,
      ) {
        expect(this).toBe(receiver)
        expect(forwarded).toBe(context)
        return data
      }, prefix)
      const first = await create.call(receiver, input, context)
      const second = await create.call(receiver, input, context)
      expect(first.id).toMatch(new RegExp(domain.$defs[definition].pattern))
      expect(first.id).not.toBe(second.id)
      expect(input).toEqual({ status: "ACTIVE" })
    }
  })

  it("supports batches without changing caller-supplied or legacy IDs", async () => {
    const input = [{ status: "ACTIVE" }, { id: "b2bmem_LEGACY", status: "SUSPENDED" }]
    const create = withBuyerRecordIds(async (rows: typeof input) => rows, "b2bmem")
    const rows = await create(input)
    expect(rows[0].id).toMatch(/^b2bmem_[a-z0-9]+$/)
    expect(rows[1]).toBe(input[1])
    expect(rows[1].id).toBe("b2bmem_LEGACY")
    expect(input[0].id).toBeUndefined()
    expect(await create([])).toEqual([])
  })
})
