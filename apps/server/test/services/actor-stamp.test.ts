import { eq } from "drizzle-orm";
import { events, getQueuedThreadMessage } from "@bb/db";
import type { Principal } from "@bb/domain";
import { describe, expect, it } from "vitest";
import type { PrincipalPolicy } from "../../src/auth/principal-policy.js";
import {
  actorStampFromPrincipal,
  exactThreadAgentActorStamp,
} from "../../src/services/actor-stamp.js";
import { readJson } from "../helpers/json.js";
import { seedThreadFixture } from "../helpers/seed.js";
import { startTestServer } from "../helpers/test-app.js";

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

function testPrincipalPolicy(): PrincipalPolicy {
  return {
    async resolve(request) {
      const selected = request.getHeader("x-test-user");
      const principal = selected === "bob" ? principals.bob : principals.alice;
      return {
        principal,
        expiresAtMs: Date.now() + 60_000,
        clientRealtimeScope: "scoped",
        async authorize() {
          return { allowed: true };
        },
      };
    },
  };
}

function queuedMessageBody(text: string): string {
  return JSON.stringify({
    input: [{ type: "text", text }],
    model: "gpt-5",
    permissionMode: "full",
    reasoningLevel: "medium",
    serviceTier: "default",
  });
}

describe("actor stamps", () => {
  it("snapshots verified Principals and derives exact thread agents", () => {
    expect(actorStampFromPrincipal(principals.alice)).toEqual({
      principalId: "user_alice",
      principalKind: "human",
      displayName: "Alice",
    });
    expect(exactThreadAgentActorStamp("thr_123")).toEqual({
      principalId: "agent:thread/thr_123",
      principalKind: "agent",
      displayName: "Thread agent",
    });
  });

  it("retains each admitted human through queued dispatch and ignores actor overrides", async () => {
    const server = await startTestServer(
      {},
      {
        principalMode: "work-together",
        principalPolicy: testPrincipalPolicy(),
      },
    );
    try {
      const { thread } = seedThreadFixture(server);
      const firstResponse = await server.app.request(
        `/api/v1/threads/${thread.id}/queued-messages?actor=attacker`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-bb-principal": "attacker",
            "x-test-user": "alice",
          },
          body: JSON.stringify({
            ...JSON.parse(queuedMessageBody("from Alice")),
            actor: {
              principalId: "user_attacker",
              principalKind: "human",
              displayName: "Attacker",
            },
          }),
        },
      );
      expect(firstResponse.status).toBe(201);
      const first = (await readJson(firstResponse)) as { id: string };
      expect(getQueuedThreadMessage(server.db, first.id)).toMatchObject({
        actorPrincipalId: "user_alice",
        actorKind: "human",
        actorDisplayName: "Alice",
      });

      const secondResponse = await server.app.request(
        `/api/v1/threads/${thread.id}/queued-messages`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-test-user": "bob",
          },
          body: queuedMessageBody("from Bob"),
        },
      );
      expect(secondResponse.status).toBe(201);
      const second = (await readJson(secondResponse)) as { id: string };
      expect(getQueuedThreadMessage(server.db, second.id)).toMatchObject({
        actorPrincipalId: "user_bob",
        actorKind: "human",
        actorDisplayName: "Bob",
      });

      const dispatchResponse = await server.app.request(
        `/api/v1/threads/${thread.id}/queued-messages/${first.id}/send`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-test-user": "bob",
          },
          body: JSON.stringify({ mode: "auto" }),
        },
      );
      expect(dispatchResponse.status).toBe(200);

      const stored = server.db
        .select({
          actorPrincipalId: events.actorPrincipalId,
          actorKind: events.actorKind,
          actorDisplayName: events.actorDisplayName,
        })
        .from(events)
        .where(eq(events.threadId, thread.id))
        .get();
      expect(stored).toEqual({
        actorPrincipalId: "user_alice",
        actorKind: "human",
        actorDisplayName: "Alice",
      });

      const timelineResponse = await server.app.request(
        `/api/v1/threads/${thread.id}/timeline`,
        { headers: { "x-test-user": "bob" } },
      );
      expect(timelineResponse.status).toBe(200);
      const timeline = (await readJson(timelineResponse)) as {
        rows: Array<{ actor?: unknown; role?: string }>;
      };
      expect(timeline.rows.find((row) => row.role === "user")?.actor).toEqual({
        principalId: "user_alice",
        principalKind: "human",
        displayName: "Alice",
      });
    } finally {
      await server.close();
    }
  });
});
