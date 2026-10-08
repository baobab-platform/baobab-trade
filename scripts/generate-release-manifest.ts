/**
 * Gate 21 reproducible-release evidence (ADR-0008 §115/§117): a machine-
 * readable record of exactly what was built and validated by
 * release-readiness.yml — the image tag, the application/Medusa/Node/
 * contract versions it carries, and the commit it was built from. This
 * script produces the record; publishing the tagged image anywhere is
 * Infrastructure's job (docs/architecture.md, ADR-0006), not this
 * repository's — this only proves what a given CI run validated.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const repoRoot = join(__dirname, "..")

const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
  version: string
  dependencies: Record<string, string>
  engines: { node: string }
}

const contractsLock = readFileSync(join(repoRoot, "contracts.lock.yaml"), "utf8")
const consumerVersionMatch = contractsLock.match(/consumer:\n(?:.*\n)*?\s+version:\s*"([^"]+)"/)
if (!consumerVersionMatch) throw new Error("Could not find consumer.version in contracts.lock.yaml")

const gitSha =
  process.env.GITHUB_SHA ?? execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()

const nvmrc = readFileSync(join(repoRoot, ".nvmrc"), "utf8").trim()
const nodeMajor = Number.parseInt(nvmrc.split(".")[0], 10)

const manifest = {
  imageTag: `baobab-trade:${gitSha}`,
  applicationVersion: packageJson.version,
  medusaVersion: packageJson.dependencies["@medusajs/medusa"],
  nodeMajor,
  contractsConsumerVersion: consumerVersionMatch[1],
  gitSha,
  builtAt: new Date().toISOString(),
}

writeFileSync(join(repoRoot, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(JSON.stringify(manifest, null, 2))
