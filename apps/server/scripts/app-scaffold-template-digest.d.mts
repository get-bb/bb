export declare const appScaffoldTemplatePath: string;
export declare const appScaffoldTemplateSourcePath: string;
export declare const appScaffoldTemplateDigestPath: string;

export interface AppScaffoldTemplateDigest {
  public: Record<string, string>;
  source: Record<string, string>;
}

/**
 * Hashes the app scaffold template's editable source/ tree (the vite build
 * inputs, including the generated bb-sdk.d.ts) and the committed prebuilt
 * public/ tree it produces. The recorded digest pins both sides so neither
 * can change without rerunning the rebuild script.
 */
export declare function computeAppScaffoldTemplateDigest(): AppScaffoldTemplateDigest;
