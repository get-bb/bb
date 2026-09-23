import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  detectUnrecognizedSupervisor,
  normalizeMovedServerUrl,
  validateServerHeaders,
} from "./moved-server.js";

const roots: string[] = [];
const NUL = String.fromCharCode(0);

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("normalizeMovedServerUrl", () => {
  it.each([
    ["http://studio.example.test:38886/", "http://studio.example.test:38886"],
    ["https://gate.example.test/handle/", "https://gate.example.test/handle"],
    ["HTTPS://Studio.Example.test", "https://studio.example.test"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeMovedServerUrl(input)).toBe(expected);
  });

  it.each([
    "http://studio.example.test\n:38886",
    `http://studio.example.test/${NUL}`,
    "https://user:pass@studio.example.test",
    "ftp://studio.example.test",
    "not a url",
  ])("rejects %j", (input) => {
    expect(() => normalizeMovedServerUrl(input)).toThrow(
      expect.objectContaining({ code: "server_move_invalid_address" }),
    );
  });
});

describe("validateServerHeaders", () => {
  it("accepts token names and printable values", () => {
    expect(
      validateServerHeaders({ "x-bb-connect-machine": "bbcm_abc 123" }),
    ).toEqual({ "x-bb-connect-machine": "bbcm_abc 123" });
  });

  it.each<Record<string, string>>([
    { "bad header": "value" },
    { "x-bb": "line\nbreak" },
    { "x-bb": "carriage\rreturn" },
  ])("rejects %j", (headers) => {
    expect(() => validateServerHeaders(headers)).toThrow(
      expect.objectContaining({ code: "server_move_invalid_address" }),
    );
  });
});

describe("detectUnrecognizedSupervisor", () => {
  it("detects systemd and launchd jobs but not terminal shells or installer-owned daemons", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "bb-supervisor-test-"));
    roots.push(dataDir);
    const detect = (env: NodeJS.ProcessEnv) =>
      detectUnrecognizedSupervisor({ env, dataDir, parentPid: 4242 });

    await expect(detect({})).resolves.toBeNull();
    await expect(detect({ XPC_SERVICE_NAME: "0" })).resolves.toBeNull();
    await expect(detect({ INVOCATION_ID: "abc" })).resolves.toBe("systemd");
    await expect(
      detect({ XPC_SERVICE_NAME: "com.example.custom" }),
    ).resolves.toBe("launchd");

    await writeFile(join(dataDir, "install-daemon.pid"), "4242\n");
    await expect(detect({ INVOCATION_ID: "abc" })).resolves.toBeNull();
    await writeFile(join(dataDir, "install-daemon.pid"), "4243\n");
    await expect(detect({ INVOCATION_ID: "abc" })).resolves.toBe("systemd");
  });
});
