import { createFileRoute } from "@tanstack/react-router";
import {
  accountApiResponse,
  pollServerLink,
  readJsonObject,
} from "@/server/account";
import { depsFromEnv } from "@/server/api";
import { getEnv } from "@/server/env";

export const Route = createFileRoute("/api/account/link/poll")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await readJsonObject(request);
        return accountApiResponse(
          await pollServerLink(depsFromEnv(getEnv()), body.deviceCode),
        );
      },
    },
  },
});
