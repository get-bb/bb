import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createLogFileFollower,
  type LogFileFollower,
} from "../src/log-file-follower.js";

const directories: string[] = [];
const followers: LogFileFollower[] = [];

async function logFile(content: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "bb-log-follower-"));
  directories.push(directory);
  const filePath = join(directory, "server.1.log");
  await writeFile(filePath, content);
  return filePath;
}

function follow(filePath: string, initialLines: number): { text(): string } {
  let text = "";
  followers.push(
    createLogFileFollower({
      filePath,
      initialLines,
      onChunk: (chunk) => {
        text += chunk;
      },
      onError: (error) => {
        text += `ERROR ${error.message}`;
      },
      pollIntervalMs: 10,
    }),
  );
  return { text: () => text };
}

afterEach(async () => {
  for (const follower of followers.splice(0)) follower.stop();
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("createLogFileFollower", () => {
  it("emits the last lines of the file and then what is appended", async () => {
    const filePath = await logFile("one\ntwo\nthree\n");
    const output = follow(filePath, 2);

    await expect.poll(output.text).toBe("two\nthree\n");
    await appendFile(filePath, "four\nfi");
    await expect.poll(output.text).toBe("two\nthree\nfour\nfi");
    await appendFile(filePath, "ve ✓\n");
    await expect.poll(output.text).toBe("two\nthree\nfour\nfive ✓\n");
  });

  it("starts again from the top when the file is truncated", async () => {
    const filePath = await logFile("before truncation\n");
    const output = follow(filePath, 10);

    await expect.poll(output.text).toBe("before truncation\n");
    await writeFile(filePath, "after\n");
    await expect.poll(output.text).toBe("before truncation\nafter\n");
  });

  it("stops reading once stopped", async () => {
    const filePath = await logFile("kept\n");
    const output = follow(filePath, 10);

    await expect.poll(output.text).toBe("kept\n");
    followers[0]?.stop();
    await appendFile(filePath, "ignored\n");
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(output.text()).toBe("kept\n");
  });
});
