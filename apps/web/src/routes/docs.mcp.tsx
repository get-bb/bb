import { createFileRoute } from "@tanstack/react-router";

async function serveDocsMcp({
  request,
}: {
  request: Request;
}): Promise<Response> {
  const { docsMcpHandler } = await import("../docs/server");
  return docsMcpHandler().fetch(request);
}

export const Route = createFileRoute("/docs/mcp")({
  server: {
    handlers: { GET: serveDocsMcp, POST: serveDocsMcp, DELETE: serveDocsMcp },
  },
});
