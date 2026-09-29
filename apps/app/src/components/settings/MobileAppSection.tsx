import { mobileAppDownloads } from "@bb/domain";
import { buttonVariants } from "@bb/shared-ui/button";
import { SettingsSection } from "@/components/ui/settings-section";

export function MobileAppSection() {
  return (
    <section aria-label="Mobile app downloads">
      <SettingsSection title="Mobile app" bodyClassName="space-y-4">
        <p className="text-sm text-subtle-foreground">
          Try bb on your phone. Both apps are in development.
        </p>
        <div className="flex flex-wrap gap-3">
          <a
            href={mobileAppDownloads.ios}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: "outline" })}
          >
            Join iOS TestFlight
          </a>
          <a
            href={mobileAppDownloads.android}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants()}
          >
            Download Android APK
          </a>
        </div>
        <p className="text-sm text-subtle-foreground">
          On Android, open the APK and allow installation from your browser if
          prompted. Return here for updates while we work on Google Play
          distribution.
        </p>
        <p className="text-sm text-subtle-foreground">
          After installing, pair your phone from Settings → Remote access → Add
          mobile device.
        </p>
      </SettingsSection>
    </section>
  );
}
