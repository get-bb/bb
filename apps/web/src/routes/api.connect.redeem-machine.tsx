import { createFileRoute } from "@tanstack/react-router";
import { redeemMachineCode } from "@/server/api";
import { getEnv } from "@/server/env";

// Unauthenticated by design — the machine-pair code is the credential. Called by
// the daemon join to obtain its bb-connect machine credential.
export const Route = createFileRoute("/api/connect/redeem-machine")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => ({}))) as { code?: string };
        const result = await redeemMachineCode(getEnv(), body.code ?? "");
        if ("error" in result) {
          return Response.json({ error: result.error }, { status: result.status });
        }
        return Response.json(result);
      },
    },
  },
});
