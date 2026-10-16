import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createRequestAuthorityRegistry } from "../src/services/plugins/request-authority.js";
import type { ReaderRequestContext } from "@bb/tunnel-contract";
import type {
  ExperimentalRequestAuthority,
  ExperimentalRequestInvocation,
} from "@get-bb/plugin-sdk";

function fixture() {
  let time = 1000;
  const registry = createRequestAuthorityRegistry(
    {
      issuer: "https://gate.test",
      serverId: "server-a",
      freshnessMs: 100,
      maxClockSkewMs: 5,
      budgetMs: 50,
    },
    { wall: () => time, monotonic: () => time },
  );
  const body = new TextEncoder().encode('"query"');
  const claim: ReaderRequestContext = {
    schema: "bb-reader-context-v1",
    issuer: "https://gate.test",
    subject: "person-a",
    sessionId: "opaque-a",
    generation: 1,
    serverId: "server-a",
    pluginId: "tower",
    rpcMethod: "page",
    nonce: "nonce-a",
    checkedAt: 990,
    issuedAt: 995,
    expiresAt: 2000,
    method: "POST",
    path: "/api/v1/plugins/tower/rpc/page",
    bodySha256: createHash("sha256").update(body).digest("hex"),
    bodyBytes: body.byteLength,
  };
  return {
    registry,
    body,
    claim,
    advance: (value: number) => {
      time = value;
    },
  };
}

describe("private request authority", () => {
  it("requires explicit operational policy", () => {
    const { claim, body } = fixture();
    expect(
      createRequestAuthorityRegistry()
        .openConnection("server-a")
        .admit(claim, body, new AbortController().signal),
    ).toBeNull();
  });
  it("owns different capability and invocation references, bound to the consuming plugin", () => {
    const { registry, claim, body } = fixture();
    const invocation = registry
      .openConnection("server-a")
      .admit(claim, body, new AbortController().signal);
    expect(invocation).not.toBeNull();
    const verified = registry.inspect("tower", invocation!);
    expect(verified?.subject).toBe("person-a");
    expect(verified?.deadlineMs).toBe(1050);
    expect(registry.inspect("other", invocation!)).toBeNull();
    expect(
      registry.inspect("tower", {
        experimental_requestAuthority: {} as ExperimentalRequestAuthority,
        experimental_invocation: {} as ExperimentalRequestInvocation,
      }),
    ).toBeNull();
    invocation!.finish();
    expect(verified?.isCurrent()).toBe(false);
    expect(registry.inspect("tower", invocation!)).toBeNull();
  });
  it("requires the currently executing invocation even when a whole live pair is copied", async () => {
    const { registry, claim, body } = fixture();
    const connection = registry.openConnection("server-a");
    const first = connection.admit(claim, body, new AbortController().signal)!;
    const second = connection.admit(
      { ...claim, nonce: "scope-second" },
      body,
      new AbortController().signal,
    )!;
    expect(registry.inspectForPlugin("tower", first)).toBeNull();
    registry.run(first, () => {
      const original = registry.inspectForPlugin("tower", first)!;
      expect(original.isCurrent()).toBe(true);
      registry.run(second, () => expect(original.isCurrent()).toBe(false));
      registry.run(undefined, () => expect(original.isCurrent()).toBe(false));
      expect(original.isCurrent()).toBe(true);
    });
    await Promise.all([
      registry.run(first, async () => {
        await Promise.resolve();
        expect(registry.inspectForPlugin("tower", first)?.subject).toBe(
          "person-a",
        );
        expect(registry.inspectForPlugin("tower", second)).toBeNull();
      }),
      registry.run(second, async () => {
        await Promise.resolve();
        expect(registry.inspectForPlugin("tower", second)?.subject).toBe(
          "person-a",
        );
        expect(registry.inspectForPlugin("tower", first)).toBeNull();
      }),
    ]);
    registry.run(undefined, () =>
      expect(registry.inspectForPlugin("tower", first)).toBeNull(),
    );
  });
  it("rejects crossed invocation references and replay", () => {
    const { registry, claim, body } = fixture();
    const connection = registry.openConnection("server-a");
    const first = connection.admit(claim, body, new AbortController().signal)!;
    const second = connection.admit(
      { ...claim, nonce: "nonce-b" },
      body,
      new AbortController().signal,
    )!;
    expect(
      registry.inspect("tower", {
        experimental_requestAuthority: first.experimental_requestAuthority,
        experimental_invocation: second.experimental_invocation,
      }),
    ).toBeNull();
    expect(
      connection.admit(claim, body, new AbortController().signal),
    ).toBeNull();
    expect(registry.inspect("tower", second)?.isCurrent()).toBe(true);
  });
  it.each([
    { issuer: "https://other.test" },
    { serverId: "other" },
    { method: "GET" },
    { path: "/api/v1/plugins/other/rpc/page" },
    { rpcMethod: "detail" },
    { bodyBytes: 0 },
    { bodySha256: "0".repeat(64) },
    { checkedAt: 899 },
    { checkedAt: 1010 },
    { expiresAt: 1005 },
    { issuedAt: 1010 },
  ])(
    "rejects a mismatched or stale snapshot before issuing references",
    (change) => {
      const { registry, claim, body } = fixture();
      expect(
        registry
          .openConnection("server-a")
          .admit({ ...claim, ...change }, body, new AbortController().signal),
      ).toBeNull();
    },
  );
  it("reads final cancellation, deadline and connection validity without renewing", () => {
    const { registry, claim, body, advance } = fixture();
    const connection = registry.openConnection("server-a");
    const cancel = new AbortController();
    const first = connection.admit(claim, body, cancel.signal)!;
    const identity = registry.inspect("tower", first)!;
    advance(1049);
    expect(identity.isCurrent()).toBe(true);
    advance(1050);
    expect(identity.isCurrent()).toBe(false);
    advance(1000);
    expect(identity.isCurrent()).toBe(false);
    const other = fixture();
    const c = other.registry.openConnection("server-a");
    const call = c.admit(other.claim, other.body, cancel.signal)!;
    const observed = other.registry.inspect("tower", call)!;
    cancel.abort();
    expect(observed.isCurrent()).toBe(false);
    c.close();
    expect(
      c.admit(
        { ...other.claim, nonce: "new" },
        other.body,
        new AbortController().signal,
      ),
    ).toBeNull();
  });
  it.each(["freshness", "expiry"])(
    "denies observed source wall %s before the monotonic budget",
    (kind) => {
      const source = fixture();
      let wall = 1000;
      const registry = createRequestAuthorityRegistry(
        {
          issuer: "https://gate.test",
          serverId: "server-a",
          freshnessMs: 100,
          maxClockSkewMs: 5,
          budgetMs: 50,
        },
        { wall: () => wall, monotonic: () => 1000 },
      );
      const claim =
        kind === "expiry" ? { ...source.claim, expiresAt: 1030 } : source.claim;
      const connection = registry.openConnection("server-a");
      const invocation = connection.admit(
        claim,
        source.body,
        new AbortController().signal,
      )!;
      const identity = registry.inspect("tower", invocation)!;
      const ticket = connection.begin(
        { ...claim, nonce: "body-delay-wall" },
        new AbortController().signal,
      )!;
      wall = kind === "expiry" ? 1025 : 1085;
      expect(identity.isCurrent()).toBe(false);
      expect(ticket.admit(source.body)).toBeNull();
      expect(registry.inspect("tower", invocation)).toBeNull();
    },
  );
  it("observed newer generation retires older calls without admitting old snapshots again", () => {
    const { registry, claim, body } = fixture();
    const connection = registry.openConnection("server-a");
    const first = connection.admit(claim, body, new AbortController().signal)!;
    const firstIdentity = registry.inspect("tower", first)!;
    expect(
      connection.admit(
        { ...claim, generation: 2, nonce: "new-generation" },
        body,
        new AbortController().signal,
      ),
    ).not.toBeNull();
    expect(firstIdentity.isCurrent()).toBe(false);
    expect(
      connection.admit(
        { ...claim, nonce: "older-nonce" },
        body,
        new AbortController().signal,
      ),
    ).toBeNull();
  });
  it("reserves the original local deadline before waiting for body bytes and dispatches once", () => {
    const { registry, claim, body, advance } = fixture();
    const connection = registry.openConnection("server-a");
    const ticket = connection.begin(claim, new AbortController().signal)!;
    advance(1050);
    expect(ticket.admit(body)).toBeNull();
    const other = fixture();
    const once = other.registry
      .openConnection("server-a")
      .begin(other.claim, new AbortController().signal)!;
    expect(once.admit(other.body)).not.toBeNull();
    expect(once.admit(other.body)).toBeNull();
  });
  it.each(["revoke", "close", "cancel"])(
    "checks final %s after clock work",
    (action) => {
      const source = fixture();
      let hook = () => {};
      const cancel = new AbortController();
      const registry = createRequestAuthorityRegistry(
        {
          issuer: "https://gate.test",
          serverId: "server-a",
          freshnessMs: 100,
          maxClockSkewMs: 5,
          budgetMs: 50,
        },
        {
          wall: () => {
            hook();
            return 1000;
          },
          monotonic: () => 1000,
        },
      );
      const connection = registry.openConnection("server-a");
      const invocation = connection.admit(
        source.claim,
        source.body,
        cancel.signal,
      )!;
      const identity = registry.inspect("tower", invocation)!;
      hook = () => {
        if (action === "revoke")
          registry.revoke(source.claim.issuer, source.claim.sessionId);
        if (action === "close") connection.close();
        if (action === "cancel") cancel.abort();
      };
      expect(identity.isCurrent()).toBe(false);
    },
  );
  it("never clears observed session revocation on replacement", () => {
    const { registry, claim, body } = fixture();
    const connection = registry.openConnection("server-a");
    const first = connection.admit(claim, body, new AbortController().signal)!;
    registry.revoke(claim.issuer, claim.sessionId);
    expect(registry.inspect("tower", first)).toBeNull();
    connection.close();
    expect(
      registry
        .openConnection("server-a")
        .admit(
          { ...claim, nonce: "replacement", generation: 2 },
          body,
          new AbortController().signal,
        ),
    ).toBeNull();
  });
  it("fails closed at bounded replay capacity without evicting live nonces", () => {
    const { registry, claim, body } = fixture();
    const connection = registry.openConnection("server-a");
    for (let n = 0; n < 1024; n++)
      expect(
        connection.admit(
          { ...claim, nonce: `n-${n}` },
          body,
          new AbortController().signal,
        ),
      ).not.toBeNull();
    expect(
      connection.admit(
        { ...claim, nonce: "overflow" },
        body,
        new AbortController().signal,
      ),
    ).toBeNull();
    expect(
      connection.admit(
        { ...claim, nonce: "n-0" },
        body,
        new AbortController().signal,
      ),
    ).toBeNull();
  });
});
