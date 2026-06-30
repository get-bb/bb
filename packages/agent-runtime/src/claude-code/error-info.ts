import type { ProviderErrorCategory, ProviderErrorInfo } from "@bb/domain";
import type {
  ClaudeAssistantMessageError,
  ClaudeResultSubtype,
} from "./schemas.js";

export interface BuildClaudeProviderErrorInfoArgs {
  code?: ClaudeAssistantMessageError;
  httpStatusCode?: number | null;
  resultSubtype?: string;
}

function getProviderErrorCategoryFromHttpStatus(
  httpStatusCode: number,
): ProviderErrorCategory {
  if (httpStatusCode === 402) {
    return "billing";
  }
  if (httpStatusCode === 401 || httpStatusCode === 403) {
    return "unauthorized";
  }
  if (httpStatusCode === 429) {
    return "rate-limit";
  }
  if (httpStatusCode === 529) {
    return "overloaded";
  }
  if (httpStatusCode >= 400 && httpStatusCode < 500) {
    return "bad-request";
  }
  if (httpStatusCode >= 500 && httpStatusCode < 600) {
    return "internal";
  }
  return "unknown";
}

function getProviderErrorCategoryFromClaudeCode(
  code: ClaudeAssistantMessageError,
  httpStatusCode: number | null,
): ProviderErrorCategory {
  if (httpStatusCode === 529) {
    return "overloaded";
  }

  switch (code) {
    case "authentication_failed":
    case "oauth_org_not_allowed":
      return "unauthorized";
    case "billing_error":
      return "billing";
    case "rate_limit":
      return "rate-limit";
    case "invalid_request":
    case "model_not_found":
      return "bad-request";
    case "server_error":
      return "internal";
    case "max_output_tokens":
      return "max-output-tokens";
    case "unknown":
      return httpStatusCode !== null
        ? getProviderErrorCategoryFromHttpStatus(httpStatusCode)
        : "unknown";
  }
}

function parseClaudeResultSubtype(
  resultSubtype: string | undefined,
): ClaudeResultSubtype | null {
  switch (resultSubtype) {
    case "success":
    case "error_during_execution":
    case "error_max_turns":
    case "error_max_budget_usd":
    case "error_max_structured_output_retries":
      return resultSubtype;
    case undefined:
      return null;
    default:
      return null;
  }
}

function getProviderErrorCategoryFromClaudeResultSubtype(
  resultSubtype: ClaudeResultSubtype,
): ProviderErrorCategory {
  switch (resultSubtype) {
    case "success":
    case "error_during_execution":
      return "unknown";
    case "error_max_turns":
      return "max-turns";
    case "error_max_budget_usd":
      return "budget-exceeded";
    case "error_max_structured_output_retries":
      return "structured-output-retries";
  }
}

function getClaudeProviderCode(
  args: BuildClaudeProviderErrorInfoArgs,
): string | null {
  if (args.code !== undefined) {
    return args.code;
  }
  const resultSubtype = parseClaudeResultSubtype(args.resultSubtype);
  if (resultSubtype && resultSubtype !== "success") {
    return resultSubtype;
  }
  return null;
}

export function buildClaudeProviderErrorInfo(
  args: BuildClaudeProviderErrorInfoArgs,
): ProviderErrorInfo | null {
  const httpStatusCode = args.httpStatusCode ?? null;
  const resultSubtype = parseClaudeResultSubtype(args.resultSubtype);
  const category =
    args.code !== undefined
      ? getProviderErrorCategoryFromClaudeCode(args.code, httpStatusCode)
      : httpStatusCode !== null
        ? getProviderErrorCategoryFromHttpStatus(httpStatusCode)
        : resultSubtype
          ? getProviderErrorCategoryFromClaudeResultSubtype(resultSubtype)
          : "unknown";
  const providerCode = getClaudeProviderCode(args);
  if (
    category === "unknown" &&
    providerCode === null &&
    httpStatusCode === null
  ) {
    return null;
  }

  return {
    category,
    providerCode,
    httpStatusCode,
  };
}
