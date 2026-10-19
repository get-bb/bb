import { useEffect, useRef, type VideoHTMLAttributes } from "react";

export function Video({
  src,
  ...props
}: VideoHTMLAttributes<HTMLVideoElement> & { src: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.src = src;
    return () => {
      video.removeAttribute("src");
      video.load();
    };
  }, [src]);
  return <video {...props} ref={ref} />;
}
