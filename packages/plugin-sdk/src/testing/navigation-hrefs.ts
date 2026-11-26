import type {
  ExperimentalSettingsSection,
  ExperimentalSettingsTarget,
} from "@get-bb/plugin-sdk";

const SETTINGS_SECTIONS: Record<ExperimentalSettingsSection, true> = {
  general: true,
  providers: true,
  "ai-services": true,
  appearance: true,
  keyboard: true,
  browser: true,
  files: true,
  projects: true,
  machines: true,
  mobile: true,
  devices: true,
  "environment-variables": true,
  updates: true,
  plugins: true,
  marketplaces: true,
  experiments: true,
  community: true,
  archived: true,
};

export function assertTestSettingsTarget(
  target: ExperimentalSettingsTarget | undefined,
): void {
  if (
    target !== undefined &&
    !Object.hasOwn(SETTINGS_SECTIONS, target.section)
  ) {
    throw new RangeError(
      `Unknown settings section "${String(target.section)}"`,
    );
  }
}

export function assertTestMessageSeq(messageSeq: number | undefined): void {
  if (
    messageSeq !== undefined &&
    (!Number.isSafeInteger(messageSeq) || messageSeq < 0)
  ) {
    throw new RangeError(
      `messageSeq must be a non-negative integer, got ${messageSeq}`,
    );
  }
}

export function testThreadHref(
  threadId: string,
  options?: { messageSeq?: number },
): string {
  const messageSeq = options?.messageSeq;
  assertTestMessageSeq(messageSeq);
  const path = `/threads/${threadId}`;
  return messageSeq === undefined ? path : `${path}#msg=${messageSeq}`;
}

export function testSettingsHref(
  target: ExperimentalSettingsTarget | undefined,
  pluginId: string,
): string {
  assertTestSettingsTarget(target);
  if (target === undefined) {
    return `/settings/plugins/${encodeURIComponent(pluginId)}`;
  }
  return target.section === "general"
    ? "/settings"
    : `/settings/${target.section}`;
}
