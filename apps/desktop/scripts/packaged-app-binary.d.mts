export function packagedAppBinaryRelativePath(args: {
  applicationName: string;
  platform: string;
}): string;

export function resolvePackagedAppBinary(args: {
  applicationName: string;
  arch?: string;
  platform: string;
  releaseDir: string;
}): Promise<string>;
