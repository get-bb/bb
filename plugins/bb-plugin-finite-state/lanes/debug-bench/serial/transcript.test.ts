import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
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
      maxBytes: 180,
    });
    await transcript.append({ at: "2026-08-13T12:00:00.000Z", dir: "rx", text: "boot" });
    await transcript.append({ at: "2026-08-13T12:00:01.000Z", dir: "tx", text: "AT+PING" });
    await transcript.append({ at: "2026-08-13T12:00:02.000Z", dir: "rx", text: "pong" });
    const segments = (await readdir(transcript.directory)).sort();
    expect(segments.length).toBeGreaterThan(1);
    const totalBytes = (await Promise.all(
      segments.map(async (name) => (await stat(join(transcript.directory, name))).size),
    )).reduce((total, bytes) => total + bytes, 0);
    expect(totalBytes).toBeLessThanOrEqual(180);
    const contents = (await Promise.all(
      segments.map((name) => readFile(join(transcript.directory, name), "utf8")),
    )).join("");
    expect(contents).toContain('"dir":"tx"');
    expect(contents).toContain("AT+PING");
    await transcript.close();
  });

  it("rolls oldest segments so one long-lived session stays within its total cap", async () => {
    const root = await mkdtemp(join(tmpdir(), "fs122-transcript-cap-"));
    directories.push(root);
    const transcript = await openSerialTranscript({
      artifactRoot: root,
      deviceId: "serial:board-a",
      sessionId: "session-bounded",
      openedAt: "2026-08-13T12:00:00.000Z",
      maxBytes: 220,
    });
    for (let index = 0; index < 12; index += 1) {
      await transcript.append({
        at: `2026-08-13T12:00:${String(index).padStart(2, "0")}.000Z`,
        dir: "rx",
        text: `line-${index}`,
      });
    }
    const segments = await readdir(transcript.directory);
    const totalBytes = (await Promise.all(
      segments.map(async (name) => (await stat(join(transcript.directory, name))).size),
    )).reduce((total, bytes) => total + bytes, 0);
    expect(totalBytes).toBeLessThanOrEqual(220);
    const contents = (await Promise.all(
      segments.map((name) => readFile(join(transcript.directory, name), "utf8")),
    )).join("");
    expect(contents).toContain("line-11");
    expect(contents).not.toContain("line-0\"");
    await transcript.close();
  });

  it("evicts the only closed segment before writing its replacement", async () => {
    const root = await mkdtemp(join(tmpdir(), "fs122-transcript-boundary-"));
    directories.push(root);
    const transcript = await openSerialTranscript({
      artifactRoot: root,
      deviceId: "serial:board-a",
      sessionId: "session-boundary",
      openedAt: "2026-08-13T12:00:00.000Z",
      maxBytes: 120,
    });

    await transcript.append({
      at: "2026-08-13T12:00:00.000Z",
      dir: "rx",
      text: "a".repeat(35),
    });
    await transcript.append({
      at: "2026-08-13T12:00:01.000Z",
      dir: "rx",
      text: "b".repeat(35),
    });
    await transcript.close();

    const files = await readdir(transcript.directory);
    const totalBytes = (await Promise.all(
      files.map(async (name) => (await stat(join(transcript.directory, name))).size),
    )).reduce((total, bytes) => total + bytes, 0);
    expect(totalBytes).toBeLessThanOrEqual(120);
    const contents = (await Promise.all(
      files.map((name) => readFile(join(transcript.directory, name), "utf8")),
    )).join("");
    expect(contents).not.toContain("a".repeat(35));
    expect(contents).toContain("b".repeat(35));
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
