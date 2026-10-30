import { Miniflare } from "miniflare";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyConnectDbMigrationsToD1 } from "@bb/connect-db/testing";
import { emailKey, handleSurveySubmission, rateLimitKey } from "./handler";
import {
  ALREADY_CLAIMED,
  CLAIM_NOT_OPEN,
  SOLD_OUT,
  surveyReply,
  type SurveyReply,
} from "./survey";

let runtime: Miniflare;
let db: D1Database;
const origin = "https://community.test";
const claimBase = "https://test-shop.myshopify.com/cart/123:1";
const defaults = {
  discovery: "GitHub",
  role: "Developer or engineer",
  work: "I don't use bb for work",
  love: "Plugins",
  improve: "Search",
  community: "Get help when I'm stuck",
  city: "Austin",
  meetup: "Maybe",
  research_call: "Yes",
};
const enabled = {
  COMMUNITY_FORMS_ENABLED: "true",
  COMMUNITY_FORM_RATE_LIMITER: { limit: async () => ({ success: true }) },
  COMMUNITY_STICKER_CLAIM_URL: claimBase,
};
const request = (body: string, headers: Record<string, string> = {}) =>
  new Request(`${origin}/api/community/survey`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": String(new TextEncoder().encode(body).byteLength),
      ...headers,
    },
    body,
  });
const post = async (
  fields: Record<string, string | string[]> = {},
  env: Record<string, unknown> = {},
  submissionId: string = crypto.randomUUID(),
) => {
  const answers = Object.fromEntries(
    Object.entries({ ...defaults, email: "ada@example.test", ...fields }).map(
      ([name, value]) => [name, Array.isArray(value) ? value : [value]],
    ),
  );
  const response = await handleSurveySubmission(
    request(JSON.stringify({ submission_id: submissionId, answers })),
    { DB: db, ...enabled, ...env },
  );
  return {
    status: response.status,
    body: surveyReply.parse(await response.json()),
  };
};
const codeFrom = (body: SurveyReply) =>
  body.result?.claimLink?.match(/\?discount=([A-Z0-9]+)/)?.[1];
const count = (sql: string) =>
  db.prepare(`SELECT COUNT(*) AS n FROM ${sql}`).first<number>("n");
beforeAll(async () => {
  runtime = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('fixture'); } }",
    d1Databases: ["DB"],
    compatibilityDate: "2026-06-11",
  });
  db = (await runtime.getD1Database("DB")) as unknown as D1Database;
  await applyConnectDbMigrationsToD1(db);
});
beforeEach(async () => {
  await db.batch([
    db.prepare("DELETE FROM community_survey_response"),
    db.prepare("DELETE FROM community_survey_email"),
    db.prepare("DELETE FROM community_gift_code"),
    db.prepare(
      "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 10) INSERT INTO community_gift_code (code) SELECT printf('CODE%04d', i) FROM n",
    ),
  ]);
});
afterAll(async () => {
  await runtime?.dispose();
});

describe("survey submissions", () => {
  it("refuses submissions while collection is off", async () => {
    expect((await post({}, { COMMUNITY_FORMS_ENABLED: "false" })).status).toBe(
      503,
    );
    expect(await count("community_survey_response")).toBe(0);
  });

  it.each<Record<string, string>>([
    { email: "bad" },
    { discord: "removed field" },
  ])("rejects %o without saving", async (fields) => {
    expect((await post(fields)).status).toBe(400);
    expect(await count("community_survey_response")).toBe(0);
  });

  it("reads bodies without a length header but stops at 16 KiB of bytes", async () => {
    const unsized = (body: string) =>
      new Request(`${origin}/api/community/survey`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
    const answers = Object.fromEntries(
      Object.entries({ ...defaults, email: "ada@example.test" }).map(
        ([name, value]) => [name, [value]],
      ),
    );
    const ok = await handleSurveySubmission(
      unsized(JSON.stringify({ submission_id: crypto.randomUUID(), answers })),
      { DB: db, ...enabled },
    );
    expect(ok.status).toBe(200);
    let pulls = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        controller.enqueue(new Uint8Array(4096));
      },
    });
    const streamed = await handleSurveySubmission(
      new Request(`${origin}/api/community/survey`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: endless,
        duplex: "half",
      } as RequestInit),
      { DB: db, ...enabled },
    );
    expect(streamed.status).toBe(400);
    expect(pulls).toBeLessThan(10);
    const multibyte = await handleSurveySubmission(unsized("é".repeat(9000)), {
      DB: db,
      ...enabled,
    });
    expect(multibyte.status).toBe(400);
  });

  it("rejects oversized or non-JSON bodies", async () => {
    for (const body of [
      request("x".repeat(16385)),
      request("discovery=GitHub", {
        "content-type": "application/x-www-form-urlencoded",
      }),
    ]) {
      const response = await handleSurveySubmission(body, {
        DB: db,
        ...enabled,
      });
      expect(response.status).toBe(400);
    }
  });

  it("saves only visible answers and gives one claim link per submission", async () => {
    const id = crypto.randomUUID();
    const fields = {
      work: "Just me",
      company_size: "1–50",
      team_adopt: "Admin approval",
      team_improve: "hidden for Just me",
      community: [
        "See how other people use bb",
        "Build things with other bb users",
      ],
    };
    const { body } = await post(fields, {}, id);
    expect(body.result?.claimLink).toBe(
      `${claimBase}?discount=${codeFrom(body)}&checkout%5Bemail%5D=ada%40example.test`,
    );
    const stored = await db
      .prepare("SELECT answers FROM community_survey_response WHERE id = ?")
      .bind(id)
      .first<string>("answers");
    const { team_improve: _hidden, ...visible } = fields;
    expect(JSON.parse(stored!)).toEqual(
      Object.fromEntries(
        Object.entries({
          ...defaults,
          ...visible,
          email: "ada@example.test",
        }).map(([name, value]) => [
          name,
          Array.isArray(value) ? value : [value],
        ]),
      ),
    );
    expect((await post(fields, {}, id)).body).toEqual({
      result: { duplicate: true, claimLink: null, claimNote: null },
    });
    expect(await count("community_survey_response")).toBe(1);
    expect(await count("community_gift_code WHERE claimed = 1")).toBe(1);
  });

  it("gives each email one code, ignoring case and +tags", async () => {
    expect(codeFrom((await post()).body)).toBeDefined();
    for (const email of ["Ada@Example.test", " ada+again@example.test "]) {
      const { body } = await post({ email });
      expect(body.result).toEqual({
        duplicate: false,
        claimLink: null,
        claimNote: ALREADY_CLAIMED,
      });
    }
    expect(
      codeFrom((await post({ email: "grace@example.test" })).body),
    ).toBeDefined();
    expect(await count("community_survey_response")).toBe(4);
    expect(await count("community_gift_code WHERE claimed = 1")).toBe(2);
    expect(emailKey(" Ada+Tag@Example.TEST ")).toBe("ada@example.test");
  });

  it("hands out the last code once and still saves answers when codes run out", async () => {
    await db
      .prepare(
        "UPDATE community_gift_code SET claimed = 1 WHERE code != 'CODE0001'",
      )
      .run();
    const replies = await Promise.all(
      [0, 1, 2, 3].map((index) => post({ email: `ada${index}@example.test` })),
    );
    expect(replies.map(({ body }) => codeFrom(body)).filter(Boolean)).toEqual([
      "CODE0001",
    ]);
    expect(
      replies.filter(({ body }) => body.result?.claimNote === SOLD_OUT),
    ).toHaveLength(3);
    expect(await count("community_survey_response")).toBe(4);
  });

  it("keeps codes while claiming is off", async () => {
    const { body } = await post({}, { COMMUNITY_STICKER_CLAIM_URL: "" });
    expect(body.result?.claimNote).toBe(CLAIM_NOT_OPEN);
    expect(await count("community_gift_code WHERE claimed = 1")).toBe(0);
  });

  it("rolls back answers when claiming a code fails", async () => {
    await db
      .prepare(
        "CREATE TRIGGER reject_code BEFORE UPDATE ON community_gift_code BEGIN SELECT RAISE(ABORT, 'unavailable'); END",
      )
      .run();
    try {
      expect((await post()).status).toBe(503);
      expect(await count("community_survey_response")).toBe(0);
    } finally {
      await db.prepare("DROP TRIGGER reject_code").run();
    }
  });

  it("rate limits IPv6 clients by their /64 network", () => {
    expect(rateLimitKey("2001:db8:0:1::a")).toBe("2001:db8:0:1::/64");
    expect(rateLimitKey("2001:0DB8:0000:0001:ffff:1:2:3")).toBe(
      "2001:db8:0:1::/64",
    );
    expect(rateLimitKey("::ffff:192.0.2.1")).toBe("0:0:0:0::/64");
    expect(rateLimitKey("192.0.2.1")).toBe("192.0.2.1");
    expect(rateLimitKey(null)).toBe("local-preview");
  });
});
