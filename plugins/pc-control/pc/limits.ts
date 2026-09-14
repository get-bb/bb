import path from "node:path";

export const PROFILE_LIMITS = {
  maxProfiles: 32,
  maxNameLength: 64,
  maxPathLength: 600,
  maxArgCount: 32,
  maxArgLength: 1024,
  maxProcessNameLength: 200,
} as const;

const CONTROL_CHAR_PATTERN = /[\0-\x08\x0e-\x1f\x7f]/u;

export function exePathFormError(exePath: string): string | null {
  if (exePath.length === 0) return "Executable path is required.";
  if (exePath.length > PROFILE_LIMITS.maxPathLength) {
    return `Executable path must be at most ${PROFILE_LIMITS.maxPathLength} characters.`;
  }
  if (CONTROL_CHAR_PATTERN.test(exePath)) {
    return "Executable path must not contain control characters.";
  }
  if (!path.isAbsolute(exePath)) {
    return "Executable path must be absolute.";
  }
  return null;
}

export function cwdFormError(cwd: string): string | null {
  if (cwd.length === 0) return "Working directory is required.";
  if (cwd.length > PROFILE_LIMITS.maxPathLength) {
    return `Working directory must be at most ${PROFILE_LIMITS.maxPathLength} characters.`;
  }
  if (CONTROL_CHAR_PATTERN.test(cwd)) {
    return "Working directory must not contain control characters.";
  }
  if (!path.isAbsolute(cwd)) {
    return "Working directory must be absolute.";
  }
  return null;
}

export function argsFormError(args: readonly string[]): string | null {
  if (args.length > PROFILE_LIMITS.maxArgCount) {
    return `A profile can have at most ${PROFILE_LIMITS.maxArgCount} arguments.`;
  }
  for (const arg of args) {
    if (arg.length === 0) return "Arguments must not be empty.";
    if (arg.length > PROFILE_LIMITS.maxArgLength) {
      return `Each argument must be at most ${PROFILE_LIMITS.maxArgLength} characters.`;
    }
    if (CONTROL_CHAR_PATTERN.test(arg)) {
      return "Arguments must not contain control characters.";
    }
  }
  return null;
}

export function processNameFormError(processName: string): string | null {
  if (processName.length === 0) return "Process name must not be empty.";
  if (processName.length > PROFILE_LIMITS.maxProcessNameLength) {
    return `Process name must be at most ${PROFILE_LIMITS.maxProcessNameLength} characters.`;
  }
  if (/[\\/\0]/u.test(processName)) {
    return "Process name must be a file name without separators.";
  }
  return null;
}

export function nameFormError(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "Profile name is required.";
  if (trimmed.length > PROFILE_LIMITS.maxNameLength) {
    return `Profile name must be at most ${PROFILE_LIMITS.maxNameLength} characters.`;
  }
  return null;
}

export function hostExecutableFormError(
  exePath: string,
  platform: NodeJS.Platform,
): string | null {
  const formError = exePathFormError(exePath);
  if (formError !== null) return formError;
  if (platform === "win32" && !/\.exe$/iu.test(exePath)) {
    return "On Windows the executable path must point at an .exe file.";
  }
  return null;
}

export function defaultProcessNameForExe(exePath: string): string {
  return path.basename(exePath).replace(/\.[^.]*$/u, "");
}

export function normalizeProcessName(value: string): string {
  return value.replace(/\.(exe|com)$/iu, "").toLowerCase();
}
