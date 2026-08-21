import { access, readdir } from "node:fs/promises";
import { join } from "node:path";

export async function resolvePackagedAppBinary({
  executableName,
  platform,
  productName,
  releaseDir,
}) {
  if (platform === "linux") {
    return join(releaseDir, "linux-unpacked", executableName);
  }
  if (platform !== "darwin") {
    throw new Error(`Unsupported packaged desktop platform: ${platform}`);
  }

  const appBundleName = `${productName}.app`;
  const appBinaryRelativePath = join(
    appBundleName,
    "Contents",
    "MacOS",
    productName,
  );
  const entries = await readdir(releaseDir, { withFileTypes: true });
  const macOutputDirectories = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("mac"))
    .map((entry) => entry.name)
    .sort();

  for (const directory of macOutputDirectories) {
    const appBinary = join(releaseDir, directory, appBinaryRelativePath);
    try {
      await access(appBinary);
      return appBinary;
    } catch {
      continue;
    }
  }

  throw new Error(`No packaged ${appBundleName} found under ${releaseDir}`);
}
