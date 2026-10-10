import type { Plugin, Rollup } from "vite";

function staticClosure(
  bundle: Rollup.OutputBundle,
  fileName: string,
): Set<string> {
  const files = new Set<string>();
  const visit = (name: string) => {
    if (files.has(name)) return;
    files.add(name);
    const chunk = bundle[name];
    if (chunk?.type === "chunk") chunk.imports.forEach(visit);
  };
  visit(fileName);
  return files;
}

export function routeModulePreload(modulePath: string): Plugin {
  let base = "/";
  return {
    name: "bb:route-modulepreload",
    apply: "build",
    configResolved(config) {
      base = config.base;
    },
    transformIndexHtml: {
      order: "post",
      handler(_html, { bundle }) {
        if (bundle === undefined) return [];
        const chunks = Object.values(bundle).filter(
          (output): output is Rollup.OutputChunk => output.type === "chunk",
        );
        const route = chunks.find((chunk) =>
          Object.keys(chunk.modules).some((module) =>
            module.endsWith(`/${modulePath}`),
          ),
        );
        if (route === undefined)
          throw new Error(`Missing route chunk for ${modulePath}`);
        const entry = chunks.find((chunk) => chunk.isEntry);
        const boot =
          entry === undefined
            ? new Set<string>()
            : staticClosure(bundle, entry.fileName);
        return [...staticClosure(bundle, route.fileName)]
          .filter((file) => !boot.has(file))
          .map((file) => ({
            tag: "link",
            attrs: {
              rel: "modulepreload",
              crossorigin: true,
              href: `${base}${file}`,
            },
            injectTo: "head" as const,
          }));
      },
    },
  };
}
