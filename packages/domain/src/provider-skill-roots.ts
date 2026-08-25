/**
 * The one rule for a provider-native skill root path.
 *
 * A root is relative — to the target host's home directory (`user`) or to the
 * workspace (`project`) — and names no dot segment, because bb resolves it
 * against a directory the user did not choose. Shared so the two boundaries
 * that enforce it cannot drift: the plugin declaration validator, which
 * rejects a bad root at registration, and the wire schema the daemon parses.
 */
/**
 * The rule for a host-absolute provider root: an absolute path (POSIX or a
 * Windows drive) with no empty or dot segment. A plugin's host entry resolves
 * such a root from what it found on the host — a settings-configured skills
 * directory — so bb still refuses a root that could walk somewhere else.
 */
export function isAbsoluteProviderSkillRootPath(value: string): boolean {
  if (value.length === 0) {
    return false;
  }
  const normalized = value.replaceAll("\\", "/");
  const drive = /^[a-zA-Z]:\//u.exec(normalized);
  const rest = drive ? normalized.slice(drive[0].length) : normalized.slice(1);
  if (!drive && !normalized.startsWith("/")) {
    return false;
  }
  return rest
    .split("/")
    .every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

export function isRelativeProviderSkillRootPath(value: string): boolean {
  if (value.length === 0) {
    return false;
  }
  const normalized = value.replaceAll("\\", "/");
  return (
    !normalized.startsWith("/") &&
    !/^[a-zA-Z]:\//u.test(normalized) &&
    normalized
      .split("/")
      .every((segment) => segment !== "" && segment !== "." && segment !== "..")
  );
}
