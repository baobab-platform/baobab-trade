#!/usr/bin/env bash
# EA v2.3 EA-R03 Trade-A TA-08 real-runtime acceptance (ADR-SHARED-039).
# Runs the SHIPPED Trade image under its protected staging profile against the
# REAL CP release binary built at a pinned merged commit, real RS256-signed
# tokens from a test issuer, and PostgreSQL 17 for both Trade and CP. Every hop
# Trade makes (CP, IAM) is TLS through the edge. Drives the scenarios in
# driver/ta08.mjs and writes the evidence bundle and receipt.
#
# REAL_COMPONENT_SYNTHETIC_DATA (EA v2.3 §3.3): NOT EA Gate D, NOT L4, NOT
# protected staging. Nothing here is deployable.
#
#   run-trade-a.sh <evidence-dir>
#
# Required environment:
#   BAOBAB_ENVIRONMENT=integration   anything else is refused
#   CP_SRC                           baobab-cp checkout at the pinned commit
# Optional: TRADE_IMAGE (default: build the repository Dockerfile),
#           TA08_KEEP=1 leaves the stack running for inspection.
set -euo pipefail

if [ "${BAOBAB_ENVIRONMENT:-}" != "integration" ]; then
  echo "the Trade-A TA-08 harness runs only with BAOBAB_ENVIRONMENT=integration" >&2
  exit 2
fi
: "${CP_SRC:?CP_SRC is required}"
OUT=$(mkdir -p "${1:?evidence directory required}" && cd "$1" && pwd)
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
RUN=$(mktemp -d)
COMPOSE_FILE="$HERE/compose.yaml"
export RUN_DIR=$RUN
export CP_IMAGE=baobab-trade-a-ta08/cp:local NODE_IMAGE=node:24.18.1-alpine3.24
export TRADE_IMAGE=${TRADE_IMAGE:-baobab-trade-a-ta08/trade:local}
export CPDB_PASSWORD="cpdb-$(openssl rand -hex 12)" TRADEDB_ADMIN_PASSWORD="pg-$(openssl rand -hex 12)"
export TRADE_DB_PASSWORD="trade-$(openssl rand -hex 12)" TRADE_WORKLOAD_SECRET=$(openssl rand -hex 24)
export TRADE_JWT_SECRET=$(openssl rand -hex 24) TRADE_COOKIE_SECRET=$(openssl rand -hex 24)
# CP derives an engine instance key from its UUID; Trade needs it before it starts.
ENGINE_UUID=$(python3 -c 'import uuid; print(uuid.uuid4())')
export TRADE_ENGINE_INSTANCE_ID="ei_${ENGINE_UUID//-/}"
COMPOSE=(docker compose -f "$COMPOSE_FILE" -p baobab-trade-a-ta08)
log() { printf '[ta08] %s\n' "$*" | tee -a "$OUT/run.log"; }

collect() {
  for s in trade cp issuer edge; do
    "${COMPOSE[@]}" logs --no-color "$s" > "$OUT/$s.log" 2>&1 || true
  done
  # Logs are evidence: they must never carry a token or a run secret.
  if grep -l -e "$TRADE_WORKLOAD_SECRET" -e "$TRADE_DB_PASSWORD" -e "$CPDB_PASSWORD" "$OUT"/*.log >/dev/null 2>&1 \
     || grep -Pl 'eyJ[A-Za-z0-9_-]{20,}\.' "$OUT"/*.log >/dev/null 2>&1; then
    log "a log carries a token or a run secret"
    echo "FAIL L01 logs carry a token or a run secret" >> "$OUT/trade-a-report.txt"
    exit 1
  fi
}
cleanup() {
  collect
  if [ "${TA08_KEEP:-0}" != "1" ]; then "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true; rm -rf "$RUN"; fi
}
trap cleanup EXIT
: > "$OUT/run.log"
# Never reuse a previous run's containers or volumes.
"${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true

log "throwaway CA and the TLS edge certificate"
mkdir -p "$RUN"/{edge,cp,issuer,trade}
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=Baobab TA-08 throwaway CA" \
  -keyout "$RUN/ca.key" -out "$RUN/ca.pem" 2>/dev/null
openssl req -newkey rsa:2048 -nodes -subj "/CN=gated.test" -keyout "$RUN/edge/server.key" -out "$RUN/edge.csr" 2>/dev/null
printf 'subjectAltName=DNS:cp.gated.test,DNS:iam.gated.test\nextendedKeyUsage=serverAuth\n' > "$RUN/edge.ext"
openssl x509 -req -in "$RUN/edge.csr" -CA "$RUN/ca.pem" -CAkey "$RUN/ca.key" -CAcreateserial -days 1 \
  -extfile "$RUN/edge.ext" -out "$RUN/edge/server.pem" 2>/dev/null
cp "$RUN/ca.pem" "$RUN/cp/ca.pem"; cp "$RUN/ca.pem" "$RUN/trade/ca.pem"; cp "$RUN/ca.pem" "$OUT/ca.pem"
printf '%s\n' "$ENGINE_UUID" > "$RUN/engine-instance-uuid"

log "Trade workload client and the CI-only registry snapshot"
python3 - "$RUN/issuer/clients.json" "$TRADE_WORKLOAD_SECRET" <<'EOF'
import json, sys
json.dump({"baobab-trade-legal-actor-assessor-staging": {
    "secret": sys.argv[2], "audience": "baobab-control-plane",
    "scopes": ["context:resolve", "legal-actor:assess", "trade-seller-binding:attest",
               "trade-seller-binding:resolve", "trade-order-authority:resolve"]}}, open(sys.argv[1], "w"))
EOF
cp "$HERE/cp/workload-registry.yaml" "$RUN/cp/workload-registry.yaml"
chmod -R a+rX "$RUN"

CP_COMMIT=$(git -C "$CP_SRC" rev-parse HEAD)
TRADE_COMMIT=$(git -C "$REPO" rev-parse HEAD)
log "images: CP release binaries at $CP_COMMIT; Trade from $TRADE_IMAGE"
mkdir -p "$RUN/build/cp"
(cd "$CP_SRC" && CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o "$RUN/build/cp/controlplane" ./cmd/controlplane \
  && CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o "$RUN/build/cp/migrate" ./cmd/migrate)
docker build -q -t "$CP_IMAGE" -f "$HERE/images/cp.Dockerfile" "$RUN/build/cp" >/dev/null
if [ "$TRADE_IMAGE" = "baobab-trade-a-ta08/trade:local" ]; then
  docker build -q -t "$TRADE_IMAGE" --build-arg REVISION="$TRADE_COMMIT" "$REPO" >/dev/null
fi
docker pull -q "$NODE_IMAGE" >/dev/null

log "databases, Redis, the TLS edge and the test issuer; then CP"
"${COMPOSE[@]}" up -d --wait tradedb cpdb redis issuer edge >/dev/null
"${COMPOSE[@]}" run --rm --no-deps --entrypoint /migrate cp >"$OUT/cp-migrate.log" 2>&1
"${COMPOSE[@]}" up -d cp >/dev/null
for _ in $(seq 1 60); do curl -sf http://127.0.0.1:18093/healthz >/dev/null && break; sleep 2; done
curl -sf http://127.0.0.1:18093/healthz >/dev/null || { log "CP did not start"; exit 1; }

# Trade's schema and synthetic Thamani Uganda catalogue, as one-off containers
# under the local test profile (the TA-07 posture is then SANDBOX; scenario S01
# proves a protected runtime refuses it until the operator moves it to ENFORCED).
LOCAL=(-e NODE_ENV=test -e BAOBAB_ENVIRONMENT= -e BAOBAB_DEPLOYMENT_ENV= -e BAOBAB_TRADE_A_ORDER_AUTHORITY_ENABLED=)
MEDUSA=(node node_modules/@medusajs/cli/cli.js)
log "Trade migrations and the Thamani Uganda bootstraps (local test profile)"
# Medusa's migrator mkdirs an empty migrations folder inside provider packages
# that ship none (auth-emailpass, fulfillment-manual, ...), which the shipped
# image's non-root user cannot write. Only this throwaway one-off runs as root;
# the Trade server itself runs as the image's own user.
"${COMPOSE[@]}" run --rm --no-deps -T -u root "${LOCAL[@]}" trade "${MEDUSA[@]}" db:migrate >"$OUT/trade-migrate.log" 2>&1 \
  || { log "Trade migrations failed"; grep '"level":"error"' "$OUT/trade-migrate.log" | tail -5; exit 1; }
for script in bootstrap-thamani-market bootstrap-thamani-catalogue bootstrap-thamani-pricing \
              bootstrap-thamani-inventory bootstrap-thamani-payments bootstrap-thamani-fulfilment bootstrap-thamani-tax; do
  "${COMPOSE[@]}" run --rm --no-deps -T "${LOCAL[@]}" trade "${MEDUSA[@]}" exec "./src/scripts/$script.js" \
    >>"$OUT/trade-bootstrap.log" 2>&1 || { log "bootstrap $script failed"; tail -40 "$OUT/trade-bootstrap.log"; exit 1; }
done

log "Trade, shipped image, protected staging profile"
"${COMPOSE[@]}" up -d trade >/dev/null
for _ in $(seq 1 90); do curl -sf http://127.0.0.1:19000/health >/dev/null && break; sleep 2; done
curl -sf http://127.0.0.1:19000/health >/dev/null || { log "Trade did not start"; exit 1; }

log "scenarios"
export CP_COMMIT TRADE_COMMIT
(cd "$REPO" && node "$HERE/driver/ta08.mjs" "$RUN" "$OUT" "$COMPOSE_FILE") 2>&1 | tee -a "$OUT/run.log"
cat "$OUT/trade-a-report.txt"
grep -q '^Trade-A failures: 0$' "$OUT/trade-a-report.txt"
