/**
 * Compiles the generated app globals declaration plus a consumer exercising
 * window.bb (realtime on, data, message) and returns formatted TypeScript
 * diagnostics. An empty array means the declaration is valid, self-contained
 * TypeScript.
 */
export declare function collectAppGlobalsDeclarationDiagnostics(
  declarationText: string,
): string[];
