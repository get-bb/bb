const AUTOMATION_DUE_PREFIX_PATTERN = /^\[bb automation due:[^\]\s]+\]\s*/u;

export function automationDueBodyOffset(text: string): number | null {
  const match = AUTOMATION_DUE_PREFIX_PATTERN.exec(text);
  return match === null ? null : match[0].length;
}
