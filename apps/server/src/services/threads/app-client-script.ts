import {
  appRuntimeBrowserBundle,
  createAppRuntimeBootstrapScript,
  type AppRuntimeBootstrap,
} from "@bb/sdk/app-runtime";

export type AppClientBootstrap = AppRuntimeBootstrap;

interface CreateAppClientScriptArgs {
  bootstrap: AppClientBootstrap;
}

interface AppRuntimeScriptAsset {
  /** Exact JavaScript text served at {@link AppRuntimeScriptAsset.url}. */
  contents: string;
  /** Content-hashed file name (`<sha256>.js`) the runtime route validates. */
  fileName: string;
  /** Root-relative URL injected app HTML references. */
  url: string;
}

const APP_CLIENT_SCRIPT_MARKER = "data-bb-app-client";

/**
 * The window.bb runtime is served once as an immutable, content-hashed asset
 * instead of being inlined into every app HTML response. Only the small
 * bootstrap assignment stays inline, because it carries per-response values
 * (the app session token).
 */
export const appRuntimeScriptAsset: AppRuntimeScriptAsset = {
  contents: appRuntimeBrowserBundle.contents,
  fileName: `${appRuntimeBrowserBundle.sha256}.js`,
  url: `/api/v1/app-runtime/${appRuntimeBrowserBundle.sha256}.js`,
};

function escapedJsonForInlineScript(value: AppClientBootstrap): string {
  return JSON.stringify(value).replace(/</gu, "\\u003c");
}

export function createAppClientScript(args: CreateAppClientScriptArgs): string {
  const bootstrapScript = createAppRuntimeBootstrapScript({
    bootstrapJson: escapedJsonForInlineScript(args.bootstrap),
  });
  return `<script ${APP_CLIENT_SCRIPT_MARKER}>${bootstrapScript}</script><script src="${appRuntimeScriptAsset.url}"></script>`;
}

export function injectAppClientScript(
  html: string,
  bootstrap: AppClientBootstrap,
): string {
  if (html.includes(APP_CLIENT_SCRIPT_MARKER)) {
    return html;
  }

  const script = createAppClientScript({ bootstrap });
  const firstScriptIndex = html.search(/<script\b/iu);
  const headCloseIndex = html.search(/<\/head>/iu);
  if (firstScriptIndex !== -1) {
    return `${html.slice(0, firstScriptIndex)}${script}${html.slice(
      firstScriptIndex,
    )}`;
  }
  if (headCloseIndex !== -1) {
    return `${html.slice(0, headCloseIndex)}${script}${html.slice(
      headCloseIndex,
    )}`;
  }

  const htmlOpenMatch = /<html\b[^>]*>/iu.exec(html);
  if (htmlOpenMatch?.index !== undefined) {
    const insertIndex = htmlOpenMatch.index + htmlOpenMatch[0].length;
    return `${html.slice(0, insertIndex)}${script}${html.slice(insertIndex)}`;
  }

  return `${script}${html}`;
}
