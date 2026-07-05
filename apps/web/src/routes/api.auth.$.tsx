import { createFileRoute } from "@tanstack/react-router";
import { createAuth } from "@/server/auth";
import { getEnv } from "@/server/env";

// better-auth owns everything under /api/auth (OAuth start, callback, session, sign-out).
const handle = ({ request }: { request: Request }) => createAuth(getEnv()).handler(request);

export const Route = createFileRoute("/api/auth/$")({
  server: { handlers: { GET: handle, POST: handle } },
});
