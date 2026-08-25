type AuthFetch = (request: Request) => Promise<Response>;

interface HeadersWithGetSetCookie extends Headers {
  getSetCookie(): string[];
}

function hasGetSetCookie(headers: Headers): headers is HeadersWithGetSetCookie {
  return (
    "getSetCookie" in headers && typeof headers.getSetCookie === "function"
  );
}

function getSetCookies(headers: Headers): string[] {
  // Node implements the standard API; the Workerd types/runtime expose the
  // older getAll API for preserving separate Set-Cookie field values.
  return hasGetSetCookie(headers)
    ? headers.getSetCookie()
    : headers.getAll("set-cookie");
}

/** Let the account worker's Better Auth route own refresh and cookie policy. */
export async function refreshAccountSessionCookies(
  cookieHeader: string,
  accountAppUrl: string,
  authFetch: AuthFetch,
): Promise<string[] | null> {
  try {
    const url = new URL("/api/auth/get-session", accountAppUrl);
    url.searchParams.set("disableCookieCache", "true");
    const response = await authFetch(
      new Request(url, { headers: { cookie: cookieHeader } }),
    );
    if (!response.ok) return null;

    const body: unknown = await response.json();
    if (
      typeof body !== "object" ||
      body === null ||
      !("session" in body) ||
      !("user" in body)
    ) {
      return null;
    }
    const setCookies = getSetCookies(response.headers);
    return setCookies.length === 0 ? null : setCookies;
  } catch (error) {
    console.error("bb connect: session refresh failed", error);
    return null;
  }
}
