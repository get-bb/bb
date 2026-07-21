export function isComposerDraftEmpty(
  text: string,
  attachmentCount: number,
): boolean {
  return text.trim().length === 0 && attachmentCount === 0;
}
