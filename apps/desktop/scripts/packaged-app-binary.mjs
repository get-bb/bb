import { access, readdir } from "node:fs/promises";
import { join } from "node:path";

export function packagedAppBinaryRelativePath(args) {
  if (args.platform === "win32") {
    return `${args.applicationName}.exe`;
  }
  if (args.platform === "linux") {
    return args.applicationName;
  }
  return join(
    `${args.applicationName}.app`,
    "Contents",
    "MacOS",
    args.applicationName,
  );
}

function packagedOutputDirectoryPrefixes(platform) {
  if (platform === "win32") {
    return ["win"];
  }
  if (platform === "linux") {
    return ["linux"];
  }
  return ["mac"];
}

function preferredPackagedOutputDirectoryNames(args) {
  if (args.platform === "win32") {
    return args.arch === "arm64"
      ? ["win-arm64-unpacked", "win-arm64"]
      : ["win-unpacked", "win"];
  }
  if (args.platform === "linux") {
    return args.arch === "arm64"
      ? ["linux-arm64-unpacked", "linux-arm64"]
      : ["linux-unpacked", "linux"];
  }
  return args.arch === "x64" ? ["mac"] : ["mac-arm64", "mac"];
}

export async function resolvePackagedAppBinary(args) {
  const entries = await readdir(args.releaseDir, { withFileTypes: true });
  const prefixes = packagedOutputDirectoryPrefixes(args.platform);
  const matchingDirectories = entries
    .filter(
      (entry) =>
        entry.isDirectory() &&
        prefixes.some((prefix) => entry.name.startsWith(prefix)),
    )
    .map((entry) => entry.name);
  const preferredNames = preferredPackagedOutputDirectoryNames({
    arch: args.arch ?? process.arch,
    platform: args.platform,
  });
  const preferredDirectories = preferredNames.filter((name) =>
    matchingDirectories.includes(name),
  );
  const remainingDirectories = matchingDirectories
    .filter((name) => !preferredDirectories.includes(name))
    .sort();
  const outputDirectories = [
    ...preferredDirectories,
    ...remainingDirectories,
  ];

  const relativePath = packagedAppBinaryRelativePath({
    applicationName: args.applicationName,
    platform: args.platform,
  });

  for (const directory of outputDirectories) {
    const appBinary = join(args.releaseDir, directory, relativePath);
    try {
      await access(appBinary);
      return appBinary;
    } catch {
      continue;
    }
  }

  throw new Error(
    `No packaged ${args.applicationName} binary found under ${args.releaseDir}`,
  );
}
