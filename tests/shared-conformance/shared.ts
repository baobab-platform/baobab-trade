import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020"
import draft07 from "ajv/dist/refs/json-schema-draft-07.json"
import addFormats from "ajv-formats"
import { parse as parseYaml } from "yaml"

/**
 * Access to a baobab-platform/shared checkout at the commit Trade's
 * contracts.lock.yaml pins. Every conformance test reads contracts from here,
 * never from a copy, so the proof is about the real files at the real pin.
 */
const repoRoot = resolve(__dirname, "../..")

export const lock = parseYaml(readFileSync(join(repoRoot, "contracts.lock.yaml"), "utf8")) as {
  source: { repository: string; commit: string }
  contracts: string[]
}

const configured = process.env.BAOBAB_SHARED_PATH
if (!configured) {
  throw new Error(
    "BAOBAB_SHARED_PATH is not set. Point it at a checkout of baobab-platform/shared at " +
      `${lock.source.commit} (contracts.lock.yaml). The conformance suite never skips silently.`,
  )
}
export const sharedRoot = resolve(configured)

export const sharedHead = (): string =>
  execFileSync("git", ["-C", sharedRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()

export const readText = (path: string): string => readFileSync(join(sharedRoot, path), "utf8")
export const readJson = <T = Record<string, any>>(path: string): T =>
  JSON.parse(readText(path)) as T
export const readYaml = <T = Record<string, any>>(path: string): T => parseYaml(readText(path)) as T

const schemaFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return schemaFiles(full)
    return name.endsWith(".schema.json") ? [full] : []
  })

/**
 * One Ajv instance that knows every Shared schema by $id, so relative $refs
 * between contracts (domain.schema.json, capability-explanation.schema.json,
 * organisation/v1/iam.schema.json, ...) resolve exactly as they do for any
 * other consumer. Formats are enforced; unknown annotation keywords are not an
 * error.
 */
export const unloadedSchemas: Array<{ file: string; reason: string }> = []

export const ajv = (() => {
  const instance = new Ajv2020({ strict: false, allErrors: true, validateFormats: true })
  addFormats(instance)
  // Some Shared schemas declare draft-07; their meta-schema must be known.
  instance.addMetaSchema(draft07)
  for (const file of schemaFiles(join(sharedRoot, "contracts"))) {
    const schema = JSON.parse(readFileSync(file, "utf8")) as { $id?: string }
    if (!schema.$id || instance.getSchema(schema.$id)) continue
    try {
      instance.addSchema(schema)
    } catch (error) {
      // Never hide a schema we could not load: a test that needs it fails on
      // the unresolved reference, and the list is asserted in pin.conformance.ts.
      unloadedSchemas.push({ file: relative(sharedRoot, file), reason: String(error) })
    }
  }
  return instance
})()

/** Validator for `#/$defs/<def>` of a Shared schema file (path relative to the Shared root). */
export const validatorFor = (schemaPath: string, def?: string): ValidateFunction => {
  const id = readJson<{ $id: string }>(schemaPath).$id
  const validate = ajv.getSchema(def ? `${id}#/$defs/${def}` : id)
  if (!validate) throw new Error(`No Shared schema ${schemaPath}${def ? `#/$defs/${def}` : ""}`)
  return validate
}

export const pathExists = (path: string): boolean => existsSync(join(sharedRoot, path))
export const relativeToShared = (path: string): string => relative(sharedRoot, path)
