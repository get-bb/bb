import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Abbreviate a conventional absolute home directory for display only.
 *
 * Detail surfaces can show paths from remote hosts, so the browser cannot use
 * its own HOME value. Preserve the original path for actions and compact only
 * the standard macOS, Linux, root, and Windows home layouts users recognize.
 */
export function formatHomePathForDisplay(pathValue: string): string {
  const homePrefix =
    pathValue.match(/^\/Users\/[^/]+(?=\/|$)/)?.[0] ??
    pathValue.match(/^\/home\/[^/]+(?=\/|$)/)?.[0] ??
    pathValue.match(/^\/root(?=\/|$)/)?.[0] ??
    pathValue.match(/^[A-Za-z]:[\\/]Users[\\/][^\\/]+(?=[\\/]|$)/i)?.[0];
  return homePrefix === undefined
    ? pathValue
    : `~${pathValue.slice(homePrefix.length)}`;
}
