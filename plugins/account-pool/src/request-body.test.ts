import { describe, expect, it } from "vitest";
import { parseCodexRequestBody, parseRequestBody } from "./request-body.js";

const accountUuid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const nextAccountUuid = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const sessionId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const encode = (value: object) =>
  new TextEncoder().encode(JSON.stringify(value));

describe("Claude request parsing", () => {
  it.each([accountUuid, "invalid-account-uuid", 123, null])(
    "extracts the own session independently of account UUID %s",
    (account) => {
      const body = encode({
        model: "claude-fable-5",
        metadata: {
          user_id: JSON.stringify({
            account_uuid: account,
            session_id: sessionId,
            parent_session_id: "parent",
            device_id: "device",
          }),
        },
      });
      const parsed = parseRequestBody(body);
      expect(parsed.family).toBe("fable");
      expect(parsed.affinityId).toBe(`session:${sessionId}`);
      if (account === "invalid-account-uuid" || account === 123)
        expect(parsed.forAccount(nextAccountUuid)).toBe(body);
    },
  );

  it.each([
    undefined,
    null,
    "",
    "   ",
    123,
    [],
    { nested: "session" },
    "a\nb",
    "a\u007fb",
    "a\u0085b",
    "x".repeat(513),
  ])(
    "rejects invalid session %j while preserving it and extra metadata during account rewrite",
    (session) => {
      const user = {
        account_uuid: accountUuid,
        session_id: session,
        parent_session_id: sessionId,
        device_id: sessionId,
        extension: { keep: true },
      };
      const request = {
        model: "claude-fable-5",
        metadata: { user_id: JSON.stringify(user), extra: "keep" },
        messages: [{ role: "user", content: "message" }],
      };
      const parsed = parseRequestBody(encode(request));
      expect(parsed.affinityId).toBeNull();
      const rewritten = JSON.parse(
        new TextDecoder().decode(parsed.forAccount(nextAccountUuid)),
      );
      expect(rewritten).toEqual({
        ...request,
        metadata: {
          ...request.metadata,
          user_id: JSON.stringify({ ...user, account_uuid: nextAccountUuid }),
        },
      });
    },
  );

  it("accepts a 512-character session and preserves legacy metadata except the account UUID", () => {
    const id = "x".repeat(512);
    expect(
      parseRequestBody(
        encode({ metadata: { user_id: JSON.stringify({ session_id: id }) } }),
      ).affinityId,
    ).toBe(`session:${id}`);
    const body = encode({
      metadata: {
        user_id: `user_hash_account_${accountUuid}_session_${sessionId}`,
        extra: "keep",
      },
    });
    const parsed = parseRequestBody(body);
    expect(parsed.affinityId).toBe(`session:${sessionId}`);
    expect(
      JSON.parse(new TextDecoder().decode(parsed.forAccount(nextAccountUuid))),
    ).toEqual({
      metadata: {
        user_id: `user_hash_account_${nextAccountUuid}_session_${sessionId}`,
        extra: "keep",
      },
    });
  });

  it.each([
    "not-json",
    "[]",
    '{"metadata":{"user_id":"malformed"}}',
    '{"metadata":{"user_id":123}}',
  ])("leaves malformed request %s unbound and byte-identical", (raw) => {
    const body = new TextEncoder().encode(raw);
    const parsed = parseRequestBody(body);
    expect(parsed.affinityId).toBeNull();
    expect(parsed.forAccount(nextAccountUuid)).toBe(body);
  });
});

describe("Codex request parsing", () => {
  it.each<{
    headers: Record<string, string>;
    cacheKey: string | null;
    expected: string | null;
  }>([
    {
      headers: { "session-id": "native", session_id: "legacy" },
      cacheKey: "cache",
      expected: "session:native",
    },
    {
      headers: { session_id: "legacy" },
      cacheKey: "cache",
      expected: "session:legacy",
    },
    {
      headers: { "session-id": "", session_id: "legacy" },
      cacheKey: "cache",
      expected: "session:legacy",
    },
    {
      headers: { "session-id": "x".repeat(513), session_id: "legacy" },
      cacheKey: "cache",
      expected: "session:legacy",
    },
    {
      headers: { "session-id": "bad\u007fid" },
      cacheKey: "cache",
      expected: "cache:cache",
    },
    { headers: { "thread-id": "thread" }, cacheKey: null, expected: null },
    { headers: {}, cacheKey: "same", expected: "cache:same" },
    {
      headers: { "session-id": "same" },
      cacheKey: "same",
      expected: "session:same",
    },
    { headers: {}, cacheKey: "", expected: null },
    { headers: {}, cacheKey: "bad\nid", expected: null },
    { headers: {}, cacheKey: "x".repeat(513), expected: null },
    {
      headers: {},
      cacheKey: "x".repeat(512),
      expected: `cache:${"x".repeat(512)}`,
    },
  ])(
    "resolves affinity $expected without changing request bytes",
    ({ headers, cacheKey, expected }) => {
      const body = new TextEncoder().encode(
        JSON.stringify(
          {
            prompt_cache_key: cacheKey,
            client_metadata: { session_id: sessionId },
            input: [
              { type: "compaction_trigger" },
              { type: "compaction", encrypted_content: "fixture" },
            ],
          },
          null,
          2,
        ),
      );
      const parsed = parseCodexRequestBody(body, new Headers(headers));
      expect(parsed.affinityId).toBe(expected);
      expect(parsed.forAccount(nextAccountUuid)).toBe(body);
    },
  );

  it.each(["not-json", '{"prompt_cache_key":123}', '{"prompt_cache_key":[]}'])(
    "does not infer cache affinity from malformed payload %s",
    (raw) => {
      const body = new TextEncoder().encode(raw);
      const parsed = parseCodexRequestBody(body, new Headers());
      expect(parsed.affinityId).toBeNull();
      expect(parsed.forAccount(null)).toBe(body);
    },
  );
});
