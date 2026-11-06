const REPO_API_URL = "https://api.github.com/repos/get-bb/bb";
export const LAST_KNOWN_GITHUB_STARS = 4891;
const TIMEOUT_MS = 3000;

export async function fetchGitHubStars({
  fetch: fetchImpl = fetch,
  token,
}: {
  fetch?: typeof fetch;
  token?: string;
} = {}): Promise<number> {
  try {
    const response = await fetchImpl(REPO_API_URL, {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "getbb.app-build",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      console.warn(
        `GitHub stars: ${REPO_API_URL} returned ${response.status}; using the last known count, ${LAST_KNOWN_GITHUB_STARS}`,
      );
      return LAST_KNOWN_GITHUB_STARS;
    }
    const body: unknown = await response.json();
    const count =
      typeof body === "object" && body !== null
        ? (body as { stargazers_count?: unknown }).stargazers_count
        : undefined;
    if (
      typeof count !== "number" ||
      !Number.isSafeInteger(count) ||
      count < 0
    ) {
      console.warn(
        `GitHub stars: no stargazers_count; using the last known count, ${LAST_KNOWN_GITHUB_STARS}`,
      );
      return LAST_KNOWN_GITHUB_STARS;
    }
    return count;
  } catch (error) {
    console.warn(
      `GitHub stars: ${error instanceof Error ? error.message : String(error)}; using the last known count, ${LAST_KNOWN_GITHUB_STARS}`,
    );
    return LAST_KNOWN_GITHUB_STARS;
  }
}
