import { Video } from "./video";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";

export function VideoThumbnail({
  src,
  className,
}: {
  src: string;
  className?: string;
}) {
  return (
    <span
      className={cn("relative block h-16 w-24 bg-surface-recessed", className)}
    >
      <Video
        src={`${src.split("#")[0]}#t=0.001`}
        muted
        playsInline
        preload="metadata"
        aria-hidden="true"
        className="size-full object-cover"
      />
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="flex size-8 items-center justify-center rounded-full bg-black/55 text-white">
          <Icon name="Play" className="size-4" />
        </span>
      </span>
    </span>
  );
}
