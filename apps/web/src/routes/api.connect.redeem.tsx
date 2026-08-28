import { createFileRoute } from "@tanstack/react-router";
import { depsFromEnv, redeemConnectCode } from "@/server/api";
import { getEnv } from "@/server/env";
import { z } from "zod";

const redeemCodeSchema = z.object({ code: z.string() });

function readRedeemCode<T>(value: T): string {
  const result = redeemCodeSchema.safeParse(value);
  return result.success ? result.data.code : "";
}

export const Route = createFileRoute("/api/connect/redeem")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const code = await request
          .json()
          .then(readRedeemCode)
          .catch(() => "");
        const result = await redeemConnectCode(depsFromEnv(getEnv()), code);
        if ("error" in result) {
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
