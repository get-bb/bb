import { createFileRoute } from "@tanstack/react-router";

async function serveLlmsFull(): Promise<Response> {
  const { docsLlms } = await import("../docs/source");
  return new Response(await docsLlms.full(), {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export const Route = createFileRoute("/llms-full.txt")({
  server: { handlers: { GET: serveLlmsFull, HEAD: serveLlmsFull } },
});
