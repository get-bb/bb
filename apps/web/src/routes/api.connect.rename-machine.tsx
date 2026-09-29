import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  connectApiResponse,
  depsFromEnv,
  renameMachineForServerCredential,
} from "@/server/api";
import { getEnv } from "@/server/env";

export const Route = createFileRoute("/api/connect/rename-machine")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const credential = request.headers.get("x-bb-connect-machine") ?? "";
        const body = z
          .object({
            machineId: z.string().min(1),
            name: z.string().trim().min(1).max(120),
          })
          .safeParse(await request.json().catch(() => null));
        if (!body.success) {
          return Response.json({ error: "invalid-request" }, { status: 400 });
        }
        const result = await renameMachineForServerCredential(
          depsFromEnv(getEnv()),
          credential,
          body.data.machineId,
          body.data.name,
        );
        return connectApiResponse(result);
      },
    },
  },
});
