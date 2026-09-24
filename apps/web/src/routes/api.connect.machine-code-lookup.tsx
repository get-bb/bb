import { createFileRoute } from "@tanstack/react-router";
import { serverCredentialFromHeaders } from "@bb/connect-db";
import { readJsonObject } from "@/server/account";
import {
  depsFromEnv,
  lookupMachineCodeForServerCredential,
} from "@/server/api";
import { getEnv } from "@/server/env";

export const Route = createFileRoute("/api/connect/machine-code-lookup")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await readJsonObject(request);
        const code = typeof body.code === "string" ? body.code : "";
        if (code.trim() === "") {
          return Response.json({ error: "missing-code" }, { status: 400 });
        }
        const result = await lookupMachineCodeForServerCredential(
          depsFromEnv(getEnv()),
          serverCredentialFromHeaders(request.headers),
          code,
        );
        return Response.json(result, {
          status: "status" in result ? result.status : 200,
        });
      },
    },
  },
});
