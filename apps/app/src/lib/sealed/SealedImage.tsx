import type { ImgHTMLAttributes } from "react";
import { useSealedMediaSrc } from "./media";

type SealedImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src: string | undefined;
};

export function SealedImage({ src, ...props }: SealedImageProps) {
  const resolved = useSealedMediaSrc(src);
  return <img {...props} src={resolved ?? undefined} />;
}
