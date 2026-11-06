const REGISTRY_URL =
  "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";
const TIMEOUT_MS = 3000;

export async function fetchAcpRegistryAgentIds({
  fetch: fetchImpl = fetch,
}: { fetch?: typeof fetch } = {}): Promise<string[] | null> {
  try {
    const response = await fetchImpl(REGISTRY_URL, {
      headers: { "user-agent": "getbb.app-build" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      console.warn(
        `ACP registry: ${REGISTRY_URL} returned ${response.status}; building without an agent count`,
      );
      return null;
    }
    const body: unknown = await response.json();
    const agents =
      typeof body === "object" && body !== null
        ? (body as { agents?: unknown }).agents
        : undefined;
    if (!Array.isArray(agents)) {
      console.warn("ACP registry: no agents list; building without an agent count");
      return null;
    }
    const ids = new Set<string>();
    for (const agent of agents) {
      const id =
        typeof agent === "object" && agent !== null
          ? (agent as { id?: unknown }).id
          : undefined;
      if (typeof id === "string" && id !== "") ids.add(id);
    }
    return ids.size > 0 ? [...ids] : null;
  } catch (error) {
    console.warn(
      `ACP registry: ${error instanceof Error ? error.message : String(error)}; building without an agent count`,
    );
    return null;
  }
}
