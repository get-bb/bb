// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { SealedConnection } from "./connection";
import {
  installSealedMediaSweep,
  needsSealedMedia,
  useSealedMediaUrl,
} from "./media";
import { setActiveSealedConnection } from "./status";

function fakeConnection(): SealedConnection {
  return {
    origin: window.location.origin,
    getState: () => ({
      kind: "ready",
      deviceId: "dev_x",
      fingerprint: "F",
      verified: true,
    }),
    subscribe: () => () => {},
  } as unknown as SealedConnection;
}

describe("sealed media", () => {
  afterEach(() => {
    setActiveSealedConnection(null);
    vi.restoreAllMocks();
  });

  it("releases swept blob URLs when the element is removed or its source changes", async () => {
    setActiveSealedConnection(fakeConnection());
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response("png", { status: 200 }),
    );
    let counter = 0;
    vi.spyOn(URL, "createObjectURL").mockImplementation(
      () => `blob:swept-${(counter += 1)}`,
    );
    const revoke = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined);
    const uninstall = installSealedMediaSweep();
    const image = document.createElement("img");
    image.setAttribute("src", "/api/v1/threads/t/thread-storage/files/s1.png");
    document.body.append(image);
    await vi.waitFor(() =>
      expect(image.getAttribute("src")).toBe("blob:swept-1"),
    );
    image.setAttribute("src", "/api/v1/threads/t/thread-storage/files/s2.png");
    await vi.waitFor(() =>
      expect(image.getAttribute("src")).toBe("blob:swept-2"),
    );
    await vi.waitFor(() => expect(revoke).toHaveBeenCalledWith("blob:swept-1"));
    image.remove();
    await vi.waitFor(() => expect(revoke).toHaveBeenCalledWith("blob:swept-2"));
    uninstall();
  });

  it("drops responsive srcset candidates that point at same-origin API media", async () => {
    setActiveSealedConnection(fakeConnection());
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("png", { status: 200 }),
    );
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:sealed-r");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const uninstall = installSealedMediaSweep();
    const picture = document.createElement("picture");
    const source = document.createElement("source");
    source.setAttribute(
      "srcset",
      "/api/v1/threads/t/thread-storage/files/r.png 1x, /api/v1/threads/t/thread-storage/files/r@2x.png 2x",
    );
    const image = document.createElement("img");
    image.setAttribute("src", "/api/v1/threads/t/thread-storage/files/r.png");
    picture.append(source, image);
    document.body.append(picture);
    await vi.waitFor(() => expect(source.getAttribute("srcset")).toBe(""));
    await vi.waitFor(() =>
      expect(image.getAttribute("src")).toBe("blob:sealed-r"),
    );
    const external = document.createElement("img");
    external.setAttribute("srcset", "https://example.com/a.png 1x");
    document.body.append(external);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(external.getAttribute("srcset")).toBe(
      "https://example.com/a.png 1x",
    );
    picture.remove();
    external.remove();
    uninstall();
  });

  it("routes clicks on same-origin API download links through the sealed fetch instead of navigating", async () => {
    setActiveSealedConnection(fakeConnection());
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("bytes", { status: 200 }));
    const createSpy = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:sealed-download");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const uninstall = installSealedMediaSweep();
    const anchor = document.createElement("a");
    anchor.href = "/api/v1/plugins/tasks/http/attachments/download?id=att_1";
    anchor.download = "report.pdf";
    document.body.append(anchor);
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    anchor.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(createSpy).toHaveBeenCalled());
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(
      "/api/v1/plugins/tasks/http/attachments/download?id=att_1",
    );
    const modified = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      metaKey: true,
    });
    anchor.dispatchEvent(modified);
    expect(modified.defaultPrevented).toBe(true);
    const middle = new MouseEvent("auxclick", {
      bubbles: true,
      cancelable: true,
      button: 1,
    });
    anchor.dispatchEvent(middle);
    expect(middle.defaultPrevented).toBe(true);
    anchor.remove();
    uninstall();

    const external = document.createElement("a");
    external.href = "https://example.com/file.pdf";
    document.body.append(external);
    const untouched = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    });
    external.dispatchEvent(untouched);
    expect(untouched.defaultPrevented).toBe(false);
    external.remove();
  });

  it("passes URLs through when no sealed connection is active", () => {
    expect(
      needsSealedMedia("/api/v1/threads/t/thread-storage/files/a.png"),
    ).toBe(false);
    const { result } = renderHook(() => useSealedMediaUrl("/api/v1/x.png"));
    expect(result.current).toEqual({ kind: "ready", url: "/api/v1/x.png" });
  });

  it("loads same-origin API media through fetch and hands out a blob URL that is revoked on unmount", async () => {
    setActiveSealedConnection(fakeConnection());
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("png", { status: 200 }));
    const createSpy = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:sealed-1");
    const revokeSpy = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    expect(
      needsSealedMedia("/api/v1/threads/t/thread-storage/files/a.png"),
    ).toBe(true);
    expect(needsSealedMedia("https://cdn.example/a.png")).toBe(false);
    expect(needsSealedMedia("/assets/logo.png")).toBe(false);
    const { result, unmount } = renderHook(() =>
      useSealedMediaUrl("/api/v1/threads/t/thread-storage/files/a.png"),
    );
    expect(result.current).toEqual({ kind: "loading" });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() =>
      expect(result.current).toEqual({ kind: "ready", url: "blob:sealed-1" }),
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(createSpy).toHaveBeenCalledTimes(1);
    unmount();
    expect(revokeSpy).toHaveBeenCalledWith("blob:sealed-1");
  });

  it("reports an error instead of falling back to a plaintext URL", async () => {
    setActiveSealedConnection(fakeConnection());
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("nope", { status: 403 }),
    );
    const { result } = renderHook(() =>
      useSealedMediaUrl("/api/v1/file-previews/lease/x.png"),
    );
    await vi.waitFor(() => expect(result.current.kind).toBe("error"));
  });
});
