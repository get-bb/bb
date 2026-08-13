import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openSerialTranscript } from "./transcript.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("serial transcripts", () => {
  it("rotates at the byte cap, marks outbound lines, and survives without a clean close", async () => {
    const root = await mkdtemp(join(tmpdir(), "fs122-transcript-"));
    directories.push(root);
    const transcript = await openSerialTranscript({
      artifactRoot: root,
      deviceId: "serial:board-a",
      sessionId: "session-a",
      openedAt: "2026-08-13T12:00:00.000Z",
      maxBytes: 90,
    });
    await transcript.append({ at: "2026-08-13T12:00:00.000Z", dir: "rx", text: "boot" });
    await transcript.append({ at: "2026-08-13T12:00:01.000Z", dir: "tx", text: "AT+PING" });
    await transcript.append({ at: "2026-08-13T12:00:02.000Z", dir: "rx", text: "pong" });
    const segments = (await readdir(transcript.directory)).sort();
    expect(segments.length).toBeGreaterThan(1);
    const contents = (await Promise.all(
      segments.map((name) => readFile(join(transcript.directory, name), "utf8")),
    )).join("");
    expect(contents).toContain('"dir":"tx"');
    expect(contents).toContain("AT+PING");
    await transcript.close();
  });

  it("retains only the newest configured sessions per device", async () => {
    const root = await mkdtemp(join(tmpdir(), "fs122-retention-"));
    directories.push(root);
    for (let index = 0; index < 3; index += 1) {
      const transcript = await openSerialTranscript({
        artifactRoot: root,
        deviceId: "serial:board-a",
        sessionId: `session-${index}`,
        openedAt: `2026-08-13T12:00:0${index}.000Z`,
        maxSessions: 2,
      });
      await transcript.close();
    }
    const deviceRoot = join(root, "transcripts", (await readdir(join(root, "transcripts")))[0]!);
    const sessions = await readdir(deviceRoot);
    expect(sessions).toHaveLength(2);
    expect(sessions.join(" ")).not.toContain("session-0");
  });
});
