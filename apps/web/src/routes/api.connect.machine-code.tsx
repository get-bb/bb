import { createFileRoute } from "@tanstack/react-router";
import {
  connectApiResponse,
  createMachineCodeForServerCredential,
  lookupMachineCodeForServerCredential,
} from "@/server/api";
import { depsFromEnv } from "@/server/deps";
import { getEnv } from "@/server/env";

export const Route = createFileRoute("/api/connect/machine-code")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const result = await lookupMachineCodeForServerCredential(
          depsFromEnv(getEnv()),
          request.headers.get("x-bb-connect-machine") ?? "",
          request.headers.get("x-bb-connect-code") ?? "",
        );
        return Response.json(result, {
          status: "status" in result ? result.status : 200,
        });
      },
      POST: async ({ request }) => {
        const credential = request.headers.get("x-bb-connect-machine") ?? "";
        const result = await createMachineCodeForServerCredential(
          depsFromEnv(getEnv()),
          credential,
        );
        return connectApiResponse(result);
      },
    },
  },
});
