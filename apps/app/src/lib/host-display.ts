import type { Host } from "@bb/domain";
import type { IconName } from "@bb/shared-ui/icon";

/**
 * Canonical icon for a known persistent host (the user's machine,
 * always-on remotes). The single in-app source of truth — everything that
 * displays a known environment/host should import this rather than
 * referencing the underlying icon name directly.
 */
export const PersistentHostIconName: IconName = "Laptop";

/** Icon name for a persistent host. */
export function getHostIconName(_host: Host | undefined | null): IconName {
  return PersistentHostIconName;
}
