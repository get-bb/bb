import { Icon } from "@bb/shared-ui/icon";
import { PluginMobileSettingsSections } from "@/components/plugin/PluginSettingsSections";
import { mobileAppDownloads } from "@bb/domain";
import { buttonVariants } from "@bb/shared-ui/button";
import { useQuery } from "@tanstack/react-query";
import { SettingsSection } from "@/components/ui/settings-section";
import { sdk } from "@/lib/sdk";

export function MobileAppSection() {
  const releases = useQuery({
    queryKey: ["system", "mobile-app-releases"],
    queryFn: () => sdk.system.mobileAppReleases(),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const android = releases.data?.android;
  return (
    <section aria-label="Mobile app downloads" className="space-y-5">
      <div>
        <h2 className="text-base font-semibold">Mobile apps</h2>
        <p className="mt-1 text-sm text-subtle-foreground">
          Read and steer your threads from your phone. Both apps are in
          development.
        </p>
      </div>
      <div className="space-y-5">
        <SettingsSection
          title="iOS"
          description="Available through TestFlight"
          bodyClassName="space-y-4"
        >
          <p className="text-sm text-subtle-foreground">
            Install TestFlight, then join the bb beta to install the app on your
            iPhone.
          </p>
          <p className="text-sm text-subtle-foreground">
            Version and release date are shown in TestFlight.
          </p>
          <a
            href={mobileAppDownloads.ios}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants()}
          >
            Join iOS TestFlight
          </a>
          <p className="text-sm text-subtle-foreground">
            Get new builds through TestFlight. Enable automatic updates there to
            stay up to date.
          </p>
        </SettingsSection>
        <SettingsSection
          title="Android"
          description="Install the APK directly"
          bodyClassName="space-y-4"
        >
          <p className="text-sm text-subtle-foreground">
            Download the APK, open it on your phone, and allow installation from
            your browser if prompted.
          </p>
          {android ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-subtle-foreground">Version</dt>
              <dd>
                {android.version} (build {android.versionCode})
              </dd>
              <dt className="text-subtle-foreground">Updated</dt>
              <dd>
                <time dateTime={android.updatedAt}>
                  {new Date(android.updatedAt).toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </time>
              </dd>
              <dt className="text-subtle-foreground">Download size</dt>
              <dd>{Math.ceil(android.size / 1024 / 1024)} MB</dd>
            </dl>
          ) : (
            <p className="text-sm text-subtle-foreground" role="status">
              {releases.isPending
                ? "Checking the latest release…"
                : "Release details are unavailable. You can still download the APK."}
            </p>
          )}
          <a
            href={mobileAppDownloads.android}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants()}
          >
            Download Android APK
          </a>
          <p className="text-sm text-subtle-foreground">
            Return here to download updates. We’re working on Google Play
            distribution.
          </p>
        </SettingsSection>
      </div>
      <div
        role="note"
        aria-label="Connect your phone"
        className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3"
      >
        <Icon
          name="Info"
          className="mt-0.5 size-4 shrink-0 text-subtle-foreground"
          aria-hidden
        />
        <div className="min-w-0 space-y-1 text-sm text-subtle-foreground">
          <p className="font-medium text-foreground">Connect your phone</p>
          <p>
            Your phone connects to your existing bb server, where your threads
            and settings are stored. Keep that server awake and online to use
            the app. After installing, pair your phone below with bb connect, or
            enter a server URL that your phone can reach.
          </p>
        </div>
      </div>
      <PluginMobileSettingsSections />
    </section>
  );
}
