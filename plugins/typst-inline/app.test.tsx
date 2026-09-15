// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginFileOpenerSource } from "@get-bb/plugin-sdk";
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

const artifact = { file: "reports/report.typ", content: "= Report" };

function mockDownloadEnvironment(): { clicks: string[]; restore: () => void } {
  const clicks: string[] = [];
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const originalClick = HTMLAnchorElement.prototype.click;
  URL.createObjectURL = () => "blob:typst-inline";
  URL.revokeObjectURL = () => {};
  HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
    clicks.push(this.download);
  };
  return {
    clicks,
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
  rpc: Record<string, (input: unknown) => unknown>;
}) {
  return renderSlot(
    app.messageDirectives[0]!,
    {
      attributes: options.attributes,
      source: "::typst{}",
      message,
      openWorkspaceFile: options.openWorkspaceFile ?? null,
    },
    { rpc: options.rpc },
  );
}

function renderOpener(options: {
  path: string;
  source: PluginFileOpenerSource;
  rpc: Record<string, (input: unknown) => unknown>;
}) {
  return renderSlot(
    app.fileOpeners[0]!,
    {
      path: options.path,
      source: options.source,
      Original: () => <div>original preview</div>,
    },
    { rpc: options.rpc },
  );
}

describe("typst registrations", () => {
  it("registers the typst directive", () => {
    expect(app.messageDirectives).toHaveLength(1);
    expect(app.messageDirectives[0]!.id).toBe("typst");
  });

  it("claims .typ files in the file opener", () => {
    expect(app.fileOpeners).toHaveLength(1);
    expect(app.fileOpeners[0]).toMatchObject({
      id: "typst",
      title: "Typst viewer",
      extensions: ["typ"],
    });
  });
});

describe("TypstDirective", () => {
  it("requires a file attribute without calling rpc", async () => {
    const slot = renderDirective({ attributes: {}, rpc: {} });

    await slot.findByRole("alert");
    expect(slot.getByText(/requires a file attribute/i)).toBeTruthy();
    expect(slot.rpcCalls).toEqual([]);
  });

  it("rejects an out-of-range height without calling rpc", async () => {
    const slot = renderDirective({
      attributes: { file: "report.typ", height: "80" },
      rpc: {},
    });

    const alert = await slot.findByRole("alert");
    expect(alert.textContent).toMatch(/120 to 1200/);
    expect(slot.rpcCalls).toEqual([]);
  });

  it("rejects an unknown source without calling rpc", async () => {
    const slot = renderDirective({
      attributes: { file: "report.typ", source: "project" },
      rpc: {},
    });

    const alert = await slot.findByRole("alert");
    expect(alert.textContent).toMatch(
      /must be "workspace" or "thread-storage"/,
    );
    expect(slot.rpcCalls).toEqual([]);
  });

  it("renders the document on a sheet and opens the source in the sidebar", async () => {
    const openWorkspaceFile = vi.fn(() => true);
    const slot = renderDirective({
      attributes: { file: "reports/report.typ", height: "480" },
      openWorkspaceFile,
      rpc: {
        prepareArtifact: (input) => {
          expect(input).toEqual({
            source: { kind: "thread-workspace", threadId: "thr_1" },
            file: "reports/report.typ",
          });
          return artifact;
        },
      },
    });

    await slot.findByRole("status", {
      name: "Rendering Typst document reports/report.typ",
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
        name: "Open reports/report.typ in sidebar",
      }),
    );
    expect(openWorkspaceFile).toHaveBeenCalledWith("reports/report.typ");
    expect(slot.rpcCalls).toEqual([
      {
        method: "prepareArtifact",
        input: {
          source: { kind: "thread-workspace", threadId: "thr_1" },
          file: "reports/report.typ",
        },
      },
    ]);
  });

  it("defaults the sheet height to 224 pixels", async () => {
    const slot = renderDirective({
      attributes: { file: "reports/report.typ" },
      rpc: { prepareArtifact: () => artifact },
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

  it("reads dependencies through the rpc and decodes base64 bytes", async () => {
    const slot = renderDirective({
      attributes: { file: "reports/report.typ" },
      rpc: {
        prepareArtifact: () => artifact,
        readArtifactFile: (input) => {
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

  it("hides the sidebar action for thread storage", async () => {
    const slot = renderDirective({
      attributes: { file: "reports/result.typ", source: "thread-storage" },
      openWorkspaceFile: vi.fn(() => true),
      rpc: {
        prepareArtifact: (input) => {
          expect(input).toEqual({
            source: { kind: "thread-storage", threadId: "thr_1" },
            file: "reports/result.typ",
          });
          return { ...artifact, file: "reports/result.typ" };
        },
      },
    });

    await waitFor(() => {
      expect(slot.container.querySelector("[data-typst-sheet]")).toBeTruthy();
    });
    expect(
      slot.queryByRole("button", {
        name: "Open reports/result.typ in sidebar",
      }),
    ).toBeNull();
  });

  it("shows a render failure and retries on demand", async () => {
    engine.renderTypstSvg.mockRejectedValueOnce(
      new Error("Typst compile error: unknown variable: foo"),
    );
    const slot = renderDirective({
      attributes: { file: "reports/report.typ" },
      rpc: { prepareArtifact: () => artifact },
    });

    const alert = await slot.findByRole("alert");
    expect(alert.textContent).toMatch(/Typst compile error/);
    expect(slot.container.querySelector("[data-typst-sheet]")).toBeNull();

    fireEvent.click(
      slot.getByRole("button", { name: "Try again for reports/report.typ" }),
    );
    await waitFor(() => {
      expect(slot.container.querySelector("[data-typst-sheet]")).toBeTruthy();
    });
  });

  it("re-renders on demand and recompiles", async () => {
    const slot = renderDirective({
      attributes: { file: "reports/report.typ" },
      rpc: { prepareArtifact: () => artifact },
    });

    await waitFor(() => {
      expect(slot.container.querySelector("[data-typst-sheet]")).toBeTruthy();
    });
    expect(engine.renderTypstSvg).toHaveBeenCalledTimes(1);

    fireEvent.click(
      slot.getByRole("button", { name: "Re-render reports/report.typ" }),
    );

    await waitFor(() => {
      expect(engine.renderTypstSvg).toHaveBeenCalledTimes(2);
    });
    expect(
      slot.rpcCalls.filter((call) => call.method === "prepareArtifact"),
    ).toHaveLength(2);
  });

  it("does not recompile the same artifact twice", async () => {
    const rpc = { prepareArtifact: () => artifact };
    const first = renderDirective({
      attributes: { file: "reports/report.typ" },
      rpc,
    });
    await first.findByRole("status", {
      name: "Rendering Typst document reports/report.typ",
    });
    cleanup();

    const second = renderDirective({
      attributes: { file: "reports/report.typ" },
      rpc,
    });
    await waitFor(() => {
      expect(second.container.querySelector("[data-typst-sheet]")).toBeTruthy();
    });
    expect(engine.renderTypstSvg).toHaveBeenCalledTimes(1);
  });
});

describe("TypstFileOpener", () => {
  const workspaceSource: PluginFileOpenerSource = {
    kind: "workspace",
    threadId: "thr_1",
    environmentId: "env_1",
    projectId: "proj_1",
  };

  it("renders the document in the panel", async () => {
    const slot = renderOpener({
      path: "reports/report.typ",
      source: workspaceSource,
      rpc: {
        prepareArtifact: (input) => {
          expect(input).toEqual({
            source: { kind: "thread-workspace", threadId: "thr_1" },
            file: "reports/report.typ",
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
    expect(slot.getByText("reports/report.typ")).toBeTruthy();
  });

  it("resolves project files without a thread", async () => {
    const slot = renderOpener({
      path: "docs/report.typ",
      source: {
        kind: "workspace",
        threadId: null,
        environmentId: null,
        projectId: "proj_1",
        experimental_hostId: "host_2",
      },
      rpc: {
        prepareArtifact: (input) => {
          expect(input).toEqual({
            source: {
              kind: "workspace",
              environmentId: null,
              projectId: "proj_1",
              hostId: "host_2",
            },
            file: "docs/report.typ",
          });
          return { file: "docs/report.typ", content: "= Report" };
        },
      },
    });

    await waitFor(() => {
      expect(slot.container.querySelector("[data-typst-sheet]")).toBeTruthy();
    });
  });

  it("falls back to the default preview for host files", () => {
    const slot = renderOpener({
      path: "C:/tmp/report.typ",
      source: {
        kind: "host",
        threadId: "thr_1",
        environmentId: "env_1",
        projectId: null,
      },
      rpc: {},
    });

    expect(slot.getByText("original preview")).toBeTruthy();
    expect(slot.rpcCalls).toEqual([]);
  });

  it("renders errors with a retry that reloads", async () => {
    let attempts = 0;
    const slot = renderOpener({
      path: "reports/report.typ",
      source: workspaceSource,
      rpc: {
        prepareArtifact: () => {
          attempts += 1;
          if (attempts === 1) throw new Error("Typst file not found: reports/report.typ");
          return artifact;
        },
      },
    });

    const alert = await slot.findByRole("alert");
    expect(alert.textContent).toMatch(/Typst file not found/);

    fireEvent.click(
      slot.getByRole("button", { name: "Try again for reports/report.typ" }),
    );
    await waitFor(() => {
      expect(slot.container.querySelector("[data-typst-sheet]")).toBeTruthy();
    });
  });
});

describe("Typst artifact actions", () => {
  function renderReadyArtifact() {
    return renderDirective({
      attributes: { file: "reports/report.typ" },
      rpc: {
        prepareArtifact: () => artifact,
        readArtifactFile: () => ({
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
      slot.getByRole("button", { name: "Export reports/report.typ" }),
      { button: 0 },
    );
  }

  it("offers PDF, SVG, PNG, and print", async () => {
    const slot = renderReadyArtifact();
    await openMenu(slot);

    expect(await slot.findByRole("menuitem", { name: "Save PDF" })).toBeTruthy();
    expect(slot.getByRole("menuitem", { name: "Save SVG" })).toBeTruthy();
    expect(slot.getByRole("menuitem", { name: "Save PNG" })).toBeTruthy();
    expect(slot.getByRole("menuitem", { name: "Печать" })).toBeTruthy();
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
