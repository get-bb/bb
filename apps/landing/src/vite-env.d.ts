/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** PostHog project API key. Analytics is a no-op when unset. */
  readonly VITE_POSTHOG_KEY?: string;
  /** PostHog ingestion host. Defaults to https://us.i.posthog.com. */
  readonly VITE_POSTHOG_HOST?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
