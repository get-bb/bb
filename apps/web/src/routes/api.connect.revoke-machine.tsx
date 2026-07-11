import { createFileRoute } from "@tanstack/react-router";
import { depsFromEnv, revokeMachineForServerCredential } from "@/server/api";
import { getEnv } from "@/server/env";

export const Route = createFileRoute("/api/connect/revoke-machine")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const credential = request.headers.get("x-bb-connect-machine") ?? "";
        const body = (await request.json().catch(() => ({}))) as {
          machineId?: string;
        };
        if (!body.machineId) {
          return Response.json(
            { error: "missing-machine-id" },
            { status: 400 },
          );
        }
        const result = await revokeMachineForServerCredential(
          depsFromEnv(getEnv()),
          credential,
          body.machineId,
        );
        if ("status" in result) {
          return Response.json(
            { error: result.error },
            { status: result.status },
          );
        }
        return Response.json(result);
      },
    },
  },
});
