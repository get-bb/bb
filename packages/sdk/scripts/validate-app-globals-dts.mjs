import ts from "typescript";

// Compiles the generated app globals declaration together with a small
// consumer that exercises the injected window.bb surface. The declaration is
// vendored into scaffolded apps whose tsconfig sets skipLibCheck, so an
// unresolved name inside the d.ts (e.g. a heritage clause referencing a type
// the generator forgot to emit) is silently swallowed there — this validation
// is the only place such breakage fails loudly.
const VIRTUAL_DIRECTORY = "/__bb-app-globals-validation__";
const DECLARATION_FILE_NAME = `${VIRTUAL_DIRECTORY}/bb-sdk.d.ts`;
const CONSUMER_FILE_NAME = `${VIRTUAL_DIRECTORY}/bb-sdk-consumer.ts`;

// Mirrors how scaffolded app code consumes the globals: realtime via
// window.bb.on, app data via bb.data, and manager messages via bb.message.
const CONSUMER_SOURCE = `export {};

const bb = window.bb;
if (bb !== undefined) {
  const unsubscribeThreadChanges: BbRealtimeUnsubscribe = bb.on({
    event: "thread:changed",
    threadId: "thr_example",
    callback(event) {
      const changes: readonly ThreadChangeKind[] = event.changes;
      void changes;
    },
  });
  unsubscribeThreadChanges();
  const unsubscribeResync = bb.on({
    event: "app-data:resync",
    callback(event) {
      const applicationId: ApplicationId = event.applicationId;
      void applicationId;
    },
  });
  unsubscribeResync();
  const unsubscribeDataChanges = bb.data.onChange({
    prefix: "todos",
    callback(event) {
      const path: AppDataPath = event.path;
      void path;
    },
  });
  unsubscribeDataChanges();
  void bb.data.list({ prefix: "todos" });
  void bb.message.send({ payload: { kind: "typecheck-probe" } });
}
`;

export function collectAppGlobalsDeclarationDiagnostics(declarationText) {
  const compilerOptions = {
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    // skipLibCheck must stay off: it is what hides unresolved names inside
    // the declaration when scaffolded apps compile it.
    skipLibCheck: false,
    strict: true,
    target: ts.ScriptTarget.ES2022,
    types: [],
  };
  const virtualContents = new Map([
    [DECLARATION_FILE_NAME, declarationText],
    [CONSUMER_FILE_NAME, CONSUMER_SOURCE],
  ]);
  const host = ts.createCompilerHost(compilerOptions, true);
  const defaultGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersionOrOptions, ...rest) => {
    const contents = virtualContents.get(fileName);
    if (contents !== undefined) {
      return ts.createSourceFile(
        fileName,
        contents,
        languageVersionOrOptions,
        true,
      );
    }
    return defaultGetSourceFile(fileName, languageVersionOrOptions, ...rest);
  };
  const defaultFileExists = host.fileExists.bind(host);
  host.fileExists = (fileName) =>
    virtualContents.has(fileName) || defaultFileExists(fileName);
  const defaultReadFile = host.readFile.bind(host);
  host.readFile = (fileName) =>
    virtualContents.get(fileName) ?? defaultReadFile(fileName);

  const program = ts.createProgram({
    rootNames: [DECLARATION_FILE_NAME, CONSUMER_FILE_NAME],
    options: compilerOptions,
    host,
  });
  return ts
    .getPreEmitDiagnostics(program)
    .map((diagnostic) => ts.formatDiagnostic(diagnostic, host).trim());
}
