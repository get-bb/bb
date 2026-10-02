// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("./app"));

const source = {
  kind: "thread-storage" as const,
  threadId: "thr_1",
  environmentId: "env_1",
  projectId: null,
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn(() => "blob:pdf-preview"),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PDF file opener", () => {
  it("registers for PDF files", () => {
    expect(app.fileOpeners).toHaveLength(1);
    expect(app.fileOpeners[0]).toMatchObject({
      id: "pdf",
      title: "PDF viewer",
      extensions: ["pdf"],
    });
  });

  it("loads a storage PDF once into a revoked object URL and leaves the viewer unsandboxed", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(new Uint8Array([37, 80, 68, 70]), {
        headers: { "content-type": "application/pdf" },
      }),
    );
    const slot = renderSlot(app.fileOpeners[0]!, {
      path: "reports/quarter one.pdf",
      source,
      Original: () => <div>Built-in preview</div>,
    });

    const frame = await waitFor(() => {
      const element = slot.container.querySelector("iframe");
      expect(element).toBeTruthy();
      return element as HTMLIFrameElement;
    });

    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/threads/thr_1/thread-storage/files/reports/quarter%20one.pdf",
      expect.objectContaining({ credentials: "same-origin" }),
    );
    expect(frame.getAttribute("src")).toBe("blob:pdf-preview");
    expect(frame.getAttribute("title")).toBe("reports/quarter one.pdf");
    expect(frame.hasAttribute("sandbox")).toBe(false);
    expect(URL.createObjectURL).toHaveBeenCalledOnce();

    fireEvent.load(frame);
    await waitFor(() =>
      expect(
        slot.queryByLabelText("Rendering reports/quarter one.pdf"),
      ).toBeNull(),
    );
    slot.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:pdf-preview");
  });

  it("rejects a non-PDF response before creating an unsandboxed frame", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response("<script>parent.pwned = true</script>", {
        headers: { "content-type": "text/html" },
      }),
    );
    const slot = renderSlot(app.fileOpeners[0]!, {
      path: "spoofed.pdf",
      source,
      Original: () => null,
    });

    expect((await slot.findByRole("alert")).textContent).toMatch(
      /response was not a PDF/i,
    );
    expect(slot.container.querySelector("iframe")).toBeNull();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});
