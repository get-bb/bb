import { createFileRoute } from "@tanstack/react-router";
import {
  connectApiResponse,
  depsFromEnv,
  redeemConnectCode,
} from "@/server/api";
import { getEnv } from "@/server/env";

export const Route = createFileRoute("/api/connect/redeem")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => ({}))) as {
          code?: string;
        };
        const result = await redeemConnectCode(
          depsFromEnv(getEnv()),
          body.code ?? "",
        );
        return connectApiResponse(result);
      },
    },
  },
});
