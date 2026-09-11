import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { z } from "zod";

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
    ];
    const moduleUrl = pathToFileURL(
      join(import.meta.dirname, "../src/launcher.ts"),
    ).href;
    const output = execFileSync(
      process.execPath,
      [
        "--conditions=source",
        "--import",
        "tsx",
        "--input-type=module",
        "--eval",
        `import { runBbApp } from ${JSON.stringify(moduleUrl)}; await runBbApp(${JSON.stringify(args)}, {dryRun: true, worktreePolicy: null, beforeServerStart() { throw new Error("Started services"); }});`,
      ],
      {
        encoding: "utf8",
        env: { ...process.env, BB_SERVER_BIND_HOST: "127.0.0.1" },
      },
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
