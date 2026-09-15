import { describe, expect, it, vi } from "vitest";
import type { TypstCompiler, TypstRenderer } from "@myriaddreamin/typst.ts";
import {
  MAX_COMPILE_ROUNDS,
  MAX_DEPENDENCY_FILES,
  renderDocumentWith,
  TypstFileAccessModel,
} from "./typst-engine";

const ENCODER = new TextEncoder();
const FAILED_DIAGNOSTICS = ["/main.typ:2:2: error: unknown variable: nope"];

interface CompilerHarness {
  accessModel: TypstFileAccessModel;
  compiler: TypstCompiler;
  compileRounds: () => number;
  shadows: () => Map<string, Uint8Array>;
}

function createCompiler(graph: Record<string, string[]>): CompilerHarness {
  const accessModel = new TypstFileAccessModel();
  const shadows = new Map<string, Uint8Array>();
  let compileRounds = 0;

  const readReachable = (path: string, seen: Set<string>): boolean => {
    if (seen.has(path)) return true;
    seen.add(path);
    const dependencies = graph[path];
    if (dependencies === undefined) return false;
    let loaded = true;
    for (const dependency of dependencies) {
      if (accessModel.readAll(dependency) === undefined) {
        loaded = false;
        continue;
      }
      if (!readReachable(dependency, seen)) loaded = false;
    }
    return loaded;
  };

  const compiler = {
    resetShadow: vi.fn(() => {
      shadows.clear();
    }),
    mapShadow: vi.fn((path: string, content: Uint8Array) => {
      shadows.set(path, content);
    }),
    compile: vi.fn(async (options: { mainFilePath: string }) => {
      compileRounds += 1;
      return readReachable(options.mainFilePath, new Set())
        ? { result: new Uint8Array([1, 2, 3]) }
        : { diagnostics: FAILED_DIAGNOSTICS };
    }),
  } as unknown as TypstCompiler;

  return {
    accessModel,
    compiler,
    compileRounds: () => compileRounds,
    shadows: () => shadows,
  };
}

function createRenderer(): TypstRenderer {
  return {
    renderSvg: vi.fn(async () => "<svg/>"),
  } as unknown as TypstRenderer;
}

function engineParts(harness: CompilerHarness) {
  return {
    accessModel: harness.accessModel,
    compiler: harness.compiler,
    renderer: createRenderer(),
  };
}

describe("renderDocumentWith", () => {
  it("loads dependencies round by round until the document compiles", async () => {
    const harness = createCompiler({
      "/reports/main.typ": ["/reports/chapter.typ"],
      "/reports/chapter.typ": ["/assets/logo.png"],
      "/assets/logo.png": [],
    });
    const requested: string[] = [];
    const readDependency = vi.fn(async (path: string) => {
      requested.push(path);
      return ENCODER.encode(`bytes:${path}`);
    });

    const svg = await renderDocumentWith({
      engine: engineParts(harness),
      request: {
        mainPath: "/reports/main.typ",
        readDependency,
        source: "= Report",
      },
    });

    expect(svg).toBe("<svg/>");
    expect(requested).toEqual(["/reports/chapter.typ", "/assets/logo.png"]);
    expect(harness.compileRounds()).toBe(3);
    expect(harness.shadows().get("/reports/main.typ")).toEqual(
      ENCODER.encode("= Report"),
    );
    expect(harness.shadows().get("/assets/logo.png")).toEqual(
      ENCODER.encode("bytes:/assets/logo.png"),
    );
  });

  it("propagates a dependency read failure", async () => {
    const harness = createCompiler({
      "/main.typ": ["/assets/missing.png"],
      "/assets/missing.png": [],
    });
    const readDependency = vi.fn(async () => {
      throw new Error("Typst dependency not found: assets/missing.png");
    });

    await expect(
      renderDocumentWith({
        engine: engineParts(harness),
        request: {
          mainPath: "/main.typ",
          readDependency,
          source: "= Report",
        },
      }),
    ).rejects.toThrow(/dependency not found/);
  });

  it("throws the compiler diagnostics when no dependency explains the failure", async () => {
    const harness = createCompiler({});
    const engine = engineParts(harness);
    const readDependency = vi.fn(async (path: string) => ENCODER.encode(path));

    await expect(
      renderDocumentWith({
        engine,
        request: {
          mainPath: "/main.typ",
          readDependency,
          source: "= Report",
        },
      }),
    ).rejects.toThrow(/unknown variable: nope/);
    expect(readDependency).not.toHaveBeenCalled();
    expect(engine.renderer.renderSvg).not.toHaveBeenCalled();
  });

  it("stops loading dependencies at the file budget", async () => {
    const graph: Record<string, string[]> = { "/main.typ": [] };
    for (let index = 0; index < MAX_DEPENDENCY_FILES + 8; index += 1) {
      const path = `/assets/image-${index}.png`;
      graph["/main.typ"]!.push(path);
      graph[path] = [];
    }
    const harness = createCompiler(graph);
    const readDependency = vi.fn(async (path: string) => ENCODER.encode(path));

    await expect(
      renderDocumentWith({
        engine: engineParts(harness),
        request: {
          mainPath: "/main.typ",
          readDependency,
          source: "= Report",
        },
      }),
    ).rejects.toThrow(/unknown variable: nope/);
    expect(readDependency).toHaveBeenCalledTimes(MAX_DEPENDENCY_FILES);
    expect(harness.compileRounds()).toBe(2);
  });

  it("gives up after the round limit", async () => {
    const graph: Record<string, string[]> = { "/main.typ": ["/a.typ"] };
    let level = 1;
    const buildLevels = (path: string): void => {
      if (level > MAX_COMPILE_ROUNDS + 2) {
        graph[path] = [];
        return;
      }
      const next = `/level-${level}.typ`;
      level += 1;
      graph[path] = [next];
      buildLevels(next);
    };
    buildLevels("/a.typ");
    const harness = createCompiler(graph);
    const readDependency = vi.fn(async (path: string) => ENCODER.encode(path));

    await expect(
      renderDocumentWith({
        engine: engineParts(harness),
        request: {
          mainPath: "/main.typ",
          readDependency,
          source: "= Report",
        },
      }),
    ).rejects.toThrow(/unknown variable: nope/);
    expect(harness.compileRounds()).toBe(MAX_COMPILE_ROUNDS);
    expect(readDependency).toHaveBeenCalledTimes(MAX_COMPILE_ROUNDS);
  });
});

describe("TypstFileAccessModel", () => {
  it("records unshadowed reads once per round", () => {
    const model = new TypstFileAccessModel();
    expect(model.readAll("/main.typ")).toBeUndefined();
    expect(model.readAll("/main.typ")).toBeUndefined();
    expect(model.takeRequested()).toEqual(["/main.typ"]);
    expect(model.takeRequested()).toEqual([]);
  });

  it("serves shadowed content and skips unavailable paths", () => {
    const model = new TypstFileAccessModel();
    model.set("/logo.png", new Uint8Array([1]));
    expect(model.isFile("/logo.png")).toBe(true);
    expect(model.readAll("/logo.png")).toEqual(new Uint8Array([1]));
    model.markUnavailable("/missing.png");
    expect(model.isFile("/missing.png")).toBe(false);
    expect(model.readAll("/missing.png")).toBeUndefined();
    expect(model.takeRequested()).toEqual([]);
  });
});
