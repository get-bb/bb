import { describe, expect, it } from "vitest";

import { THEME_INIT } from "./theme";

/* THEME_INIT ships as text and runs before anything else on the page, so it
   gets no type checking and no framework around it. These run the exact string
   the document embeds against stub globals. */

type Stub = ReturnType<typeof runThemeInit>;

function runThemeInit(options: {
  stored?: string | null;
  storageThrows?: boolean;
  osDark?: boolean;
  readyState?: string;
}) {
  const metaAttrs: Array<Record<string, string>> = [
    {
      name: "theme-color",
      media: "(prefers-color-scheme: light)",
      content: "#ffffff",
      "data-scheme": "light",
    },
    {
      name: "theme-color",
      media: "(prefers-color-scheme: dark)",
      content: "#151515",
      "data-scheme": "dark",
    },
  ];
  const metas = metaAttrs.map((attrs) => ({
    getAttribute: (key: string) => attrs[key] ?? null,
    setAttribute: (key: string, value: string) => {
      attrs[key] = value;
    },
  }));

  const classes = new Set<string>();
  const rootAttributes: Record<string, string> = {};
  const deferred: Array<() => void> = [];

  const document = {
    readyState: options.readyState ?? "loading",
    documentElement: {
      classList: { add: (name: string) => classes.add(name) },
      setAttribute: (key: string, value: string) => {
        rootAttributes[key] = value;
      },
    },
    querySelectorAll: (selector: string) =>
      selector === 'meta[name="theme-color"]' ? metas : [],
    addEventListener: (event: string, handler: () => void) => {
      if (event === "DOMContentLoaded") deferred.push(handler);
    },
  };
  const localStorage = {
    getItem: (key: string) => {
      if (options.storageThrows) throw new Error("storage is not available");
      return key === "bb.theme" ? (options.stored ?? null) : null;
    },
  };
  const matchMedia = (query: string) => ({
    matches:
      query === "(prefers-color-scheme: dark)"
        ? (options.osDark ?? false)
        : false,
  });

  new Function("document", "localStorage", "matchMedia", THEME_INIT)(
    document,
    localStorage,
    matchMedia,
  );

  return {
    get dark() {
      return classes.has("dark");
    },
    get preference() {
      return rootAttributes["data-theme-preference"];
    },
    get media() {
      return metaAttrs.map((a) => `${a["data-scheme"]}=${a.media}`);
    },
    get content() {
      return metaAttrs.map((a) => a.content);
    },
    flushDomContentLoaded: () => deferred.forEach((handler) => handler()),
  };
}

const OS_SCOPED = [
  "light=(prefers-color-scheme: light)",
  "dark=(prefers-color-scheme: dark)",
];

function settled(stub: Stub) {
  stub.flushDomContentLoaded();
  return stub;
}

describe("THEME_INIT", () => {
  it("leaves the theme-color metas to the OS when no preference is stored", () => {
    const light = settled(runThemeInit({ osDark: false }));
    expect(light.dark).toBe(false);
    expect(light.preference).toBe("system");
    expect(light.media).toEqual(OS_SCOPED);

    const dark = settled(runThemeInit({ osDark: true }));
    expect(dark.dark).toBe(true);
    expect(dark.preference).toBe("system");
    expect(dark.media).toEqual(OS_SCOPED);
  });

  it("narrows the metas by media, never by content, when a preference overrides the OS", () => {
    const stub = settled(runThemeInit({ stored: "light", osDark: true }));
    expect(stub.dark).toBe(false);
    expect(stub.preference).toBe("light");
    expect(stub.media).toEqual(["light=all", "dark=not all"]);
    // React hydrates a hoistable <meta> by matching its content attribute, so
    // editing content here would orphan the server's meta and leave a
    // duplicate behind.
    expect(stub.content).toEqual(["#ffffff", "#151515"]);
  });

  it("applies dark for a stored dark preference on a light OS", () => {
    const stub = settled(runThemeInit({ stored: "dark", osDark: false }));
    expect(stub.dark).toBe(true);
    expect(stub.preference).toBe("dark");
    expect(stub.media).toEqual(["light=not all", "dark=all"]);
  });

  it("still honours the OS scheme when storage access throws", () => {
    // Safari's "block all cookies" and sandboxed frames throw here. Reading
    // storage must not be able to abort the rest of the script, or the page
    // renders light while the nav's control reports "System".
    const stub = settled(runThemeInit({ storageThrows: true, osDark: true }));
    expect(stub.dark).toBe(true);
    expect(stub.preference).toBe("system");
  });

  it("narrows the metas immediately once the document has parsed", () => {
    const stub = runThemeInit({
      stored: "dark",
      osDark: false,
      readyState: "interactive",
    });
    expect(stub.media).toEqual(["light=not all", "dark=all"]);
  });

  it("treats an unknown stored value as system", () => {
    const stub = settled(runThemeInit({ stored: "sepia", osDark: true }));
    expect(stub.preference).toBe("system");
    expect(stub.dark).toBe(true);
    expect(stub.media).toEqual(OS_SCOPED);
  });
});
