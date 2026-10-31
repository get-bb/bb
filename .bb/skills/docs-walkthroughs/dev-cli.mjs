import { execFileSync } from "node:child_process";
import { hostname, userInfo } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

export const DEV_SERVER_URL =
  process.env.WALKTHROUGH_SERVER_URL ??
  `http://127.0.0.1:${process.env.WALKTHROUGH_PORT ?? "47186"}`;

const THREAD_CONTEXT = [
  "BB_THREAD_ID",
  "BB_ENVIRONMENT_ID",
  "BB_THREAD_STORAGE",
  "BB_PROJECT_ID",
  "BB_CLI",
  "BB_CLI_REEXEC",
];

export function devEnv() {
  const env = { ...process.env };
  for (const name of THREAD_CONTEXT) delete env[name];
  const port = Number(new URL(DEV_SERVER_URL).port);
  return {
    ...env,
    BB_SERVER_URL: DEV_SERVER_URL,
    BB_HOST_DAEMON_PORT: String(port + 1),
    NODE_ENV: "production",
  };
}

export function bb(args, { json = true, cwd = repo } = {}) {
  const output = execFileSync(
    process.execPath,
    [
      path.join(repo, "apps/cli/dist/index.js"),
      ...args,
      ...(json ? ["--json"] : []),
    ],
    { cwd, env: devEnv(), encoding: "utf8" },
  );
  return json ? JSON.parse(output) : output;
}

export const WALKTHROUGH_DIR = path.join(repo, ".tmp/docs-walkthrough");

export function privacyReplacements(extra = []) {
  const { username, homedir } = userInfo();
  const pairs = [
    ...extra,
    [WALKTHROUGH_DIR, "/Users/alex/code"],
    [{ re: "~/\\S*docs-walkthrough" }, "~/code"],
    [repo, "/Users/alex/code/bb"],
    [homedir, "/Users/alex"],
    [hostname(), "Studio"],
    [username, "alex"],
    [{ re: "\\bthr_[a-z0-9]{6,}" }, "thr_8k2m4x9q1c"],
    [{ re: "\\b(env|proj|host)_[a-z0-9]{6,}" }, "$1_4n7v2c8d5e"],
    [
      { re: "[\\w.+-]+@[\\w-]+(\\.[\\w-]+)*\\.[a-z]{2,}\\b" },
      "alex@example.com",
    ],
  ];
  return pairs.filter(([from]) => typeof from !== "string" || from.length > 2);
}

export function menuItem(text) {
  return {
    text,
    within: "[role=menu],[role=listbox],[data-radix-popper-content-wrapper]",
    closest: "[role=menuitem],[role=option],[role=menuitemradio],button",
  };
}

export async function until(
  check,
  { timeout = 600_000, every = 2000, what = "condition" } = {},
) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, every));
  }
  throw new Error(`Timed out waiting for ${what}`);
}
