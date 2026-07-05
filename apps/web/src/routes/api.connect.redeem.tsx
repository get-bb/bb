import { createFileRoute } from "@tanstack/react-router";
import { redeemConnectCode } from "@/server/api";
import { getEnv } from "@/server/env";

// Unauthenticated by design — the connect code itself is the credential.
// Stays a plain HTTP endpoint because the external tunnel client calls it.
export const Route = createFileRoute("/api/connect/redeem")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => ({}))) as { code?: string };
        const result = await redeemConnectCode(getEnv(), body.code ?? "");
        if ("error" in result) {
          return Response.json({ error: result.error }, { status: result.status });
        }
        return Response.json(result);
      },
    },
  },
});
