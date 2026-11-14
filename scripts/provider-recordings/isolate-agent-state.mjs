import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const RUN_WORKSPACE_MARKER = "bb-conf-";

function copyIfPresent(fromDir, toDir, names) {
  mkdirSync(toDir, { recursive: true });
  for (const name of names) {
    if (existsSync(join(fromDir, name))) {
      copyFileSync(join(fromDir, name), join(toDir, name));
    }
  }
}

function writeBackIfChanged(isolatedPath, realPath) {
  if (!existsSync(isolatedPath) || !existsSync(realPath)) return;
  const isolated = readFileSync(isolatedPath);
  if (!isolated.equals(readFileSync(realPath))) {
    writeFileSync(realPath, isolated);
  }
}

async function freePort() {
  const server = createServer();
  await new Promise((resolveListen) =>
    server.listen(0, "127.0.0.1", resolveListen),
  );
  const { port } = server.address();
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}

function listenerPids(port) {
  try {
    return execFileSync("lsof", ["-t", `-iTCP:${port}`, "-sTCP:LISTEN"], {
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean)
      .map(Number);
  } catch {
    return [];
  }
}

async function stopListener(port) {
  for (const pid of listenerPids(port)) {
    try {
      process.kill(pid);
    } catch {}
  }
  for (
    let attempt = 0;
    attempt < 50 && listenerPids(port).length > 0;
    attempt += 1
  ) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
}

function copyActiveOpenCodeCredentials(realDb, isolatedDb) {
  if (!existsSync(realDb)) return;
  const source = new DatabaseSync(realDb, { readOnly: true });
  const target = new DatabaseSync(isolatedDb);
  try {
    const insert = target.prepare(
      "INSERT OR REPLACE INTO credential (id, integration_id, label, value, connector_id, method_id, active, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const row of source
      .prepare(
        "SELECT id, integration_id, label, value, connector_id, method_id, active, time_created, time_updated FROM credential WHERE active = 1",
      )
      .all()) {
      insert.run(
        row.id,
        row.integration_id,
        row.label,
        row.value,
        row.connector_id,
        row.method_id,
        row.active,
        row.time_created,
        row.time_updated,
      );
    }
  } finally {
    source.close();
    target.close();
  }
}

function isolateCodex(root, env) {
  const real = env.CODEX_HOME ?? join(homedir(), ".codex");
  const home = join(root, "codex-home");
  copyIfPresent(real, home, ["config.toml", "auth.json"]);
  return {
    env: { CODEX_HOME: home },
    finish: async () =>
      writeBackIfChanged(join(home, "auth.json"), join(real, "auth.json")),
  };
}

function isolatePi(root, env) {
  const real = env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
  const agentDir = join(root, "pi-agent");
  copyIfPresent(real, agentDir, [
    "auth.json",
    "models.json",
    "settings.json",
    "trust.json",
  ]);
  return {
    env: { PI_CODING_AGENT_DIR: agentDir },
    finish: async () =>
      writeBackIfChanged(join(agentDir, "auth.json"), join(real, "auth.json")),
  };
}

function isolateCursor(root, env) {
  const real =
    env.CURSOR_CONFIG_DIR ??
    (env.XDG_CONFIG_HOME ? join(env.XDG_CONFIG_HOME, "cursor") : null) ??
    join(homedir(), ".cursor");
  const config = join(root, "cursor-config");
  copyIfPresent(real, config, ["cli-config.json"]);
  const data = join(root, "cursor-data");
  mkdirSync(data, { recursive: true });
  const skillManifest = join(
    homedir(),
    ".cursor",
    "skills-cursor",
    ".sync-manifest.json",
  );
  const manifestBefore = existsSync(skillManifest)
    ? readFileSync(skillManifest)
    : null;
  return {
    env: { CURSOR_CONFIG_DIR: config, CURSOR_DATA_DIR: data },
    finish: async () => {
      if (manifestBefore === null) {
        rmSync(skillManifest, { force: true });
      } else {
        writeFileSync(skillManifest, manifestBefore);
      }
    },
  };
}

async function waitForOpenCodeCatalog(env, cwd) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const models = execFileSync("opencode", ["models"], {
      cwd,
      env,
      encoding: "utf8",
      timeout: 120_000,
    });
    if (/^opencode\//mu.test(models)) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000));
  }
}

async function isolateOpenCode(root, env, directories) {
  const realConfig = join(
    env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
    "opencode",
  );
  const realData = join(
    env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"),
    "opencode",
  );
  const xdg = {
    XDG_CONFIG_HOME: join(root, "opencode-config"),
    XDG_DATA_HOME: join(root, "opencode-data"),
    XDG_STATE_HOME: join(root, "opencode-state"),
    XDG_CACHE_HOME: join(root, "opencode-cache"),
  };
  const config = join(xdg.XDG_CONFIG_HOME, "opencode");
  const data = join(xdg.XDG_DATA_HOME, "opencode");
  copyIfPresent(realConfig, config, ["opencode.json"]);
  copyIfPresent(realData, data, ["auth.json"]);
  const port = await freePort();
  writeFileSync(
    join(config, "service.json"),
    JSON.stringify({ port, password: randomBytes(24).toString("base64url") }),
  );
  try {
    execFileSync("opencode", ["models"], {
      cwd: directories[0],
      env: { ...env, ...xdg },
      stdio: "ignore",
      timeout: 120_000,
    });
    await stopListener(port);
    copyActiveOpenCodeCredentials(
      join(realData, "opencode.db"),
      join(data, "opencode.db"),
    );
    for (const directory of directories) {
      await waitForOpenCodeCatalog({ ...env, ...xdg }, directory);
    }
  } catch (error) {
    await stopListener(port);
    throw error;
  }
  return {
    env: xdg,
    finish: async () => {
      await stopListener(port);
      writeBackIfChanged(join(data, "auth.json"), join(realData, "auth.json"));
    },
  };
}

function claudeRunEntries(claudeDir) {
  const projectsDir = join(claudeDir, "projects");
  if (!existsSync(projectsDir)) return { projects: [], sessionIds: [] };
  const projects = readdirSync(projectsDir).filter((name) =>
    name.includes(RUN_WORKSPACE_MARKER),
  );
  const sessionIds = projects.flatMap((project) =>
    readdirSync(join(projectsDir, project))
      .filter((name) => name.endsWith(".jsonl"))
      .map((name) => name.slice(0, -".jsonl".length)),
  );
  return { projects, sessionIds };
}

function removeClaudeRunState(env, before) {
  const claudeDir = env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
  const { projects, sessionIds } = claudeRunEntries(claudeDir);
  const fresh = projects.filter(
    (project) => !before.projects.includes(project),
  );
  const freshSessions = sessionIds.filter(
    (id) => !before.sessionIds.includes(id),
  );
  for (const project of fresh) {
    rmSync(join(claudeDir, "projects", project), {
      recursive: true,
      force: true,
    });
  }
  for (const dir of ["session-env", "file-history", "todos", "debug"]) {
    const parent = join(claudeDir, dir);
    if (!existsSync(parent)) continue;
    for (const name of readdirSync(parent)) {
      if (freshSessions.some((id) => name.startsWith(id))) {
        rmSync(join(parent, name), { recursive: true, force: true });
      }
    }
  }
  const statePath = env.CLAUDE_CONFIG_DIR
    ? join(env.CLAUDE_CONFIG_DIR, ".claude.json")
    : join(homedir(), ".claude.json");
  if (!existsSync(statePath)) return;
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  const runProjects = Object.keys(state.projects ?? {}).filter(
    (key) =>
      key.includes(RUN_WORKSPACE_MARKER) && !before.stateProjects.includes(key),
  );
  if (runProjects.length === 0) return;
  for (const key of runProjects) delete state.projects[key];
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

function cleanUpClaude(env) {
  const claudeDir = env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
  const statePath = env.CLAUDE_CONFIG_DIR
    ? join(env.CLAUDE_CONFIG_DIR, ".claude.json")
    : join(homedir(), ".claude.json");
  const before = {
    ...claudeRunEntries(claudeDir),
    stateProjects: existsSync(statePath)
      ? Object.keys(JSON.parse(readFileSync(statePath, "utf8")).projects ?? {})
      : [],
  };
  return { env: {}, finish: async () => removeClaudeRunState(env, before) };
}

export async function isolateAgentState(providerId, env, directories) {
  const root = mkdtempSync(join(tmpdir(), "bb-scenario-agent-state-"));
  const isolation =
    providerId === "codex"
      ? isolateCodex(root, env)
      : providerId === "pi"
        ? isolatePi(root, env)
        : providerId === "acp-cursor"
          ? isolateCursor(root, env)
          : providerId === "acp-opencode"
            ? await isolateOpenCode(root, env, directories)
            : providerId === "claude-code"
              ? cleanUpClaude(env)
              : null;
  if (isolation === null) {
    rmSync(root, { recursive: true, force: true });
    throw new Error(`no agent state isolation for provider "${providerId}"`);
  }
  return {
    env: isolation.env,
    finish: async () => {
      try {
        await isolation.finish();
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  };
}
