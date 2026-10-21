// Trade-A TA-08 scenarios (ADR-SHARED-039 §§1, 4, 6; EA v2.3 §10.3).
//
// Every scenario drives the shipped Trade image in its protected staging
// profile against the REAL CP, and asserts persisted state in BOTH databases.
// ADR-SHARED-039 §6 "three layers": each certified class is driven through
// its native HTTP route, a direct (non-HTTP) workflow run and direct SQL as
// Trade's own runtime role, and all three must reach the same outcome.
//
//   node ta08.mjs <run-dir> <evidence-dir> <compose-file>
//
// REAL_COMPONENT_SYNTHETIC_DATA (EA v2.3 §3.3): not EA Gate D, not L4, not
// protected staging. Never skipped: the runner fails unless the report ends
// "Trade-A failures: 0".
import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import {
  CP,
  Compose,
  Evidence,
  TRADE,
  assert,
  call,
  equal,
  must,
  sleep,
  tradeCommand,
} from "./lib.mjs"
import { CHECKOUT, ControlPlane, CURRENCY, DRAFT_FINALISATION, MARKET } from "./seed.mjs"

const [run, out, composeFile] = process.argv.slice(2)
const compose = new Compose(composeFile)
const evidence = new Evidence(out)
const engineInstanceUuid = readFileSync(`${run}/engine-instance-uuid`, "utf8").trim()
const cp = new ControlPlane(compose, evidence, engineInstanceUuid)

// --- Trade's database, as its own non-superuser runtime role, and as the operator.
const tradeSql = (statement) =>
  compose.sql("tradedb", "baobab_trade_ta08", "trade_runtime", statement)
const tradeOne = (statement) => tradeSql(statement)[0] ?? []
const tradeRefusal = (statement) =>
  compose.sqlRefusal("tradedb", "baobab_trade_ta08", "trade_runtime", statement)
const operatorSql = (statement) =>
  compose.sql("tradedb", "baobab_trade_ta08", "postgres", statement)

const PROBLEM = "application/problem+json"
let fixture
let adminToken
let binding

async function storeComplete(cartId) {
  return call(
    "POST",
    `${TRADE}/store/carts/${cartId}/complete`,
    {},
    {
      "x-publishable-api-key": fixture.publishable_key,
      "x-correlation-id": randomUUID(),
    },
  )
}

async function adminFinalize(draftId, token = adminToken) {
  return call(
    "POST",
    `${TRADE}/admin/draft-orders/${draftId}/convert-to-order`,
    {},
    token ? { Authorization: `Bearer ${token}` } : {},
  )
}

/** ADR-SHARED-039 §6: an RFC 9457 document with no-store, never Medusa's handler. */
function expectProblem(response, status, code) {
  equal(response.status, status, "status")
  equal(response.headers.get("content-type"), PROBLEM, "content type")
  equal(response.headers.get("cache-control"), "no-store", "cache control")
  if (code) equal(response.body?.code, code, "problem code")
  const text = JSON.stringify(response.body)
  assert(
    !/eyJ[A-Za-z0-9_-]{20,}|SELECT|INSERT|postgres/i.test(text),
    `problem document leaks internals: ${text}`,
  )
}

const cart = () => tradeCommand(compose, "cart").cart_id
const draft = () => tradeCommand(compose, "draft", [], { local: true }).draft_id
const completedAt = (cartId) =>
  tradeOne(`SELECT coalesce(completed_at::text, '') FROM cart WHERE id = '${cartId}'`)[0]
const commitments = (subjectId) =>
  tradeSql(
    `SELECT receipt_id, operation_class, order_id FROM trade_order_commitment WHERE subject_id = '${subjectId}'`,
  )
const isDraft = (orderId) =>
  tradeOne(`SELECT is_draft_order::text FROM "order" WHERE id = '${orderId}'`)[0]
const decisionsFor = (subjectType, id) =>
  cp.decisions(`operation_reference LIKE '${subjectType}/${id}/%'`)

/** The Trade receipt behind one commitment, cross-checked against CP's decision history. */
function crossCheck(receiptId, activity) {
  const [decision, cls, ref, bindingId, version, mandate, consumed] = tradeOne(
    `SELECT decision_id::text, operation_class, operation_reference, binding_id::text, binding_version::text,
            mandate_id::text, coalesce(consumed_at::text, '')
       FROM trade_order_authority_receipt WHERE receipt_id = '${receiptId}'`,
  )
  assert(consumed, `receipt ${receiptId} was not consumed`)
  const [row] = cp.c.sql(
    "cpdb",
    "controlplane",
    "controlplane",
    `SELECT outcome, operation_class, operation_reference, binding_id::text, binding_version::text,
            coalesce(mandate_id::text, ''), activity, client_id
       FROM registry.trade_order_authority_decision WHERE decision_id = '${decision}'`,
  )
  assert(row, `CP has no decision ${decision}`)
  const [outcome, cpClass, cpRef, cpBinding, cpVersion, cpMandate, cpActivity, client] = row
  equal(outcome, "AUTHORIZED", "CP outcome")
  equal(cpClass, cls, "operation class")
  equal(cpRef, ref, "operation reference")
  equal(cpBinding, bindingId, "binding id")
  equal(cpVersion, version, "binding version")
  equal(cpMandate, mandate, "mandate")
  equal(cpActivity, activity, "activity")
  equal(client, "baobab-trade-legal-actor-assessor-staging", "CP client")
  equal(bindingId, binding.binding_id, "active CP binding")
  return { decision_id: decision, mandate_id: mandate, binding_version: Number(version) }
}

async function setup() {
  await cp.seed()
  fixture = tradeCommand(compose, "fixture")
  evidence.note("trade", {
    region_id: fixture.region_id,
    sales_channel_id: fixture.sales_channel_id,
  })

  await evidence.check(
    "A01",
    "Trade attests its native configuration to the real CP with a signed workload token over TLS",
    () => {
      const outText = compose.run([
        "exec",
        "-T",
        "-e",
        "BAOBAB_SELLER_ATTESTATION_ENABLED=true",
        "-e",
        "BAOBAB_SELLER_NATIVE_CONFIGURATION_REFERENCE=trade/native-seller-configuration/ta08-thamani-ug",
        "-e",
        `BAOBAB_SELLER_TENANT_ID=${cp.tenant}`,
        "-e",
        `BAOBAB_SELLER_ORGANISATION_ID=${cp.organisation}`,
        "-e",
        `BAOBAB_SELLER_MARKET=${MARKET}`,
        "-e",
        `BAOBAB_SELLER_CURRENCY_SCOPE=${CURRENCY}`,
        "-e",
        `BAOBAB_SELLER_SALES_CHANNEL_IDS=${fixture.sales_channel_id}`,
        "-e",
        `BAOBAB_SELLER_REGION_IDS=${fixture.region_id}`,
        "trade",
        "node",
        "node_modules/@medusajs/cli/cli.js",
        "exec",
        "./src/scripts/attest-native-seller-configuration.js",
      ])
      const line = /^\{"attestation_id".*\}$/m.exec(outText)
      assert(line, `attestation printed no result: ${outText.slice(-1500)}`)
      fixture.attestation = JSON.parse(line[0])
      const [client, digest, market] =
        cp.c.sql(
          "cpdb",
          "controlplane",
          "controlplane",
          `SELECT client_id, native_configuration_digest, market FROM registry.trade_native_configuration_attestation
        WHERE attestation_id = '${fixture.attestation.attestation_id}'`,
        )[0] ?? []
      equal(client, "baobab-trade-legal-actor-assessor-staging", "attesting workload")
      equal(digest, fixture.attestation.native_configuration_digest, "digest recorded by CP")
      equal(market, MARKET, "market derived from the RUNTIME context")
      return { attestation_id: fixture.attestation.attestation_id }
    },
  )

  await evidence.check(
    "A02",
    "CP binding lifecycle needs three distinct humans; the proposer cannot approve its own proposal",
    async () => {
      const { body: proposed } = await cp.propose(fixture.attestation.attestation_id)
      equal(proposed.status, "PENDING_APPROVAL", "proposal status")
      const ref = { binding_id: proposed.binding_id, binding_version: proposed.binding_version }
      const selfApproval = await cp.transition(
        ref,
        "approve",
        "APPROVE",
        "PENDING_APPROVAL",
        cp.maker,
      )
      assert(
        selfApproval.status >= 400,
        `the maker approved its own proposal (${selfApproval.status})`,
      )
      must(await cp.transition(ref, "approve", "APPROVE", "PENDING_APPROVAL", cp.checker), 200, 202)
      const checkerActivation = await cp.transition(
        ref,
        "activate",
        "ACTIVATE",
        "APPROVED",
        cp.checker,
      )
      assert(checkerActivation.status >= 400, `the checker activated (${checkerActivation.status})`)
      const activated = must(
        await cp.transition(ref, "activate", "ACTIVATE", "APPROVED", cp.operator),
        200,
        202,
      )
      equal(activated.status, "ACTIVE", "binding status")
      binding = ref
      evidence.note("cp", { binding_id: ref.binding_id, binding_version: ref.binding_version })
      return { ...ref, maker: cp.maker, checker: cp.checker, operator: cp.operator }
    },
  )

  // A Medusa administrator for the native Admin routes (authentication is Medusa's own).
  const email = `ta08-admin-${randomUUID().slice(0, 8)}@example.invalid`
  const password = randomUUID()
  compose.run([
    "exec",
    "-T",
    "trade",
    "node",
    "node_modules/@medusajs/cli/cli.js",
    "user",
    "-e",
    email,
    "-p",
    password,
  ])
  adminToken = must(
    await call("POST", `${TRADE}/auth/user/emailpass`, { email, password }),
    200,
  ).token
}

async function scenarios() {
  // S01 runs while the database still has the SANDBOX posture its local-profile migration recorded.
  await evidence.check(
    "S01",
    "A SANDBOX database is refused before any CP call, then the operator moves it to ENFORCED",
    async () => {
      const verdict = tradeCommand(compose, "posture")
      equal(verdict.reason, "POSTURE_NOT_ENFORCED", "posture verdict")
      const id = cart()
      expectProblem(await storeComplete(id), 403, "TRADE_OPERATION_NOT_AUTHORISED")
      equal(completedAt(id), "", "cart completion")
      equal(decisionsFor("cart", id).length, 0, "CP decisions for a refused posture")
      operatorSql("UPDATE trade_a_persistence_posture SET posture = 'ENFORCED'")
      equal(tradeCommand(compose, "posture").enforced, true, "posture after the operator step")
      // The posture never moves back, even for the operator.
      const downgrade = compose.sqlRefusal(
        "tradedb",
        "baobab_trade_ta08",
        "postgres",
        "UPDATE trade_a_persistence_posture SET posture = 'SANDBOX'",
      )
      assert(
        downgrade?.includes("only moves from SANDBOX to ENFORCED"),
        `posture downgrade: ${downgrade}`,
      )
    },
  )

  let committedCart
  await evidence.check(
    "S02",
    "Store HTTP checkout commits one order under a current CP decision, ACTIVE binding and mandate",
    async () => {
      committedCart = cart()
      const response = await storeComplete(committedCart)
      equal(response.status, 200, `checkout answer ${JSON.stringify(response.body).slice(0, 400)}`)
      equal(response.body?.type, "order", "checkout result")
      const rows = commitments(committedCart)
      equal(rows.length, 1, "commitments")
      const [receipt, cls, orderId] = rows[0]
      equal(cls, "trade.order.commit", "class")
      equal(orderId, response.body.order.id, "committed order")
      assert(completedAt(committedCart), "cart completed")
      const checked = crossCheck(receipt, CHECKOUT)
      equal(checked.mandate_id, cp.checkoutMandate, "checkout mandate")
      return { cart: committedCart, order: orderId, ...checked }
    },
  )

  await evidence.check(
    "S03",
    "Replaying the checkout returns the same order and creates no second commitment",
    async () => {
      const response = await storeComplete(committedCart)
      equal(response.status, 200, "replay answer")
      equal(response.body?.order?.id, commitments(committedCart)[0][2], "replayed order")
      equal(commitments(committedCart).length, 1, "commitments after replay")
      equal(
        tradeOne(
          `SELECT count(*)::text FROM trade_order_commitment WHERE subject_id = '${committedCart}'`,
        )[0],
        "1",
        "rows",
      )
    },
  )

  await evidence.check(
    "S04",
    "A direct completeCartWorkflow run (no HTTP) reaches the same PEP and the same outcome",
    () => {
      const id = cart()
      const result = tradeCommand(compose, "complete", [id])
      assert(result.ok, `direct completion refused: ${result.message}`)
      const [receipt, , orderId] = commitments(id)[0] ?? []
      equal(orderId, result.order_id, "direct commitment")
      return crossCheck(receipt, CHECKOUT)
    },
  )

  await evidence.check(
    "S05",
    "Draft finalisation without a DRAFT_ORDER_FINALISATION mandate is a real CP denial",
    async () => {
      const id = draft()
      const response = await adminFinalize(id)
      expectProblem(response, 403)
      equal(isDraft(id), "true", "draft stays a draft")
      const decided = decisionsFor("draft_order", id)
      assert(
        decided.length === 1 && decided[0][2] === "NO_APPLICABLE_MANDATE",
        `CP decisions ${JSON.stringify(decided)}`,
      )
      equal(
        tradeOne(
          `SELECT count(*)::text FROM trade_order_authority_receipt WHERE operation_reference LIKE 'draft_order/${id}/%'`,
        )[0],
        "0",
        "receipts",
      )
    },
  )

  await evidence.check(
    "S06",
    "With its mandate, Admin HTTP draft finalisation commits under a current CP decision",
    async () => {
      cp.draftMandate = await cp.mandate([DRAFT_FINALISATION], "ta08/mandate-draft-finalisation")
      const id = draft()
      const response = await adminFinalize(id)
      equal(
        response.status,
        200,
        `finalisation answer ${JSON.stringify(response.body).slice(0, 400)}`,
      )
      equal(isDraft(id), "false", "finalised")
      const [receipt, cls, orderId] = commitments(id)[0] ?? []
      equal(cls, "trade.draft-order.finalize", "class")
      equal(orderId, id, "finalised order")
      const checked = crossCheck(receipt, DRAFT_FINALISATION)
      equal(checked.mandate_id, cp.draftMandate, "draft mandate")
      return checked
    },
  )

  await evidence.check(
    "S07",
    "A direct convertDraftOrderWorkflow run (no route PEP) is refused at persistence",
    () => {
      const id = draft()
      const result = tradeCommand(compose, "finalize", [id])
      assert(
        !result.ok && /Trade-A denied/.test(result.message),
        `direct finalisation: ${JSON.stringify(result)}`,
      )
      equal(isDraft(id), "true", "draft stays a draft")
      equal(commitments(id).length, 0, "commitments")
    },
  )

  await evidence.check(
    "S08",
    "Direct and admin order creation have no governed commit point and stay denied",
    async () => {
      const direct = tradeCommand(compose, "create-order")
      assert(
        !direct.ok && /NO_GOVERNED_COMMIT_POINT/.test(direct.message),
        `direct creation: ${JSON.stringify(direct)}`,
      )
      expectProblem(
        await call(
          "POST",
          `${TRADE}/admin/draft-orders`,
          {},
          { Authorization: `Bearer ${adminToken}` },
        ),
        403,
        "TRADE_OPERATION_NOT_AUTHORISED",
      )
    },
  )

  await evidence.check(
    "S09",
    "Trade's runtime role cannot commit, complete, consume or rewrite evidence by direct SQL",
    () => {
      const id = cart()
      const [region, channel] = tradeOne(
        `SELECT region_id, sales_channel_id FROM cart WHERE id = '${id}'`,
      )
      const attempts = {
        order: `INSERT INTO "order" (id, region_id, sales_channel_id, email, currency_code, is_draft_order, status)
              VALUES ('order_ta08raw${randomUUID().slice(0, 8)}', '${region}', '${channel}', 'raw@example.invalid', 'ugx', false, 'pending')`,
        completion: `UPDATE cart SET completed_at = now() WHERE id = '${id}'`,
        consumption:
          "UPDATE trade_order_authority_receipt SET consumed_at = now() WHERE consumed_at IS NULL",
        rewrite: "UPDATE trade_order_commitment SET order_id = order_id",
        erase: "DELETE FROM trade_order_commitment",
        truncate: "TRUNCATE trade_order_authority_receipt",
        posture: "UPDATE trade_a_persistence_posture SET posture = 'SANDBOX'",
      }
      const refused = {}
      for (const [name, statement] of Object.entries(attempts)) {
        const error = tradeRefusal(statement)
        assert(error, `${name} was not refused`)
        refused[name] = error.split("\n").find((l) => /ERROR/.test(l)) ?? error.slice(0, 160)
      }
      equal(completedAt(id), "", "cart completion")
      return refused
    },
  )

  await evidence.check(
    "S10",
    "Trade-B/C mutations are denied by name for an authenticated administrator; no credential is 401",
    async () => {
      const orderId = commitments(committedCart)[0][2]
      for (const path of [
        `/admin/orders/${orderId}/cancel`,
        `/admin/orders/${orderId}/fulfillments`,
        "/admin/payments/pay_ta08/capture",
      ])
        expectProblem(
          await call("POST", `${TRADE}${path}`, {}, { Authorization: `Bearer ${adminToken}` }),
          403,
          "TRADE_OPERATION_NOT_AUTHORISED",
        )
      const anonymous = await adminFinalize(draft(), null)
      equal(anonymous.status, 401, "unauthenticated finalisation")
    },
  )

  await evidence.check(
    "S11",
    "A suspended CP binding denies checkout; reinstatement by the operator restores it",
    async () => {
      must(await cp.transition(binding, "suspend", "SUSPEND", "ACTIVE", cp.operator), 200, 202)
      const id = cart()
      expectProblem(await storeComplete(id), 403)
      equal(completedAt(id), "", "cart completion while suspended")
      must(await cp.transition(binding, "activate", "ACTIVATE", "SUSPENDED", cp.operator), 200, 202)
      const resumed = await storeComplete(id)
      equal(
        resumed.status,
        200,
        `checkout after reinstatement ${JSON.stringify(resumed.body).slice(0, 300)}`,
      )
      return crossCheck(commitments(id)[0][0], CHECKOUT)
    },
  )

  await evidence.check(
    "S12",
    "Native configuration drift (attested channel disabled) is refused before any CP decision",
    async () => {
      const id = cart()
      operatorSql(
        `UPDATE sales_channel SET is_disabled = true WHERE id = '${fixture.sales_channel_id}'`,
      )
      try {
        expectProblem(await storeComplete(id), 403)
        equal(decisionsFor("cart", id).length, 0, "CP decisions under drift")
      } finally {
        operatorSql(
          `UPDATE sales_channel SET is_disabled = false WHERE id = '${fixture.sales_channel_id}'`,
        )
      }
      equal(completedAt(id), "", "cart completion under drift")
    },
  )

  await evidence.check(
    "S13",
    "CP unavailable answers 503 and commits nothing; the same cart completes once CP returns",
    async () => {
      const id = cart()
      compose.run(["stop", "cp"])
      try {
        const response = await storeComplete(id)
        expectProblem(response, 503, "TRADE_AUTHORITY_UNAVAILABLE")
        equal(response.body.retryable, true, "retryable")
        equal(completedAt(id), "", "cart completion without CP")
      } finally {
        compose.run(["start", "cp"])
        for (let i = 0; i < 30; i++) {
          if ((await call("GET", `${CP}/healthz`).catch(() => ({ status: 0 }))).status === 200)
            break
          await sleep(1000)
        }
      }
      equal((await storeComplete(id)).status, 200, "checkout after CP returns")
    },
  )

  await evidence.check(
    "S14",
    "A disabled TA-07 fence trigger is detected and refused before any CP call",
    async () => {
      const id = cart()
      operatorSql("ALTER TABLE cart DISABLE TRIGGER trade_a_cart_commit_fence")
      try {
        equal(tradeCommand(compose, "posture").reason, "FENCE_NOT_ACTIVE", "posture verdict")
        expectProblem(await storeComplete(id), 403, "TRADE_OPERATION_NOT_AUTHORISED")
        equal(decisionsFor("cart", id).length, 0, "CP decisions with a disabled fence")
      } finally {
        operatorSql("ALTER TABLE cart ENABLE TRIGGER trade_a_cart_commit_fence")
      }
      equal(tradeCommand(compose, "posture").enforced, true, "posture after re-enabling")
      equal((await storeComplete(id)).status, 200, "checkout after re-enabling")
    },
  )

  await evidence.check(
    "S15",
    "A revoked mandate denies checkout with a recorded CP denial",
    async () => {
      await cp.revokeMandate(cp.checkoutMandate)
      const id = cart()
      expectProblem(await storeComplete(id), 403)
      equal(completedAt(id), "", "cart completion after revocation")
      const outcomes = decisionsFor("cart", id).map((d) => d[2])
      assert(outcomes.length > 0 && !outcomes.includes("AUTHORIZED"), `CP outcomes ${outcomes}`)
      return { outcomes }
    },
  )

  await evidence.check(
    "S16",
    "Every Trade commitment consumed exactly one receipt that matches an AUTHORIZED CP decision",
    () => {
      const rows = tradeSql(
        `SELECT k.receipt_id, k.operation_class, count(*) OVER (PARTITION BY k.receipt_id)
         FROM trade_order_commitment k`,
      )
      assert(rows.length >= 6, `only ${rows.length} commitments`)
      for (const [receipt, cls, uses] of rows) {
        equal(uses, "1", `receipt ${receipt} reuse`)
        crossCheck(receipt, cls === "trade.order.commit" ? CHECKOUT : DRAFT_FINALISATION)
      }
      const orphans = tradeOne(
        `SELECT count(*)::text FROM "order" o WHERE NOT o.is_draft_order AND o.deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM trade_order_commitment k WHERE k.order_id = o.id)`,
      )[0]
      equal(orphans, "0", "orders without a commitment")
      return { commitments: rows.length }
    },
  )
}

try {
  await setup()
  if (binding) await scenarios()
} catch (error) {
  evidence.failures++
  evidence.note("harness", { error: String(error.stack ?? error).slice(0, 4000) })
  console.error(error)
} finally {
  const git = (dir) =>
    execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  evidence.finish({
    classification:
      "REAL_COMPONENT_SYNTHETIC_DATA (EA v2.3 §3.3): not EA Gate D, not L4, not protected staging",
    trade_commit: process.env.TRADE_COMMIT ?? git("."),
    cp_commit: process.env.CP_COMMIT,
    trade_image: process.env.TRADE_IMAGE,
    evidence_location: process.env.EVIDENCE_LOCATION ?? null,
  })
}
