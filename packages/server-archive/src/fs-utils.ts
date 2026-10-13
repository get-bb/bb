import { constants, type Stats } from "node:fs";
import { copyFile, lstat, rename, rm } from "node:fs/promises";
import { hasErrorCode } from "./errors.js";

export async function lstatOrNull(path: string): Promise<Stats | null> {
  try {
    return await lstat(path);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return null;
    }
    throw error;
  }
}

export async function moveFile(
  sourcePath: string,
  destinationPath: string,
): Promise<void> {
  try {
    await rename(sourcePath, destinationPath);
  } catch (error) {
    if (!hasErrorCode(error, "EXDEV")) {
      throw error;
    }
    await copyFile(sourcePath, destinationPath, constants.COPYFILE_EXCL);
    await rm(sourcePath, { force: true });
  }
}
