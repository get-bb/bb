import {
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "../../errors.js";
import {
  automationScriptDir,
  deleteAutomationScriptDir,
  resolveAutomationScriptPath,
  resolveDefaultInterpreter,
  writeInlineAutomationScript,
} from "./automation-scripts.js";

let dataDir: string;
const AUTOMATION_ID = "auto_test";

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "bb-automation-scripts-"));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe("writeInlineAutomationScript", () => {
  it("writes inline content under the automation script dir with 0o700", async () => {
    const stored = await writeInlineAutomationScript({
      dataDir,
      automationId: AUTOMATION_ID,
      content: "echo hi",
      scriptFile: "watch.sh",
    });
    expect(stored).toBe("watch.sh");

    const path = join(automationScriptDir(dataDir, AUTOMATION_ID), stored);
    expect(await readFile(path, "utf8")).toBe("echo hi");
    const mode = (await stat(path)).mode & 0o777;
    expect(mode).toBe(0o700);
  });

  it("sanitizes a path-bearing filename to a flat name", async () => {
    const stored = await writeInlineAutomationScript({
      dataDir,
      automationId: AUTOMATION_ID,
      content: "echo hi",
      scriptFile: "../../escape.sh",
    });
    expect(stored).not.toContain("/");
    expect(stored).not.toContain("..");
  });
});

describe("resolveAutomationScriptPath", () => {
  it("resolves a contained script to its absolute path", async () => {
    await writeInlineAutomationScript({
      dataDir,
      automationId: AUTOMATION_ID,
      content: "echo hi",
      scriptFile: "ok.sh",
    });
    const resolved = await resolveAutomationScriptPath({
      dataDir,
      automationId: AUTOMATION_ID,
      scriptFile: "ok.sh",
    });
    // The helper realpaths the result, so compare against the realpath'd target.
    expect(resolved).toBe(
      await realpath(join(automationScriptDir(dataDir, AUTOMATION_ID), "ok.sh")),
    );
  });

  it("rejects path traversal outside the script dir", async () => {
    await expect(
      resolveAutomationScriptPath({
        dataDir,
        automationId: AUTOMATION_ID,
        scriptFile: "../../../etc/passwd",
      }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("rejects a symlink that escapes the script dir", async () => {
    const dir = automationScriptDir(dataDir, AUTOMATION_ID);
    await writeInlineAutomationScript({
      dataDir,
      automationId: AUTOMATION_ID,
      content: "echo hi",
      scriptFile: "real.sh",
    });
    const outside = join(dataDir, "outside-secret.sh");
    await writeFile(outside, "secret");
    await symlink(outside, join(dir, "link.sh"));

    await expect(
      resolveAutomationScriptPath({
        dataDir,
        automationId: AUTOMATION_ID,
        scriptFile: "link.sh",
      }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("rejects a missing script file", async () => {
    await writeInlineAutomationScript({
      dataDir,
      automationId: AUTOMATION_ID,
      content: "echo hi",
      scriptFile: "real.sh",
    });
    await expect(
      resolveAutomationScriptPath({
        dataDir,
        automationId: AUTOMATION_ID,
        scriptFile: "ghost.sh",
      }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});

describe("deleteAutomationScriptDir", () => {
  it("removes the automation script dir", async () => {
    await writeInlineAutomationScript({
      dataDir,
      automationId: AUTOMATION_ID,
      content: "echo hi",
      scriptFile: "real.sh",
    });
    await deleteAutomationScriptDir({ dataDir, automationId: AUTOMATION_ID });
    await expect(
      stat(automationScriptDir(dataDir, AUTOMATION_ID)),
    ).rejects.toThrow();
  });
});

describe("resolveDefaultInterpreter", () => {
  it("maps known extensions and defaults to bash", () => {
    expect(resolveDefaultInterpreter("a.sh")).toBe("bash");
    expect(resolveDefaultInterpreter("a.bash")).toBe("bash");
    expect(resolveDefaultInterpreter("a.js")).toBe("node");
    expect(resolveDefaultInterpreter("a.mjs")).toBe("node");
    expect(resolveDefaultInterpreter("a.py")).toBe("python3");
    expect(resolveDefaultInterpreter("a.unknown")).toBe("bash");
  });
});
