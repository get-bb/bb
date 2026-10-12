const SERVER_TITLE_SEPARATOR = " — ";

interface FormatApplicationWindowTitleArgs {
  pageTitle: string;
  serverName: string | null;
}

export function formatApplicationWindowTitle(
  args: FormatApplicationWindowTitleArgs,
): string {
  return args.serverName === null
    ? args.pageTitle
    : `${args.pageTitle}${SERVER_TITLE_SEPARATOR}${args.serverName}`;
}

export function shouldShowServerInWindowTitles(
  serverIds: Iterable<string>,
): boolean {
  return new Set(serverIds).size >= 2;
}
