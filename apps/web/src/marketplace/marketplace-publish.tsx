import GithubIcon from "@hugeicons/core-free-icons/GithubIcon";
import LinkSquare02Icon from "@hugeicons/core-free-icons/LinkSquare02Icon";
import PackageIcon from "@hugeicons/core-free-icons/PackageIcon";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ReactNode } from "react";

import { useInitAnalytics } from "../landing/analytics.js";
import { CommandButton } from "../landing/command-button.js";
import { SiteFooter, SiteNav } from "../landing/site-chrome.js";
import type { MarketplaceV2Manifest } from "./marketplace-v2.js";
import {
  MARKETPLACE_LISTING_REPORT_URL,
  marketplacePublishableCategories,
} from "./marketplace-view-model.js";
import { MarketplaceLink } from "./public-marketplace.js";

const LISTING_EXAMPLE = `{
  "name": "bb-plugin-notes",
  "version": "1.0.0",
  "keywords": ["bb-plugin", "notes", "markdown"],
  "bb": {
    "name": "Notes",
    "description": "Keep project notes beside each thread.",
    "branding": { "icon": "./icon.svg" }
  },
  "bbMarketplace": {
    "category": "thread-content",
    "secondaryCategories": ["memory-and-context"],
    "screenshots": ["./screenshots/notes-panel.png"]
  }
}`;

function Command({ command }: { command: string }) {
  return (
    <CommandButton
      command={command}
      label={`Copy ${command}`}
      size="compact"
      onCopy={() => {}}
    />
  );
}

function Step({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <li className="marketplace-publish-step">
      <span className="marketplace-publish-step-number" aria-hidden>
        {number}
      </span>
      <div>
        <h2>{title}</h2>
        {children}
      </div>
    </li>
  );
}

function ExternalLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <HugeiconsIcon icon={LinkSquare02Icon} aria-hidden />
    </a>
  );
}

export function PublicMarketplacePublishPage({
  manifest,
}: {
  manifest: MarketplaceV2Manifest | null;
}) {
  useInitAnalytics();
  const categories =
    manifest === null ? [] : marketplacePublishableCategories(manifest);
  return (
    <div className="wrap plugin-pages-wrap">
      <SiteNav current="plugins" />
      <main className="marketplace-detail-main marketplace-publish">
        <nav className="marketplace-breadcrumbs" aria-label="Breadcrumb">
          <MarketplaceLink href="/marketplace">Marketplace</MarketplaceLink>
          <span aria-hidden>/</span>
          <strong>Publish a plugin</strong>
        </nav>
        <header className="marketplace-publish-head">
          <h1>Publish a plugin</h1>
          <p>
            Any public plugin can be listed. There is no pull request to open:
            opt in with a GitHub topic or an npm keyword, release, and your
            plugin appears in the Marketplace and in bb within about 30 minutes.
          </p>
          <p className="marketplace-publish-notice">
            Listings are not reviewed by BB. People install your plugin with
            full trust, so say plainly what it does and what it needs.
          </p>
        </header>

        <ol className="marketplace-publish-steps marketplace-overview">
          <Step number={1} title="Describe the listing">
            <p>
              Everything the Marketplace shows comes from your plugin, read from
              the release: <code>package.json</code> and{" "}
              <code>PLUGIN_OVERVIEW.md</code> beside it.
            </p>
            <pre>
              <code>{LISTING_EXAMPLE}</code>
            </pre>
            <ul>
              <li>
                <code>bb.name</code>, <code>bb.description</code>, and{" "}
                <code>bb.branding.icon</code> are the name, the one-line hook,
                and the icon (a BB icon name or a relative <code>.svg</code> up
                to 256 KiB).
              </li>
              <li>
                Set <code>bbMarketplace.category</code> so people browsing by
                category find the plugin. Add up to 3{" "}
                <code>secondaryCategories</code>. bb ignores{" "}
                <code>bbMarketplace</code> when it loads the plugin.
              </li>
              <li>
                Up to 6 <code>screenshots</code>: relative PNG, JPEG, or WebP
                paths, at least 1200 px wide and at most 2 MiB each.
              </li>
              <li>
                Other <code>keywords</code> become search tags: lowercase words
                joined by hyphens, up to 32 characters, at most 10.
              </li>
              <li>
                <code>PLUGIN_OVERVIEW.md</code> is the long description: up to
                4000 characters of headings, paragraphs, lists, code, and https
                links. No HTML, images, or tables. A file that breaks these
                rules is left out of the listing.
              </li>
              <li>
                The plugin id comes from the package name, so{" "}
                <code>bb-plugin-notes</code> is <code>notes</code>. An id
                another plugin already holds is refused.
              </li>
            </ul>
          </Step>

          <Step number={2} title="Check it">
            <p>
              Run the Marketplace's checks locally. The command reports every
              problem with the same reason code the Marketplace uses, then
              prints the exact steps for your repository or package. It never
              pushes, tags, or publishes.
            </p>
            <Command command="bb plugin publish --check" />
          </Step>

          <Step number={3} title="Opt in and release">
            <div className="marketplace-publish-sources">
              <section>
                <h3>
                  <HugeiconsIcon icon={GithubIcon} aria-hidden />
                  GitHub
                </h3>
                <p>
                  Give the public repository the <code>bb-plugin</code> topic,
                  then push a semver tag that starts with <code>v</code>. Bare{" "}
                  <code>1.0.0</code> tags are not listed. Forks and archived
                  repositories are skipped.
                </p>
                <Command command="gh repo edit OWNER/REPO --add-topic bb-plugin" />
                <Command command="git tag v1.0.0 && git push origin v1.0.0" />
                <p>
                  A plugin in a subdirectory listed in{" "}
                  <code>.bb/plugins.json</code> uses its directory name as a tag
                  prefix, such as <code>notes/v1.0.0</code>. The listing is read
                  from the newest stable tag, never from the default branch.
                </p>
              </section>
              <section>
                <h3>
                  <HugeiconsIcon icon={PackageIcon} aria-hidden />
                  npm
                </h3>
                <p>
                  Keep <code>bb-plugin</code> in <code>keywords</code> and
                  publish. The overview, icon, and screenshots must be in the
                  package, so list them in <code>files</code>.
                </p>
                <Command command="npm publish" />
              </section>
            </div>
          </Step>

          <Step number={4} title="Confirm the listing">
            <p>
              The Marketplace checks for new releases about every 30 minutes.
              Your plugin then appears at{" "}
              <code>getbb.app/marketplace/&lt;id&gt;</code>. Each source&apos;s
              latest result, with the reason when it was skipped, is in the{" "}
              <ExternalLink href={MARKETPLACE_LISTING_REPORT_URL}>
                listing report
              </ExternalLink>
              .
            </p>
          </Step>
        </ol>

        <section className="marketplace-publish-section marketplace-overview">
          <h2>Already listed?</h2>
          <p>
            Plugins added to the Marketplace by pull request keep working. To
            change your listing, release from the same repository or package, or
            from another repository you own. The new listing replaces the old
            one; its category, icon, screenshots, and overview carry over only
            where your release has none. Each later release updates it again.
          </p>
        </section>

        <section className="marketplace-publish-section marketplace-overview">
          <h2>Let an agent do it</h2>
          <p>
            In bb, ask an agent to publish your plugin. The built-in{" "}
            <code>publish-a-plugin</code> skill takes it through these steps,
            captures screenshots, and asks you before it tags or publishes
            anything.
          </p>
        </section>

        {categories.length === 0 ? null : (
          <section className="marketplace-publish-section">
            <h2>Categories</h2>
            <dl className="marketplace-publish-categories">
              {categories.map((category) => (
                <div key={category.id}>
                  <dt>
                    <code>{category.id}</code>
                    <span>{category.displayName}</span>
                  </dt>
                  {category.description === undefined ? null : (
                    <dd>{category.description}</dd>
                  )}
                </div>
              ))}
            </dl>
          </section>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
