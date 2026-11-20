import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const TEMP_DIR_ENV_KEYS = ["TMPDIR", "TEMP", "TMP"] as const;

type TempDirEnvKey = (typeof TEMP_DIR_ENV_KEYS)[number];

/**
 * Options for {@link experimental_sandboxTempDir}.
 *
 * @experimental
 */
export interface ExperimentalSandboxTempDirOptions {
  /**
   * Runs with the sandbox path after the last setup tears down and the
   * temp dir variables are restored, before the sandbox is deleted. Use it
   * to stop processes that still hold files inside the sandbox.
   */
  beforeRemove?: (sandboxPath: string) => unknown;
}

interface TempDirSandbox {
  root: string;
  previous: Record<TempDirEnvKey, string | undefined>;
  references: number;
  beforeRemove: Set<(sandboxPath: string) => unknown>;
}

const SANDBOX_KEY = Symbol.for("bb.plugin-sdk.vitest-temp-dir-sandbox");

type SandboxHolder = { [SANDBOX_KEY]?: TempDirSandbox };

/**
 * Points `TMPDIR`, `TEMP` and `TMP` at a fresh `bb-vt-*` directory under
 * `os.tmpdir()` and returns a teardown that restores them and deletes that
 * directory with everything in it.
 *
 * The module's default export calls it with no options, so it works as a
 * Vitest `globalSetup`:
 * `test.globalSetup: ["@get-bb/plugin-sdk/testing/vitest-global-setup"]`.
 * Vitest stops its workers with SIGTERM, so a worker never runs its `exit`
 * handlers. Files a test leaves in `os.tmpdir()`, including fake plugin host
 * storage from `createFakePluginHost`, still go away with the sandbox,
 * because teardown runs in Vitest's main process.
 *
 * Nested setups in one process share a single sandbox, which is removed when
 * the last of them tears down. That teardown runs every `beforeRemove`
 * callback and attempts the removal even when a callback throws, then
 * rethrows: the error itself when there is one, an `AggregateError` when
 * there are several. Calling a teardown twice has no effect.
 *
 * @experimental
 */
export function experimental_sandboxTempDir(
  options: ExperimentalSandboxTempDirOptions = {},
): () => Promise<void> {
  const holder = globalThis as SandboxHolder;
  let sandbox = holder[SANDBOX_KEY];
  if (sandbox === undefined) {
    const root = mkdtempSync(join(resolve(tmpdir()), "bb-vt-"));
    sandbox = {
      root,
      previous: {
        TMPDIR: process.env.TMPDIR,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
      },
      references: 0,
      beforeRemove: new Set(),
    };
    holder[SANDBOX_KEY] = sandbox;
    for (const key of TEMP_DIR_ENV_KEYS) process.env[key] = root;
  }
  if (options.beforeRemove !== undefined) {
    sandbox.beforeRemove.add(options.beforeRemove);
  }
  sandbox.references += 1;
  const owned = sandbox;
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    owned.references -= 1;
    if (owned.references > 0) return;
    if (holder[SANDBOX_KEY] === owned) delete holder[SANDBOX_KEY];
    for (const key of TEMP_DIR_ENV_KEYS) {
      const previous = owned.previous[key];
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
    const errors: unknown[] = [];
    for (const beforeRemove of owned.beforeRemove) {
      try {
        await beforeRemove(owned.root);
      } catch (error) {
        errors.push(error);
      }
    }
    try {
      rmSync(owned.root, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      });
    } catch (error) {
      errors.push(error);
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(
        errors,
        `temp dir sandbox teardown failed for ${owned.root}`,
      );
    }
  };
}

export default function setup(): () => Promise<void> {
  return experimental_sandboxTempDir();
}
