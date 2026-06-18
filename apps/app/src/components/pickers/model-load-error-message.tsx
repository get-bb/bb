import type { ReactNode } from "react";
import type { SystemExecutionOptionsModelLoadError } from "@bb/server-contract";
import { useUrlAnchorClickHandler } from "@/lib/url-open-routing";

interface ModelLoadErrorMessageProps {
  error: SystemExecutionOptionsModelLoadError;
  providerLabel: string;
}

interface FormatModelLoadErrorTextArgs {
  error: SystemExecutionOptionsModelLoadError;
  providerLabel: string;
}

const CODEX_CLI_HELP_LINK = {
  label: "Codex CLI",
  url: "https://developers.openai.com/codex/cli",
};

export function formatModelLoadErrorText({
  error,
  providerLabel,
}: FormatModelLoadErrorTextArgs): string {
  if (error.code === "timeout") {
    return `Timed out loading models for ${providerLabel}.`;
  }

  if (error.code === "missing_executable" && error.providerId === "codex") {
    return `Could not load models for ${providerLabel}. Please make sure the ${CODEX_CLI_HELP_LINK.label} is installed.`;
  }

  return `Could not load models for ${providerLabel}.`;
}

export function ModelLoadErrorMessage({
  error,
  providerLabel,
}: ModelLoadErrorMessageProps): ReactNode {
  const handleHelpLinkClick = useUrlAnchorClickHandler(CODEX_CLI_HELP_LINK.url);

  if (error.code === "missing_executable" && error.providerId === "codex") {
    return (
      <>
        Could not load models for {providerLabel}. Please make sure the{" "}
        <a
          href={CODEX_CLI_HELP_LINK.url}
          target="_blank"
          rel="noreferrer"
          onClick={handleHelpLinkClick}
          className="underline underline-offset-2 hover:text-foreground"
        >
          {CODEX_CLI_HELP_LINK.label}
        </a>{" "}
        is installed.
      </>
    );
  }

  return formatModelLoadErrorText({ error, providerLabel });
}
