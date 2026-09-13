import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it.skipIf(process.platform !== "win32")(
  "drains HTTP error output before a Windows CLI exits",
  async () => {
    const server = createServer((_request, response) => {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "fixture rejection" }));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      if (address === null || typeof address === "string")
        throw new Error("Missing test port");
      for (let attempt = 0; attempt < 3; attempt++) {
        const child = spawn(
          process.execPath,
          [
            "--conditions=source",
            "--import",
            "tsx",
            fileURLToPath(new URL("../index.ts", import.meta.url)),
            "project",
            "show",
            "fixture-project",
            "--json",
          ],
          {
            env: {
              ...process.env,
              BB_CLI: "",
              BB_SERVER_URL: `http://127.0.0.1:${address.port}`,
            },
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"],
            timeout: 15_000,
          },
        );
        let stderr = "";
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk) => {
          stderr += chunk;
        });
        child.stdout.resume();
        const [code] = await once(child, "close");
        expect(code, stderr).toBe(1);
        expect(stderr).toContain("fixture rejection");
        expect(stderr).not.toMatch(/Assertion failed|UV_HANDLE_CLOSING/);
      }
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  },
  45_000,
);
