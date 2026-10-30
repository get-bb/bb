import { createFileRoute } from "@tanstack/react-router";

async function serveLlmsIndex(): Promise<Response> {
  const { docsLlms } = await import("../docs/source");
  return new Response(docsLlms.index(), {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export const Route = createFileRoute("/llms.txt")({
  server: { handlers: { GET: serveLlmsIndex, HEAD: serveLlmsIndex } },
});
