import CookieManager from "@react-native-cookies/cookies";
import type { CookieStoreLike } from "../session/cookie-store";

/**
 * `@react-native-cookies/cookies` behind the session cookie contract. On iOS
 * `useWebKit=false` writes NSHTTPCookieStorage (fetch/WebSocket/expo-image)
 * and `useWebKit=true` writes WKHTTPCookieStore (WebView); Android has one
 * CookieManager.
 */
export const nativeCookieStore: CookieStoreLike = {
  set: (url, cookie, useWebKit) => CookieManager.set(url, cookie, useWebKit),
};
