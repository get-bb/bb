import { describe, expect, it, vi } from "vitest";

import { classifyGithubRevisionAvailability } from "../../src/command-handlers/environment.js";

const ARGS = {
  providerRepositoryId: "42",
  baseBranch: "main",
  baseRevision: "a".repeat(40),
  env: {},
} as const;

function repositoryResponse(): Response {
  return Response.json({ full_name: "owner/repo", default_branch: "main" });
}

describe("GitHub revision availability classification", () => {
  it("confirms a missing revision only when the repository and base branch are readable", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(repositoryResponse())
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    await expect(
      classifyGithubRevisionAvailability({ ...ARGS, fetchImpl }),
    ).resolves.toBe("not_found");
  });

  it.each([
    ["masked repository", [new Response(null, { status: 404 })]],
    [
      "ambiguous target lookup",
      [repositoryResponse(), new Response(null, { status: 503 })],
    ],
    [
      "unreadable base branch",
      [
        repositoryResponse(),
        new Response(null, { status: 404 }),
        new Response(null, { status: 503 }),
      ],
    ],
  ])("keeps %s unavailable", async (_name, responses) => {
    const fetchImpl = vi.fn<typeof fetch>();
    for (const response of responses) {
      fetchImpl.mockResolvedValueOnce(response);
    }
    await expect(
      classifyGithubRevisionAvailability({ ...ARGS, fetchImpl }),
    ).resolves.toBe("unavailable");
  });

  it("keeps network failures unavailable", async () => {
    await expect(
      classifyGithubRevisionAvailability({
        ...ARGS,
        fetchImpl: vi
          .fn<typeof fetch>()
          .mockRejectedValue(new Error("offline")),
      }),
    ).resolves.toBe("unavailable");
  });
});
