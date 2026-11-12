import { describe, expect, it } from "vitest"
import { createRequire } from "node:module"
import { resolve } from "node:path"

// Medusa loads CommonJS. Keep GraphQL and its schema helpers in the same
// module realm instead of mixing Vitest's ESM GraphQL with CJS dependencies.
const require = createRequire(resolve(process.cwd(), "package.json"))
const { graphql } = require("graphql") as typeof import("graphql")
const { makeExecutableSchema } =
  require("@graphql-tools/schema") as typeof import("@graphql-tools/schema")
const { mergeDeep, mergeIncrementalResult } =
  require("@graphql-tools/utils") as typeof import("@graphql-tools/utils")

describe("Medusa GraphQL dependency compatibility and security", () => {
  it("executes an ordinary schema after the security override", async () => {
    const schema = makeExecutableSchema({
      typeDefs: "type Query { total: Int! }",
      resolvers: { Query: { total: () => 123 } },
    })
    const result = await graphql({ schema, source: "{ total }" })
    expect(result.errors).toBeUndefined()
    expect(result.data?.total).toBe(123)
  })

  it("rejects coercible incremental paths without polluting prototypes", () => {
    const before = Object.getOwnPropertyDescriptors(Object.prototype)
    const executionResult = { data: {} }
    mergeIncrementalResult({
      incrementalResult: JSON.parse(
        '{"path":[["__proto__"],"baobabPolluted"],"data":{"unsafe":true}}',
      ),
      executionResult,
    })
    expect(Object.getOwnPropertyDescriptors(Object.prototype)).toEqual(before)
    expect(executionResult).toEqual({ data: {} })
    mergeIncrementalResult({
      incrementalResult: { path: ["total"], data: 123 },
      executionResult,
    })
    expect(executionResult).toEqual({ data: { total: 123 } })
  })

  it("does not follow inherited constructors during deep merge", () => {
    const before = Object.getOwnPropertyDescriptors(Object.prototype)
    mergeDeep([{}, JSON.parse('{"constructor":{"prototype":{"baobabPolluted":true}}}')])
    expect(Object.getOwnPropertyDescriptors(Object.prototype)).toEqual(before)
  })
})
