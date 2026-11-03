import { createFileRoute } from "@tanstack/react-router";
import { getEnv } from "@/server/env";
import { gateKeysResponse } from "@/server/gate-keys";

export const Route = createFileRoute("/.well-known/bb-connect-gate-keys.json")({
  server: {
    handlers: {
      GET: () => gateKeysResponse(getEnv()),
    },
  },
});
