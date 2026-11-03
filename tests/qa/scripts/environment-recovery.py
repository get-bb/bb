import json
import os
from pathlib import Path
import shlex
import signal
import socket
import sqlite3
import subprocess
import tempfile
import time
import uuid


ROOT = Path(__file__).resolve().parents[3]
OWNER_ENV = dict(os.environ)
assert OWNER_ENV.get("BB_SERVER_URL"), "Set BB_SERVER_URL to the host-care owner"
assert OWNER_ENV.get("BB_THREAD_ID"), "Run from an owning bb thread"
HEAD = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
assert not subprocess.check_output(["git", "diff", "HEAD", "--name-only"], cwd=ROOT), "Commit tracked changes first"
(ROOT / ".tmp").mkdir(exist_ok=True)
RUN = Path(tempfile.mkdtemp(prefix="environment-recovery-", dir=ROOT / ".tmp"))
DATA = RUN / "data"
DATA.mkdir()
(RUN / "skills").mkdir()
LOG = RUN / "results.log"
DIAGNOSTICS = RUN / "diagnostics.log"
JOB = None
HOOK = None


def log(message):
    print(message, flush=True)
    with LOG.open("a") as stream:
        stream.write(message + "\n")


def command(args, env=OWNER_ENV, check=True, timeout=120, cwd=ROOT):
    result = subprocess.run(args, env=env, cwd=cwd, text=True, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, timeout=timeout)
    with DIAGNOSTICS.open("a") as stream:
        stream.write(shlex.join(args) + "\n" + result.stdout + "\n")
    if check and result.returncode:
        raise RuntimeError("Command failed; inspect private diagnostics.log")
    return result


def owner(*args):
    return json.loads(command(["bb", *args, "--json"], timeout=660).stdout)


OWNER_STATUS = owner("status")
assert Path(OWNER_STATUS["dataDir"]).resolve() != DATA.resolve()


def reserve_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


PORT = reserve_port()
DAEMON_PORT = reserve_port()
assert PORT != DAEMON_PORT
QA_ENV = {key: value for key, value in os.environ.items()
          if not key.startswith("BB_") and key != "NODE_OPTIONS"}
QA_ENV.update(BB_SERVER_URL=f"http://127.0.0.1:{PORT}", BB_SERVER_PORT=str(PORT),
              BB_HOST_DAEMON_PORT=str(DAEMON_PORT), BB_DATA_DIR=str(DATA),
              BB_SERVER_BIND_HOST="127.0.0.1", BB_SKIP_ONBOARDING="1",
              BB_TELEMETRY="false", BB_INHERITED_SKILLS_ROOTS=str(RUN / "skills"),
              BB_CLI_REEXEC="1", BB_THREAD_ID="", BB_PROJECT_ID="", BB_CLI_ERROR_LOG="0")
CLI = ["node", "--conditions=source", "--import", "tsx", "apps/cli/src/index.ts"]


def qa_bb(*args, check=True):
    return command([*CLI, *args], env=QA_ENV, check=check)


def qa_preflight():
    status = json.loads(qa_bb("status", "--json").stdout)
    if not status.get("dataDir"):
        raise RuntimeError("QA server is not ready")
    assert Path(status["dataDir"]).resolve() == DATA.resolve(), "Unexpected QA target"
    assert status["dataDir"] != OWNER_STATUS["dataDir"], "Owner is not a QA target"
    return True


def qa_write(*args, check=True):
    qa_preflight()
    return qa_bb(*args, check=check)


def wait_for(predicate, timeout=120):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = predicate()
        if value:
            return value
        time.sleep(1)
    raise RuntimeError("Timed out; inspect private diagnostics.log")


def database():
    db = sqlite3.connect(f"file:{DATA / 'bb.db'}?mode=rw", uri=True)
    db.row_factory = sqlite3.Row
    return db


def row(environment_id):
    with database() as db:
        result = db.execute("select * from environments where id=?", (environment_id,)).fetchone()
        return dict(result) if result else None


def process(pid):
    fields = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()
    return {"pid": pid, "parent": int(fields[1]), "start": fields[19], "state": fields[0]}


def same_process(saved):
    try:
        current = process(saved["pid"])
        return current["start"] == saved["start"] and current["state"] != "Z"
    except FileNotFoundError:
        return False


def daemon():
    rows = []
    for entry in Path("/proc").iterdir():
        if entry.name.isdecimal():
            try:
                rows.append(process(int(entry.name)))
            except (FileNotFoundError, PermissionError):
                pass
    owned = {JOB["process"]["pid"]}
    for _ in range(len(rows)):
        descendants = {item["pid"] for item in rows if item["parent"] in owned}
        if descendants <= owned:
            break
        owned |= descendants
    found = []
    for item in rows:
        if item["pid"] not in owned:
            continue
        try:
            args = Path(f"/proc/{item['pid']}/cmdline").read_bytes().split(b"\0")
            if any(arg.endswith(b"/apps/host-daemon/dist/daemon-bundle.mjs") for arg in args):
                environ = Path(f"/proc/{item['pid']}/environ").read_bytes().split(b"\0")
                assert f"BB_DATA_DIR={DATA}".encode() in environ
                found.append(item)
        except FileNotFoundError:
            pass
    assert len(found) <= 1
    return found[0] if found else None


def terminal(environment_id, attempts):
    state = row(environment_id)
    return (state["teardown_attempt"] == attempts and state["teardown_status"] == "failed"
            and state["retire_at"] is None and state["teardown_message"].startswith("Needs recovery:"))


def run():
    global JOB, HOOK
    log(f"HEAD {HEAD}")
    launcher = RUN / "launch.sh"
    exports = "\n".join(f"export {key}={shlex.quote(value)}" for key, value in QA_ENV.items()
                        if key.startswith("BB_"))
    launcher.write_text("set -euo pipefail\nfor key in ${!BB_@}; do unset \"$key\"; done\nunset NODE_OPTIONS\n"
                        + exports + "\nexec pnpm start --worktree-runtime-policy\n")
    assert owner("status")["dataDir"] == OWNER_STATUS["dataDir"]
    JOB = owner("host-care", "start", "--title", "Environment recovery e2e", "--cwd", str(ROOT),
                "--command", shlex.join(["bash", str(launcher)]), "--retention", "temporary", "--wait", "600s")
    (RUN / "job.json").write_text(json.dumps(JOB))
    assert JOB["state"] == "running", "Host-care queued or refused launch; do not bypass it"

    def ready():
        assert same_process({"pid": JOB["process"]["pid"], "start": str(JOB["process"]["startTicks"])}), "Runtime exited; inspect host-care logs"
        try:
            return qa_preflight()
        except (RuntimeError, KeyError, json.JSONDecodeError):
            return False

    wait_for(ready, 600)
    host_list = wait_for(lambda: json.loads(qa_bb("host", "list", "--json").stdout))
    assert len(host_list) == 1
    host_id = host_list[0]["id"]
    fixture = RUN / "fixture"
    fixture.mkdir()
    pid_file = RUN / "setup.pid"
    cwd_file = RUN / "setup.cwd"
    teardown_file = RUN / "teardown.finished"
    (fixture / ".bb-env-setup.sh").write_text(
        f"echo $$ > {shlex.quote(str(pid_file))}\npwd > {shlex.quote(str(cwd_file))}\nexec sleep 3600\n")
    (fixture / ".bb-env-teardown.sh").write_text(f"echo finished > {shlex.quote(str(teardown_file))}\n")
    command(["git", "init", "-b", "main", str(fixture)])
    command(["git", "add", "."], cwd=fixture)
    command(["git", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
             "commit", "-m", "Add blocking setup fixture"], cwd=fixture)
    project = json.loads(qa_write("project", "create", "--name", "Recovery fixture", "--root", str(fixture),
                                  "--host", host_id, "--json").stdout)
    thread = json.loads(qa_write("thread", "spawn", "--project", project["id"], "--host", host_id,
                                 "--new-environment", "worktree", "--provider", "codex",
                                 "--title", "Interrupted setup", "--prompt", "Reply OK", "--json").stdout)
    wait_for(lambda: pid_file.exists() and cwd_file.exists())
    HOOK = process(int(pid_file.read_text().strip()))
    hook_cwd = cwd_file.read_text().strip()
    assert os.readlink(f"/proc/{HOOK['pid']}/cwd") == hook_cwd
    assert Path(hook_cwd).is_relative_to(DATA)
    with database() as db:
        environment_id = db.execute("select environment_id from threads where id=?", (thread["id"],)).fetchone()[0]
        unfinished = db.execute("select count(*) from environment_hook_operations where path=? and finished_at is null",
                                (hook_cwd,)).fetchone()[0]
        assert unfinished == 1
    original = wait_for(daemon)
    assert same_process(original)
    os.kill(original["pid"], signal.SIGKILL)
    wait_for(lambda: (current := daemon()) and current["pid"] != original["pid"])
    assert same_process(HOOK), "Expected detached setup to survive daemon restart"
    log("PASS real setup survives isolated daemon restart; operation remains unresolved")
    def thread_status():
        with database() as db:
            return db.execute("select status from threads where id=?", (thread["id"],)).fetchone()[0]

    wait_for(lambda: thread_status() == "error")
    qa_write("thread", "archive", thread["id"], "--json")
    wait_for(lambda: thread_status() not in ("active", "stopping"))
    for attempt in range(1, 6):
        if row(environment_id)["teardown_attempt"] < attempt:
            qa_write("environment", "cleanup", environment_id, "--json")
        wait_for(lambda: row(environment_id)["teardown_attempt"] == attempt
                 and row(environment_id)["teardown_status"] == "failed")
        state = row(environment_id)
        if attempt < 5:
            delay = state["retire_at"] - state["updated_at"]
            assert abs(delay - 60000 * 2 ** (attempt - 1)) < 2000
    assert terminal(environment_id, 5)
    assert "Needs recovery" in qa_bb("environment", "list").stdout
    log("PASS backoff deadlines 1/2/4/8 minutes; explicit cleanup advances five failures to Needs recovery")
    saved = row(environment_id)
    legacy_id = "env_" + uuid.uuid4().hex[:10]
    legacy_path = RUN / "absent-workspace"
    legacy = dict(saved, id=legacy_id, path=str(legacy_path), owner_thread_id=None,
                  environment_provider_instance_key="legacy-recovery", teardown_attempt=7873,
                  teardown_message="Interrupted legacy setup", retire_at=int(time.time() * 1000) - 1,
                  is_worktree=0, is_git_repo=0, claim_path=None)
    qa_preflight()
    with database() as db:
        db.execute(f"insert into environments ({','.join(legacy)}) values ({','.join('?' for _ in legacy)})",
                   list(legacy.values()))
        operation = f"environment:{legacy_id}:legacy-recovery:setup"
        db.execute("insert into environment_hook_operations (id,operation_id,host_id,path,kind,started_at) values (?,?,?,?,?,?)",
                   (operation, operation, host_id, str(legacy_path), "setup", int(time.time() * 1000)))
    wait_for(lambda: terminal(legacy_id, 7873), 90)
    before = time.monotonic()
    while time.monotonic() - before < 75:
        assert terminal(environment_id, 5) and terminal(legacy_id, 7873)
        time.sleep(1)
    log("PASS no retries for 75 seconds: interrupted setup 5 -> 5; legacy 7873 -> 7873")
    blocked = qa_write("environment", "cleanup", environment_id, "--recover", "--json", check=False)
    assert blocked.returncode and "workspace processes remain" in blocked.stdout
    assert terminal(environment_id, 5) and not teardown_file.exists()
    log("PASS recovery refuses surviving same-UID workspace process without deleting workspace")
    assert same_process(HOOK) and os.readlink(f"/proc/{HOOK['pid']}/cwd") == hook_cwd
    os.kill(HOOK["pid"], signal.SIGTERM)
    wait_for(lambda: not same_process(HOOK))
    qa_write("environment", "cleanup", environment_id, "--recover", "--json")
    wait_for(lambda: row(environment_id)["teardown_status"] == "removed")
    assert teardown_file.exists() and not Path(hook_cwd).exists()
    with database() as db:
        assert db.execute("select count(*) from environment_hook_operations where path=? and finished_at is null",
                          (hook_cwd,)).fetchone()[0] == 0
    log("PASS recovery after process exit finishes hook, runs teardown, and removes workspace")
    qa_write("environment", "cleanup", legacy_id, "--recover", "--json")
    wait_for(lambda: row(legacy_id)["teardown_status"] == "removed")
    log("PASS legacy fixture recovers after stopping at 7873 attempts")
    assert subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip() == HEAD


try:
    run()
finally:
    if HOOK and same_process(HOOK):
        os.kill(HOOK["pid"], signal.SIGTERM)
    if JOB:
        assert owner("status")["dataDir"] == OWNER_STATUS["dataDir"]
        owner("host-care", "release", JOB["id"])
log("PASS owned runtime released; automated e2e complete")
