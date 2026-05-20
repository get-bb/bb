export type LocalViewModel = LoadingViewModel | StartupErrorViewModel;

export interface LoadingViewModel {
  kind: "loading";
  message: string;
  title: string;
}

export interface StartupErrorViewModel {
  details: string;
  kind: "error";
  logText: string;
  title: string;
}

export interface CreateLocalViewUrlArgs {
  viewModel: LocalViewModel;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => {
    if (character === "&") {
      return "&amp;";
    }
    if (character === "<") {
      return "&lt;";
    }
    if (character === ">") {
      return "&gt;";
    }
    if (character === '"') {
      return "&quot;";
    }
    return "&#39;";
  });
}

function renderLoadingView(viewModel: LoadingViewModel): string {
  return `
    <main class="shell">
      <div class="spinner"></div>
      <h1>${escapeHtml(viewModel.title)}</h1>
      <p>${escapeHtml(viewModel.message)}</p>
    </main>
  `;
}

function renderErrorView(viewModel: StartupErrorViewModel): string {
  const logs =
    viewModel.logText.trim().length > 0
      ? `<pre>${escapeHtml(viewModel.logText)}</pre>`
      : "";
  return `
    <main class="shell shell-error">
      <h1>${escapeHtml(viewModel.title)}</h1>
      <p>${escapeHtml(viewModel.details)}</p>
      ${logs}
    </main>
  `;
}

function renderLocalView(viewModel: LocalViewModel): string {
  const body =
    viewModel.kind === "loading"
      ? renderLoadingView(viewModel)
      : renderErrorView(viewModel);
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>bb</title>
  <style>
    :root {
      color-scheme: light dark;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    body {
      align-items: center;
      background: Canvas;
      color: CanvasText;
      display: flex;
      height: 100vh;
      justify-content: center;
      margin: 0;
    }

    .shell {
      max-width: 680px;
      padding: 32px;
      text-align: center;
    }

    .shell-error {
      text-align: left;
    }

    h1 {
      font-size: 22px;
      font-weight: 600;
      letter-spacing: 0;
      line-height: 1.25;
      margin: 16px 0 8px;
    }

    p {
      color: color-mix(in srgb, CanvasText 74%, transparent);
      font-size: 14px;
      line-height: 1.5;
      margin: 0;
    }

    pre {
      background: color-mix(in srgb, CanvasText 8%, transparent);
      border-radius: 6px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      line-height: 1.45;
      margin: 18px 0 0;
      max-height: 260px;
      overflow: auto;
      padding: 12px;
      white-space: pre-wrap;
    }

    .spinner {
      animation: spin 0.9s linear infinite;
      border: 2px solid color-mix(in srgb, CanvasText 16%, transparent);
      border-top-color: CanvasText;
      border-radius: 999px;
      height: 24px;
      margin: 0 auto;
      width: 24px;
    }

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }
  </style>
</head>
<body>
${body}
</body>
</html>`;
}

export function createLocalViewUrl(args: CreateLocalViewUrlArgs): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(
    renderLocalView(args.viewModel),
  )}`;
}
