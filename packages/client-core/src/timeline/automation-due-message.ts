const AUTOMATION_DUE_PREFIX_PATTERN = /^\[bb automation due:([^\]\s]+)\]\s*/u;

export interface AutomationDueMessage {
  automationId: string;
  bodyOffset: number;
}

export function parseAutomationDueMessage(
  text: string,
): AutomationDueMessage | null {
  const match = AUTOMATION_DUE_PREFIX_PATTERN.exec(text);
  const automationId = match?.[1];
  return match === null || automationId === undefined
    ? null
    : { automationId, bodyOffset: match[0].length };
}
