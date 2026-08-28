import { describe, expect, it } from "vitest";
import {
  ANDROID_ASSET_LINKS_PATH,
  APPLE_APP_SITE_ASSOCIATION_PATH,
  BB_MOBILE_ANDROID_PACKAGE,
  BB_MOBILE_IOS_APP_ID,
  handleAppLinkAssociationRequest,
  parseAssetLinksFingerprints,
} from "../src/app-links.js";

type AppLinkJsonObject = { readonly [key: string]: AppLinkJsonValue };
type AppLinkJsonValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | AppLinkJsonValue[]
  | AppLinkJsonObject;

type AppleAssociation = {
  applinks: {
    details: Array<{
      appIDs: string[];
      components: Array<{ "/": string }>;
    }>;
  };
};

type AssetLink = {
  relation: string[];
  target: {
    package_name: string;
    sha256_cert_fingerprints: string[];
  };
};

function isAppLinkObject(value: AppLinkJsonValue): value is AppLinkJsonObject {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function isAppLinkString(value: AppLinkJsonValue): value is string {
  return (
    Object.prototype.toString.call(value) === "[object String]" &&
    value === String(value)
  );
}

function requireAppLinkObject(value: AppLinkJsonValue): AppLinkJsonObject {
  if (!isAppLinkObject(value)) throw new Error("invalid app link object");
  return value;
}

function requireAppLinkArray(value: AppLinkJsonValue): AppLinkJsonValue[] {
  if (!Array.isArray(value)) throw new Error("invalid app link array");
  return value;
}

function requireAppLinkString(value: AppLinkJsonValue): string {
  if (!isAppLinkString(value)) throw new Error("invalid app link string");
  return value;
}

function parseAppleAssociation(value: AppLinkJsonValue): AppleAssociation {
  const root = requireAppLinkObject(value);
  const applinks = requireAppLinkObject(root.applinks);
  const details = requireAppLinkArray(applinks.details).map((entry) => {
    const detail = requireAppLinkObject(entry);
    const appIDs = requireAppLinkArray(detail.appIDs).map(requireAppLinkString);
    const components = requireAppLinkArray(detail.components).map((entry) => {
      const component = requireAppLinkObject(entry);
      return { "/": requireAppLinkString(component["/"]) };
    });
    return { appIDs, components };
  });
  return { applinks: { details } };
}

function parseAssetLinks(value: AppLinkJsonValue): AssetLink[] {
  return requireAppLinkArray(value).map((entry) => {
    const assetLink = requireAppLinkObject(entry);
    const relation = requireAppLinkArray(assetLink.relation).map(
      requireAppLinkString,
    );
    const target = requireAppLinkObject(assetLink.target);
    return {
      relation,
      target: {
        package_name: requireAppLinkString(target.package_name),
        sha256_cert_fingerprints: requireAppLinkArray(
          target.sha256_cert_fingerprints,
        ).map(requireAppLinkString),
      },
    };
  });
}

describe("app link association files", () => {
  it("serves the AASA as application/json with the app id and path allowlist", async () => {
    const response = handleAppLinkAssociationRequest(
      {
        method: "GET",
        url: `https://sawyer.getbb.app${APPLE_APP_SITE_ASSOCIATION_PATH}`,
      },
      {},
    );
    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toBe("application/json");
    const body = parseAppleAssociation(await response?.json());
    expect(body.applinks.details).toEqual([
      {
        appIDs: [BB_MOBILE_IOS_APP_ID],
        components: [
          { "/": "/threads/*" },
          { "/": "/projects/*" },
          { "/": "/settings/*" },
        ],
      },
    ]);
    expect(Object.keys(body.applinks)).toEqual(["details"]);
  });

  it("serves assetlinks.json with the fingerprints from the env (empty when unset)", async () => {
    const unset = handleAppLinkAssociationRequest(
      { method: "GET", url: `https://getbb.app${ANDROID_ASSET_LINKS_PATH}` },
      {},
    );
    const unsetBody = parseAssetLinks(await unset?.json());
    expect(unsetBody[0]?.target.package_name).toBe(BB_MOBILE_ANDROID_PACKAGE);
    expect(unsetBody[0]?.target.sha256_cert_fingerprints).toEqual([]);

    const set = handleAppLinkAssociationRequest(
      { method: "GET", url: `https://getbb.app${ANDROID_ASSET_LINKS_PATH}` },
      { ASSETLINKS_SHA256_FINGERPRINTS: "aa:bb:cc, dd:ee:ff\n11:22" },
    );
    const setBody = parseAssetLinks(await set?.json());
    expect(setBody[0]?.target.sha256_cert_fingerprints).toEqual([
      "AA:BB:CC",
      "DD:EE:FF",
      "11:22",
    ]);
    expect(parseAssetLinksFingerprints(undefined)).toEqual([]);
  });

  it("ignores other paths and refuses non-GET methods", () => {
    expect(
      handleAppLinkAssociationRequest(
        { method: "GET", url: "https://getbb.app/.well-known/other" },
        {},
      ),
    ).toBeNull();
    expect(
      handleAppLinkAssociationRequest(
        { method: "GET", url: "https://getbb.app/threads/x" },
        {},
      ),
    ).toBeNull();
    const post = handleAppLinkAssociationRequest(
      {
        method: "POST",
        url: `https://getbb.app${APPLE_APP_SITE_ASSOCIATION_PATH}`,
      },
      {},
    );
    expect(post?.status).toBe(405);
    const head = handleAppLinkAssociationRequest(
      {
        method: "HEAD",
        url: `https://getbb.app${APPLE_APP_SITE_ASSOCIATION_PATH}`,
      },
      {},
    );
    expect(head?.status).toBe(200);
    expect(head?.body).toBeNull();
  });
});
