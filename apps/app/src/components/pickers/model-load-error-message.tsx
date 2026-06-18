import type { ReactNode } from "react";
import type { SystemExecutionOptionsModelLoadError } from "@bb/server-contract";

interface ModelLoadErrorMessageProps {
  error: SystemExecutionOptionsModelLoadError;
  providerLabel: string;
}

interface FormatModelLoadErrorTextArgs {
  error: SystemExecutionOptionsModelLoadError;
  providerLabel: string;
}

const PROVIDER_CLI_HELP_LINKS: Partial<
  Record<string, { label: string; url: string }>
> = {
  codex: {
    label: "Codex CLI",
    url: "https://developers.openai.com/codex/cli",
  },
  "acp-cursor": {
    label: "Cursor CLI",
    url: "https://cursor.com/docs/cli/installation",
  },
};

function providerCliLabel({
  error,
  providerLabel,
}: FormatModelLoadErrorTextArgs): string {
  return (
    PROVIDER_CLI_HELP_LINKS[error.providerId]?.label ?? `${providerLabel} CLI`
  );
}

export function formatModelLoadErrorText({
  error,
  providerLabel,
}: FormatModelLoadErrorTextArgs): string {
  if (error.code === "timeout") {
    return `Timed out loading models for ${providerLabel}.`;
  }

  if (error.code === "missing_executable") {
    return `Could not load models for ${providerLabel}. Please make sure the ${providerCliLabel({ error, providerLabel })} is installed.`;
  }

  return `Could not load models for ${providerLabel}.`;
}

export function ModelLoadErrorMessage({
  error,
  providerLabel,
}: ModelLoadErrorMessageProps): ReactNode {
  if (error.code === "missing_executable") {
    const helpLink = PROVIDER_CLI_HELP_LINKS[error.providerId];
    if (!helpLink) {
      return formatModelLoadErrorText({ error, providerLabel });
    }
    return (
      <>
        Could not load models for {providerLabel}. Please make sure the{" "}
        <a
          href={helpLink.url}
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2 hover:text-foreground"
        >
          {helpLink.label}
        </a>{" "}
        is installed.
      </>
    );
  }

  return formatModelLoadErrorText({ error, providerLabel });
}
