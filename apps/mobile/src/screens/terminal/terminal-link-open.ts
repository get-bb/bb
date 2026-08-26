interface TerminalLinkConfirmationRequest {
  actionLabel: string;
  message: string;
  onConfirm: () => void;
  title: string;
}

interface RequestTerminalLinkOpenArgs {
  confirm: (request: TerminalLinkConfirmationRequest) => void;
  openUrl: (url: string) => unknown;
  source: "detected-url" | "osc8";
  url: string;
}

/**
 * Terminal output is untrusted and OSC-8 display text can hide its target.
 * Keep URL opening behind a native confirmation that displays the exact URL.
 */
export function requestTerminalLinkOpen({
  confirm,
  openUrl,
  source,
  url,
}: RequestTerminalLinkOpenArgs): void {
  if (source === "detected-url") {
    void openUrl(url);
    return;
  }
  confirm({
    actionLabel: "Open",
    message: url,
    onConfirm: () => {
      void openUrl(url);
    },
    title: "Open terminal link?",
  });
}
