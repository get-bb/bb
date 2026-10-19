import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer, request } from "node:http";
import { join } from "node:path";
import { getRequestListener } from "@hono/node-server";
import { describe, expect, it } from "vitest";
import { createTestAppHarness } from "../../helpers/test-app.js";

describe("plugin HTTP disconnect cleanup", () => {
  it.each(["before", "after"])(
    "aborts the signal and cancels a late response when first accessed %s disconnect",
    async (access) => {
      const harness = await createTestAppHarness();
      const server = createServer(getRequestListener(harness.app.fetch));
      const root = join(harness.config.dataDir, "disconnect-plugin");
      await mkdir(root);
      await writeFile(
        join(root, "package.json"),
        JSON.stringify({
          name: "bb-plugin-disconnect",
          version: "0.1.0",
          bb: {
            name: "Disconnect fixture",
            description: "Exercises HTTP disconnect cleanup.",
            branding: { icon: "Zap" },
            server: "./server.ts",
          },
        }),
      );
      await writeFile(
        join(root, "server.ts"),
        `export default function plugin(bb) {
          const state = { entered: false, returned: false, aborted: null, cancelled: false };
          let finish;
          const pending = new Promise(resolve => { finish = resolve; });
          bb.http.route("GET", "/stream", async context => {
            state.entered = true;
            if (context.req.query("access") === "before") void context.req.raw.signal;
            await pending;
            state.aborted = context.req.raw.signal.aborted;
            state.returned = true;
            return new Response(new ReadableStream({
              start(controller) { controller.enqueue(new TextEncoder().encode("first")); },
              cancel() { state.cancelled = true; },
            }), { headers: { "content-type": "text/event-stream" } });
          });
          bb.http.route("GET", "/state", context => context.json(state));
          bb.http.route("GET", "/finish", context => {
            finish();
            return context.text("released");
          });
        }`,
      );

      const readState = async () => {
        const response = await harness.app.request(
          "http://127.0.0.1/api/v1/plugins/disconnect/http/state",
        );
        return response.json();
      };
      const finish = async () => {
        await harness.app.request(
          "http://127.0.0.1/api/v1/plugins/disconnect/http/finish",
        );
      };

      try {
        const entry = await harness.pluginService.installPath(root);
        expect(entry.status).toBe("running");
        server.listen(0, "127.0.0.1");
        await once(server, "listening");
        const address = server.address();
        if (address === null || typeof address === "string") {
          throw new Error("Expected a listening TCP server");
        }
        harness.config.serverPort = address.port;
        const disconnected = new Promise<void>((resolve) => {
          server.once("request", (_incoming, outgoing) => {
            outgoing.once("close", resolve);
          });
        });
        const client = request(
          `http://127.0.0.1:${address.port}/api/v1/plugins/disconnect/http/stream?access=${access}`,
        );
        client.on("error", () => undefined);
        client.end();
        try {
          await expect.poll(readState).toMatchObject({ entered: true });
          client.destroy();
          await disconnected;
          await finish();
          await expect.poll(readState).toMatchObject({ returned: true });
          expect(await readState()).toMatchObject({ aborted: true });
          await expect
            .poll(readState, { timeout: 1_000 })
            .toMatchObject({ cancelled: true });
        } finally {
          client.destroy();
        }
      } finally {
        await finish();
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await harness.cleanup();
      }
    },
  );
});
