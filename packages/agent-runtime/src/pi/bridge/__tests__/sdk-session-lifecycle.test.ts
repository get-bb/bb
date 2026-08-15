import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PiSdkSession } from "../sdk-session.js";

const testRoots: string[] = [];

async function writeTestSessionFile(
  filePath: string,
  cwd: string,
  id: string,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const userEntryId = `${id}-user`;
  await writeFile(
    filePath,
    `${[
      JSON.stringify({
        type: "session",
        version: 3,
        id,
        timestamp: "2026-08-12T00:00:00.000Z",
        cwd,
      }),
      JSON.stringify({
        type: "message",
        id: userEntryId,
        parentId: null,
        timestamp: "2026-08-12T00:00:01.000Z",
        message: { role: "user", content: "fork point" },
      }),
      JSON.stringify({
        type: "message",
        id: `${id}-assistant`,
        parentId: userEntryId,
        timestamp: "2026-08-12T00:00:02.000Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "ready" }],
        },
      }),
    ].join("\n")}\n`,
  );
}

async function createLifecycleFixture(): Promise<{
  cwd: string;
  markerPath: string;
  sessionFilePath: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "bb-pi-lifecycle-test-"));
  testRoots.push(root);
  const agentDir = join(root, "agent");
  const cwd = join(root, "workspace");
  const markerPath = join(root, "lifecycle-events.txt");

  await mkdir(join(cwd, ".pi", "extensions"), { recursive: true });
  await mkdir(agentDir, { recursive: true });
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify({ defaultProjectTrust: "always" }),
  );
  await writeFile(
    join(cwd, ".pi", "settings.json"),
    JSON.stringify({ extensions: ["./extensions/lifecycle.ts"] }),
  );
  await writeFile(
    join(cwd, ".pi", "extensions", "lifecycle.ts"),
    `import { appendFileSync } from "node:fs";
export default function extension(pi): void {
  pi.on("session_start", (event) => {
    appendFileSync(${JSON.stringify(markerPath)}, event.type + ":" + event.reason + "\\n", "utf8");
  });
  pi.on("session_shutdown", (event) => {
    appendFileSync(${JSON.stringify(markerPath)}, event.type + ":" + event.reason + "\\n", "utf8");
  });
}
`,
  );
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);

  const sessionFilePath = join(root, "initial.jsonl");
  await writeTestSessionFile(sessionFilePath, cwd, "initial");

  return { cwd, markerPath, sessionFilePath };
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    testRoots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("PiSdkSession extension lifecycle", () => {
  it("starts configured extensions for new and resumed bb threads", async () => {
    const { cwd, markerPath, sessionFilePath } = await createLifecycleFixture();
    const newThread = new PiSdkSession({ cwd }, vi.fn(), vi.fn());

    await newThread.start();
    await newThread.closeGracefully(1_000);

    const resumedThread = new PiSdkSession(
      { cwd, sessionFilePath },
      vi.fn(),
      vi.fn(),
    );
    await resumedThread.start();
    await resumedThread.closeGracefully(1_000);

    await expect(readFile(markerPath, "utf8")).resolves.toBe(
      "session_start:startup\n" +
        "session_shutdown:quit\n" +
        "session_start:startup\n" +
        "session_shutdown:quit\n",
    );
  });
});
