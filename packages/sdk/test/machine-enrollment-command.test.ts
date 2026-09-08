import { expect, it } from "vitest";
import { createBbSdk } from "../src/core.js";
import { createHttpTransport } from "../src/transport-http.js";

it("distinguishes thread command resolution from an exact consumed launch", async () => {
  const urls: URL[] = [];
  const sdk = createBbSdk({
    transport: createHttpTransport({
      baseUrl: "http://bb.test",
      runtime: "node",
      fetch: async (url) => {
        const requestUrl = new URL(String(url));
        urls.push(requestUrl);
        return Response.json({
          command:
            requestUrl.searchParams.get("scope") === "thread"
              ? "replacement-command"
              : null,
        });
      },
    }),
  });
  expect(
    await sdk.hosts.experimental_enrollmentCommand({ id: "thread" }),
  ).toEqual({ command: null });
  expect(
    await sdk.hosts.experimental_enrollmentCommand({
      id: "thread",
      scope: "thread",
    }),
  ).toEqual({ command: "replacement-command" });
  expect(urls.map((url) => url.pathname)).toEqual([
    "/api/v1/hosts/launches/thread/enrollment-command",
    "/api/v1/hosts/launches/thread/enrollment-command",
  ]);
  expect(urls.map((url) => url.search)).toEqual(["", "?scope=thread"]);
});
