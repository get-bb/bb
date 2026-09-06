import { describe, expect, it } from "vitest";
import {
  browserUrlMatches,
  assembleBrowserCapture,
  decodeBrowserCaptureChunk,
  browserClientStateMessageSchema,
  browserControlActionSchema,
  browserOpenTabRequestMessageSchema,
  browserOpenTabResponseMessageSchema,
  browserPluginRequestMessageSchema,
  browserPluginResponseMessageSchema,
  isAllowedBrowserNavigationUrl,
} from "../src/browser-control.js";
const target = {
  clientId: "client-a",
  windowId: "window-a",
  tabId: "tab-a",
  navigationEpoch: 0,
};

it("matches glob suffixes after repeated text without overlapping fixed segments", () => {
  expect(browserUrlMatches("https://example.test/a/a", "*/a", "glob")).toBe(
    true,
  );
  expect(browserUrlMatches("aaa", "aa*aa", "glob")).toBe(false);
});
describe("Bounded Browser capture downloads", () => {
  const descriptor = {
    captureId: "capture",
    format: "png" as const,
    pixelSize: { width: 500, height: 350 },
    byteLength: 700_000,
  };

  it("rejects a foreign resource without releasing that foreign identity", async () => {
    const released: string[] = [];
    await expect(
      assembleBrowserCapture({
        descriptor,
        read: async () => ({
          captureId: "foreign",
          offset: 0,
          base64: "AQ==",
          eof: false,
        }),
        release: async () => {
          released.push(descriptor.captureId);
        },
      }),
    ).rejects.toThrow();
    expect(released).toEqual([descriptor.captureId]);
  });

  it("preserves the read failure when resource release also fails", async () => {
    const readError = new Error("Read failed");
    const releaseError = new Error("Release failed");
    await expect(
      assembleBrowserCapture({
        descriptor,
        read: async () => {
          throw readError;
        },
        release: async () => {
          throw releaseError;
        },
      }),
    ).rejects.toMatchObject({ errors: [readError, releaseError] });
  });
  it("assembles decoded offsets without corruption and releases once", async () => {
    const source = Uint8Array.from(
      { length: descriptor.byteLength },
      (_, i) => i % 251,
    );
    let releases = 0;
    const bytes = await assembleBrowserCapture({
      descriptor,
      read: async ({ captureId, offset, length }) => {
        let binary = "";
        for (const byte of source.subarray(offset, offset + length)) {
          binary += String.fromCharCode(byte);
        }
        return {
          captureId,
          offset,
          base64: btoa(binary),
          eof: offset + length === source.length,
        };
      },
      release: async () => {
        releases += 1;
      },
    });
    expect(bytes.length).toBe(source.length);
    expect(bytes.every((byte, index) => byte === source[index])).toBe(true);
    expect(releases).toBe(1);
  });

  it("rejects oversized decoded ranges even when total allocation would fit", () => {
    expect(() =>
      decodeBrowserCaptureChunk(
        {
          captureId: "capture",
          offset: 0,
          base64: "AAAA".repeat(100_000),
          eof: false,
        },
        { captureId: "capture", offset: 0, length: 262_144 },
        700_000,
      ),
    ).toThrow();
  });

  it("rejects malformed and noncanonical base64 instead of ignoring invalid bytes", () => {
    for (const base64 of ["AQID!!!!", "AR=="]) {
      expect(() =>
        decodeBrowserCaptureChunk(
          {
            captureId: "capture",
            offset: 0,
            base64,
            eof: true,
          },
          { captureId: "capture", offset: 0, length: 3 },
          3,
        ),
      ).toThrow();
    }
  });

  it("releases an owned resource when its descriptor is invalid", async () => {
    let releases = 0;
    await expect(
      assembleBrowserCapture({
        descriptor: { ...descriptor, byteLength: 3.9 },
        read: async () => {
          throw new Error("Unexpected read");
        },
        release: async () => {
          releases += 1;
        },
      }),
    ).rejects.toThrow();
    expect(releases).toBe(1);
  });

  it("aborts a pending read without accepting its late bytes", async () => {
    const controller = new AbortController();
    let releases = 0;
    await expect(
      assembleBrowserCapture({
        descriptor,
        signal: controller.signal,
        read: async ({ captureId, offset }) => {
          controller.abort();
          return { captureId, offset, base64: "AQID", eof: true };
        },
        release: async () => {
          releases += 1;
        },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(releases).toBe(1);
  });
});

describe("Browser tab owner messages", () => {
  it("advertises a panel owner before it has any tabs", () => {
    expect(
      browserClientStateMessageSchema.parse({
        type: "browser-client-state",
        clientId: target.clientId,
        windowId: target.windowId,
        active: true,
        canActivateThreadOwner: true,
        tabs: [],
        controllers: [],
        owners: [
          {
            ownerId: "owner-a",
            threadId: "thread-a",
            projectId: "project-a",
            active: true,
          },
        ],
      }),
    ).toMatchObject({ tabs: [], owners: [{ ownerId: "owner-a" }] });
  });
  it("accepts inactive tab inventory entries without actionable state", () => {
    const state = browserClientStateMessageSchema.parse({
      type: "browser-client-state",
      clientId: target.clientId,
      windowId: target.windowId,
      active: true,
      canActivateThreadOwner: false,
      owners: [],
      controllers: [],
      tabs: [
        {
          tabId: "tab-inactive",
          threadId: "thread-a",
          projectId: "project-a",
          url: "https://example.test/",
          title: "Inactive",
          connected: false,
          active: false,
          navigationEpoch: 0,
        },
      ],
    });
    expect(state.tabs[0]).toMatchObject({
      tabId: "tab-inactive",
      connected: false,
      active: false,
    });
  });

  it("requires unique controller registration identities in client state", () => {
    const state = {
      type: "browser-client-state",
      clientId: target.clientId,
      windowId: target.windowId,
      active: true,
      canActivateThreadOwner: true,
      tabs: [],
      owners: [],
      controllers: [
        {
          pluginId: "plugin-a",
          controllerId: "controller-a",
          tabId: target.tabId,
          registrationId: "00000000-0000-4000-8000-000000000001",
        },
      ],
    };
    expect(browserClientStateMessageSchema.safeParse(state).success).toBe(true);
    expect(
      browserClientStateMessageSchema.safeParse({
        ...state,
        controllers: [...state.controllers, state.controllers[0]],
      }).success,
    ).toBe(false);
  });

  it("requires controller generation provenance on plugin wire messages", () => {
    const request = {
      type: "browser-plugin-request",
      requestId: "request-a",
      pluginId: "plugin-a",
      controllerId: "controller-a",
      registrationId: "00000000-0000-4000-8000-000000000001",
      target,
      input: null,
    };
    const response = {
      type: "browser-plugin-response",
      requestId: request.requestId,
      pluginId: request.pluginId,
      controllerId: request.controllerId,
      registrationId: request.registrationId,
      ok: true,
      value: null,
    };
    expect(browserPluginRequestMessageSchema.safeParse(request).success).toBe(
      true,
    );
    expect(browserPluginResponseMessageSchema.safeParse(response).success).toBe(
      true,
    );
    const { registrationId: _requestRegistrationId, ...missingRequest } =
      request;
    const { registrationId: _responseRegistrationId, ...missingResponse } =
      response;
    expect(
      browserPluginRequestMessageSchema.safeParse(missingRequest).success,
    ).toBe(false);
    expect(
      browserPluginResponseMessageSchema.safeParse(missingResponse).success,
    ).toBe(false);
  });

  it("binds targetless open requests and responses to an exact owner", () => {
    const request = browserOpenTabRequestMessageSchema.parse({
      type: "browser-open-tab-request",
      mode: "owner",
      requestId: "request-a",
      clientId: target.clientId,
      windowId: target.windowId,
      ownerId: "owner-a",
      url: "file:///Users/test/page.html",
    });
    expect(request.mode).toBe("owner");
    if (request.mode !== "owner") {
      throw new Error("Expected owner-bound Browser open request");
    }
    expect(request.ownerId).toBe("owner-a");
    expect(
      browserOpenTabResponseMessageSchema.parse({
        type: "browser-open-tab-response",
        requestId: request.requestId,
        clientId: request.clientId,
        windowId: request.windowId,
        ownerId: request.ownerId,
        ok: true,
        target,
      }),
    ).toMatchObject({ ok: true, target });
    expect(
      browserOpenTabResponseMessageSchema.safeParse({
        type: "browser-open-tab-response",
        requestId: request.requestId,
        clientId: request.clientId,
        windowId: request.windowId,
        ownerId: request.ownerId,
        ok: true,
      }).success,
    ).toBe(false);
  });
});
describe("Browser automation boundaries", () => {
  it("rejects executable and credentialed file navigation", () => {
    expect(isAllowedBrowserNavigationUrl("https://example.test/")).toBe(true);
    expect(isAllowedBrowserNavigationUrl("file:///Users/test/page.html")).toBe(
      true,
    );
    expect(isAllowedBrowserNavigationUrl("javascript:alert(1)")).toBe(false);
    expect(
      isAllowedBrowserNavigationUrl(
        "file://user:password@localhost/Users/test/page.html",
      ),
    ).toBe(false);
  });

  it("parses expanded Browser actions and enforces destructive confirmation", () => {
    expect(
      [
        {
          kind: "upload",
          locator: {
            frame: { frameId: "frame-a", documentEpoch: 1 },
            role: "textbox",
            name: "Upload",
          },
          files: [
            {
              name: "input.txt",
              mimeType: "text/plain",
              base64: "aGVsbG8=",
            },
          ],
        },
        {
          kind: "wait",
          criteria: { kind: "text", text: "Complete" },
        },
        {
          kind: "set-dialog-handler",
          behavior: "accept",
          promptText: "approved",
        },
        { kind: "list-cookie-import-sources" },
        {
          kind: "import-cookies-from-browser",
          family: "chrome",
          profileId: "Default",
        },
        { kind: "clear-imported-cookies", confirm: true },
      ].every((action) => browserControlActionSchema.safeParse(action).success),
    ).toBe(true);
    expect(
      browserControlActionSchema.safeParse({
        kind: "clear-imported-cookies",
        confirm: false,
      }).success,
    ).toBe(false);
  });
});
