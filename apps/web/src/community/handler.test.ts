import { Miniflare } from "miniflare";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { applyConnectDbMigrationsToD1 } from "@bb/connect-db/testing";
import {
  ALREADY_CLAIMED,
  CLAIM_NOT_OPEN,
  DELIVERY_WINDOW_MS,
  emailKey,
  runClaimRetries,
  SOLD_OUT,
} from "./claims";
import { handleSurveySubmission, rateLimitKey } from "./handler";
import { surveyReply, type SurveyReply } from "./survey";

let runtime: Miniflare;
let db: D1Database;
const origin = "https://community.test";
const claimBase = "https://test-shop.myshopify.com/cart/123:1";
type ShopifyMode =
  | "ok"
  | "down"
  | "tokenDenied"
  | "tokenHangs"
  | "loseReply"
  | "taken";
const shopify = {
  mode: "ok" as ShopifyMode,
  codes: new Set<string>(),
  requests: 0,
};
const mail = {
  status: 200,
  sent: [] as { headers: Headers; body: Record<string, unknown> }[],
};
async function fakeFetch(url: string, init: RequestInit) {
  if (!url.startsWith("https://api.resend.com/")) return fakeShopify(url, init);
  mail.sent.push({
    headers: new Headers(init.headers),
    body: JSON.parse(String(init.body)),
  });
  return new Response("{}", { status: mail.status });
}
async function fakeShopify(url: string, init: RequestInit) {
  shopify.requests++;
  if (
    url.endsWith("/admin/oauth/access_token") &&
    shopify.mode === "tokenHangs"
  )
    return new Promise<Response>((_, reject) =>
      init.signal?.addEventListener("abort", () => reject(init.signal?.reason)),
    );
  if (url.endsWith("/admin/oauth/access_token"))
    return shopify.mode === "tokenDenied"
      ? Response.json({ error: "invalid_client" }, { status: 400 })
      : Response.json({ access_token: "token", expires_in: 86399 });
  if (shopify.mode === "down")
    return new Response("unavailable", { status: 503 });
  const { query, variables } = JSON.parse(String(init.body));
  if (query.includes("codeDiscountNodeByCode"))
    return Response.json({
      data: {
        codeDiscountNodeByCode: shopify.codes.has(variables.code)
          ? { id: "gid://shopify/DiscountCodeNode/1" }
          : null,
      },
    });
  const code = variables.discount.code;
  const existed = shopify.codes.has(code) || shopify.mode === "taken";
  shopify.codes.add(code);
  if (shopify.mode === "loseReply")
    return new Response("timeout", { status: 504 });
  return Response.json({
    data: {
      discountCodeBasicCreate: existed
        ? { codeDiscountNode: null, userErrors: [{ code: "TAKEN" }] }
        : {
            codeDiscountNode: { id: "gid://shopify/DiscountCodeNode/2" },
            userErrors: [],
          },
    },
  });
}
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
  COMMUNITY_SHOPIFY_STORE: "test-shop.myshopify.com",
  COMMUNITY_STICKER_VARIANT_ID: "123",
  COMMUNITY_STICKER_LIMIT: "1000",
  SHOPIFY_CLIENT_ID: "client",
  SHOPIFY_CLIENT_SECRET: "secret",
  RESEND_API_KEY: "test-key",
};
const worker = () => ({ DB: db, ...enabled });
const claims = () =>
  db
    .prepare(
      "SELECT c.status, c.submission_id, r.emailed_at FROM community_sticker_claim c LEFT JOIN community_survey_response r ON r.id = c.submission_id",
    )
    .all<{
      status: string;
      submission_id: string | null;
      emailed_at: number | null;
    }>()
    .then((result) => result.results);
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
  body.result?.claimLink?.match(/\?discount=(BB-[A-Z2-7]{12})/)?.[1];
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
    db.prepare("DELETE FROM community_sticker_claim"),
  ]);
  shopify.mode = "ok";
  shopify.requests = 0;
  shopify.codes.clear();
  mail.status = 200;
  mail.sent = [];
  vi.stubGlobal("fetch", fakeFetch);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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
    expect(shopify.codes).toEqual(new Set([codeFrom(body)]));
    expect((await post(fields, {}, id)).body).toEqual({
      result: {
        duplicate: true,
        claimLink: null,
        claimNote: null,
        emailStatus: "sent",
      },
    });
    expect(await count("community_survey_response")).toBe(1);
    expect(
      await count("community_sticker_claim WHERE status = 'delivered'"),
    ).toBe(1);
  });

  it("gives each email one code, ignoring case and +tags", async () => {
    expect(codeFrom((await post()).body)).toBeDefined();
    for (const email of ["Ada@Example.test", " ada+again@example.test "]) {
      const { body } = await post({ email });
      expect(body.result).toEqual({
        duplicate: false,
        claimLink: null,
        claimNote: ALREADY_CLAIMED,
        emailStatus: "none",
      });
    }
    expect(
      codeFrom((await post({ email: "grace@example.test" })).body),
    ).toBeDefined();
    expect(await count("community_survey_response")).toBe(4);
    expect(await count("community_sticker_claim")).toBe(2);
    expect(emailKey(" Ada+Tag@Example.TEST ")).toBe("ada@example.test");
  });

  it("reserves the last claim once and still saves answers at the limit", async () => {
    const replies = await Promise.all(
      [0, 1, 2, 3].map((index) =>
        post(
          { email: `ada${index}@example.test` },
          { COMMUNITY_STICKER_LIMIT: "1" },
        ),
      ),
    );
    expect(
      replies.map(({ body }) => codeFrom(body)).filter(Boolean),
    ).toHaveLength(1);
    expect(
      replies.filter(({ body }) => body.result?.claimNote === SOLD_OUT),
    ).toHaveLength(3);
    expect(await count("community_survey_response")).toBe(4);
    expect(await count("community_sticker_claim")).toBe(1);
  });

  it("keeps an email eligible while claims are closed", async () => {
    const closed = await post({}, { SHOPIFY_CLIENT_SECRET: "" });
    expect(closed.body.result?.claimNote).toBe(CLAIM_NOT_OPEN);
    expect(await count("community_sticker_claim")).toBe(0);
    expect(await count("community_survey_email")).toBe(0);
    expect(codeFrom((await post()).body)).toBeDefined();
  });

  it.each([
    ["down", 3],
    ["tokenDenied", 1],
  ] as const)(
    "keeps the claim pending when Shopify is %s",
    async (mode, requests) => {
      shopify.mode = mode;
      const { body } = await post();
      expect(body.result).toEqual({
        duplicate: false,
        claimLink: null,
        claimNote: null,
        emailStatus: "queued",
      });
      expect(
        await count(
          "community_sticker_claim WHERE status = 'pending' AND attempts = 1",
        ),
      ).toBe(1);
      expect([shopify.codes.size, shopify.requests]).toEqual([0, requests]);
    },
  );

  it.each(["taken", "loseReply"] as const)(
    "treats its own code as created after a %s reply",
    async (mode) => {
      shopify.mode = mode;
      const { body } = await post();
      expect(codeFrom(body)).toBeDefined();
      expect(shopify.codes.size).toBe(1);
      expect(
        await count("community_sticker_claim WHERE status = 'delivered'"),
      ).toBe(1);
    },
  );

  it("rolls back answers when reserving a claim fails", async () => {
    await db
      .prepare(
        "CREATE TRIGGER reject_claim BEFORE INSERT ON community_sticker_claim BEGIN SELECT RAISE(ABORT, 'unavailable'); END",
      )
      .run();
    try {
      expect((await post()).status).toBe(503);
      expect(await count("community_survey_response")).toBe(0);
      expect(shopify.codes.size).toBe(0);
    } finally {
      await db.prepare("DROP TRIGGER reject_claim").run();
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

describe("results email", () => {
  it("emails a new finisher once, escaped, with their claim link", async () => {
    const id = crypto.randomUUID();
    const { body } = await post({ improve: "<b>Faster</b>" }, {}, id);
    expect(body.result?.emailStatus).toBe("sent");
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]!.headers.get("idempotency-key")).toBe(
      `community-survey/${id}`,
    );
    expect(mail.sent[0]!.body.to).toEqual(["ada@example.test"]);
    expect(String(mail.sent[0]!.body.html)).toContain(
      "&lt;b&gt;Faster&lt;/b&gt;",
    );
    expect(String(mail.sent[0]!.body.html)).toContain(
      `discount=${codeFrom(body)}`,
    );
    expect(await claims()).toEqual([
      { status: "delivered", submission_id: null, emailed_at: null },
    ]);
    expect(
      await count("community_survey_response WHERE emailed_at IS NOT NULL"),
    ).toBe(1);
  });

  it("retries a rate-limited send right away", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) =>
      url.startsWith("https://api.resend.com/")
        ? new Response("{}", { status: ++calls === 1 ? 429 : 200 })
        : fakeShopify(url, init),
    );
    expect((await post()).body.result?.emailStatus).toBe("sent");
    expect(calls).toBe(2);
  });

  it("keeps retrying a failed email hourly, with one key", async () => {
    mail.status = 503;
    expect((await post()).body.result?.emailStatus).toBe("queued");
    mail.status = 422;
    await runClaimRetries(worker(), Date.now() + 3_600_000);
    expect((await claims())[0]?.status).toBe("created");
    mail.status = 200;
    await runClaimRetries(worker(), Date.now() + 2 * 3_600_000);
    expect((await claims())[0]?.status).toBe("delivered");
    const sends = mail.sent.length;
    await runClaimRetries(worker(), Date.now() + 3 * 3_600_000);
    expect(mail.sent).toHaveLength(sends);
    expect(
      new Set(mail.sent.map(({ headers }) => headers.get("idempotency-key")))
        .size,
    ).toBe(1);
  });

  it("emails a created claim whose request ended before sending", async () => {
    const id = crypto.randomUUID();
    const created = Date.now() - 30 * 60_000;
    await db.batch([
      db
        .prepare(
          "INSERT INTO community_survey_response (id, created_at, answers) VALUES (?, ?, ?)",
        )
        .bind(id, created, JSON.stringify({ email: ["ada@example.test"] })),
      db
        .prepare(
          "INSERT INTO community_sticker_claim (code, submission_id, status, created_at) VALUES ('BB-AAAAAAAAAAAA', ?, 'created', ?)",
        )
        .bind(id, created),
    ]);
    await runClaimRetries(worker(), created + 4 * 60_000);
    expect(mail.sent).toHaveLength(0);
    await runClaimRetries(worker(), created + 6 * 60_000);
    expect(mail.sent).toHaveLength(1);
    expect((await claims())[0]?.status).toBe("delivered");
  });

  it("finishes a pending claim once Shopify recovers and emails its link", async () => {
    shopify.mode = "down";
    const id = crypto.randomUUID();
    const now = Date.now();
    expect((await post({}, {}, id)).body.result?.emailStatus).toBe("queued");
    expect((await post({}, {}, id)).body.result).toMatchObject({
      duplicate: true,
      emailStatus: "queued",
    });
    shopify.mode = "ok";
    await runClaimRetries(worker(), now + 8 * 24 * 3_600_000);
    expect(shopify.codes.size).toBe(1);
    expect(String(mail.sent[0]!.body.html)).toContain(
      `discount=${[...shopify.codes][0]}`,
    );
    expect((await claims())[0]?.status).toBe("delivered");
  });

  it("expires claims it couldn't deliver in 30 days and unlinks the response", async () => {
    mail.status = 503;
    await post();
    shopify.mode = "down";
    await post({ email: "grace@example.test" });
    await runClaimRetries(worker(), Date.now() + DELIVERY_WINDOW_MS + 60_000);
    expect(await claims()).toEqual([
      { status: "expired", submission_id: null, emailed_at: null },
      { status: "expired", submission_id: null, emailed_at: null },
    ]);
    expect(await count("community_survey_email")).toBe(2);
    const sends = mail.sent.length;
    mail.status = 200;
    shopify.mode = "ok";
    await runClaimRetries(
      worker(),
      Date.now() + DELIVERY_WINDOW_MS + 3_600_000,
    );
    expect(mail.sent).toHaveLength(sends);
  });

  it("promises no email to a repeat send without a claim", async () => {
    await post();
    const id = crypto.randomUUID();
    await post({ email: "Ada+again@example.test" }, {}, id);
    expect(
      (await post({ email: "Ada+again@example.test" }, {}, id)).body.result,
    ).toMatchObject({ duplicate: true, emailStatus: "none" });
    expect(mail.sent).toHaveLength(1);
  });

  it("sends due emails, then stops at a hanging Shopify and logs once", async () => {
    mail.status = 503;
    await post();
    shopify.mode = "down";
    for (const email of ["b@example.test", "c@example.test"])
      await post({ email });
    mail.status = 200;
    shopify.mode = "tokenHangs";
    const errors = vi.mocked(console.error);
    errors.mockClear();
    await runClaimRetries(worker(), Date.now() + 3_600_000);
    expect(
      await count("community_sticker_claim WHERE status = 'delivered'"),
    ).toBe(1);
    expect(
      await count(
        "community_sticker_claim WHERE status = 'pending' AND attempts = 2",
      ),
    ).toBe(1);
    expect(errors.mock.calls).toHaveLength(1);
    expect(String(errors.mock.calls[0]?.[0])).toContain(
      '"event":"community_sticker_deliveries_stuck","claims":2',
    );
    expect(String(errors.mock.calls[0]?.[0])).toContain(
      '"failure":"unreachable"',
    );
  }, 20_000);

  it("logs an auth failure when Shopify rejects the credentials", async () => {
    shopify.mode = "tokenDenied";
    await post();
    const errors = vi.mocked(console.error);
    errors.mockClear();
    await runClaimRetries(worker(), Date.now() + 3_600_000);
    expect(String(errors.mock.calls.at(-1)?.[0])).toContain('"failure":"auth"');
  });
});
