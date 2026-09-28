import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "./navigation-menu.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/NavigationMenu",
};

export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="Dropdown section">
        <NavigationMenu>
          <NavigationMenuList>
            <NavigationMenuItem>
              <NavigationMenuTrigger>Docs</NavigationMenuTrigger>
              <NavigationMenuContent>
                <ul className="w-48 p-2">
                  <li>
                    <NavigationMenuLink href="#" className="block rounded-sm p-2 text-sm hover:bg-muted">
                      Getting started
                    </NavigationMenuLink>
                  </li>
                  <li>
                    <NavigationMenuLink href="#" className="block rounded-sm p-2 text-sm hover:bg-muted">
                      Plugin API
                    </NavigationMenuLink>
                  </li>
                </ul>
              </NavigationMenuContent>
            </NavigationMenuItem>
          </NavigationMenuList>
        </NavigationMenu>
      </StoryRow>
    </StoryCard>
  );
}
