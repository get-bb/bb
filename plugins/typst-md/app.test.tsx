// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BbNavigate, PluginThreadPanelProps } from "@get-bb/plugin-sdk";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

const { engine, raster } = vi.hoisted(() => {
  const svg = [
    '<svg class="typst-doc" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">',
    '<g class="typst-page" transform="translate(0, 0)" data-page-width="200" data-page-height="100">',
    '<g class="typst-group"><path d="M0 0h10v10z"/></g>',
    "</g>",
    "</svg>",
  ].join("");
  return {
    engine: {
      compileTypstPdf: vi.fn(async (_request: unknown) => new Uint8Array([37, 80, 68, 70])),
      compileTypstVector: vi.fn(async (_request: unknown) => new Uint8Array([1, 2, 3])),
      renderTypstSvg: vi.fn(async (_artifact: unknown) => svg),
    },
    raster: {
      rasterizeTypstPages: vi.fn(async (_svg: unknown) => [
        new Blob(["png"], { type: "image/png" }),
      ]),
    },
  };
});

vi.mock("./lib/typst-engine.js", () => engine);
vi.mock("./lib/typst-raster.js", () => raster);

const app = await loadPluginApp(() => import("./app"));
const { resetTypstDocuments } = await import("./lib/typst-artifact.js");

afterEach(() => {
  cleanup();
  for (const frame of document.querySelectorAll("iframe")) frame.remove();
});

beforeEach(() => {
  resetTypstDocuments();
  engine.compileTypstPdf.mockClear();
  engine.compileTypstVector.mockClear();
  engine.renderTypstSvg.mockClear();
  raster.rasterizeTypstPages.mockClear();
  raster.rasterizeTypstPages.mockResolvedValue([
    new Blob(["png"], { type: "image/png" }),
  ]);
});

const message = {
  id: "msg_1",
  threadId: "thr_1",
  turnId: "turn_1",
  projectId: "proj_1",
};

const artifact = { file: "reports/report.md", content: "# Report" };

function mockDownloadEnvironment(): {
  clicks: string[];
  blobs: Blob[];
  restore: () => void;
} {
  const clicks: string[] = [];
  const blobs: Blob[] = [];
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const originalClick = HTMLAnchorElement.prototype.click;
  URL.createObjectURL = (value: Blob | MediaSource) => {
    if (value instanceof Blob) blobs.push(value);
    return "blob:typst-md";
  };
  URL.revokeObjectURL = () => {};
  HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
    clicks.push(this.download);
  };
  return {
    clicks,
    blobs,
    restore: () => {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
      HTMLAnchorElement.prototype.click = originalClick;
    },
  };
}

function renderDirective(options: {
  attributes: Record<string, string>;
  openWorkspaceFile?: ((path: string) => boolean) | null;
  openThreadPanel?: (input: Parameters<BbNavigate["openThreadPanel"]>[0]) => boolean;
  rpc: Record<string, (input: unknown) => unknown>;
}) {
  return renderSlot(
    app.messageDirectives[0]!,
    {
      attributes: options.attributes,
      source: "::typst-md{}",
      message,
      openWorkspaceFile: options.openWorkspaceFile ?? null,
    },
    {
      rpc: options.rpc,
      ...(options.openThreadPanel === undefined
        ? {}
        : { openThreadPanel: options.openThreadPanel }),
    },
  );
}

function renderPanel(options: {
  threadId?: string;
  params?: PluginThreadPanelProps["params"];
  rpc: Record<string, (input: unknown) => unknown>;
}) {
  return renderSlot(
    app.threadPanelActions[0]!,
    {
      threadId: options.threadId ?? "thr_1",
      params: options.params ?? null,
    },
    { rpc: options.rpc },
  );
}

describe("typst-md registrations", () => {
  it("registers the typst-md directive and its document panel", () => {
    expect(app.messageDirectives).toHaveLength(1);
    expect(app.messageDirectives[0]!.id).toBe("typst-md");
    expect(app.fileOpeners).toHaveLength(0);
    expect(app.threadPanelActions).toHaveLength(1);
    expect(app.threadPanelActions[0]).toMatchObject({
      id: "document",
      title: "Markdown document",
      layout: "flush",
    });
  });
});

describe("TypstMdDirective", () => {
  it("requires a file attribute without calling rpc", async () => {
    const slot = renderDirective({ attributes: {}, rpc: {} });

    await slot.findByRole("alert");
    expect(slot.getByText(/requires a file attribute/i)).toBeTruthy();
    expect(slot.rpcCalls).toEqual([]);
  });

  it("rejects an out-of-range height without calling rpc", async () => {
    const slot = renderDirective({
      attributes: { file: "report.md", height: "80" },
      rpc: {},
    });

    const alert = await slot.findByRole("alert");
    expect(alert.textContent).toMatch(/120 to 1200/);
    expect(slot.rpcCalls).toEqual([]);
  });

  it("rejects an unknown source without calling rpc", async () => {
    const slot = renderDirective({
      attributes: { file: "report.md", source: "project" },
      rpc: {},
    });

    const alert = await slot.findByRole("alert");
    expect(alert.textContent).toMatch(/must be "workspace" or "thread-storage"/);
    expect(slot.rpcCalls).toEqual([]);
  });

  it("renders the document on a sheet and opens the source in the sidebar", async () => {
    const openWorkspaceFile = vi.fn(() => true);
    const slot = renderDirective({
      attributes: { file: "reports/report.md", height: "480" },
      openWorkspaceFile,
      rpc: {
        prepareDocument: (input) => {
          expect(input).toEqual({
            source: { kind: "thread-workspace", threadId: "thr_1" },
            file: "reports/report.md",
          });
          return artifact;
        },
      },
    });

    await slot.findByRole("status", {
      name: "Rendering Markdown document reports/report.md",
    });

    const sheet = await waitFor(() => {
      const element = slot.container.querySelector("[data-typst-sheet]");
      expect(element).toBeTruthy();
      return element as HTMLElement;
    });

    expect(sheet.querySelector("svg.typst-doc")).toBeTruthy();
    const viewport = sheet.closest(
      "[data-typst-sheet-viewport]",
    ) as HTMLElement | null;
    expect(viewport?.style.height).toBe("480px");

    fireEvent.click(
      slot.getByRole("button", {
        name: "Open reports/report.md in sidebar",
      }),
    );
    expect(openWorkspaceFile).toHaveBeenCalledWith("reports/report.md");
    expect(slot.navigateCalls).toContainEqual({
      method: "openThreadPanel",
      options: {
        actionId: "document",
        title: "reports/report.md",
        params: { file: "reports/report.md", source: "workspace" },
      },
    });
    expect(slot.rpcCalls).toEqual([
      {
        method: "prepareDocument",
        input: {
          source: { kind: "thread-workspace", threadId: "thr_1" },
          file: "reports/report.md",
        },
      },
    ]);
  });

  it("toggles between the rendered document and the Markdown source", async () => {
    const slot = renderDirective({
      attributes: { file: "reports/report.md" },
      rpc: { prepareDocument: () => artifact },
    });

    await waitFor(() => {
      expect(slot.container.querySelector("[data-typst-sheet]")).toBeTruthy();
    });
    fireEvent.click(
      slot.getByRole("button", {
        name: "Show Markdown source reports/report.md",
      }),
    );
    const source = await slot.findByTestId("bb-source-code");
    expect(source.textContent).toBe("# Report");
    expect(slot.container.querySelector("[data-typst-sheet]")).toBeNull();

    fireEvent.click(
      slot.getByRole("button", { name: "Show rendered reports/report.md" }),
    );
    await waitFor(() => {
      expect(slot.container.querySelector("[data-typst-sheet]")).toBeTruthy();
    });
  });

  it("defaults the sheet height to 224 pixels", async () => {
    const slot = renderDirective({
      attributes: { file: "reports/report.md" },
      rpc: { prepareDocument: () => artifact },
    });

    const sheet = await waitFor(() => {
      const element = slot.container.querySelector("[data-typst-sheet]");
      expect(element).toBeTruthy();
      return element as HTMLElement;
    });
    const viewport = sheet.closest(
      "[data-typst-sheet-viewport]",
    ) as HTMLElement | null;
    expect(viewport?.style.height).toBe("224px");
  });

  it("compiles the converted Typst source under the document path", async () => {
    const slot = renderDirective({
      attributes: { file: "reports/report.md" },
      rpc: { prepareDocument: () => artifact },
    });

    await waitFor(() => {
      expect(slot.container.querySelector("[data-typst-sheet]")).toBeTruthy();
    });

    const request = engine.compileTypstVector.mock.calls[0]![0] as {
      mainPath: string;
      source: string;
    };
    expect(request.mainPath).toBe("/reports/report.md");
    expect(request.source).toContain("= Report");
    expect(request.source).toContain('#set page(paper: "a4", margin: 2cm)');
  });

  it("reads assets through the rpc and decodes base64 bytes", async () => {
    const slot = renderDirective({
      attributes: { file: "reports/report.md" },
      rpc: {
        prepareDocument: () => artifact,
        readAsset: (input) => {
          expect(input).toEqual({
            source: { kind: "thread-workspace", threadId: "thr_1" },
            file: "assets/logo.png",
          });
          return {
            file: "assets/logo.png",
            content: "AQID",
            contentEncoding: "base64",
          };
        },
      },
    });

    await waitFor(() => {
      expect(slot.container.querySelector("[data-typst-sheet]")).toBeTruthy();
    });

    const request = engine.compileTypstVector.mock.calls[0]![0] as {
      readDependency: (path: string) => Promise<Uint8Array>;
    };
    await expect(request.readDependency("/assets/logo.png")).resolves.toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });

  it("prefers the plugin panel over the workspace viewer when accepted", async () => {
    const openWorkspaceFile = vi.fn(() => true);
    const slot = renderDirective({
      attributes: { file: "reports/report.md" },
      openWorkspaceFile,
      openThreadPanel: () => true,
      rpc: { prepareDocument: () => artifact },
    });

    await waitFor(() => {
      expect(slot.container.querySelector("[data-typst-sheet]")).toBeTruthy();
    });
    fireEvent.click(
      slot.getByRole("button", { name: "Open reports/report.md in sidebar" }),
    );

    expect(openWorkspaceFile).not.toHaveBeenCalled();
    expect(slot.navigateCalls).toContainEqual({
      method: "openThreadPanel",
      options: {
        actionId: "document",
        title: "reports/report.md",
        params: { file: "reports/report.md", source: "workspace" },
      },
    });
  });

  it("opens the plugin panel for thread storage", async () => {
    const openWorkspaceFile = vi.fn(() => true);
    const slot = renderDirective({
      attributes: { file: "reports/result.md", source: "thread-storage" },
      openWorkspaceFile,
      rpc: {
        prepareDocument: (input) => {
          expect(input).toEqual({
            source: { kind: "thread-storage", threadId: "thr_1" },
            file: "reports/result.md",
          });
          return { ...artifact, file: "reports/result.md" };
        },
      },
    });

    await waitFor(() => {
      expect(slot.container.querySelector("[data-typst-sheet]")).toBeTruthy();
    });
    fireEvent.click(
      slot.getByRole("button", {
        name: "Open reports/result.md in sidebar",
      }),
    );

    expect(openWorkspaceFile).not.toHaveBeenCalled();
    expect(slot.navigateCalls).toContainEqual({
      method: "openThreadPanel",
      options: {
        actionId: "document",
        title: "reports/result.md",
        params: { file: "reports/result.md", source: "thread-storage" },
      },
    });
  });

  it("shows a render failure and retries on demand", async () => {
    engine.renderTypstSvg.mockRejectedValueOnce(
      new Error("Typst compile error: unknown variable: foo"),
    );
    const slot = renderDirective({
      attributes: { file: "reports/report.md" },
      rpc: { prepareDocument: () => artifact },
    });

    const alert = await slot.findByRole("alert");
    expect(alert.textContent).toMatch(/Typst compile error/);
    expect(slot.container.querySelector("[data-typst-sheet]")).toBeNull();

    fireEvent.click(
      slot.getByRole("button", { name: "Try again for reports/report.md" }),
    );
    await waitFor(() => {
      expect(slot.container.querySelector("[data-typst-sheet]")).toBeTruthy();
    });
  });

  it("re-renders on demand and recompiles", async () => {
    const slot = renderDirective({
      attributes: { file: "reports/report.md" },
      rpc: { prepareDocument: () => artifact },
    });

    await waitFor(() => {
      expect(slot.container.querySelector("[data-typst-sheet]")).toBeTruthy();
    });
    expect(engine.renderTypstSvg).toHaveBeenCalledTimes(1);

    fireEvent.click(
      slot.getByRole("button", { name: "Re-render reports/report.md" }),
    );

    await waitFor(() => {
      expect(engine.renderTypstSvg).toHaveBeenCalledTimes(2);
    });
    expect(
      slot.rpcCalls.filter((call) => call.method === "prepareDocument"),
    ).toHaveLength(2);
  });

  it("does not recompile the same document twice", async () => {
    const rpc = { prepareDocument: () => artifact };
    const first = renderDirective({
      attributes: { file: "reports/report.md" },
      rpc,
    });
    await first.findByRole("status", {
      name: "Rendering Markdown document reports/report.md",
    });
    cleanup();

    const second = renderDirective({
      attributes: { file: "reports/report.md" },
      rpc,
    });
    await waitFor(() => {
      expect(second.container.querySelector("[data-typst-sheet]")).toBeTruthy();
    });
    expect(engine.renderTypstSvg).toHaveBeenCalledTimes(1);
  });
});

describe("TypstMdPanel", () => {
  it("explains how to open a document without params", async () => {
    const slot = renderPanel({ params: null, rpc: {} });

    expect(
      await slot.findByText(/Open a typst-md card from a message/i),
    ).toBeTruthy();
    expect(slot.rpcCalls).toEqual([]);
  });

  it("rejects params that are not a document target", async () => {
    const slot = renderPanel({ params: { file: "  " }, rpc: {} });

    expect(
      await slot.findByText(/Open a typst-md card from a message/i),
    ).toBeTruthy();
    expect(slot.rpcCalls).toEqual([]);
  });

  it("renders the document from params and reads it from the panel source", async () => {
    const slot = renderPanel({
      params: { file: "reports/report.md", source: "workspace" },
      rpc: {
        prepareDocument: (input) => {
          expect(input).toEqual({
            source: { kind: "thread-workspace", threadId: "thr_1" },
            file: "reports/report.md",
          });
          return artifact;
        },
      },
    });

    const sheet = await waitFor(() => {
      const element = slot.container.querySelector("[data-typst-sheet]");
      expect(element).toBeTruthy();
      return element as HTMLElement;
    });
    expect(sheet.querySelector("svg.typst-doc")).toBeTruthy();
    expect(
      slot.queryByRole("button", {
        name: "Open reports/report.md in sidebar",
      }),
    ).toBeNull();
  });

  it("renders thread-storage documents in the panel", async () => {
    const slot = renderPanel({
      params: { file: "reports/result.md", source: "thread-storage" },
      rpc: {
        prepareDocument: (input) => {
          expect(input).toEqual({
            source: { kind: "thread-storage", threadId: "thr_1" },
            file: "reports/result.md",
          });
          return { ...artifact, file: "reports/result.md" };
        },
      },
    });

    await waitFor(() => {
      expect(slot.container.querySelector("[data-typst-sheet]")).toBeTruthy();
    });
  });
});

describe("Typst artifact actions", () => {
  function renderReadyArtifact() {
    return renderDirective({
      attributes: { file: "reports/report.md" },
      rpc: {
        prepareDocument: () => artifact,
        readAsset: () => ({
          file: "assets/logo.png",
          content: "AQID",
          contentEncoding: "base64",
        }),
      },
    });
  }

  async function openMenu(
    slot: ReturnType<typeof renderReadyArtifact>,
  ): Promise<void> {
    await waitFor(() => {
      expect(slot.container.querySelector("[data-typst-sheet]")).toBeTruthy();
    });
    fireEvent.pointerDown(
      slot.getByRole("button", { name: "Export reports/report.md" }),
      { button: 0 },
    );
  }

  it("offers Markdown, Word, PDF, SVG, PNG, and print", async () => {
    const slot = renderReadyArtifact();
    await openMenu(slot);

    expect(
      await slot.findByRole("menuitem", { name: "Save Markdown" }),
    ).toBeTruthy();
    expect(slot.getByRole("menuitem", { name: "Word (.docx)" })).toBeTruthy();
    expect(slot.getByRole("menuitem", { name: "Save PDF" })).toBeTruthy();
    expect(slot.getByRole("menuitem", { name: "Save SVG" })).toBeTruthy();
    expect(slot.getByRole("menuitem", { name: "Save PNG" })).toBeTruthy();
    expect(slot.getByRole("menuitem", { name: "Печать" })).toBeTruthy();
  });

  it("saves the Markdown source", async () => {
    const downloads = mockDownloadEnvironment();
    try {
      const slot = renderReadyArtifact();
      await openMenu(slot);
      fireEvent.click(
        await slot.findByRole("menuitem", { name: "Save Markdown" }),
      );
      await waitFor(() => {
        expect(downloads.clicks).toEqual(["report.md"]);
      });
      await expect(downloads.blobs[0]!.text()).resolves.toBe("# Report");
    } finally {
      downloads.restore();
    }
  });

  it("exports Word through the core route", async () => {
    const downloads = mockDownloadEnvironment();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      blob: async () => new Blob(["docx"], { type: "application/vnd.ms-word" }),
      text: async () => "",
    }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const slot = renderReadyArtifact();
      await openMenu(slot);
      fireEvent.click(
        await slot.findByRole("menuitem", { name: "Word (.docx)" }),
      );
      await waitFor(() => {
        expect(downloads.clicks).toEqual(["report.docx"]);
      });
      const [url, init] = fetchMock.mock.calls[0] as unknown as [
        string,
        RequestInit,
      ];
      expect(url).toBe("/api/v1/files/export");
      expect(JSON.parse(String(init.body))).toMatchObject({
        content: "# Report",
        filename: "reports/report.md",
        format: "docx",
        sourceKind: "markdown",
      });
      expect(JSON.parse(String(init.body)).baseHref).toContain(
        "/api/v1/threads/thr_1/worktree/files/reports/report.md",
      );
    } finally {
      downloads.restore();
      vi.unstubAllGlobals();
    }
  });

  it("saves the SVG without recompiling", async () => {
    const downloads = mockDownloadEnvironment();
    try {
      const slot = renderReadyArtifact();
      await openMenu(slot);
      fireEvent.click(await slot.findByRole("menuitem", { name: "Save SVG" }));
      await waitFor(() => {
        expect(downloads.clicks).toEqual(["report.svg"]);
      });
      expect(engine.compileTypstPdf).not.toHaveBeenCalled();
    } finally {
      downloads.restore();
    }
  });

  it("saves a PDF compiled by the engine", async () => {
    const downloads = mockDownloadEnvironment();
    try {
      const slot = renderReadyArtifact();
      await openMenu(slot);
      fireEvent.click(await slot.findByRole("menuitem", { name: "Save PDF" }));
      await waitFor(() => {
        expect(downloads.clicks).toEqual(["report.pdf"]);
      });
      expect(engine.compileTypstPdf).toHaveBeenCalledTimes(1);
    } finally {
      downloads.restore();
    }
  });

  it("saves one PNG per page", async () => {
    raster.rasterizeTypstPages.mockResolvedValueOnce([
      new Blob(["png"], { type: "image/png" }),
      new Blob(["png"], { type: "image/png" }),
    ]);
    const downloads = mockDownloadEnvironment();
    try {
      const slot = renderReadyArtifact();
      await openMenu(slot);
      fireEvent.click(await slot.findByRole("menuitem", { name: "Save PNG" }));
      await waitFor(() => {
        expect(downloads.clicks).toEqual(["report-1.png", "report-2.png"]);
      });
      expect(raster.rasterizeTypstPages).toHaveBeenCalledTimes(1);
    } finally {
      downloads.restore();
    }
  });

  it("prints the rendered pages", async () => {
    const slot = renderReadyArtifact();
    await openMenu(slot);
    fireEvent.click(await slot.findByRole("menuitem", { name: "Печать" }));

    const frame = await waitFor(() => {
      const element = document.querySelector("iframe");
      expect(element).toBeTruthy();
      return element as HTMLIFrameElement;
    });
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts allow-modals");
    expect(frame.getAttribute("srcdoc")).toContain("@page { size: 200pt 100pt");
    expect(frame.getAttribute("srcdoc")).toContain('class="typst-page"');
  });
});
