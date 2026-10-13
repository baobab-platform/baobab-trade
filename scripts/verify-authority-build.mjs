/** P0-04A: verify the actual standalone artifact consumed by Docker.
 * Imported JSON must retain immutable Shared bytes, and compiled validators
 * must load without source TS or a runtime schema download.
 */
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { cpSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join, resolve } from "node:path"

const root = resolve(import.meta.dirname, "..")
const server = join(root, ".medusa/server")
// TypeScript emits imported JSON with different formatting. Preserve upstream
// bytes in the private server artifact, never in public/admin or a source-only
// directory. Medusa recreates the server directory on every build.
cpSync(join(root, "src/baobab/contracts/shared"), join(server, "src/baobab/contracts/shared"), {
  recursive: true,
})
const sourceManifest = JSON.parse(
  readFileSync(join(root, "src/baobab/contracts/shared/provenance.json"), "utf8"),
)
const builtManifest = JSON.parse(
  readFileSync(join(server, "src/baobab/contracts/shared/provenance.json"), "utf8"),
)
assert.deepEqual(builtManifest, sourceManifest)
for (const [path, hash] of Object.entries(sourceManifest.files)) {
  const bytes = readFileSync(join(server, "src/baobab/contracts/shared", path))
  assert.equal(createHash("sha256").update(bytes).digest("hex"), hash, path)
}
const require = createRequire(import.meta.url)
const validators = require(join(server, "src/baobab/contracts/authority-validation.js"))
// Exercise the compiled artifact; a missing export must not produce a false pass.
for (const name of [
  "legalActorRequestSchema",
  "legalActorResponseSchema",
  "documentaryRequestSchema",
  "documentaryResponseSchema",
  "merchantReadinessRequestSchema",
  "merchantReadinessResponseSchema",
  "platformContextSchema",
]) {
  assert.equal(typeof validators[name], "function", name)
  assert.equal(validators[name]({}), false, name)
}
console.log("Standalone authority validators and immutable schema assets verified")
