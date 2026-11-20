import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { killProcessesReferencingPath } from "./packages/test-helpers/src/process-sweep.js";

const ACTIVE = Symbol.for("@bb/vitest-tmpdir-sandbox");
const TEMP_DIR_ENV_KEYS = ["TMPDIR", "TEMP", "TMP"] as const;

type TempDirEnv = Record<
  (typeof TEMP_DIR_ENV_KEYS)[number],
  string | undefined
>;

interface Sandbox {
  root: string;
  previous: TempDirEnv;
  references: number;
}

type SandboxHolder = { [ACTIVE]?: Sandbox };

export default function setup(): () => Promise<void> {
  const holder = globalThis as SandboxHolder;
  let sandbox = holder[ACTIVE];
  if (sandbox === undefined) {
    const previous: TempDirEnv = {
      TMPDIR: process.env.TMPDIR,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
    };
    sandbox = {
      root: mkdtempSync(join(tmpdir(), "bb-vt-")),
      previous,
      references: 0,
    };
    holder[ACTIVE] = sandbox;
    for (const key of TEMP_DIR_ENV_KEYS) process.env[key] = sandbox.root;
  }
  sandbox.references += 1;
  return async () => {
    const active = holder[ACTIVE];
    if (active === undefined) return;
    active.references -= 1;
    if (active.references > 0) return;
    delete holder[ACTIVE];
    for (const key of TEMP_DIR_ENV_KEYS) {
      const previous = active.previous[key];
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
    await killProcessesReferencingPath(active.root);
    rmSync(active.root, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  };
}
