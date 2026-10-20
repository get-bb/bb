import { createFileRoute } from "@tanstack/react-router";
import { handleInstallerDownload } from "@/landing/endpoints";

export const Route = createFileRoute("/install_/$platform/file")({
  server: {
    handlers: {
      GET: ({ request, params }) => {
        const { platform } = params;
        if (
          platform !== "macos" &&
          platform !== "windows" &&
          platform !== "linux"
        ) {
          return new Response("Not found", { status: 404 });
        }
        return handleInstallerDownload(platform, request);
      },
    },
  },
});
