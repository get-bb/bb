export function automationDetailUrl(
  origin: string,
  projectId: string,
  automationId: string,
): string {
  return new URL(
    `/plugins/automations/automations/${encodeURIComponent(projectId)}/${encodeURIComponent(automationId)}`,
    origin,
  ).href;
}

export async function copyAutomationDetailLink(
  origin: string,
  projectId: string,
  automationId: string,
  copy: (text: string) => Promise<boolean>,
  notify: {
    success: (message: string) => unknown;
    error: (message: string) => unknown;
  },
): Promise<void> {
  let copied: boolean;
  try {
    copied = await copy(automationDetailUrl(origin, projectId, automationId));
  } catch {
    notify.error("Could not copy the link");
    return;
  }
  if (copied) notify.success("Link copied");
  else notify.error("Could not copy the link");
}
