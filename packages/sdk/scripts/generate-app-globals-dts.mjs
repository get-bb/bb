import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const outputFile = path.resolve(
  repoRoot,
  "apps",
  "server",
  "src",
  "services",
  "threads",
  "app-scaffold-template",
  "source",
  "src",
  "bb-sdk.d.ts",
);
const outputRelativePath = path.relative(repoRoot, outputFile);
const regenerateCommand = "pnpm --filter @bb/sdk generate:app-globals-dts";
const typeFormatFlags =
  ts.TypeFormatFlags.NoTruncation |
  ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope;

const sdkCurrentAppAliasNames = [
  "CurrentAppDataReadArgs",
  "CurrentAppDataWriteArgs",
  "CurrentAppDataDeleteArgs",
  "CurrentAppDataListArgs",
  "CurrentAppDataEntry",
  "CurrentAppDataChangeEvent",
  "CurrentAppDataChangeCallback",
  "CurrentAppDataChangeArgs",
  "CurrentAppMessageSendArgs",
];
const serverContractDeclarationNames = [
  "BbDataEntry",
  "BbDataReadArgs",
  "BbDataWriteArgs",
  "BbDataDeleteArgs",
  "BbDataListArgs",
  "BbDataChangeEvent",
  "BbDataChangeCallback",
  "BbDataOnChangeArgs",
  "BbMessageSendArgs",
];
const domainChangeKindAliasNames = [
  "ThreadChangeKind",
  "ProjectChangeKind",
  "EnvironmentChangeKind",
  "HostChangeKind",
  "SystemChangeKind",
  "AppChangeKind",
];
const domainChangedMessageInterfaceNames = [
  "ThreadChangeMetadata",
  "ThreadChangedMessage",
  "ProjectChangedMessage",
  "EnvironmentChangedMessage",
  "HostChangedMessage",
  "SystemChangedMessage",
  "AppChangedMessage",
];
const realtimeDeclarationNames = [
  "BbRealtimeUnsubscribe",
  "BbRealtimeEventName",
  "ThreadRealtimeEvent",
  "ProjectRealtimeEvent",
  "EnvironmentRealtimeEvent",
  "HostRealtimeEvent",
  "SystemRealtimeEvent",
  "AppRealtimeEvent",
  "AppDataChangedRealtimeEvent",
  "AppDataResyncRealtimeEvent",
  "BbRealtimeConnectionState",
  "BbRealtimeConnectionEvent",
  "BbRealtimeEventMap",
  "BbRealtimeCallback",
  "ThreadRealtimeOnInput",
  "ProjectRealtimeOnInput",
  "EnvironmentRealtimeOnInput",
  "HostRealtimeOnInput",
  "SystemRealtimeOnInput",
  "SystemConfigRealtimeOnInput",
  "SystemAppsRealtimeOnInput",
  "AppRealtimeOnInput",
  "AppDataChangedRealtimeOnInput",
  "AppDataResyncRealtimeOnInput",
  "RealtimeConnectionOnInput",
  "BbRealtimeOnInputUnion",
  "BbRealtimeOnInput",
];

function readCompilerConfig() {
  const configPath = ts.findConfigFile(
    packageRoot,
    ts.sys.fileExists,
    "tsconfig.json",
  );
  if (!configPath) {
    throw new Error("Unable to locate packages/sdk/tsconfig.json.");
  }
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) {
    throw new Error(
      ts.flattenDiagnosticMessageText(config.error.messageText, "\n"),
    );
  }
  return ts.parseJsonConfigFileContent(config.config, ts.sys, packageRoot);
}

function createSdkProgram() {
  const config = readCompilerConfig();
  return ts.createProgram(config.fileNames, config.options);
}

const program = createSdkProgram();
const checker = program.getTypeChecker();
const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });

function getSourceFile(relativePath) {
  const absolutePath = path.resolve(repoRoot, relativePath);
  const directSourceFile =
    program.getSourceFile(absolutePath) ?? program.getSourceFile(relativePath);
  if (directSourceFile) {
    return directSourceFile;
  }
  const normalizedPath = path.normalize(absolutePath);
  const sourceFile = program
    .getSourceFiles()
    .find((candidate) => path.normalize(candidate.fileName) === normalizedPath);
  if (!sourceFile) {
    throw new Error(`Unable to load TypeScript source file: ${relativePath}`);
  }
  return sourceFile;
}

function findNamedDeclaration(sourceFile, name, predicate) {
  const declaration = sourceFile.statements.find(
    (statement) => predicate(statement) && statement.name.text === name,
  );
  if (!declaration) {
    throw new Error(
      `Unable to find declaration ${name} in ${sourceFile.fileName}`,
    );
  }
  return declaration;
}

function findInterfaceDeclaration(sourceFile, name) {
  return findNamedDeclaration(sourceFile, name, ts.isInterfaceDeclaration);
}

function findTypeAliasDeclaration(sourceFile, name) {
  return findNamedDeclaration(sourceFile, name, ts.isTypeAliasDeclaration);
}

function findTypeAliasOrInterfaceDeclaration(sourceFile, name) {
  return findNamedDeclaration(
    sourceFile,
    name,
    (statement) =>
      ts.isTypeAliasDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement),
  );
}

function declarationText(sourceFile, declaration) {
  return printer
    .printNode(ts.EmitHint.Unspecified, declaration, sourceFile)
    .replace(/^ {4}/gmu, "  ")
    .replace(/^export\s+/u, "");
}

function renderStringAlias(sourceFile, aliasName) {
  const declaration = findTypeAliasDeclaration(sourceFile, aliasName);
  const type = checker.getTypeAtLocation(declaration.name);
  return `type ${aliasName} = ${checker.typeToString(
    type,
    declaration,
    typeFormatFlags,
  )};`;
}

function renderInterfaceFromType(
  sourceFile,
  aliasName,
  interfaceName,
  overrides,
) {
  const declaration = findTypeAliasDeclaration(sourceFile, aliasName);
  const type = checker.getTypeAtLocation(declaration.name);
  const lines = [`interface ${interfaceName} {`];
  for (const property of checker.getPropertiesOfType(type)) {
    const propertyDeclaration =
      property.valueDeclaration ?? property.declarations?.[0];
    if (!propertyDeclaration) {
      throw new Error(
        `Unable to resolve property ${property.name} on ${aliasName}.`,
      );
    }
    const propertyType =
      overrides[property.name] ??
      checker.typeToString(
        checker.getTypeOfSymbolAtLocation(property, propertyDeclaration),
        propertyDeclaration,
        typeFormatFlags,
      );
    const optional = property.flags & ts.SymbolFlags.Optional ? "?" : "";
    lines.push(`  ${property.name}${optional}: ${propertyType};`);
  }
  lines.push("}");
  return lines.join("\n");
}

function renderRenamedInterface(sourceFile, sourceName, targetName) {
  return declarationText(
    sourceFile,
    findInterfaceDeclaration(sourceFile, sourceName),
  ).replace(
    new RegExp(`interface ${sourceName}\\b`, "u"),
    `interface ${targetName}`,
  );
}

function indentDeclaration(declaration) {
  return declaration
    .split("\n")
    .map((line) => (line.length === 0 ? line : `  ${line}`))
    .join("\n");
}

function joinGlobalDeclarations(declarations) {
  return declarations.map(indentDeclaration).join("\n\n");
}

function buildDeclarationFile() {
  const domainAppsSource = getSourceFile("packages/domain/src/apps.ts");
  const domainChangeKindsSource = getSourceFile(
    "packages/domain/src/change-kinds.ts",
  );
  const jsonValueSource = getSourceFile("packages/domain/src/json-value.ts");
  const providerEventSource = getSourceFile(
    "packages/domain/src/provider-event.ts",
  );
  const serverContractSource = getSourceFile(
    "packages/server-contract/src/api-types.ts",
  );
  const sdkAppsSource = getSourceFile("packages/sdk/src/areas/apps.ts");
  const sdkRealtimeSource = getSourceFile("packages/sdk/src/realtime-types.ts");
  const sdkWindowSource = getSourceFile("packages/sdk/src/app-window.ts");

  const declarations = [
    renderStringAlias(domainAppsSource, "ApplicationId"),
    renderStringAlias(domainAppsSource, "AppDataPath"),
    declarationText(
      jsonValueSource,
      findInterfaceDeclaration(jsonValueSource, "JsonObject"),
    ),
    declarationText(
      jsonValueSource,
      findTypeAliasDeclaration(jsonValueSource, "JsonValue"),
    ),
    renderStringAlias(providerEventSource, "ThreadEventType"),
    ...domainChangeKindAliasNames.map((name) =>
      renderStringAlias(domainChangeKindsSource, name),
    ),
    ...domainChangedMessageInterfaceNames.map((name) =>
      declarationText(
        domainChangeKindsSource,
        findInterfaceDeclaration(domainChangeKindsSource, name),
      ),
    ),
    declarationText(
      domainChangeKindsSource,
      findTypeAliasDeclaration(domainChangeKindsSource, "ChangedMessage"),
    ),
    renderStringAlias(serverContractSource, "AppDataBroadcastMessage"),
    renderInterfaceFromType(
      serverContractSource,
      "AppDataEntry",
      "AppDataEntry",
      {
        path: "AppDataPath",
      },
    ),
    ...serverContractDeclarationNames.map((name) => {
      const isTypeAlias = name === "BbDataChangeCallback";
      return declarationText(
        serverContractSource,
        isTypeAlias
          ? findTypeAliasDeclaration(serverContractSource, name)
          : findInterfaceDeclaration(serverContractSource, name),
      );
    }),
    ...realtimeDeclarationNames.map((name) =>
      declarationText(
        sdkRealtimeSource,
        findTypeAliasOrInterfaceDeclaration(sdkRealtimeSource, name),
      ),
    ),
    ...sdkCurrentAppAliasNames.map((name) =>
      declarationText(
        sdkAppsSource,
        findTypeAliasDeclaration(sdkAppsSource, name),
      ),
    ),
    declarationText(
      sdkAppsSource,
      findInterfaceDeclaration(sdkAppsSource, "CurrentAppDataArea"),
    ),
    declarationText(
      sdkAppsSource,
      findInterfaceDeclaration(sdkAppsSource, "CurrentAppMessageArea"),
    ),
    "type BbData = CurrentAppDataArea;",
    "type BbMessage = CurrentAppMessageArea;",
    renderRenamedInterface(sdkWindowSource, "InjectedAppWindowBb", "Bb"),
    ["interface Window {", "  bb?: Bb;", "}"].join("\n"),
  ];

  const output = [
    `// GENERATED - do not edit. Run ${regenerateCommand} to regenerate.`,
    "// Source: @bb/sdk current app runtime types.",
    "export {};",
    "",
    "declare global {",
    joinGlobalDeclarations(declarations),
    "}",
    "",
  ].join("\n");

  if (/^\s*import\s/u.test(output)) {
    throw new Error(
      "Generated app globals declaration must not contain imports.",
    );
  }
  return output;
}

async function checkGeneratedFile(expected) {
  let actual = "";
  try {
    actual = await readFile(outputFile, "utf8");
  } catch {
    console.error(
      `${outputRelativePath} is missing. Run ${regenerateCommand}.`,
    );
    process.exitCode = 1;
    return;
  }
  if (actual !== expected) {
    console.error(`${outputRelativePath} is stale. Run ${regenerateCommand}.`);
    process.exitCode = 1;
  }
}

const output = buildDeclarationFile();
if (process.argv.includes("--check")) {
  await checkGeneratedFile(output);
} else {
  await writeFile(outputFile, output, "utf8");
}
