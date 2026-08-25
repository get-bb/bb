type AuthFetch = (request: Request) => Promise<Response>;

/** Let the account worker's Better Auth route own refresh and cookie policy. */
export async function refreshAccountSessionCookie(
  cookieHeader: string,
  accountAppUrl: string,
  authFetch: AuthFetch,
): Promise<string | null> {
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
    return response.headers.get("set-cookie");
  } catch (error) {
    console.error("bb connect: session refresh failed", error);
    return null;
  }
}
