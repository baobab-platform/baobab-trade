// Trade-A TA-08 harness driver library: the compose stack, SQL in both
// databases, HTTP to Trade, CP and the issuer, the Trade-side acceptance
// commands, and the evidence/report files. Harness-only, never deployed.
import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { appendFileSync, writeFileSync } from "node:fs"

export const CP = "http://127.0.0.1:18093"
export const ISSUER = "http://127.0.0.1:18011"
export const TRADE = "http://127.0.0.1:19000"
export const ISS = "https://iam.gated.test/realms/baobab"
export const key = () => randomUUID()

export class Compose {
  constructor(file, project = "baobab-trade-a-ta08") {
    this.base = ["compose", "-f", file, "-p", project]
  }

  run(args, { input, allowFailure = false } = {}) {
    try {
      return execFileSync("docker", [...this.base, ...args], {
        input,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
        maxBuffer: 64 * 1024 * 1024,
      })
    } catch (error) {
      if (allowFailure) return `${error.stdout ?? ""}${error.stderr ?? ""}`
      throw new Error(
        // Medusa logs its error to stdout; report the end of both streams.
        `docker ${args.slice(0, 4).join(" ")} failed: ${`${error.stdout ?? ""}\n${error.stderr ?? ""}`.slice(-2500)}`,
      )
    }
  }

  /**
   * Rows as arrays of strings. psql runs inside the database container over
   * its local socket, as `user`: the scenarios that attack the fences connect
   * as Trade's own non-superuser runtime role.
   */
  sql(service, db, user, statement) {
    // -q drops command tags, so every line is one row; an empty line is a row
    // whose single value is the empty string, not noise.
    const out = this.run(
      [
        "exec",
        "-T",
        service,
        "psql",
        "-U",
        user,
        "-d",
        db,
        "-qAt",
        "-F",
        "\t",
        "-v",
        "ON_ERROR_STOP=1",
      ],
      { input: statement },
    )
    const lines = out.split("\n")
    if (lines.at(-1) === "") lines.pop()
    return lines.map((line) => line.split("\t"))
  }

  /** The SQL error text, or null when the statement succeeded. */
  sqlRefusal(service, db, user, statement) {
    try {
      this.sql(service, db, user, statement)
      return null
    } catch (error) {
      return String(error.message)
    }
  }

  scalar(service, db, user, statement) {
    return this.sql(service, db, user, statement)[0]?.[0] ?? ""
  }
}

// A keep-alive socket the server already closed fails before the request is
// sent; only that failure is retried, once.
const STALE_SOCKET = new Set(["UND_ERR_SOCKET", "ECONNRESET", "EPIPE"])

export async function call(method, url, body, headers = {}, retried = false) {
  let response
  try {
    response = await fetch(url, {
      method,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (error) {
    if (!retried && STALE_SOCKET.has(error?.cause?.code))
      return call(method, url, body, headers, true)
    throw new Error(`${method} ${url}: ${error?.cause?.code ?? error?.message}`)
  }
  const text = await response.text()
  let parsed = text
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    // A non-JSON body stays text.
  }
  return { status: response.status, headers: response.headers, body: parsed }
}

export function must(response, ...ok) {
  if (!ok.includes(response.status))
    throw new Error(
      `unexpected answer ${response.status}: ${JSON.stringify(response.body).slice(0, 600)}`,
    )
  return response.body
}

const TA08_LINE = /^TA08 (\{.*\})$/m

/**
 * One src/scripts/acceptance-trade-a.ts command in the shipped Trade image.
 * `local` runs a one-off container under the local test profile (fixtures
 * Trade-A would deny in a protected runtime); otherwise it runs in the
 * protected staging container itself.
 */
export function tradeCommand(compose, command, args = [], { local = false, env = {} } = {}) {
  const extra = Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`])
  const exec = [
    "node",
    "node_modules/@medusajs/cli/cli.js",
    "exec",
    "./src/scripts/acceptance-trade-a.js",
    command,
    ...args,
  ]
  const out = local
    ? compose.run(["run", "--rm", "--no-deps", "-T", ...LOCAL_PROFILE, ...extra, "trade", ...exec])
    : compose.run(["exec", "-T", ...extra, "trade", ...exec])
  const line = TA08_LINE.exec(out)
  if (!line)
    throw new Error(`Trade acceptance command ${command} printed no result: ${out.slice(-1500)}`)
  return JSON.parse(line[1])
}

/** The local test profile (LOCAL_SANDBOX), as CI's core-module job runs it. */
export const LOCAL_PROFILE = [
  "-e",
  "NODE_ENV=test",
  "-e",
  "BAOBAB_ENVIRONMENT=",
  "-e",
  "BAOBAB_DEPLOYMENT_ENV=",
  "-e",
  "BAOBAB_TRADE_A_ORDER_AUTHORITY_ENABLED=",
]

export class Evidence {
  constructor(dir) {
    this.dir = dir
    this.notes = []
    this.failures = 0
    this.report = `${dir}/trade-a-report.txt`
    writeFileSync(this.report, "")
  }

  note(kind, value) {
    this.notes.push({ at: new Date().toISOString(), kind, ...value })
  }

  async check(id, title, run) {
    try {
      const detail = await run()
      appendFileSync(this.report, `PASS ${id} ${title}\n`)
      this.note("scenario", { id, title, result: "PASS", detail: detail ?? null })
    } catch (error) {
      this.failures++
      appendFileSync(this.report, `FAIL ${id} ${title}: ${String(error.message).slice(0, 800)}\n`)
      this.note("scenario", {
        id,
        title,
        result: "FAIL",
        error: String(error.message).slice(0, 4000),
      })
    }
  }

  finish(receipt) {
    writeFileSync(
      `${this.dir}/evidence.json`,
      JSON.stringify({ receipt, notes: this.notes }, null, 2),
    )
    appendFileSync(this.report, `Trade-A failures: ${this.failures}\n`)
  }
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function assert(condition, message) {
  if (!condition) throw new Error(message)
}

export function equal(actual, expected, message) {
  if (actual !== expected)
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    )
}
