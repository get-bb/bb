import { z } from "zod";
import { createFileRoute } from "@tanstack/react-router";
import { connectApiResponse, redeemMachineCode } from "@/server/api";
import { depsFromEnv } from "@/server/deps";
import { getEnv } from "@/server/env";

export const Route = createFileRoute("/api/connect/redeem-machine")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = z
          .object({
            code: z.string(),
            deviceName: z.string().trim().min(1).max(128).optional(),
          })
          .safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
          return Response.json({ error: "invalid-request" }, { status: 400 });
        }
        const result = await redeemMachineCode(
          depsFromEnv(getEnv()),
          parsed.data.code,
          parsed.data.deviceName ?? null,
        );
        return connectApiResponse(result);
      },
    },
  },
});
