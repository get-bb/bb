/// <reference types="vite/client" />

declare const __BB_DEV_WS_BROWSER_HOST_PORT__: number | undefined;
declare const __BB_DEV_APP_BROWSER_HOST_PORT__: number | undefined;

declare module "virtual:bb-plugin-zod" {
  export * from "zod";
  export { default } from "zod";
}
