interface CloudDevViteSettings {
  persistStatePath: string;
  vars: Record<string, string>;
}

export function resolveCloudDevViteSettings(
  command: string,
  env: Record<string, string | undefined>,
): CloudDevViteSettings | null {
  if (command !== "serve") return null;

  const persistStatePath = env.BB_CLOUD_DEV_STATE_PATH?.trim();
  const appUrl = env.BB_CLOUD_DEV_APP_URL?.trim();
  const serverUrlTemplate = env.BB_CLOUD_DEV_SERVER_URL_TEMPLATE?.trim();
  const betterAuthSecret = env.BETTER_AUTH_SECRET?.trim();
  if (!persistStatePath || !appUrl || !serverUrlTemplate || !betterAuthSecret) {
    return null;
  }

  return {
    persistStatePath,
    vars: {
      APP_URL: appUrl,
      BASE_DOMAIN: new URL(appUrl).hostname,
      BETTER_AUTH_SECRET: betterAuthSecret,
      CONNECT_SERVER_URL_TEMPLATE: serverUrlTemplate,
      DEV_EMAIL_PASSWORD_AUTH: "true",
      GITHUB_CLIENT_ID: "local-cloud-dev-unused",
      GITHUB_CLIENT_SECRET: "local-cloud-dev-unused",
    },
  };
}
