import { describe, expect, it, vi } from "vitest"
import type { IOrderModuleService } from "@medusajs/framework/types"
import {
  commitMedusaNativeBuyerOrder,
  medusaNativeQuery,
  nativeXid32,
} from "../src/baobab/b2b/medusa-native-transaction-owner"

describe("CAA-06b native Medusa transaction boundary", () => {
  it("compares a 64-bit transaction to 32-bit PostgreSQL row xmin without truncating the source", () => {
    expect(nativeXid32("1")).toBe("1")
    expect(nativeXid32("4294967297")).toBe("1")
    expect(() => nativeXid32("")).toThrow("MEDUSA_NATIVE_TRANSACTION_XID_UNAVAILABLE")
    expect(() => nativeXid32("not-a-number")).toThrow("MEDUSA_NATIVE_TRANSACTION_XID_UNAVAILABLE")
  })

  it("binds repeated and out-of-order pg parameters to the same Knex transaction", async () => {
    const raw = vi.fn(async (statement: string, bindings: unknown[]) => ({
      rows: [{ statement, bindings }],
      rowCount: 1,
    }))
    const db = medusaNativeQuery({ raw })
    expect(
      (await db.query("SELECT $2 AS second, $1 AS first, $2 AS again", ["a", "b"])).rows[0],
    ).toEqual({
      statement: "SELECT ? AS second, ? AS first, ? AS again",
      bindings: ["b", "a", "b"],
    })
    expect(raw).toHaveBeenCalledOnce()
    await expect(db.query("SELECT $2", ["only-one"])).rejects.toThrow("MEDUSA_SQL_BINDING_INVALID")
    await expect(db.query("SELECT ?", ["unsafe"])).rejects.toThrow("MEDUSA_SQL_BINDING_UNSAFE")
    await expect(db.query("SELECT 1", ["unused"])).rejects.toThrow("MEDUSA_SQL_BINDING_MISSING")
    expect(() => db.release()).toThrow("MEDUSA_NATIVE_TRANSACTION_OWNED_BY_ORDER_MODULE")
  })

  it("refuses absent Order Module transaction ownership before asking for authority", async () => {
    const authorise = vi.fn(async () => {
      throw new Error("must not be reached")
    })
    const outcome = await commitMedusaNativeBuyerOrder(
      {
        orderModule: {} as IOrderModuleService,
        spend: {} as never,
        source: {} as never,
        authorizeNow: authorise,
        recheckAuthorityNow: async () => {
          throw new Error("must not reach IAM/CP for an unavailable native owner")
        },
      },
      {
        nativeOrderId: "order_native_synthetic",
        idempotencyKey: "native.test.20261104.01",
        correlationId: "f04d8f4e-3d76-4b09-b3d0-1b645c87546a",
        tenant: {} as never,
      },
    )
    expect(outcome).toEqual({ outcome: "REFUSED", reason: "NATIVE_ORDER_OWNER_UNAVAILABLE" })
    expect(authorise).not.toHaveBeenCalled()
  })

  it("refuses a native order service without a real transaction factory", async () => {
    const nativeOrder = {
      baseRepository_: {
        transaction: "not-a-function",
      },
      createOrders: vi.fn(),
    } as unknown as IOrderModuleService
    expect(
      await commitMedusaNativeBuyerOrder(
        {
          orderModule: nativeOrder,
          spend: {} as never,
          source: {} as never,
          authorizeNow: vi.fn(async () => {
            throw new Error("must not run")
          }),
          recheckAuthorityNow: async () => {
            throw new Error("must not reach IAM/CP for an unavailable native owner")
          },
        },
        {
          nativeOrderId: "order_native_synthetic",
          idempotencyKey: "native.test.20261104.02",
          correlationId: "f04d8f4e-3d76-4b09-b3d0-1b645c87546a",
          tenant: {} as never,
        },
      ),
    ).toEqual({ outcome: "REFUSED", reason: "NATIVE_ORDER_OWNER_UNAVAILABLE" })
  })
})
