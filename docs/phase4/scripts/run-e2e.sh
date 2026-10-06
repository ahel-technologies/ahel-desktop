#!/bin/sh
# Hosted chat end to end on one machine: the real chat gateway, one
# ahel-chat-host container per person, a fake ahel.ai with a mock model, and
# headless Chromium driving the real client (load.mjs). No cluster, no
# ahel.ai account, no model spend.
#
#   docs/phase4/scripts/run-e2e.sh <ahel checkout> [users] [turns]
#
# Needs Docker, an `ahel-chat-host:e2e` image (docs/phase4/HOSTED-CHAT.md,
# "Run it locally", with -t ahel-chat-host:e2e), openssl and a Chromium
# (CHROME, default: Playwright's headless shell). Stop with:
#   docker rm -f chat-gw $(docker ps -aq -f label=ahel.e2e=1); docker volume rm $(docker volume ls -q -f label=ahel.e2e=1)
set -eu
AHEL=${1:?path to an ahel checkout with services/chat-gateway}
USERS=${2:-20}
TURNS=${3:-3}
HERE=$(cd "$(dirname "$0")" && pwd)
WORK=${E2E_WORK:-$(mktemp -d /tmp/chat-e2e.XXXXXX)}
mkdir -p "$WORK/certs" "$WORK/stub"

# A throwaway CA and one leaf for the fake ahel.ai (chat-gw) and the browser front (localhost).
openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj /CN=chat-e2e-ca -keyout "$WORK/certs/ca.key" -out "$WORK/certs/ca.pem" 2>/dev/null
openssl req -newkey rsa:2048 -nodes -subj /CN=chat-gw -keyout "$WORK/certs/leaf.key" -out "$WORK/certs/leaf.csr" 2>/dev/null
printf 'subjectAltName=DNS:chat-gw,DNS:localhost\n' > "$WORK/certs/ext"
openssl x509 -req -in "$WORK/certs/leaf.csr" -CA "$WORK/certs/ca.pem" -CAkey "$WORK/certs/ca.key" -CAcreateserial -days 2 -extfile "$WORK/certs/ext" -out "$WORK/certs/leaf.pem" 2>/dev/null
cp "$WORK/certs/ca.pem" "$WORK/stub/ca.pem"
chmod 644 "$WORK/certs/leaf.key"

# Each Host talks to the fake ahel.ai instead of ahel.ai: account, Ahel models.
cat > "$WORK/stub/stub.patch.yml" <<'EOF'
- id: ahel-account
  config:
    appOrigin: https://chat-gw:9443
- id: llm-ahel
  config:
    baseURL: https://chat-gw:9443/api/llm/v1
    defaultModels: [mock/]
- id: mcp-ahel
  disabled: true
- id: web-search-ahel
  disabled: true
EOF

docker network inspect chat-e2e >/dev/null 2>&1 || docker network create chat-e2e >/dev/null
docker rm -f chat-gw >/dev/null 2>&1 || true
docker run -d --name chat-gw --network chat-e2e -p 127.0.0.1:8443:8443 -u 0 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$AHEL/services/chat-gateway:/gateway:ro" -v "$HERE:/e2e:ro" -v "$WORK/certs:/certs:ro" \
  -e STUB_DIR="$WORK/stub" -e PUBLIC_HOST=localhost:8443 -e HOST_IMAGE="${HOST_IMAGE:-ahel-chat-host:e2e}" \
  node:22-slim node /e2e/gateway-harness.mjs >/dev/null
until curl -sk -o /dev/null https://localhost:8443/chat/; do sleep 0.2; done

node "$HERE/load.mjs" https://localhost:8443 "$USERS" "$TURNS"
echo "fake ahel.ai counters: $(docker exec chat-gw node -e "fetch('http://127.0.0.1:9080/stats').then(r=>r.text()).then(console.log)")"
echo "Host containers: $(docker ps -q -f label=ahel.e2e=1 | wc -l | tr -d ' ') running, $(docker ps -aq -f label=ahel.e2e=1 -f status=exited | wc -l | tr -d ' ') exited"
for c in $(docker ps -q -f label=ahel.e2e=1); do docker exec "$c" sh -c 'grep VmRSS /proc/1/status' ; done \
  | awk '{s+=$2; n++; if ($2>m) m=$2} END {if (n) printf "Host RSS: mean %d MB, max %d MB over %d containers\n", s/n/1024, m/1024, n}'
