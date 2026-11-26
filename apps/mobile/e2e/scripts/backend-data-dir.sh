#!/usr/bin/env bash
# Prints the e2e backend's server data dir from its ready line in a backend log.
# Usage: backend-data-dir.sh <backend.log>
set -euo pipefail

grep -m1 '"serverUrl"' "${1:?backend log}" |
  node -e 'let s="";process.stdin.on("data",(d)=>(s+=d)).on("end",()=>process.stdout.write(JSON.parse(s).serverDataDir))'
