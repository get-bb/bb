import { Miniflare } from "miniflare";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyConnectDbMigrationsToD1 } from "@bb/connect-db/testing";
import { handleSurveySubmission, rateLimitKey } from "./handler";
import { surveyReply } from "./survey";

let runtime: Miniflare;
let db: D1Database;
const origin = "https://community.test";
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
  await db.batch([db.prepare("DELETE FROM community_survey_response")]);
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

  it("saves only visible answers once per submission", async () => {
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
    expect((await post(fields, {}, id)).body).toEqual({
      result: { duplicate: false },
    });
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
      result: { duplicate: true },
    });
    expect(await count("community_survey_response")).toBe(1);
  });

  it("reports a save failure so the page can keep the answers", async () => {
    await db
      .prepare(
        "CREATE TRIGGER reject_response BEFORE INSERT ON community_survey_response BEGIN SELECT RAISE(ABORT, 'unavailable'); END",
      )
      .run();
    try {
      const { status, body } = await post();
      expect(status).toBe(503);
      expect(body.error).toContain("couldn't save");
    } finally {
      await db.prepare("DROP TRIGGER reject_response").run();
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
