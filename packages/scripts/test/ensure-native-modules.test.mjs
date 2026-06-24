import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import {
  ensureNativeModules,
  verifyNativeModule,
} from "../../../scripts/ensure-native-modules.mjs";

const scriptUrl = new URL(
  "../../../scripts/ensure-native-modules.mjs",
  import.meta.url,
).href;

function createBetterSqliteRequire(initialError) {
  const state = {
    constructorError: initialError,
    constructorCalls: 0,
  };

  function Database() {
    state.constructorCalls += 1;
    if (state.constructorError !== null) {
      throw state.constructorError;
    }
  }

  Database.prototype.close = vi.fn();

  function requireModule(request) {
    if (request !== "better-sqlite3") {
      throw new Error(`Unexpected require: ${request}`);
    }

    return Database;
  }

  requireModule.resolve = (request) => {
    if (request !== "better-sqlite3/package.json") {
      throw new Error(`Unexpected resolve: ${request}`);
    }

    return "/tmp/fake-node-modules/better-sqlite3/package.json";
  };

  return {
    requireModule,
    state,
    clearConstructorError() {
      state.constructorError = null;
    },
  };
}

function createEnsureOptions(fakeRequire, execSync) {
  return {
    repoRoot: "/repo",
    modules: [
      { name: "better-sqlite3", resolveFrom: "packages/db/package.json" },
    ],
    createRequire: () => fakeRequire,
    execSync,
    log: vi.fn(),
  };
}

describe("ensure-native-modules", () => {
  it("does not detect a better-sqlite3 ABI mismatch by requiring the wrapper only", () => {
    const abiError = new Error(
      "The module was compiled against a different NODE_MODULE_VERSION",
    );
    const { requireModule, state } = createBetterSqliteRequire(abiError);

    expect(() => requireModule("better-sqlite3")).not.toThrow();
    expect(state.constructorCalls).toBe(0);
    expect(() => verifyNativeModule("better-sqlite3", requireModule)).toThrow(
      /NODE_MODULE_VERSION/,
    );
    expect(state.constructorCalls).toBe(1);
  });

  it("rechecks better-sqlite3 after a rebuild succeeds", () => {
    const abiError = new Error(
      "The module was compiled against a different NODE_MODULE_VERSION",
    );
    const fake = createBetterSqliteRequire(abiError);
    const execSync = vi.fn(() => {
      fake.clearConstructorError();
    });

    expect(() =>
      ensureNativeModules(createEnsureOptions(fake.requireModule, execSync)),
    ).not.toThrow();

    expect(execSync).toHaveBeenCalledWith("npx --yes node-gyp rebuild", {
      cwd: "/tmp/fake-node-modules/better-sqlite3",
      stdio: "inherit",
    });
    expect(fake.state.constructorCalls).toBe(2);
  });

  it("rebuilds better-sqlite3 when the native binding is missing", () => {
    const missingBindingError = new Error(
      "Could not locate the bindings file. Tried: build/Release/better_sqlite3.node",
    );
    const fake = createBetterSqliteRequire(missingBindingError);
    const execSync = vi.fn(() => {
      fake.clearConstructorError();
    });

    expect(() =>
      ensureNativeModules(createEnsureOptions(fake.requireModule, execSync)),
    ).not.toThrow();

    expect(execSync).toHaveBeenCalledWith("npx --yes node-gyp rebuild", {
      cwd: "/tmp/fake-node-modules/better-sqlite3",
      stdio: "inherit",
    });
    expect(fake.state.constructorCalls).toBe(2);
  });

  it("exits non-zero when the post-rebuild instantiation still fails", () => {
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `
          import { ensureNativeModules } from ${JSON.stringify(scriptUrl)};

          function createRequire() {
            function Database() {
              throw new Error("Wrong native binary NODE_MODULE_VERSION");
            }

            function requireModule(request) {
              if (request !== "better-sqlite3") {
                throw new Error("Unexpected require: " + request);
              }

              return Database;
            }

            requireModule.resolve = () => "/tmp/fake-node-modules/better-sqlite3/package.json";
            return requireModule;
          }

          ensureNativeModules({
            repoRoot: "/repo",
            modules: [{ name: "better-sqlite3", resolveFrom: "packages/db/package.json" }],
            createRequire,
            execSync() {},
            log() {},
          });
        `,
      ],
      { encoding: "utf8" },
    );

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain(
      "better-sqlite3 still failed to load after rebuild",
    );
  });
});
