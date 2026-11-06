import { z } from "zod";
import { createFileRoute } from "@tanstack/react-router";
import { MACHINE_KINDS } from "@bb/connect-db";
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
            kind: z.enum(MACHINE_KINDS).optional(),
          })
          .safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
          return Response.json({ error: "invalid-request" }, { status: 400 });
        }
        const result = await redeemMachineCode(
          depsFromEnv(getEnv()),
          parsed.data.code,
          {
            name: parsed.data.deviceName ?? null,
            kind: parsed.data.kind ?? null,
          },
        );
        return connectApiResponse(result);
      },
    },
  },
});
