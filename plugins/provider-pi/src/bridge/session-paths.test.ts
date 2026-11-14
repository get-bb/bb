import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PI_BRIDGE_SESSION_DIR_ENV,
  resolvePiSessionFilePath,
} from "./session-paths.js";

describe("resolvePiSessionFilePath", () => {
  let root: string;
  let home: string;
  let bridgeDataDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "bb-pi-session-paths-"));
    home = join(root, "home");
    bridgeDataDir = join(root, "data", "plugins", "provider-pi", "bridge-data");
    vi.stubEnv("HOME", home);
    vi.stubEnv("USERPROFILE", home);
    vi.stubEnv(PI_BRIDGE_SESSION_DIR_ENV, "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  function writeLegacySession(threadId: string, content: string): void {
    const legacyDir = join(home, ".bb", "pi-bridge-sessions");
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(join(legacyDir, `${threadId}.jsonl`), content);
  }

  it("keeps sessions in the bridge data directory, not the home directory", () => {
    expect(
      resolvePiSessionFilePath({
        env: process.env,
        bridgeDataDir,
        threadId: "pi_new",
      }),
    ).toBe(join(bridgeDataDir, "sessions", "pi_new.jsonl"));
  });

  it("carries a thread's session file over from the old home-directory location", () => {
    writeLegacySession("pi_existing", "legacy\n");

    const sessionFile = resolvePiSessionFilePath({
      env: process.env,
      bridgeDataDir,
      threadId: "pi_existing",
    });

    expect(readFileSync(sessionFile, "utf8")).toBe("legacy\n");
    expect(
      readFileSync(
        join(home, ".bb", "pi-bridge-sessions", "pi_existing.jsonl"),
        "utf8",
      ),
    ).toBe("legacy\n");
  });

  it("never replaces a session file the bridge data directory already has", () => {
    writeLegacySession("pi_existing", "legacy\n");
    mkdirSync(join(bridgeDataDir, "sessions"), { recursive: true });
    writeFileSync(
      join(bridgeDataDir, "sessions", "pi_existing.jsonl"),
      "current\n",
    );

    const sessionFile = resolvePiSessionFilePath({
      env: process.env,
      bridgeDataDir,
      threadId: "pi_existing",
    });

    expect(readFileSync(sessionFile, "utf8")).toBe("current\n");
  });
});
