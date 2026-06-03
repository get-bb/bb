import {
  createAppRuntimeScript,
  type AppRuntimeBootstrap,
} from "@bb/sdk/app-runtime";

export type AppClientBootstrap = AppRuntimeBootstrap;

interface CreateAppClientScriptArgs {
  bootstrap: AppClientBootstrap;
}

const APP_CLIENT_SCRIPT_MARKER = "data-bb-app-client";

function escapedJsonForInlineScript(value: AppClientBootstrap): string {
  return JSON.stringify(value).replace(/</gu, "\\u003c");
}

export function createAppClientScript(args: CreateAppClientScriptArgs): string {
  return `<script ${APP_CLIENT_SCRIPT_MARKER}>${createAppRuntimeScript({
    bootstrapJson: escapedJsonForInlineScript(args.bootstrap),
  })}</script>`;
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
