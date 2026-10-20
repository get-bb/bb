import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import type { Root, RootContent } from "mdast";
import remarkDirective from "remark-directive";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import type { Plugin } from "vite";
import { docHeadings } from "../src/docs/markdown";
import { docFrontmatterSchema, docSlugSchema } from "../src/docs/schema";
import { DOC_SECTIONS } from "../src/docs/sections";
import type { DocMeta } from "../src/docs/types";

interface DocsSourceOptions {
  contentDir: string;
  publicDir: string;
  guideSlugs: Set<string>;
  sitePaths: Set<string>;
}

interface ParsedDoc {
  file: string;
  meta: DocMeta;
  body: string;
  tree: Root;
}

function fail(file: string, message: string, node?: RootContent): never {
  const start = node?.position?.start;
  throw new Error(
    `${file}${start ? `:${start.line}:${start.column}` : ""}: ${message}`,
  );
}

function validateUrl(url: string, file: string, node: RootContent) {
  if (
    /[\u0000-\u0020\u007f\\]/.test(url) ||
    !/^(https:\/\/|\/(?!\/)|#)/.test(url)
  ) {
    fail(file, `Unsafe or unsupported URL: ${url}`, node);
  }
  let parsed: URL;
  try {
    parsed = new URL(url, "https://docs.invalid");
    decodeURIComponent(parsed.pathname);
    decodeURIComponent(parsed.hash);
  } catch {
    fail(file, `Invalid URL: ${url}`, node);
  }
  if (parsed.username || parsed.password)
    fail(file, `Credentials are not allowed in URLs: ${url}`, node);
  return parsed;
}

export async function readDocsCorpus(options: DocsSourceOptions) {
  const docs: ParsedDoc[] = [];
  const filenames = (await readdir(options.contentDir))
    .filter((file) => file.endsWith(".md"))
    .sort();
  for (const filename of filenames) {
    const file = path.join(options.contentDir, filename);
    const slugResult = docSlugSchema.safeParse(filename.slice(0, -3));
    if (!slugResult.success) fail(file, "Filename must be a kebab-case slug");
    const source = await readFile(file, "utf8");
    if (!/^---\r?\n/.test(source))
      fail(file, "Expected YAML frontmatter starting with ---");
    let parsed: ReturnType<typeof matter>;
    try {
      parsed = matter(source);
    } catch (error) {
      fail(file, `Invalid frontmatter: ${String(error)}`);
    }
    const result = docFrontmatterSchema.safeParse(parsed.data);
    if (!result.success)
      fail(file, `Invalid frontmatter: ${result.error.message}`);
    const { status, media: _media, ...data } = result.data;
    if (status === "draft") continue;
    const body = parsed.content;
    const offset =
      source.slice(0, source.length - body.length).split("\n").length - 1;
    const tree = unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkDirective)
      .parse("\n".repeat(offset) + body);
    const definitions = new Set<string>();
    visit(tree, "definition", (node) => {
      definitions.add(node.identifier);
    });
    visit(tree, (node) => {
      if (node.type === "html") fail(file, "Raw HTML is not supported", node);
      if (node.type === "heading" && node.depth === 1)
        fail(
          file,
          "Use the frontmatter title for H1; body headings start at H2",
          node,
        );
      if (
        node.type === "containerDirective" ||
        node.type === "leafDirective" ||
        node.type === "textDirective"
      ) {
        if (
          node.type !== "containerDirective" ||
          node.name !== "note" ||
          Object.keys(node.attributes ?? {}).length > 0
        ) {
          fail(
            file,
            "Only :::note without attributes is supported in this docs slice",
            node,
          );
        }
      }
      if (
        (node.type === "linkReference" || node.type === "imageReference") &&
        !definitions.has(node.identifier)
      ) {
        fail(file, `Missing link definition: ${node.identifier}`, node);
      }
    });
    docs.push({
      file,
      body,
      tree,
      meta: {
        ...data,
        slug: slugResult.data,
        path: `/docs/${slugResult.data}`,
        headings: docHeadings(tree),
      },
    });
  }
  const bySlug = new Map(docs.map((doc) => [doc.meta.slug, doc]));
  const redirects: Record<string, string> = {};
  const orders = new Set<string>();
  for (const doc of docs) {
    const { meta, file } = doc;
    const orderKey = `${meta.section}:${meta.order}`;
    if (orders.has(orderKey))
      fail(file, `Duplicate order ${meta.order} in section ${meta.section}`);
    orders.add(orderKey);
    for (const slug of meta.relatedDocs) {
      if (!bySlug.has(slug))
        fail(file, `Related doc is missing or unpublished: ${slug}`);
    }
    for (const slug of meta.relatedGuides) {
      if (!options.guideSlugs.has(slug))
        fail(file, `Unknown related guide: ${slug}`);
    }
    for (const from of meta.redirectFrom) {
      if (
        bySlug.has(from.slice("/docs/".length)) ||
        Object.hasOwn(redirects, from)
      ) {
        fail(file, `Redirect collision or cycle: ${from}`);
      }
      redirects[from] = meta.path;
    }
  }
  for (const doc of docs) {
    const links: Array<{ url: string; node: RootContent; image: boolean }> = [];
    const imageDefinitions = new Set<string>();
    visit(doc.tree, "imageReference", (node) => {
      imageDefinitions.add(node.identifier);
    });
    visit(doc.tree, (node) => {
      if (
        node.type === "link" ||
        node.type === "image" ||
        node.type === "definition"
      ) {
        links.push({
          url: node.url,
          node,
          image:
            node.type === "image" ||
            (node.type === "definition" &&
              imageDefinitions.has(node.identifier)),
        });
      }
    });
    for (const { url, node, image } of links) {
      const parsed = validateUrl(url, doc.file, node);
      if (url.startsWith("https://")) continue;
      const pathname = url.startsWith("#")
        ? doc.meta.path
        : decodeURIComponent(parsed.pathname);
      const targetPath = redirects[pathname] ?? pathname;
      if (
        !image &&
        (targetPath === "/docs" || /^\/docs\/[^/.]+$/.test(targetPath))
      ) {
        const target = bySlug.get(targetPath.slice("/docs/".length));
        if (targetPath !== "/docs" && !target)
          fail(doc.file, `Doc link is missing or unpublished: ${url}`, node);
        if (
          parsed.hash &&
          !target?.meta.headings.some(
            (heading) =>
              heading.id === decodeURIComponent(parsed.hash.slice(1)),
          )
        ) {
          fail(doc.file, `Unknown heading anchor: ${url}`, node);
        }
        continue;
      }
      if (!image && pathname.startsWith("/guides/")) {
        if (!options.guideSlugs.has(pathname.slice("/guides/".length)))
          fail(doc.file, `Unknown guide link: ${url}`, node);
        continue;
      }
      if (!image && options.sitePaths.has(pathname)) continue;
      const asset = path.resolve(options.publicDir, `.${pathname}`);
      const relative = path.relative(options.publicDir, asset);
      if (relative.startsWith("..") || path.isAbsolute(relative))
        fail(doc.file, `Asset escapes public directory: ${url}`, node);
      const exists = await stat(asset).then(
        (entry) => entry.isFile(),
        () => false,
      );
      if (!exists)
        fail(doc.file, `Unknown local page or missing asset: ${url}`, node);
    }
  }
  docs.sort(
    (a, b) =>
      DOC_SECTIONS.findIndex((section) => section.id === a.meta.section) -
        DOC_SECTIONS.findIndex((section) => section.id === b.meta.section) ||
      a.meta.order - b.meta.order,
  );
  return { docs, redirects };
}

export function docsContent(): Plugin {
  let root = "";
  let options: DocsSourceOptions;
  let corpus: ReturnType<typeof readDocsCorpus> | undefined;
  const metaId = "\0virtual:docs-meta";
  const bodiesId = "\0virtual:docs-bodies";
  const getCorpus = () => (corpus ??= readDocsCorpus(options));
  return {
    name: "docs-content",
    enforce: "pre",
    async configResolved(config) {
      root = config.root;
      const guideSlugs = new Set(
        (await readdir(path.join(root, "src/guides/pages")))
          .filter((file) => file.endsWith(".meta.ts"))
          .map((file) => file.slice(0, -8)),
      );
      const sitePaths = new Set(
        (await readdir(path.join(root, "src/routes")))
          .filter(
            (file) =>
              file.endsWith(".tsx") &&
              !file.includes("$") &&
              !file.startsWith("__"),
          )
          .map(
            (file) =>
              `/${file.slice(0, -4).replaceAll("_", "").replaceAll(".", "/")}`,
          ),
      );
      for (const dir of ["landing", "compare"]) {
        for (const file of await readdir(path.join(root, `src/${dir}/pages`))) {
          if (file.endsWith(".meta.ts"))
            sitePaths.add(
              `${dir === "compare" ? "/compare" : ""}/${file.slice(0, -8)}`,
            );
        }
      }
      sitePaths.add("/");
      options = {
        contentDir: path.join(root, "src/docs/content"),
        publicDir: config.publicDir,
        guideSlugs,
        sitePaths,
      };
    },
    resolveId(id) {
      if (id === "virtual:docs-meta") return metaId;
      if (id === "virtual:docs-bodies") return bodiesId;
    },
    async buildStart() {
      corpus = undefined;
      this.addWatchFile(options.contentDir);
      const { docs } = await getCorpus();
      for (const doc of docs) this.addWatchFile(doc.file);
    },
    async load(id) {
      if (id !== metaId && id !== bodiesId) return;
      const { docs, redirects } = await getCorpus();
      if (id === metaId)
        return `export const DOCS = ${JSON.stringify(docs.map((doc) => doc.meta))};\nexport const DOC_REDIRECTS = ${JSON.stringify(redirects)};`;
      return `export const DOC_BODIES = {${docs.map((doc) => `${JSON.stringify(doc.meta.slug)}: () => import(${JSON.stringify(`${doc.file}?docs-body`)})`).join(",")}};`;
    },
    async transform(_source, id) {
      if (!id.endsWith("?docs-body")) return;
      const { docs } = await getCorpus();
      const doc = docs.find(
        (entry) =>
          entry.file === path.normalize(id.slice(0, -"?docs-body".length)),
      );
      if (!doc) throw new Error(`${id}: Only published docs can be imported`);
      return { code: `export default ${JSON.stringify(doc.body)};`, map: null };
    },
    configureServer(server) {
      const onChange = (file: string) => {
        if (
          !file.startsWith(`${options.contentDir}${path.sep}`) ||
          !file.endsWith(".md")
        )
          return;
        corpus = undefined;
        for (const environment of Object.values(server.environments)) {
          for (const id of [
            metaId,
            bodiesId,
            ...environment.moduleGraph.idToModuleMap.keys(),
          ].filter(
            (id) =>
              id === metaId || id === bodiesId || id.endsWith("?docs-body"),
          )) {
            const module = environment.moduleGraph.getModuleById(id);
            if (module) environment.moduleGraph.invalidateModule(module);
          }
        }
        server.ws.send({ type: "full-reload" });
      };
      server.watcher.add(options.contentDir);
      server.watcher
        .on("add", onChange)
        .on("change", onChange)
        .on("unlink", onChange);
      server.httpServer?.once("close", () => {
        server.watcher
          .off("add", onChange)
          .off("change", onChange)
          .off("unlink", onChange);
      });
    },
  };
}
