import type { ReactNode } from "react";
import type { SystemExecutionOptionsModelLoadError } from "@bb/server-contract";
import { useUrlAnchorClickHandler } from "@/lib/url-open-routing";

interface ModelLoadErrorMessageProps {
  error: SystemExecutionOptionsModelLoadError;
  providerLabel: string;
  installUrl?: string;
}

interface FormatModelLoadErrorTextArgs {
  error: SystemExecutionOptionsModelLoadError;
  providerLabel: string;
}

export function formatModelLoadErrorSummary({
  providerLabel,
}: Pick<FormatModelLoadErrorTextArgs, "providerLabel">): string {
  return `Could not load models for ${providerLabel}.`;
}

export function formatModelLoadErrorReason({
  error,
}: Pick<FormatModelLoadErrorTextArgs, "error">): string | null {
  switch (error.code) {
    case "provider_unavailable":
      return "Provider plugin failed to load";
    case "missing_executable":
      return "CLI not found";
    case "auth_required":
      return "Not signed in";
    case "timeout":
      return "Timed out";
    case "failed":
      return error.detail;
  }
}

export function formatModelLoadErrorText(
  args: FormatModelLoadErrorTextArgs,
): string {
  const summary = formatModelLoadErrorSummary(args);
  const reason = formatModelLoadErrorReason(args);
  return reason === null ? summary : `${summary} ${reason}.`;
}

export function formatModelLoadErrorTitle(
  args: FormatModelLoadErrorTextArgs,
): string {
  const summary = formatModelLoadErrorSummary(args);
  const detail = args.error.detail ?? formatModelLoadErrorReason(args);
  return detail === null ? summary : `${summary}\n${detail}`;
}

export function ModelLoadErrorMessage({
  error,
  providerLabel,
  installUrl,
}: ModelLoadErrorMessageProps): ReactNode {
  const helpUrl = error.code === "missing_executable" ? installUrl : undefined;
  const handleHelpLinkClick = useUrlAnchorClickHandler(helpUrl);
  const reason = formatModelLoadErrorReason({ error });

  return (
    <>
      <span className="block">
        {formatModelLoadErrorSummary({ providerLabel })}
      </span>
      {reason === null ? null : (
        <span className="mt-1 line-clamp-3 block break-words opacity-80 [overflow-wrap:anywhere]">
          {helpUrl === undefined ? (
            reason
          ) : (
            <a
              href={helpUrl}
              target="_blank"
              rel="noreferrer"
              onClick={handleHelpLinkClick}
              className="underline underline-offset-2 hover:text-foreground"
            >
              {reason}
            </a>
          )}
        </span>
      )}
    </>
  );
}
