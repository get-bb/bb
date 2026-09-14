import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { z } from "zod";
import { runBbApp } from "../src/launcher.js";

async function captureStdout(run: () => Promise<void>): Promise<string> {
  const chunks: string[] = [];
  const write = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk) => {
      chunks.push(typeof chunk === "string" ? chunk : chunk.toString());
      return true;
    });
  try {
    await run();
  } finally {
    write.mockRestore();
  }
  return chunks.join("");
}

it("previews occupied ports without creating data or starting services", async () => {
  const root = mkdtempSync(join(tmpdir(), "bb-start-dryrun-"));
  const dataDir = join(root, "not-created");
  const listener = createServer();
  await new Promise<void>((resolve) =>
    listener.listen(0, "127.0.0.1", resolve),
  );
  try {
    const address = listener.address();
    if (address === null || typeof address === "string")
      throw new Error("Missing test port");
    const args = [
      "--data-dir",
      dataDir,
      "--server-port",
      String(address.port),
      "--host-daemon-port",
      String(address.port),
      "--server-bind-host",
      "127.0.0.1",
    ];
    const output = await captureStdout(() =>
      runBbApp(args, {
        dryRun: true,
        worktreePolicy: null,
        beforeServerStart() {
          throw new Error("Started services");
        },
      }),
    );
    const preview = z
      .object({
        dryRun: z.literal(true),
        dataDir: z.string(),
        serverPort: z.number(),
        daemonPort: z.number(),
        serverBindHost: z.string(),
      })
      .parse(JSON.parse(output));
    expect(preview).toEqual({
      dryRun: true,
      dataDir,
      serverPort: address.port,
      daemonPort: address.port,
      serverBindHost: "127.0.0.1",
    });
    expect(existsSync(dataDir)).toBe(false);
  } finally {
    await new Promise<void>((resolve, reject) =>
      listener.close((error) => (error ? reject(error) : resolve())),
    );
    rmSync(root, { recursive: true, force: true });
  }
});
