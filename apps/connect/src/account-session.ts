type AuthFetch = (request: Request) => Promise<Response>;

export function getSetCookies(headers: Headers): string[] {
  return headers.getSetCookie();
}

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
