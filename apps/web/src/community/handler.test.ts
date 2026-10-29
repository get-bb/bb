import { Miniflare } from "miniflare";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sha256Hex } from "@bb/connect-db";
import { applyConnectDbMigrationsToD1 } from "@bb/connect-db/testing";
import { emailKey, handleCommunityForm, rateLimitKey } from "./handler";
import { ALREADY_CLAIMED, CLAIM_NOT_OPEN, SOLD_OUT } from "./survey";

let runtime: Miniflare;
let db: D1Database;
const origin = "https://community.test";
const codeFrom = (html: string) =>
  html.match(/myshopify\.com\/cart\/123:1\?discount=([A-Z0-9]+)/)?.[1];
const claimedCodes = () =>
  db
    .prepare("SELECT COUNT(*) AS n FROM community_gift_code WHERE claimed = 1")
    .first("n");
const enabled = () => ({
  DB: db,
  COMMUNITY_FORMS_ENABLED: "true",
  COMMUNITY_FORM_RATE_LIMITER: { limit: async () => ({ success: true }) },
  COMMUNITY_STICKER_CLAIM_URL: "https://test-shop.myshopify.com/cart/123:1",
});
const requiredFields = {
  discovery: "GitHub",
  role: "Developer or engineer",
  work: "I don't use bb for work",
  love: "Plugins",
  improve: "Search",
  community: "Get help when I'm stuck",
  city: "Austin",
  meetup: "Maybe",
};
const requiredAnswers = Object.fromEntries(
  Object.entries(requiredFields).map(([key, value]) => [key, [value]]),
);
const submit = (
  id = crypto.randomUUID(),
  fields: Record<string, string> = {},
) =>
  handleCommunityForm(
    new Request(`${origin}/community/survey`, {
      method: "POST",
      headers: { Origin: origin },
      body: new URLSearchParams({
        ...requiredFields,
        submission_id: id,
        email: "ada@example.test",
        ...fields,
      }),
    }),
    enabled(),
    "survey",
  );

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

describe("private community forms", () => {
  it("keeps collection off and refuses addresses", async () => {
    const response = await handleCommunityForm(
      new Request(`${origin}/community/survey`, { method: "POST" }),
      { DB: db },
      "survey",
    );
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('class="community-notice"');
    const merch = await handleCommunityForm(
      new Request(`${origin}/community/merch`, {
        method: "POST",
        body: "address=private",
      }),
      enabled(),
      "merch",
    );
    expect(merch.status).toBe(405);
    expect(
      await db
        .prepare("SELECT COUNT(*) AS n FROM community_survey_response")
        .first("n"),
    ).toBe(0);
    expect(
      await db
        .prepare(
          "SELECT name FROM sqlite_master WHERE name = 'community_merch_address'",
        )
        .first(),
    ).toBeNull();
  });
  it("claims one gift code per new submission without storing it with answers", async () => {
    const id = crypto.randomUUID();
    const html = await (
      await submit(id, { community: "Get help when I'm stuck" })
    ).text();
    const code = codeFrom(html)!;
    expect(code).toMatch(/^CODE\d{4}$/);
    expect(html).toContain(
      `https://test-shop.myshopify.com/cart/123:1?discount=${code}&amp;checkout%5Bemail%5D=ada%40example.test`,
    );
    expect(
      await db
        .prepare("SELECT answers FROM community_survey_response WHERE id = ?")
        .bind(id)
        .first("answers"),
    ).toBe(
      JSON.stringify({
        ...requiredAnswers,
        community: ["Get help when I'm stuck"],
        email: ["ada@example.test"],
      }),
    );
    expect(
      await db
        .prepare("SELECT claimed FROM community_gift_code WHERE code = ?")
        .bind(code)
        .first("claimed"),
    ).toBe(1);
    const repeat = await (await submit(id)).text();
    expect(codeFrom(repeat)).toBeUndefined();
    expect(repeat).toContain("we already have your answers");
    expect(await claimedCodes()).toBe(1);
  });
  it("rejects missing contact, removed fields and conflicting involvement without saving", async () => {
    const invalidFields: Record<string, string>[] = [
      { name: "" },
      { email: "" },
      { email: "bad" },
      { discord: "old" },
      { merch: "Mug" },
      { opt_in: "old" },
      { miss: "old" },
      { company: "old" },
    ];
    for (const fields of invalidFields) {
      expect((await submit(crypto.randomUUID(), fields)).status).toBe(400);
    }
    const response = await handleCommunityForm(
      new Request(`${origin}/community/survey`, {
        method: "POST",
        headers: { Origin: origin },
        body: new URLSearchParams([
          ["submission_id", crypto.randomUUID()],
          ["email", "ada@example.test"],
          ["meetup", "I'd come"],
          ["meetup", "Not for me right now"],
        ]),
      }),
      enabled(),
      "survey",
    );
    expect(response.status).toBe(400);
    expect(
      await db
        .prepare("SELECT COUNT(*) AS n FROM community_survey_response")
        .first("n"),
    ).toBe(0);
  });
  it("thanks respondents with stickers without requesting their name", async () => {
    const html = await (await submit()).text();
    expect(html).toContain("Thanks!");
    expect(html).toContain("Claim my bb stickers");
    expect(html).not.toContain("hat and stickers");
    expect(codeFrom(html)).toBeTruthy();
  });
  it("stores up to three community choices", async () => {
    const id = crypto.randomUUID();
    const response = await handleCommunityForm(
      new Request(`${origin}/community/survey`, {
        method: "POST",
        headers: { Origin: origin },
        body: new URLSearchParams([
          ...Object.entries(requiredFields).filter(
            ([name]) => name !== "community",
          ),
          ["submission_id", id],
          ["email", "ada@example.test"],
          ["community", "See how other people use bb"],
          ["community", "Build things with other bb users"],
        ]),
      }),
      enabled(),
      "survey",
    );
    expect(response.status).toBe(200);
    const answers = await db
      .prepare("SELECT answers FROM community_survey_response WHERE id = ?")
      .bind(id)
      .first("answers");
    expect(JSON.parse(String(answers))).toEqual({
      ...requiredAnswers,
      community: [
        "See how other people use bb",
        "Build things with other bb users",
      ],
      email: ["ada@example.test"],
    });
  });
  it.each([
    "2–4 people",
    "5 or more",
    "Just me",
    "I don't use bb for work",
    "I'm not sure",
  ])(
    "stores experience answers and discards inapplicable team feedback for %s",
    async (work) => {
      const id = crypto.randomUUID();
      const teamVisible = work === "2–4 people" || work === "5 or more";
      const adoptVisible = work === "Just me";
      const response = await submit(id, {
        work,
        company_size:
          work === "I don't use bb for work" ? "ignored" : "201–999",
        love: "Fast iteration",
        improve: "Better search",
        team_improve: teamVisible ? "Shared sessions" : "x".repeat(251),
        team_adopt: adoptVisible ? "Admin approval" : "x".repeat(251),
      });
      expect(response.status).toBe(200);
      const answers = await db
        .prepare("SELECT answers FROM community_survey_response WHERE id = ?")
        .bind(id)
        .first<string>("answers");
      expect(JSON.parse(answers!)).toEqual({
        ...requiredAnswers,
        work: [work],
        ...(work === "I don't use bb for work"
          ? {}
          : { company_size: ["201–999"] }),
        love: ["Fast iteration"],
        improve: ["Better search"],
        ...(teamVisible ? { team_improve: ["Shared sessions"] } : {}),
        ...(adoptVisible ? { team_adopt: ["Admin approval"] } : {}),
        email: ["ada@example.test"],
      });
    },
  );
  it.each([
    ["love", "5 or more"],
    ["improve", "5 or more"],
    ["team_improve", "5 or more"],
    ["team_adopt", "Just me"],
  ])("rejects overlong %s without saving", async (field, work) => {
    expect(
      (
        await submit(crypto.randomUUID(), {
          work,
          ...(work === "Just me" ? { team_adopt: "Admin approval" } : {}),
          [field]: "x".repeat(251),
        })
      ).status,
    ).toBe(400);
    expect(
      await db
        .prepare("SELECT COUNT(*) AS n FROM community_survey_response")
        .first("n"),
    ).toBe(0);
  });
  it("gives each email one sticker code and still saves repeat answers", async () => {
    expect(codeFrom(await (await submit()).text())).toBeDefined();
    for (const email of ["Ada@Example.test", " ada+again@example.test "]) {
      const html = await (await submit(undefined, { email })).text();
      expect(codeFrom(html)).toBeUndefined();
      expect(html).toContain(ALREADY_CLAIMED);
    }
    expect(
      codeFrom(
        await (await submit(undefined, { email: "grace@example.test" })).text(),
      ),
    ).toBeDefined();
    expect(
      await db
        .prepare("SELECT COUNT(*) AS n FROM community_survey_response")
        .first("n"),
    ).toBe(4);
    expect(await claimedCodes()).toBe(2);
    expect(emailKey(" Ada+Tag@Example.TEST ")).toBe("ada@example.test");
  });
  it("rate limits IPv6 clients by their /64 network", () => {
    expect(rateLimitKey("2001:db8:0:1::a")).toBe("2001:db8:0:1::/64");
    expect(rateLimitKey("2001:0DB8:0000:0001:ffff:1:2:3")).toBe(
      "2001:db8:0:1::/64",
    );
    expect(rateLimitKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(rateLimitKey("::ffff:192.0.2.1")).toBe("0:0:0:0::/64");
    expect(rateLimitKey("192.0.2.1")).toBe("192.0.2.1");
    expect(rateLimitKey(null)).toBe("local-preview");
  });
  it("hands out the last code once and still accepts answers when codes run out", async () => {
    await db
      .prepare(
        "UPDATE community_gift_code SET claimed = 1 WHERE code != 'CODE0001'",
      )
      .run();
    const responses = await Promise.all(
      Array.from({ length: 4 }, async (_, index) =>
        (await submit(undefined, { email: `ada${index}@example.test` })).text(),
      ),
    );
    expect(responses.map(codeFrom).filter(Boolean)).toEqual(["CODE0001"]);
    expect(
      responses.filter((html) =>
        html.includes(SOLD_OUT.replaceAll("'", "&#x27;")),
      ),
    ).toHaveLength(3);
    expect(
      await db
        .prepare("SELECT COUNT(*) AS n FROM community_survey_response")
        .first("n"),
    ).toBe(4);
  });
  it("keeps codes when claiming isn't configured", async () => {
    const html = await (
      await handleCommunityForm(
        new Request(`${origin}/community/survey`, {
          method: "POST",
          headers: { Origin: origin },
          body: new URLSearchParams({
            ...requiredFields,
            submission_id: crypto.randomUUID(),
            email: "ada@example.test",
          }),
        }),
        {
          ...enabled(),
          COMMUNITY_STICKER_CLAIM_URL: "https://attacker.example/cart/1:1",
        },
        "survey",
      )
    ).text();
    expect(codeFrom(html)).toBeUndefined();
    expect(html).toContain(CLAIM_NOT_OPEN.replaceAll("'", "&#x27;"));
    expect(await claimedCodes()).toBe(0);
  });
  it("rolls back answers when claiming a code fails", async () => {
    await db
      .prepare(
        "CREATE TRIGGER reject_code BEFORE UPDATE ON community_gift_code BEGIN SELECT RAISE(ABORT, 'unavailable'); END",
      )
      .run();
    try {
      expect((await submit()).status).toBe(503);
      expect(
        await db
          .prepare("SELECT COUNT(*) AS n FROM community_survey_response")
          .first("n"),
      ).toBe(0);
    } finally {
      await db.prepare("DROP TRIGGER reject_code").run();
    }
  });
  it("doesn't open the mailing form for survey gift codes", async () => {
    const code = codeFrom(await (await submit()).text())!;
    const response = await handleCommunityForm(
      new Request(`${origin}/community/merch?c=${code}`),
      {
        ...enabled(),
        COMMUNITY_JOTFORM_URL: "https://form.jotform.com/123456",
      },
      "merch",
    );
    expect(response.status).toBe(404);
  });
  it("rejects unknown codes, validates contributor hashes and ignores legacy raw invites", async () => {
    const code = "contributor-code-128-bits-fixture";
    const request = new Request(`${origin}/community/merch?c=${code}`);
    expect(
      (await handleCommunityForm(request, enabled(), "merch")).status,
    ).toBe(404);
    expect(
      (
        await handleCommunityForm(
          request,
          {
            ...enabled(),
            COMMUNITY_MERCH_INVITE_HASHES: JSON.stringify([
              await sha256Hex(code),
            ]),
          },
          "merch",
        )
      ).status,
    ).toBe(200);
    const invited = {
      ...enabled(),
      COMMUNITY_MERCH_INVITE_HASHES: JSON.stringify([await sha256Hex(code)]),
    };
    const form = await handleCommunityForm(
      request,
      { ...invited, COMMUNITY_JOTFORM_URL: "https://form.jotform.com/123456" },
      "merch",
    );
    expect(await form.text()).toContain(
      `https://form.jotform.com/123456?code=${code}`,
    );
    expect(form.headers.get("referrer-policy")).toBe("no-referrer");
    const unsafe = await handleCommunityForm(
      request,
      { ...invited, COMMUNITY_JOTFORM_URL: "https://attacker.example/form" },
      "merch",
    );
    expect(await unsafe.text()).not.toContain("<iframe");
  });
});
