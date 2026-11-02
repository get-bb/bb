import { describe, expect, it, vi } from "vitest";
import { fetchAcpRegistryAgentIds } from "./acp-registry";

function respond(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

describe("fetchAcpRegistryAgentIds", () => {
  it("returns each registry agent id once", async () => {
    const fetch = respond({
      agents: [{ id: "claude-acp" }, { id: "goose" }, { id: "goose" }, {}],
    });
    await expect(fetchAcpRegistryAgentIds({ fetch })).resolves.toEqual([
      "claude-acp",
      "goose",
    ]);
  });

  it("returns null when the registry can't be read", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      fetchAcpRegistryAgentIds({ fetch: respond({}, 503) }),
    ).resolves.toBeNull();
    await expect(
      fetchAcpRegistryAgentIds({ fetch: respond({ agents: "x" }) }),
    ).resolves.toBeNull();
    await expect(
      fetchAcpRegistryAgentIds({
        fetch: vi.fn(async () => {
          throw new Error("offline");
        }),
      }),
    ).resolves.toBeNull();
  });
});
