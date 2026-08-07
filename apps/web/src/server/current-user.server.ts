import { getRequest } from "@tanstack/react-start/server";
import { createAuth } from "./auth.js";
import { getEnv } from "./env.js";

// `.server.ts`: server-only. Never import from client code — only from server
// functions / route handlers. Holds the request-bound session lookup.

/** The authenticated user id for the current request, or null. */
export async function getSessionUserId(): Promise<string | null> {
  const env = getEnv();
  const request = getRequest();
  const auth = createAuth(env);
  const session = await auth.api.getSession({ headers: request.headers });
  return session?.user?.id ?? null;
}
