#!/usr/bin/env bash
# Prints a fresh one-time pairing code from the e2e backend. The backend only
# lets signed-in callers mint codes, so this signs in as the server machine with
# the local token the server keeps in its data dir.
#
# Usage: SERVER_URL=http://127.0.0.1:41999 SERVER_DATA_DIR=<dir> mint-pairing-code.sh
# SERVER_DATA_DIR is the backend's "serverDataDir" (printed in its ready line;
# see backend-data-dir.sh).
set -euo pipefail

: "${SERVER_URL:?SERVER_URL}"
: "${SERVER_DATA_DIR:?SERVER_DATA_DIR}"
token="bbl_$(tr -d '[:space:]' < "$SERVER_DATA_DIR/local-access-token")"
curl -fsS -X POST -H "Authorization: Bearer $token" \
  "$SERVER_URL/api/v1/access/pairings" |
  node -e 'let s="";process.stdin.on("data",(d)=>(s+=d)).on("end",()=>process.stdout.write(JSON.parse(s).code))'
