import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { gzipSync } from "node:zlib";
import type { SkillSummary } from "@bb/server-contract";
import { afterEach, describe, expect, it } from "vitest";
import { createGuideArea } from "../src/areas/guide.js";
import {
  docsIndexDocuments,
  loadSkillDocuments,
  parseGuideSearchQuery,
  rankGuideSearchDocuments,
  type GuideSearchDocument,
  type GuideSkillSource,
} from "../src/areas/guide-search.js";

const DOCS_BASE_URL = "https://docs.example/docs";
const WORKSPACE = { projectId: "project-1", environmentId: "env-1" };

function docsIndex() {
  return {
    version: 1,
    pages: [
      {
        title: "Add a machine",
        url: "/docs/machines",
        description: "Run bb on another computer.",
        sections: [
          { heading: null, anchor: null, text: "Send threads to it." },
          {
            heading: "Enroll over SSH",
            anchor: "enroll-over-ssh",
            text: "Enrolling a machine over SSH installs the bb daemon.",
          },
        ],
      },
      {
        title: "Use bb on your phone",
        url: "/docs/phone",
        description: "Pair your phone by scanning a QR code.",
        sections: [],
      },
    ],
  };
}

function skillSummary(
  overrides: Partial<SkillSummary> & Pick<SkillSummary, "name" | "filePath">,
): SkillSummary {
  return {
    id: `skill_${overrides.name.padEnd(64, "0").slice(0, 64)}`,
    description: null,
    provider: null,
    scope: "bb-user",
    pluginId: null,
    manageable: true,
    registrySkillId: null,
    ...overrides,
  };
}

function skillSource(
  skills: readonly SkillSummary[],
  contents: Readonly<Record<string, string>>,
  calls: unknown[] = [],
): GuideSkillSource {
  return {
    async list(args) {
      calls.push({ list: args });
      return { skills: [...skills] };
    },
    async getContent(args) {
      calls.push({ getContent: args });
      const skill = skills.find((entry) => entry.id === args.skillId);
      const content = skill === undefined ? undefined : contents[skill.name];
      if (content === undefined) throw new Error("not found");
      return { content, revision: "a".repeat(64) };
    },
  };
}

describe("docs search index", () => {
  it("turns each page section into one document with an absolute URL", () => {
    const documents = docsIndexDocuments(docsIndex(), DOCS_BASE_URL);

    expect(documents).toEqual([
      {
        source: "docs",
        title: "Add a machine",
        section: null,
        location: "https://docs.example/docs/machines",
        text: "Run bb on another computer.\nSend threads to it.",
      },
      {
        source: "docs",
        title: "Add a machine",
        section: "Enroll over SSH",
        location: "https://docs.example/docs/machines#enroll-over-ssh",
        text: "Enrolling a machine over SSH installs the bb daemon.",
      },
      {
        source: "docs",
        title: "Use bb on your phone",
        section: null,
        location: "https://docs.example/docs/phone",
        text: "Pair your phone by scanning a QR code.",
      },
    ]);
  });
});

describe("ranking", () => {
  const documents: GuideSearchDocument[] = [
    {
      source: "skill",
      title: "deploy",
      section: "Steps",
      location: "/skills/deploy/SKILL.md",
      text: "Deploy the site after the machine is ready.",
    },
    {
      source: "guide",
      title: "Machines",
      section: "Machine commands",
      location: "bb guide machines",
      text: "bb machine enroll --bootstrap-file <path> adds a machine.",
    },
    {
      source: "docs",
      title: "Add a machine",
      section: "Enroll over SSH",
      location: "https://docs.example/docs/machines#enroll-over-ssh",
      text: "Enrolling a machine over SSH installs the bb daemon.",
    },
    {
      source: "docs",
      title: "Use bb on your phone",
      section: null,
      location: "https://docs.example/docs/phone",
      text: "Pair your phone by scanning a QR code.",
    },
  ];

  it("merges every source into one list ordered by relevance", () => {
    const results = rankGuideSearchDocuments(
      "how do I add a machine",
      documents,
      10,
    );

    expect(results.map((result) => result.location)).toEqual([
      "https://docs.example/docs/machines#enroll-over-ssh",
      "bb guide machines",
      "/skills/deploy/SKILL.md",
    ]);
  });

  it("puts a document matching every word above one matching a repeated single word", () => {
    const results = rankGuideSearchDocuments(
      "pair phone",
      [
        {
          source: "guide",
          title: "Phones",
          section: null,
          location: "bb guide phones",
          text: "phone phone phone phone phone",
        },
        ...documents,
      ],
      10,
    );

    expect(results[0]?.location).toBe("https://docs.example/docs/phone");
  });

  it("returns the best matching line as the snippet", () => {
    const [result] = rankGuideSearchDocuments(
      "enroll machine",
      [
        {
          source: "guide",
          title: "Machines",
          section: null,
          location: "bb guide machines",
          text: "Unrelated opening line.\nbb machine enroll   --bootstrap-file <path>",
        },
      ],
      1,
    );

    expect(result?.snippet).toBe("bb machine enroll --bootstrap-file <path>");
  });

  it("returns nothing when no document shares a word with the query", () => {
    expect(rankGuideSearchDocuments("kubernetes", documents, 10)).toEqual([]);
  });
});

describe("query validation", () => {
  it("normalizes whitespace and applies the default limit", () => {
    expect(parseGuideSearchQuery({ query: "  add   a machine " })).toEqual({
      query: "add a machine",
      limit: 10,
    });
  });

  it.each([
    [{ query: "   " }, "must not be empty"],
    [{ query: "how do I" }, "no searchable words"],
    [{ query: "x".repeat(501) }, "at most 500"],
    [{ query: "machines", limit: 0 }, "from 1 to 50"],
    [{ query: "machines", limit: 51 }, "from 1 to 50"],
    [{ query: "machines", limit: 2.5 }, "from 1 to 50"],
  ])("rejects %j", (input, message) => {
    expect(() => parseGuideSearchQuery(input)).toThrow(message);
  });
});

describe("skills", () => {
  const listed = [
    skillSummary({
      name: "deploy",
      description: "Ship the site",
      scope: "bb-project",
      filePath: "/repo/.bb/skills/deploy/SKILL.md",
    }),
    skillSummary({
      name: "browser-automation",
      description: "Drive a browser page",
      scope: "plugin",
      pluginId: "browser-automation",
      manageable: false,
      filePath:
        "/bb/plugins/browser-automation/skills/browser-automation/SKILL.md",
    }),
    skillSummary({
      name: "notes",
      filePath: "/home/user/.agents/skills/notes/SKILL.md",
    }),
  ];

  it("indexes exactly the server's listing with each skill's sections", async () => {
    const calls: unknown[] = [];
    const result = await loadSkillDocuments({
      skills: skillSource(
        listed,
        {
          deploy:
            "---\nname: deploy\ndescription: Ship the site\n---\n# Deploy\n\nRun the deploy.\n\n## Rollback\n\nRevert it.\n",
          "browser-automation": "Open a page and click.\n",
        },
        calls,
      ),
      ...WORKSPACE,
    });

    expect(result.status).toEqual({ ok: true, error: null });
    expect(
      result.documents.map(({ title, section, location, text }) => ({
        title,
        section,
        location,
        text,
      })),
    ).toEqual([
      {
        title: "deploy",
        section: null,
        location: "/repo/.bb/skills/deploy/SKILL.md",
        text: "Ship the site",
      },
      {
        title: "deploy",
        section: "Deploy",
        location: "/repo/.bb/skills/deploy/SKILL.md",
        text: "Run the deploy.",
      },
      {
        title: "deploy",
        section: "Rollback",
        location: "/repo/.bb/skills/deploy/SKILL.md",
        text: "Revert it.",
      },
      {
        title: "browser-automation",
        section: null,
        location:
          "/bb/plugins/browser-automation/skills/browser-automation/SKILL.md",
        text: "Drive a browser page",
      },
      {
        title: "browser-automation",
        section: null,
        location:
          "/bb/plugins/browser-automation/skills/browser-automation/SKILL.md",
        text: "Open a page and click.",
      },
      {
        title: "notes",
        section: null,
        location: "/home/user/.agents/skills/notes/SKILL.md",
        text: "",
      },
    ]);
    expect(calls[0]).toEqual({ list: WORKSPACE });
    expect(calls).toContainEqual({
      getContent: { ...WORKSPACE, skillId: listed[1]!.id, path: "SKILL.md" },
    });
  });

  it("reports an unreachable server and searches no skills", async () => {
    const result = await loadSkillDocuments({
      skills: {
        list: async () => {
          throw new TypeError("fetch failed", {
            cause: new Error("connect ECONNREFUSED 127.0.0.1:38886"),
          });
        },
        getContent: async () => {
          throw new Error("must not read content");
        },
      },
      ...WORKSPACE,
    });

    expect(result).toEqual({
      documents: [],
      status: {
        ok: false,
        error: "fetch failed: connect ECONNREFUSED 127.0.0.1:38886",
      },
    });
  });
});

type DocsServerHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => void;

const servers: Server[] = [];

async function docsServer(handler: DocsServerHandler): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("docs server has no port");
  }
  return `http://127.0.0.1:${address.port}/docs`;
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});

describe("guide.search", () => {
  it("merges docs, guide chapters, and the server's skills into one ranked list", async () => {
    const requested: { url: string; encoding: string | undefined }[] = [];
    const docsBaseUrl = await docsServer((request, response) => {
      requested.push({
        url: request.url ?? "",
        encoding: request.headers["accept-encoding"],
      });
      response.setHeader("content-type", "application/json");
      response.setHeader("content-encoding", "gzip");
      response.end(gzipSync(JSON.stringify(docsIndex())));
    });
    const listed = [
      skillSummary({
        name: "machine-setup",
        description: "Enroll a new machine for this team",
        filePath: "/repo/.bb/skills/machine-setup/SKILL.md",
      }),
      skillSummary({
        name: "machine-plugin",
        description: "Enroll machines from a plugin",
        scope: "plugin",
        pluginId: "machines",
        manageable: false,
        filePath: "/bb/plugins/machines/skills/machine-plugin/SKILL.md",
      }),
    ];
    const guide = createGuideArea({
      docsBaseUrl,
      skills: skillSource(listed, {}),
    });

    const response = await guide.search({
      query: "enroll machine",
      limit: 50,
      ...WORKSPACE,
    });

    expect(requested).toEqual([
      { url: "/docs/search-index.v1.json", encoding: "gzip" },
    ]);
    expect(response.query).toBe("enroll machine");
    expect(response.docs).toEqual({
      url: `${docsBaseUrl}/search-index.v1.json`,
      ok: true,
      error: null,
    });
    expect(response.skills).toEqual({ ok: true, error: null });
    expect(response.results[0]).toEqual({
      source: "docs",
      title: "Add a machine",
      section: "Enroll over SSH",
      location: `${docsBaseUrl}/machines#enroll-over-ssh`,
      snippet: "Enrolling a machine over SSH installs the bb daemon.",
    });
    const skillLocations = new Set(
      response.results
        .filter((result) => result.source === "skill")
        .map((result) => result.location),
    );
    expect(skillLocations).toEqual(
      new Set(listed.map((skill) => skill.filePath)),
    );
    expect(response.results).toContainEqual(
      expect.objectContaining({
        source: "guide",
        title: "Machines",
        location: "bb guide machines",
      }),
    );
  });

  it("searches no skills when no server is configured", async () => {
    const guide = createGuideArea({
      docsBaseUrl: DOCS_BASE_URL,
      fetchIndex: async () => docsIndex(),
    });

    const response = await guide.search({
      query: "enroll machine",
      limit: 50,
      ...WORKSPACE,
    });

    expect(response.skills).toEqual({
      ok: false,
      error: "no bb server configured",
    });
    expect(response.results.some((result) => result.source === "skill")).toBe(
      false,
    );
  });

  it.each<[string, DocsServerHandler, string]>([
    [
      "an HTTP error",
      (_request, response) => {
        response.statusCode = 503;
        response.end("unavailable");
      },
      "HTTP 503",
    ],
    [
      "a redirect",
      (_request, response) => {
        response.statusCode = 302;
        response.setHeader("location", "http://127.0.0.1:1/elsewhere.json");
        response.end();
      },
      "HTTP 302",
    ],
    [
      "not JSON",
      (_request, response) => response.end("<html></html>"),
      "search index is not JSON",
    ],
    [
      "another index version",
      (_request, response) =>
        response.end(JSON.stringify({ ...docsIndex(), version: 2 })),
      "unrecognized search index format",
    ],
    [
      "a small gzip body that decompresses past the size cap",
      (_request, response) => {
        response.setHeader("content-encoding", "gzip");
        response.end(gzipSync(" ".repeat(33 * 1024 * 1024)));
      },
      "search index is too large",
    ],
  ])(
    "falls back to the other sources when the docs return %s",
    async (_label, handler, error) => {
      const docsBaseUrl = await docsServer(handler);
      const guide = createGuideArea({ docsBaseUrl });

      const response = await guide.search({
        query: "enroll machine",
        ...WORKSPACE,
      });

      expect(response.docs).toEqual({
        url: `${docsBaseUrl}/search-index.v1.json`,
        ok: false,
        error,
      });
      expect(response.results.length).toBeGreaterThan(0);
      expect(
        response.results.every((result) => result.source === "guide"),
      ).toBe(true);
    },
  );

  it("gives up on docs that do not answer within the timeout", async () => {
    const docsBaseUrl = await docsServer(() => {});
    const guide = createGuideArea({ docsBaseUrl, docsTimeoutMs: 50 });

    const response = await guide.search({
      query: "terminal output",
      ...WORKSPACE,
    });

    expect(response.docs.error).toBe("timed out after 50 ms");
    expect(response.results[0]?.location).toBe("bb guide terminals");
  });

  it("rejects an invalid query before reading any source", async () => {
    const guide = createGuideArea({
      docsBaseUrl: DOCS_BASE_URL,
      fetchIndex: async () => {
        throw new Error("must not fetch");
      },
      skills: skillSource([], {}),
    });

    await expect(guide.search({ query: " ", ...WORKSPACE })).rejects.toThrow(
      "must not be empty",
    );
  });
});
