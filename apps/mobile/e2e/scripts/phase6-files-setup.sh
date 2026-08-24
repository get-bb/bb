#!/usr/bin/env bash
# Seeds the Phase 6 Files flow against a running mobile e2e backend: writes
# a README.md, src/app.ts, data.csv, docs/index.html and assets/dot.png into
# the harness project checkout (the "Idle thread" / any thread's workspace —
# the seed threads share the project repo), plus notes/plan.md and report.csv
# into the named thread's storage directory. Prints the thread id and the
# paths as JSON.
#
#   SERVER_URL=http://127.0.0.1:41999 THREAD_TITLE="Idle thread" e2e/scripts/phase6-files-setup.sh
#   maestro test e2e/flows/phase6-files.yaml
#
# Requires curl + python3. Idempotent: re-running rewrites the same files.
set -euo pipefail

SERVER_URL="${SERVER_URL:-http://127.0.0.1:41999}"
THREAD_TITLE="${THREAD_TITLE:-Idle thread}"
API="$SERVER_URL/api/v1"

python3 - "$API" "$THREAD_TITLE" <<'PY'
import json, sys, urllib.request, base64

api, title = sys.argv[1], sys.argv[2]

def get(path):
    with urllib.request.urlopen(f"{api}{path}") as response:
        return json.load(response)

def post(path, body):
    request = urllib.request.Request(
        f"{api}{path}",
        data=json.dumps(body).encode(),
        headers={"content-type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request) as response:
        return response.status

threads = get("/threads")
threads = threads if isinstance(threads, list) else threads.get("threads", threads.get("items", []))
thread = next((t for t in threads if t.get("title") == title and not t.get("archivedAt")), None)
if thread is None:
    raise SystemExit(f"no thread titled {title!r}")
environment = get(f"/environments/{thread['environmentId']}")
host_id, repo = environment["hostId"], environment["path"]
storage = get(f"/threads/{thread['id']}/thread-storage/files")["storageRootPath"]

def write(path, content, encoding=None):
    body = {"hostId": host_id, "path": path, "content": content, "createParents": True}
    if encoding:
        body["contentEncoding"] = encoding
    post("/files/write", body)

readme = ["# Mobile E2E Project", "", "This README exercises the mobile file preview.", "",
          "See [the app source](src/app.ts:12) and [data](data.csv).", "", "## Sections", ""]
readme += [f"- Item {i}: lorem ipsum dolor sit amet, line {i} of the README." for i in range(1, 70)]
readme += ["", "```ts", "export const answer = 42;", "```", ""]
write(f"{repo}/README.md", "\n".join(readme))
write(f"{repo}/src/app.ts", "// app.ts — sample source for the file preview\n" + "".join(
    f"export function fn{i}(value: number): number {{ return value * {i}; }} // line {i}\n" for i in range(1, 121)))
write(f"{repo}/data.csv", 'name,qty,price,note\nalpha,1,2.50,"quoted, comma"\nbeta,20,13.00,plain\ngamma,3,0.99,"with ""quotes"""\n')
write(f"{repo}/docs/index.html", '<!doctype html><html><head><meta charset="utf-8"><title>Preview</title>'
      '<style>body{font-family:-apple-system;padding:24px}h1{color:#6c3ad1}</style></head><body>'
      '<h1>HTML preview works</h1><p id="p">static</p>'
      '<script>document.getElementById("p").textContent="scripts run in the sandbox";</script></body></html>')
write(f"{repo}/assets/dot.png", "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAE0lEQVR4nGP4z8DwHwyBNAMDAwA0TQP9ZSqa6wAAAABJRU5ErkJggg==", "base64")
write(f"{storage}/notes/plan.md", "# Plan\n\n1. Build the files tab\n2. Preview a storage file\n\nSibling: [report](report.csv).\n")
write(f"{storage}/report.csv", "week,done\n1,3\n2,5\n")
print(json.dumps({"threadId": thread["id"], "environmentId": environment["id"], "repo": repo, "storage": storage}))
PY
