import {
  compileTypstPdf,
  compileTypstVector,
  renderTypstSvg,
  type TypstCompileRequest,
} from "./typst-engine.js";
import { splitTypstPages, type TypstPage } from "./typst-pages.js";

const MAX_CACHED_DOCUMENTS = 24;

const cache = new Map<string, TypstDocument>();

export interface TypstDocument {
  pages: () => Promise<readonly TypstPage[]>;
  pdf: () => Promise<Uint8Array>;
  svg: Promise<string>;
  vector: Promise<Uint8Array>;
}

export function hashTypstSource(source: string): string {
  let hash = 5381;
  for (let index = 0; index < source.length; index += 1) {
    hash = ((hash << 5) + hash) ^ source.charCodeAt(index);
  }
  return (hash >>> 0).toString(16);
}

export function typstDocumentKey(input: {
  content: string;
  file: string;
  source: string;
}): string {
  return [input.source, input.file, hashTypstSource(input.content)].join("\u0000");
}

export function loadTypstDocument(
  key: string,
  request: TypstCompileRequest,
): TypstDocument {
  const cached = cache.get(key);
  if (cached !== undefined) {
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }

  const vector = compileTypstVector(request);
  const svg = vector.then((artifactContent) => renderTypstSvg(artifactContent));
  let pdf: Promise<Uint8Array> | null = null;
  let pages: Promise<readonly TypstPage[]> | null = null;
  const document: TypstDocument = {
    vector,
    svg,
    pages: () => {
      pages ??= svg.then((value) => splitTypstPages(value));
      return pages;
    },
    pdf: () => {
      pdf ??= compileTypstPdf(request).catch((error: unknown) => {
        pdf = null;
        throw error;
      });
      return pdf;
    },
  };

  void vector.catch(() => {
    if (cache.get(key) === document) cache.delete(key);
  });
  void svg.catch(() => undefined);

  cache.set(key, document);
  while (cache.size > MAX_CACHED_DOCUMENTS) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return document;
}

export function resetTypstDocument(key: string): void {
  cache.delete(key);
}

export function resetTypstDocuments(): void {
  cache.clear();
}
