export const DOCS_VIDEOS_BASE = "/docs-videos";

export const DOCS_VIDEO_MAX_BYTES = 3 * 1024 * 1024;

export function videoFiles(src: string): {
  video: string;
  poster: string;
  text: string;
  captions: string;
} {
  return {
    video: `${src}.mp4`,
    poster: `${src}-poster.jpg`,
    text: `${src}.txt`,
    captions: `${src}.vtt`,
  };
}

export function videoMarkdown(title: string, src: string): string {
  const files = videoFiles(src);
  return `[Video: ${title}](${files.video}) ([text version](${files.text}))`;
}
