import type { Plugin } from "vite";

const PRELOAD_HELPER_ID = "\0vite/preload-helper.js";
const PRELOAD_EXPORT = "export const __vitePreload =";

const downloadBeforeImportHelper = `
const downloadedScripts = new Set();
function wasDownloaded(href) {
  if (downloadedScripts.has(href)) return true;
  return performance.getEntriesByName(href).some(
    (entry) => entry.responseStatus >= 200 && entry.responseStatus < 300,
  );
}
async function downloadScript(href) {
  if (wasDownloaded(href)) return;
  let response;
  try {
    response = await fetch(href, { credentials: "same-origin" });
    if (response.ok) await response.arrayBuffer();
  } catch {
    response = undefined;
  }
  if (response === undefined || !response.ok) {
    throw new TypeError("Unable to download module script: " + href);
  }
  downloadedScripts.add(href);
}
async function downloadScripts(deps, importerUrl) {
  if (!deps || deps.length === 0) return;
  const hrefs = deps
    .map((dep) => new URL(assetsURL(dep, importerUrl), import.meta.url))
    .filter((url) => !isCssPreloadUrl(url))
    .map((url) => url.href);
  try {
    await Promise.all(hrefs.map(downloadScript));
  } catch (error) {
    const event = new Event("vite:preloadError", { cancelable: true });
    event.payload = error;
    window.dispatchEvent(event);
    if (!event.defaultPrevented) throw error;
  }
}
export const __vitePreload = (baseModule, deps, importerUrl) =>
  downloadScripts(deps, importerUrl).then(() =>
    importAfterDownload(baseModule, deps, importerUrl),
  );
`;

export function downloadBeforeImport(): Plugin {
  let wrapped = false;
  return {
    name: "bb:download-before-import",
    apply: "build",
    config() {
      return {
        build: {
          modulePreload: {
            resolveDependencies: (filename, deps, { hostType }) =>
              hostType === "js" && deps.length === 0 ? [filename] : deps,
          },
        },
      };
    },
    buildStart() {
      wrapped = false;
    },
    generateBundle(_options, bundle) {
      const importsDynamically = Object.values(bundle).some(
        (output) => output.type === "chunk" && output.dynamicImports.length > 0,
      );
      if (importsDynamically && !wrapped) {
        this.error(
          "Vite's preload helper was not wrapped; update bb:download-before-import",
        );
      }
    },
    transform: {
      filter: { id: { include: [/^\0vite\/preload-helper\.js$/] } },
      handler(code, id) {
        if (id !== PRELOAD_HELPER_ID) return null;
        if (!code.includes(PRELOAD_EXPORT)) {
          throw new Error(
            "Vite's preload helper no longer exports __vitePreload; update bb:download-before-import",
          );
        }
        wrapped = true;
        return {
          code:
            code.replace(PRELOAD_EXPORT, "const importAfterDownload =") +
            downloadBeforeImportHelper,
          map: null,
        };
      },
    },
  };
}
