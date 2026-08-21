import { describe, expect, it } from "vitest";
import {
  parsePageParameter,
  parsePerPageParameter,
  parsePublicDetail,
  parsePublicDirectorySkills,
  parsePublicSkillMarkdown,
  parseRegistrySkillId,
  registrySkillUrl,
} from "../../src/services/skills/registry-parse.js";

describe("registry skill IDs and URLs", () => {
  it("splits a registry ID at the final path separator", () => {
    expect(
      parseRegistrySkillId("github.com/vercel-labs/skills/find-skills"),
    ).toEqual({
      source: "github.com/vercel-labs/skills",
      skillId: "find-skills",
    });
  });

  it.each(["", "find-skills", "--help/find-skills", "owner/repo/BadName"])(
    "rejects invalid registry ID %j",
    (id) => {
      expect(() => parseRegistrySkillId(id)).toThrowError(
        "Expected a valid registry skill ID",
      );
    },
  );

  it("encodes each registry URL path segment independently", () => {
    expect(registrySkillUrl("owner name/repo/@skill")).toBe(
      "https://www.skills.sh/owner%20name/repo/%40skill",
    );
  });
});

describe("registry pagination parameters", () => {
  it("uses the existing pagination defaults", () => {
    expect(parsePageParameter(undefined)).toBe(0);
    expect(parsePerPageParameter(undefined)).toBe(24);
  });

  it.each([
    ["0", 0],
    ["17", 17],
    ["100000", 100_000],
  ])("parses page %s", (value, expected) => {
    expect(parsePageParameter(value)).toBe(expected);
  });

  it.each(["-1", "1.5", "100001", "9007199254740992"])(
    "rejects page %s",
    (value) => {
      expect(() => parsePageParameter(value)).toThrowError(
        "page must be a nonnegative integer no greater than 100000",
      );
    },
  );

  it.each([
    ["1", 1],
    ["24", 24],
    ["100", 100],
  ])("parses perPage %s", (value, expected) => {
    expect(parsePerPageParameter(value)).toBe(expected);
  });

  it.each(["0", "101", "9007199254740992"])(
    "rejects out-of-range perPage %s",
    (value) => {
      expect(() => parsePerPageParameter(value)).toThrowError(
        "perPage must be between 1 and 100",
      );
    },
  );

  it.each(["-1", "1.5", "nope"])("rejects malformed perPage %s", (value) => {
    expect(() => parsePerPageParameter(value)).toThrowError(
      "perPage must be a positive integer",
    );
  });
});

describe("public registry HTML parsing", () => {
  it("parses and de-duplicates representative homepage records", () => {
    const html = [
      String.raw`\"source\":\"owner/repo\",\"skillId\":\"first-skill\",\"name\":\"First skill\",\"installs\":42`,
      String.raw`\"source\":\"owner/repo\",\"skillId\":\"first-skill\",\"name\":\"Duplicate\",\"installs\":1`,
      String.raw`\"source\":\"catalog.example.com/pkg\",\"skillId\":\"hosted-skill\",\"name\":\"Hosted skill\",\"installs\":7`,
    ].join("\n");

    expect(parsePublicDirectorySkills(html)).toEqual([
      {
        id: "owner/repo/first-skill",
        source: "owner/repo",
        skillId: "first-skill",
        name: "First skill",
        installs: 42,
        stars: null,
        installUrl: "https://github.com/owner/repo",
        url: "https://www.skills.sh/owner/repo/first-skill",
        topic: null,
        summary: null,
      },
      {
        id: "catalog.example.com/pkg/hosted-skill",
        source: "catalog.example.com/pkg",
        skillId: "hosted-skill",
        name: "Hosted skill",
        installs: 7,
        stars: null,
        installUrl: "https://catalog.example.com/pkg",
        url: "https://www.skills.sh/catalog.example.com/pkg/hosted-skill",
        topic: null,
        summary: null,
      },
    ]);
  });

  it("extracts and decodes detail topic and summary text", () => {
    const html = [
      '<a href="/topic/dev-tools">Dev &amp; Tools</a>',
      "Summary</div>",
      "<p>Build <strong>things</strong> &amp; ship.</p>",
      "<button>Show more</button>",
      "SKILL.md",
    ].join("");

    expect(parsePublicDetail(html)).toEqual({
      topic: "Dev & Tools",
      summary: "Build things & ship.",
    });
  });

  it("converts the rendered SKILL.md preview into markdown", () => {
    const html = [
      "<span>SKILL.md</span></div>",
      '<div class="prose prose-invert">',
      "<h1>Hello</h1>",
      "<div><p>Use <strong>care</strong> &amp; <code>code</code>.</p></div>",
      "</div>",
    ].join("");

    expect(parsePublicSkillMarkdown(html)).toEqual([
      {
        path: "SKILL.md",
        contents: "# Hello\n\nUse **care** & `code`.",
      },
    ]);
  });
});
