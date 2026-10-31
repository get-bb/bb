import { Button } from "@bb/shared-ui/button";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  SettingsSection,
  SettingsWithControl,
} from "@/components/ui/settings-section.js";
import { openUrlInExternalBrowser } from "@/lib/url-open-routing";
import { bbHelpLinks, docsLinks } from "@bb/domain/docs-links";

const GITHUB_REPO_URL = "https://github.com/get-bb/bb";

interface CommunityLinkRowProps {
  description: string;
  href: string;
  icon: IconName;
  iconClassName?: string;
  label: string;
  openLabel: string;
}

function CommunityLinkRow({
  description,
  href,
  icon,
  iconClassName,
  label,
  openLabel,
}: CommunityLinkRowProps) {
  return (
    <SettingsWithControl label={label} description={description}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 gap-1.5 px-2.5 text-xs"
        aria-label={openLabel}
        onClick={() => {
          openUrlInExternalBrowser(href);
        }}
      >
        <Icon name={icon} className={cn("size-3.5 shrink-0", iconClassName)} />
        {openLabel}
        <Icon
          name="ExternalLink"
          className="size-3 shrink-0 text-muted-foreground"
        />
      </Button>
    </SettingsWithControl>
  );
}

export function CommunitySettingsSection() {
  return (
    <SettingsSection
      title="Community"
      description="Read the docs, chat with other bb users, and follow development on GitHub."
    >
      <div className="space-y-5">
        <CommunityLinkRow
          label="Docs"
          description="Guides, troubleshooting, and reference for bb."
          href={docsLinks.home}
          icon="FileText"
          openLabel="Open docs"
        />
        <CommunityLinkRow
          label="Discord"
          description="Join the server for support, feedback, and announcements."
          href={bbHelpLinks.discord}
          icon="DiscordLogo"
          iconClassName="text-brand-discord"
          openLabel="Join Discord"
        />
        <CommunityLinkRow
          label="GitHub"
          description="Source code, issues, and releases for the bb project."
          href={GITHUB_REPO_URL}
          icon="GithubLogo"
          openLabel="View on GitHub"
        />
      </div>
    </SettingsSection>
  );
}
