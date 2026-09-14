import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

export const declarationId = (id) =>
  /\.d\.[cm]?ts$/.test(id)
    ? id
    : id.replace(/\.([cm]?ts|tsx)$/, ".d.$1").replace(/\.d\.tsx$/, ".d.ts");

export function sharedDeclarationEmit(entries, workspaceDir, resolveSource) {
  const configCache = new Map();
  const programs = new Map();

  function compilerConfig(file) {
    const configPath = ts.findConfigFile(path.dirname(file), ts.sys.fileExists);
    if (!configPath) throw new Error(`Missing tsconfig for ${file}`);
    if (configCache.has(configPath)) return configCache.get(configPath);
    const config = ts.getParsedCommandLineOfConfigFile(
      configPath,
      {
        declaration: true,
        noEmit: false,
        emitDeclarationOnly: true,
        noEmitOnError: true,
        checkJs: false,
        declarationMap: false,
        skipLibCheck: true,
        preserveSymlinks: false,
        target: ts.ScriptTarget.ESNext,
        resolveJsonModule: true,
      },
      {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic(diagnostic) {
          throw new Error(
            ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
          );
        },
      },
    );
    if (!config || config.errors.length) {
      throw new Error(
        `Invalid tsconfig ${configPath}: ${config?.errors.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")).join("\n")}`,
      );
    }
    const options = { ...config.options };
    for (const key of [
      "rootDir",
      "outDir",
      "configFilePath",
      "tsBuildInfoFile",
    ]) {
      delete options[key];
    }
    const ambientFiles = config.fileNames.filter((fileName) =>
      /\.d\.[cm]?ts$/.test(fileName),
    );
    const result = {
      options,
      ambientFiles,
      key: JSON.stringify([
        Object.entries(options).sort(([a], [b]) => a.localeCompare(b)),
        ambientFiles,
      ]),
    };
    configCache.set(configPath, result);
    return result;
  }

  const initialConfig = compilerConfig(entries[0]);
  const discovery = ts.createProgram(
    [...entries, ...initialConfig.ambientFiles],
    initialConfig.options,
  );
  const roots = discovery
    .getSourceFiles()
    .map((source) => source.fileName)
    .filter(
      (id) =>
        id.startsWith(workspaceDir + path.sep) &&
        !id.includes(`${path.sep}node_modules${path.sep}`) &&
        !/\.d\.[cm]?ts$/.test(id),
    );

  function programFor(file) {
    const config = compilerConfig(file);
    const previous = programs.get(config.key);
    if (!previous || !previous.getRootFileNames().includes(file)) {
      programs.set(
        config.key,
        ts.createProgram(
          [
            ...new Set([
              ...roots,
              ...config.ambientFiles,
              ...(previous?.getRootFileNames() ?? []),
              file,
            ]),
          ],
          config.options,
          undefined,
          previous ?? discovery,
        ),
      );
    }
    return programs.get(config.key);
  }

  const declarations = new Map();
  const sources = new Map(
    discovery
      .getSourceFiles()
      .map((source) => [path.resolve(source.fileName), source]),
  );
  const sourceIds = new Map(
    [...sources.keys()].map((id) => [declarationId(id), id]),
  );

  return {
    name: "shared-declaration-emit",
    resolveId(id, importer) {
      const source = resolveSource(id, importer && sourceIds.get(importer));
      if (source) {
        sourceIds.set(declarationId(source), source);
        return declarationId(source);
      }
      if (!importer) return declarationId(id);
      if (id.startsWith(".")) {
        const resolved = ts.resolveModuleName(
          id,
          sourceIds.get(importer) ?? importer,
          { moduleResolution: ts.ModuleResolutionKind.Node10 },
          ts.sys,
        ).resolvedModule;
        if (resolved) {
          const real = path.resolve(resolved.resolvedFileName);
          sourceIds.set(declarationId(real), real);
          return declarationId(real);
        }
      }
    },
    load(id) {
      const sourceId = sourceIds.get(id);
      if (!sourceId) return null;
      if (/\.d\.[cm]?ts$/.test(sourceId)) return readFileSync(sourceId, "utf8");
      if (declarations.has(id)) return declarations.get(id);
      const program = programFor(sourceId);
      const source = program.getSourceFile(sourceId);
      if (!source) throw new Error(`Missing source ${sourceId}`);
      let declaration;
      const result = program.emit(
        source,
        (name, text) => {
          if (!name.endsWith(".map")) declaration = text;
        },
        undefined,
        true,
        undefined,
        true,
      );
      if (!declaration || result.emitSkipped) {
        throw new Error(
          `Failed emit ${sourceId}: ${result.diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")).join("\n")}`,
        );
      }
      declarations.set(id, declaration);
      return declaration;
    },
  };
}
