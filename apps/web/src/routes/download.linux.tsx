import { createFileRoute } from "@tanstack/react-router";
import { waitUntil } from "cloudflare:workers";
import { handleDownload } from "@/landing/endpoints";
import { getEnv } from "@/server/env";

export const Route = createFileRoute("/download/linux")({
  server: {
    handlers: {
      GET: ({ request }) =>
        handleDownload("linux", request, getEnv(), waitUntil),
    },
  },
});
