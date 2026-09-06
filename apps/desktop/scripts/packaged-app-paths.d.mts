export interface ResolvePackagedAppBinaryArgs {
  executableName: string;
  platform: string;
  productName: string;
  releaseDir: string;
}

export function resolvePackagedAppBinary(
  args: ResolvePackagedAppBinaryArgs,
): Promise<string>;
