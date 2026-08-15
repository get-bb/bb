import { parsePost, type Post } from "./parse-post";

const files = import.meta.glob<string>("./posts/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});

function slugFromPath(path: string): string {
  const match = /\/([^/]+)\.md$/.exec(path);
  if (!match) {
    throw new Error(`Could not read blog slug from ${path}`);
  }
  return match[1];
}

export const POSTS: Post[] = Object.entries(files)
  .map(([path, source]) => parsePost(slugFromPath(path), source))
  .sort((left, right) => (left.dateIso < right.dateIso ? 1 : -1));

export function getPost(slug: string): Post | undefined {
  return POSTS.find((post) => post.slug === slug);
}
