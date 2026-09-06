import { beforeEach, expect, it, vi } from "vitest";
import { resolveNativeApplicationIconDataUrl } from "./native-application-icon.js";
import { decodeCodexInteractiveRequest } from "./interactive-requests.js";
import { resolveCodexMcpElicitationAppIcon } from "./mcp-elicitation-host.js";
import computerUseElicitation from "./fixtures/computer-use-elicitation.json";

vi.mock("./native-application-icon.js", () => ({
  resolveNativeApplicationIconDataUrl: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(resolveNativeApplicationIconDataUrl).mockReset();
});

it("uses the native host bundle ID and includes its icon in the outgoing interaction", async () => {
  const iconDataUrl = "data:image/png;base64,aWNvbg==";
  vi.mocked(resolveNativeApplicationIconDataUrl).mockResolvedValue(iconDataUrl);
  const request = decodeCodexInteractiveRequest(computerUseElicitation);
  if (request === null) throw new Error("Expected Computer Use request");
  const result = await resolveCodexMcpElicitationAppIcon(request);
  expect(resolveNativeApplicationIconDataUrl).toHaveBeenCalledExactlyOnceWith(
    "com.apple.calculator",
  );
  expect(result.payload).toMatchObject({
    data: {
      app: { id: "com.apple.calculator", name: "Calculator", iconDataUrl },
    },
  });
  expect(request.payload).toMatchObject({
    data: { app: { iconDataUrl: null } },
  });
});

it.each([null, new Error("Native application registry unavailable")])(
  "keeps the permission usable when icon resolution fails: %s",
  async (failure) => {
    if (failure === null)
      vi.mocked(resolveNativeApplicationIconDataUrl).mockResolvedValue(null);
    else
      vi.mocked(resolveNativeApplicationIconDataUrl).mockRejectedValue(failure);
    const request = decodeCodexInteractiveRequest(computerUseElicitation);
    if (request === null) throw new Error("Expected Computer Use request");
    expect(await resolveCodexMcpElicitationAppIcon(request)).toEqual(request);
  },
);

it("does not resolve icons for ordinary MCP forms", async () => {
  const request = decodeCodexInteractiveRequest({
    ...computerUseElicitation,
    params: { ...computerUseElicitation.params, _meta: null },
  });
  if (request === null) throw new Error("Expected form request");
  expect(await resolveCodexMcpElicitationAppIcon(request)).toBe(request);
  expect(resolveNativeApplicationIconDataUrl).not.toHaveBeenCalled();
});
