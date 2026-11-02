import { afterEach, describe, expect, it } from "vitest";
import {
  bindHostProcessOwner,
  hostProcessOwner,
  processesOwnedBy,
  type ProcessOwner,
} from "../src/index.js";
import type { TrackedProcess } from "../src/tracked-process.js";

const posixOnly = process.platform === "win32" ? describe.skip : describe;

function recordingOwner(): ProcessOwner & { tracked: TrackedProcess[] } {
  const tracked: TrackedProcess[] = [];
  return { tracked, trackProcess: (process) => tracked.push(process) };
}

afterEach(() => {
  bindHostProcessOwner(null);
});

posixOnly("processesOwnedBy", () => {
  it("records every child with the owner it was started for", async () => {
    const host = recordingOwner();
    const explicit = recordingOwner();
    bindHostProcessOwner(host.trackProcess);
    const fromHost = processesOwnedBy(hostProcessOwner);
    const fromExplicit = processesOwnedBy(explicit);

    await fromHost.execHostFile("true");
    const detached = fromExplicit.spawnPortableProcess({
      command: "true",
      args: [],
      detached: true,
      stdio: "ignore",
    });
    await fromExplicit.execPortableFile("true", [], {
      cwd: process.cwd(),
      env: process.env,
      maxBuffer: 1024,
    });

    expect(host.tracked.map((process) => process.label)).toEqual(["true"]);
    expect(explicit.tracked).toEqual([
      expect.objectContaining({ pid: detached.pid, processGroup: true }),
      expect.objectContaining({ label: "true", processGroup: true }),
    ]);
    await Promise.all(explicit.tracked.map((process) => process.exited));
  });

  it("starts children without a bound host owner", async () => {
    await expect(
      processesOwnedBy(hostProcessOwner).execHostFile("true"),
    ).resolves.toEqual({ stdout: "", stderr: "" });
  });

  it("binds the host owner under a key separately bundled copies share", () => {
    const host = recordingOwner();
    bindHostProcessOwner(host.trackProcess);

    expect(
      Reflect.get(globalThis, Symbol.for("bb.process-utils.host-process-owner")),
    ).toBe(host.trackProcess);
  });
});
