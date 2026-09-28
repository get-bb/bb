import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "./carousel.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Carousel",
};

const PLACEHOLDER_COLORS = ["bg-muted", "bg-muted", "bg-muted", "bg-muted"];

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Screenshot gallery"
        hint="apps/app/src/components/plugin/management/PluginMarketplaceListing.tsx — PluginScreenshotGallery, images replaced with placeholders"
      >
        <Carousel
          opts={{ align: "start", containScroll: "trimSnaps" }}
          aria-label="Plugin screenshots"
          className="w-full max-w-xl px-11"
        >
          <CarouselContent className="-ml-3 items-center">
            {PLACEHOLDER_COLORS.map((color, index) => (
              <CarouselItem key={index} className="basis-auto pl-3">
                <div
                  className={`flex h-40 w-64 items-center justify-center rounded-md border border-border text-sm text-muted-foreground ${color}`}
                >
                  Screenshot {index + 1}
                </div>
              </CarouselItem>
            ))}
          </CarouselContent>
          <CarouselPrevious className="left-0 size-8" />
          <CarouselNext className="right-0 size-8" />
        </Carousel>
      </StoryRow>
    </StoryCard>
  );
}
