import {
  getThread,
  getThreadLastReadAtForPrincipal,
  setThreadReadStateForPrincipal,
  threads,
} from "@bb/db";
import { eq } from "drizzle-orm";
import type { Principal } from "@bb/domain";
import { describe, expect, it } from "vitest";
import type { PrincipalPolicy } from "../../src/auth/principal-policy.js";
import { createApp } from "../../src/server.js";
import { readJson } from "../helpers/json.js";
import { seedThreadFixture } from "../helpers/seed.js";
import { createTestAppHarness, startTestServer } from "../helpers/test-app.js";

const principals = {
  alice: {
    id: "user_alice",
    kind: "human",
    displayName: "Alice",
  },
  bob: {
    id: "user_bob",
    kind: "human",
    displayName: "Bob",
  },
} as const satisfies Record<string, Principal>;

function multiPrincipalPolicy(args?: {
  readonly allow?: (principalId: string) => boolean;
}): PrincipalPolicy {
  return {
    async resolve(request) {
      const selected = request.getHeader("x-test-user");
      const principal = selected === "bob" ? principals.bob : principals.alice;
      return {
        principal,
        expiresAtMs: Date.now() + 60_000,
        clientRealtimeScope: "scoped",
        async authorize() {
          if (args?.allow && !args.allow(principal.id)) {
            return { allowed: false, reason: "forbidden" };
          }
          return { allowed: true };
        },
      };
    },
  };
}

describe("public thread principal read state", () => {
  it("projects different lastReadAt for two Principals on get and list", async () => {
    const server = await startTestServer(
      {},
      {
        principalMode: "work-together",
        principalPolicy: multiPrincipalPolicy(),
      },
    );
    try {
      const { thread } = seedThreadFixture(server);
      server.db
        .update(threads)
        .set({ lastReadAt: 9_999, updatedAt: Date.now() })
        .where(eq(threads.id, thread.id))
        .run();

      setThreadReadStateForPrincipal(server.db, server.hub, {
        threadId: thread.id,
        principalId: principals.alice.id,
        lastReadAt: 1_111,
      });
      setThreadReadStateForPrincipal(server.db, server.hub, {
        threadId: thread.id,
        principalId: principals.bob.id,
        lastReadAt: 2_222,
      });

      const aliceGet = await server.app.request(
        `/api/v1/threads/${thread.id}`,
        { headers: { "x-test-user": "alice" } },
      );
      expect(aliceGet.status).toBe(200);
      await expect(readJson(aliceGet)).resolves.toMatchObject({
        id: thread.id,
        lastReadAt: 1_111,
      });

      const bobGet = await server.app.request(`/api/v1/threads/${thread.id}`, {
        headers: { "x-test-user": "bob" },
      });
      expect(bobGet.status).toBe(200);
      await expect(readJson(bobGet)).resolves.toMatchObject({
        id: thread.id,
        lastReadAt: 2_222,
      });

      const aliceList = await server.app.request(
        `/api/v1/threads?projectId=${thread.projectId}`,
        { headers: { "x-test-user": "alice" } },
      );
      expect(aliceList.status).toBe(200);
      const aliceListBody = (await readJson(aliceList)) as Array<{
        id: string;
        lastReadAt: number | null;
      }>;
      expect(
        aliceListBody.find((entry) => entry.id === thread.id)?.lastReadAt,
      ).toBe(1_111);

      const bobList = await server.app.request(
        `/api/v1/threads?projectId=${thread.projectId}`,
        { headers: { "x-test-user": "bob" } },
      );
      expect(bobList.status).toBe(200);
      const bobListBody = (await readJson(bobList)) as Array<{
        id: string;
        lastReadAt: number | null;
      }>;
      expect(
        bobListBody.find((entry) => entry.id === thread.id)?.lastReadAt,
      ).toBe(2_222);

      // Global compatibility remains for local-owner; signed never leak a map.
      expect(getThread(server.db, thread.id)?.lastReadAt).toBe(9_999);
      const aliceBody = await readJson(
        await server.app.request(`/api/v1/threads/${thread.id}`, {
          headers: { "x-test-user": "alice" },
        }),
      );
      expect(aliceBody).not.toHaveProperty("principalReadState");
      expect(aliceBody).not.toHaveProperty("lastReadAtByPrincipal");
    } finally {
      await server.close();
    }
  });

  it("keeps A read/unread mutations isolated from B and the global column", async () => {
    const server = await startTestServer(
      {},
      {
        principalMode: "work-together",
        principalPolicy: multiPrincipalPolicy(),
      },
    );
    try {
      const { thread } = seedThreadFixture(server);
      server.db
        .update(threads)
        .set({ lastReadAt: 5_000, updatedAt: Date.now() })
        .where(eq(threads.id, thread.id))
        .run();
      setThreadReadStateForPrincipal(server.db, server.hub, {
        threadId: thread.id,
        principalId: principals.bob.id,
        lastReadAt: 4_000,
      });

      const readResponse = await server.app.request(
        `/api/v1/threads/${thread.id}/read`,
        {
          method: "POST",
          headers: { "x-test-user": "alice" },
        },
      );
      expect(readResponse.status).toBe(200);
      const readBody = (await readJson(readResponse)) as {
        lastReadAt: number | null;
      };
      expect(readBody.lastReadAt).toBeTypeOf("number");

      expect(getThread(server.db, thread.id)?.lastReadAt).toBe(5_000);
      expect(
        getThreadLastReadAtForPrincipal(server.db, {
          threadId: thread.id,
          principalId: principals.bob.id,
          globalLastReadAt: getThread(server.db, thread.id)!.lastReadAt,
        }),
      ).toBe(4_000);

      const unreadResponse = await server.app.request(
        `/api/v1/threads/${thread.id}/unread`,
        {
          method: "POST",
          headers: { "x-test-user": "alice" },
        },
      );
      expect(unreadResponse.status).toBe(200);
      await expect(readJson(unreadResponse)).resolves.toMatchObject({
        lastReadAt: null,
      });
      expect(getThread(server.db, thread.id)?.lastReadAt).toBe(5_000);
      expect(
        getThreadLastReadAtForPrincipal(server.db, {
          threadId: thread.id,
          principalId: principals.bob.id,
          globalLastReadAt: getThread(server.db, thread.id)!.lastReadAt,
        }),
      ).toBe(4_000);
    } finally {
      await server.close();
    }
  });

  it("denies read and unread mutations for a forbidden Principal", async () => {
    const server = await startTestServer(
      {},
      {
        principalMode: "work-together",
        principalPolicy: multiPrincipalPolicy({
          allow: (principalId) => principalId !== principals.alice.id,
        }),
      },
    );
    try {
      const { thread } = seedThreadFixture(server);
      server.db
        .update(threads)
        .set({ lastReadAt: 7_000, updatedAt: Date.now() })
        .where(eq(threads.id, thread.id))
        .run();

      for (const path of [
        `/api/v1/threads/${thread.id}`,
        `/api/v1/threads/${thread.id}/read`,
        `/api/v1/threads/${thread.id}/unread`,
      ] as const) {
        const method =
          path.endsWith("/read") || path.endsWith("/unread") ? "POST" : "GET";
        const response = await server.app.request(path, {
          method,
          headers: { "x-test-user": "alice" },
        });
        // Public HTTP policy denials are opaque not-found (no resource leakage).
        expect(response.status).toBe(404);
      }

      expect(getThread(server.db, thread.id)?.lastReadAt).toBe(7_000);
      expect(
        getThreadLastReadAtForPrincipal(server.db, {
          threadId: thread.id,
          principalId: principals.alice.id,
          globalLastReadAt: getThread(server.db, thread.id)!.lastReadAt,
        }),
      ).toBeNull();
    } finally {
      await server.close();
    }
  });

  it("preserves stock local-owner read/unread against the global column", async () => {
    await createTestAppHarness().then(async (harness) => {
      try {
        const server = createApp(harness.deps);
        const { thread } = seedThreadFixture(harness);

        const readResponse = await server.app.request(
          `/api/v1/threads/${thread.id}/read`,
          { method: "POST" },
        );
        expect(readResponse.status).toBe(200);
        const readBody = (await readJson(readResponse)) as {
          lastReadAt: number | null;
        };
        expect(readBody.lastReadAt).toBeTypeOf("number");
        expect(getThread(harness.db, thread.id)?.lastReadAt).toBe(
          readBody.lastReadAt,
        );

        const unreadResponse = await server.app.request(
          `/api/v1/threads/${thread.id}/unread`,
          { method: "POST" },
        );
        expect(unreadResponse.status).toBe(200);
        await expect(readJson(unreadResponse)).resolves.toMatchObject({
          lastReadAt: null,
        });
        expect(getThread(harness.db, thread.id)?.lastReadAt).toBeNull();
      } finally {
        await harness.cleanup();
      }
    });
  });
});
