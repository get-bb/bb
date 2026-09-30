export function buildAutomationEditThreadPrompt({
  name,
  projectId,
  automationId,
}: {
  name: string;
  projectId: string;
  automationId: string;
}): string {
  return `Edit the bb automation ${JSON.stringify(name)} (ID ${automationId}) in project ${projectId}. I want to `;
}
