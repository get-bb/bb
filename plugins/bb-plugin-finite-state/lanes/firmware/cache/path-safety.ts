import { createHash } from "node:crypto";
import { closeSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import { lstat, mkdir, readdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { FirmwareCacheError } from "./layout.js";

const WINDOWS_ABSOLUTE = /^[A-Za-z]:[\\/]/u;

function hasHostPrefix(value: string): boolean {
  return (
    WINDOWS_ABSOLUTE.test(value) ||
    value.startsWith("\\\\") ||
    value.startsWith("//") ||
    /^file:/iu.test(value)
  );
}

export function normalizeVirtualPath(value: string): string {
  if (value.includes("\0")) {
    throw new FirmwareCacheError("UNSAFE_FIRMWARE_PATH", "Firmware paths may not contain NUL.");
  }
  if (hasHostPrefix(value) || value.includes("\\")) {
    throw new FirmwareCacheError(
      "UNSAFE_FIRMWARE_PATH",
      "Host-absolute and backslash firmware paths are not allowed.",
    );
  }

  const absoluteVirtual = value.startsWith("/") ? value : `/${value}`;
  const segments = absoluteVirtual.split("/").slice(1);
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new FirmwareCacheError(
      "UNSAFE_FIRMWARE_PATH",
      "Firmware paths must contain only non-traversing segments.",
    );
  }
  const normalized = segments.map((segment) => segment.normalize("NFC"));
  return `/${normalized.join("/")}`;
}

function isContained(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

async function assertNoUnicodeCollision(parent: string, segment: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(parent);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const collision = entries.find(
    (entry) => entry.normalize("NFC") === segment.normalize("NFC") && entry !== segment,
  );
  if (collision) {
    throw new FirmwareCacheError(
      "FIRMWARE_PATH_NORMALIZATION_COLLISION",
      "Two firmware path segments normalize to the same Unicode name.",
    );
  }
}

export async function resolveSafeNodePath(
  rootfs: string,
  virtualPath: string,
  createParents = false,
): Promise<string> {
  const root = await realpath(rootfs);
  const normalized = normalizeVirtualPath(virtualPath);
  const segments = normalized.slice(1).split("/");
  let parent = root;

  for (const segment of segments.slice(0, -1)) {
    await assertNoUnicodeCollision(parent, segment);
    const next = resolve(parent, segment);
    if (!isContained(root, next)) {
      throw new FirmwareCacheError("UNSAFE_FIRMWARE_PATH", "Firmware path escaped rootfs.");
    }
    try {
      const stat = await lstat(next);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new FirmwareCacheError(
          "FIRMWARE_SYMLINK_PARENT",
          "Firmware writes may not traverse a symlink or non-directory parent.",
        );
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (!createParents) throw error;
      await mkdir(next, { mode: 0o755 });
    }
    parent = next;
  }

  const leaf = segments.at(-1)!;
  await assertNoUnicodeCollision(parent, leaf);
  const candidate = resolve(parent, leaf);
  if (!isContained(root, candidate) || dirname(candidate) !== parent) {
    throw new FirmwareCacheError("UNSAFE_FIRMWARE_PATH", "Firmware path escaped rootfs.");
  }
  return candidate;
}

export function safeSymlinkTarget(nodePath: string, target: string): string {
  if (target.includes("\0") || hasHostPrefix(target) || target.includes("\\")) {
    throw new FirmwareCacheError(
      "UNSAFE_FIRMWARE_SYMLINK",
      "The firmware symlink target is not representable inside the virtual root.",
    );
  }
  const node = normalizeVirtualPath(nodePath);
  const baseSegments = node.slice(1).split("/").slice(0, -1);
  const targetSegments = target.startsWith("/") ? [] : [...baseSegments];
  const rawSegments = target.split("/").filter((segment) => segment !== "" && segment !== ".");
  for (const segment of rawSegments) {
    if (segment === "..") {
      if (targetSegments.length === 0) {
        throw new FirmwareCacheError(
          "UNSAFE_FIRMWARE_SYMLINK",
          "The firmware symlink target escapes the virtual root.",
        );
      }
      targetSegments.pop();
    } else {
      targetSegments.push(segment.normalize("NFC"));
    }
  }
  if (!target.startsWith("/")) return target;
  const from = `/${baseSegments.join("/")}`;
  const to = targetSegments.length === 0 ? "/" : `/${targetSegments.join("/")}`;
  const rel = relative(from, to).split(sep).join("/");
  return rel || ".";
}

export function verifyRegularFileBytesSync(
  rootfs: string,
  virtualPath: string,
  expectedSha256: string,
  expectedSize: number | null,
): boolean {
  try {
    const root = realpathSync(rootfs);
    const segments = normalizeVirtualPath(virtualPath).slice(1).split("/");
    let current = root;
    for (const [index, segment] of segments.entries()) {
      current = resolve(current, segment);
      if (!isContained(root, current)) return false;
      const stat = lstatSync(current);
      if (stat.isSymbolicLink()) return false;
      if (index < segments.length - 1 && !stat.isDirectory()) return false;
      if (index === segments.length - 1) {
        if (!stat.isFile() || (expectedSize !== null && stat.size !== expectedSize)) return false;
      }
    }

    const descriptor = openSync(current, "r");
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    try {
      let bytesRead = 0;
      do {
        bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
        if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
      } while (bytesRead > 0);
    } finally {
      closeSync(descriptor);
    }
    return hash.digest("hex") === expectedSha256;
  } catch {
    return false;
  }
}
