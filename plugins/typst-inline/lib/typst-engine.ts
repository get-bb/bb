import {
  createTypstCompiler,
  createTypstRenderer,
  loadFonts,
  type TypstCompiler,
  type TypstRenderer,
} from "@myriaddreamin/typst.ts";
import { CompileFormatEnum } from "@myriaddreamin/typst.ts/compiler";
import { withAccessModel } from "@myriaddreamin/typst.ts/options.init";

const COMPILER_WASM_URL =
  "https://cdn.jsdelivr.net/npm/@myriaddreamin/typst-ts-web-compiler@0.7.0/pkg/typst_ts_web_compiler_bg.wasm";
const RENDERER_WASM_URL =
  "https://cdn.jsdelivr.net/npm/@myriaddreamin/typst-ts-renderer@0.7.0/pkg/typst_ts_renderer_bg.wasm";

export const MAX_DEPENDENCY_FILES = 32;
export const MAX_DEPENDENCY_BYTES = 8 * 1024 * 1024;
export const MAX_COMPILE_ROUNDS = 40;

export type TypstReadDependency = (path: string) => Promise<Uint8Array>;

export class TypstFileAccessModel {
  private readonly files = new Map<string, Uint8Array>();
  private readonly unavailable = new Set<string>();
  private readonly requested = new Set<string>();

  clear(): void {
    this.files.clear();
    this.unavailable.clear();
    this.requested.clear();
  }

  clearRequests(): void {
    this.requested.clear();
  }

  takeRequested(): string[] {
    const paths = [...this.requested].filter(
      (path) => !this.files.has(path) && !this.unavailable.has(path),
    );
    this.requested.clear();
    return paths;
  }

  set(path: string, content: Uint8Array): void {
    this.files.set(path, content);
    this.unavailable.delete(path);
  }

  markUnavailable(path: string): void {
    this.unavailable.add(path);
  }

  entries(): IterableIterator<[string, Uint8Array]> {
    return this.files.entries();
  }

  getMTime(): Date | undefined {
    return undefined;
  }

  isFile(path: string): boolean {
    return this.files.has(path) || !this.unavailable.has(path);
  }

  getRealPath(path: string): string {
    return path;
  }

  readAll(path: string): Uint8Array | undefined {
    const content = this.files.get(path);
    if (content !== undefined) return content;
    if (!this.unavailable.has(path)) this.requested.add(path);
    return undefined;
  }
}

export interface TypstEngineParts {
  accessModel: TypstFileAccessModel;
  compiler: TypstCompiler;
  renderer: TypstRenderer;
}

type TypstEngine = TypstEngineParts;

export interface TypstCompileRequest {
  mainPath: string;
  readDependency: TypstReadDependency;
  source: string;
}

let enginePromise: Promise<TypstEngine> | null = null;
let queue: Promise<unknown> = Promise.resolve();

async function bootEngine(): Promise<TypstEngine> {
  const accessModel = new TypstFileAccessModel();
  const compiler = createTypstCompiler();
  await compiler.init({
    getModule: () => COMPILER_WASM_URL,
    beforeBuild: [
      loadFonts([], { assets: ["text"] }),
      withAccessModel(accessModel),
    ],
  });
  const renderer = createTypstRenderer();
  await renderer.init({ getModule: () => RENDERER_WASM_URL });
  return { accessModel, compiler, renderer };
}

function ensureEngine(): Promise<TypstEngine> {
  enginePromise ??= bootEngine().catch((error: unknown) => {
    enginePromise = null;
    throw error;
  });
  return enginePromise;
}

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function describeDiagnostics(
  diagnostics: readonly string[] | undefined,
): string {
  const lines = (diagnostics ?? [])
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    return "Typst produced no document for this file.";
  }
  return `Typst compile error: ${lines.join(" ")}`;
}

async function loadDependencies(
  accessModel: TypstFileAccessModel,
  requested: readonly string[],
  readDependency: TypstReadDependency,
): Promise<number> {
  let loaded = 0;
  let bytes = 0;
  for (const path of requested) {
    if (loaded >= MAX_DEPENDENCY_FILES) {
      accessModel.markUnavailable(path);
      continue;
    }
    const content = await readDependency(path);
    if (bytes + content.byteLength > MAX_DEPENDENCY_BYTES) {
      accessModel.markUnavailable(path);
      continue;
    }
    bytes += content.byteLength;
    accessModel.set(path, content);
    loaded += 1;
  }
  return loaded;
}

export async function compileDocumentWith(input: {
  engine: TypstEngineParts;
  format: CompileFormatEnum.vector | CompileFormatEnum.pdf;
  request: TypstCompileRequest;
}): Promise<Uint8Array> {
  const { engine, format, request } = input;
  const encodedSource = new TextEncoder().encode(request.source);
  const accessModel = engine.accessModel;
  let lastDiagnostics: readonly string[] | undefined;
  accessModel.clear();

  for (let round = 0; round < MAX_COMPILE_ROUNDS; round += 1) {
    accessModel.clearRequests();
    engine.compiler.resetShadow();
    engine.compiler.mapShadow(request.mainPath, encodedSource);
    for (const [path, content] of accessModel.entries()) {
      engine.compiler.mapShadow(path, content);
    }
    const compiled =
      format === CompileFormatEnum.pdf
        ? await engine.compiler.compile({
            mainFilePath: request.mainPath,
            diagnostics: "unix",
            format: CompileFormatEnum.pdf,
          })
        : await engine.compiler.compile({
            mainFilePath: request.mainPath,
            diagnostics: "unix",
          });
    if (compiled.result !== undefined) return compiled.result;
    lastDiagnostics = compiled.diagnostics;
    const requested = accessModel.takeRequested();
    if (requested.length === 0) break;
    const loaded = await loadDependencies(
      accessModel,
      requested,
      request.readDependency,
    );
    if (loaded === 0) break;
  }

  throw new Error(describeDiagnostics(lastDiagnostics));
}

export async function renderSvgWith(input: {
  artifactContent: Uint8Array;
  renderer: TypstRenderer;
}): Promise<string> {
  return await input.renderer.renderSvg({
    artifactContent: input.artifactContent,
    format: "vector",
    data_selection: { body: true, defs: true, css: true, js: false },
  });
}

export async function renderDocumentWith(input: {
  engine: TypstEngineParts;
  request: TypstCompileRequest;
}): Promise<string> {
  const artifactContent = await compileDocumentWith({
    engine: input.engine,
    format: CompileFormatEnum.vector,
    request: input.request,
  });
  return await renderSvgWith({
    artifactContent,
    renderer: input.engine.renderer,
  });
}

export function compileTypstVector(
  request: TypstCompileRequest,
): Promise<Uint8Array> {
  return enqueue(async () =>
    compileDocumentWith({
      engine: await ensureEngine(),
      format: CompileFormatEnum.vector,
      request,
    }),
  );
}

export function compileTypstPdf(
  request: TypstCompileRequest,
): Promise<Uint8Array> {
  return enqueue(async () =>
    compileDocumentWith({
      engine: await ensureEngine(),
      format: CompileFormatEnum.pdf,
      request,
    }),
  );
}

export function renderTypstSvg(artifactContent: Uint8Array): Promise<string> {
  return enqueue(async () =>
    renderSvgWith({ artifactContent, renderer: (await ensureEngine()).renderer }),
  );
}

export function compileTypstDocument(
  request: TypstCompileRequest,
): Promise<string> {
  return enqueue(async () =>
    renderDocumentWith({ engine: await ensureEngine(), request }),
  );
}
