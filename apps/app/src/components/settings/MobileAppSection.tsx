import AppleIcon from "@hugeicons/core-free-icons/AppleIcon";
import AndroidIcon from "@hugeicons/core-free-icons/AndroidIcon";
import { HugeiconsIcon } from "@hugeicons/react";
import { MobileConnectionSettings } from "./MobileConnectionSettings";
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
          Use bb from your phone
        </p>
      </div>
      <MobileConnectionSettings />
      <div className="space-y-5">
        <SettingsSection
          title={
            <span className="flex items-center gap-1.5">
              <HugeiconsIcon
                icon={AppleIcon}
                size={16}
                strokeWidth={1.5}
                className="shrink-0"
                aria-hidden="true"
              />
              iOS
            </span>
          }
          description="Available through TestFlight"
          bodyClassName="space-y-4"
        >
          <p className="text-sm text-subtle-foreground">
            Install{" "}
            <a
              href="https://apps.apple.com/app/testflight/id899247664"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
            >
              TestFlight
            </a>
            , then join the bb beta to install the app on your iPhone.
          </p>
          <a
            href={mobileAppDownloads.ios}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants()}
          >
            Join iOS TestFlight
          </a>
        </SettingsSection>
        <SettingsSection
          title={
            <span className="flex items-center gap-1.5">
              <HugeiconsIcon
                icon={AndroidIcon}
                size={16}
                strokeWidth={1.5}
                className="shrink-0"
                aria-hidden="true"
              />
              Android
            </span>
          }
          description="Install the APK directly"
          bodyClassName="space-y-4"
        >
          <p className="text-sm text-subtle-foreground">
            Download the APK, open it on your phone, and allow installation from
            your browser if prompted. Download new builds here to update.
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
        </SettingsSection>
      </div>
    </section>
  );
}
