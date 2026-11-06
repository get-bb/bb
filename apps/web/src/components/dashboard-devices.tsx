import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Overlay, RowMenu } from "@/components/connect-ui";
import { cn } from "@/lib/utils";
import {
  appStatus,
  deviceStatus,
  deviceTitle,
  splitUnused,
} from "@/lib/dashboard-groups";
import type { MachineSummary } from "@/server/api";
import type { OAuthGrantView } from "@/server/oauth";

function ItemRow({
  title,
  mono,
  status,
  dimmed,
  menu,
}: {
  title: string;
  mono?: boolean;
  status: string;
  dimmed?: boolean;
  menu: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto_26px] items-center gap-2.5 rounded-lg px-2 py-1">
      <span
        className={cn(
          "min-w-0 truncate text-sm",
          mono && "font-mono",
          dimmed && "text-muted-foreground",
        )}
      >
        {title}
      </span>
      <span className="text-xs text-muted-foreground" suppressHydrationWarning>
        {status}
      </span>
      {menu}
    </div>
  );
}

function ConfirmRemoval({
  title,
  body,
  action,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  action: string;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Overlay onClose={onCancel}>
      <h4 className="mb-1.5 text-base font-semibold">{title}</h4>
      <p className="mb-4 text-sm text-muted-foreground">{body}</p>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="destructive"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void onConfirm().finally(() => {
              setBusy(false);
              onCancel();
            });
          }}
        >
          {busy ? "Removing…" : action}
        </Button>
      </div>
    </Overlay>
  );
}

function DeviceRow({
  device,
  serverUrlTemplate,
  onRemove,
}: {
  device: MachineSummary;
  serverUrlTemplate: string;
  onRemove: (device: MachineSummary) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const title = deviceTitle(device);
  const address =
    device.subdomain === null
      ? null
      : serverUrlTemplate
          .replace("{label}", device.subdomain)
          .replace(/^https?:\/\//u, "");
  return (
    <>
      <ItemRow
        title={address ?? title}
        mono={address !== null}
        status={deviceStatus(device, Date.now())}
        dimmed={device.unused}
        menu={
          <RowMenu
            items={[
              {
                label: "Remove…",
                danger: true,
                onSelect: () => setConfirming(true),
              },
            ]}
          />
        }
      />
      {confirming && (
        <ConfirmRemoval
          title={`Remove ${title}?`}
          body="It loses access to all your bbs right away. To use it again, pair it with a new code."
          action="Remove"
          onConfirm={() => onRemove(device)}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  );
}

export function DeviceList({
  machines,
  serverUrlTemplate,
  onRemove,
  onRemoveUnused,
}: {
  machines: readonly MachineSummary[];
  serverUrlTemplate: string;
  onRemove: (device: MachineSummary) => Promise<void>;
  onRemoveUnused: () => Promise<void>;
}) {
  const [showUnused, setShowUnused] = useState(false);
  const [confirmingRemoveAll, setConfirmingRemoveAll] = useState(false);
  const { devices, unusedDevices } = splitUnused(machines);
  const unused = unusedDevices.length;
  const noun = unused === 1 ? "device" : "devices";
  const row = (device: MachineSummary) => (
    <DeviceRow
      key={device.id}
      device={device}
      serverUrlTemplate={serverUrlTemplate}
      onRemove={onRemove}
    />
  );
  return (
    <div className="mt-3 rounded-xl border border-border bg-card p-2 shadow-sm">
      <h3 className="px-3 pb-1.5 pt-1.5 text-base font-semibold tracking-tight">
        Devices
      </h3>
      {machines.length === 0 && (
        <p className="px-3 pb-2 text-xs text-subtle-foreground">
          Phones and computers you pair with your bbs show up here.
        </p>
      )}
      <div className="pl-1">
        {devices.map(row)}
        {showUnused && unusedDevices.map(row)}
        {unused > 0 && (
          <div className="flex items-center gap-1 px-2 py-1 text-xs text-subtle-foreground">
            <button
              className="hover:text-foreground"
              onClick={() => setShowUnused((value) => !value)}
            >
              {showUnused ? "Hide unused" : `Show ${unused} unused`}
            </button>
            {showUnused && (
              <>
                <span aria-hidden>·</span>
                <button
                  className="hover:text-destructive-text"
                  onClick={() => setConfirmingRemoveAll(true)}
                >
                  Remove {unused} unused
                </button>
              </>
            )}
          </div>
        )}
      </div>
      {confirmingRemoveAll && (
        <ConfirmRemoval
          title={`Remove ${unused} unused ${noun}?`}
          body="They haven't been used in 14 days and lose access to your bbs. A device you still use can be paired again with a new code."
          action={`Remove ${unused}`}
          onConfirm={onRemoveUnused}
          onCancel={() => setConfirmingRemoveAll(false)}
        />
      )}
    </div>
  );
}

function AppRow({
  grant,
  onRevoke,
}: {
  grant: OAuthGrantView;
  onRevoke: (grant: OAuthGrantView) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <ItemRow
        title={`${grant.clientName} · ${grant.serverHandle}`}
        status={appStatus(grant, Date.now())}
        menu={
          <RowMenu
            items={[
              {
                label: "Disconnect…",
                danger: true,
                onSelect: () => setConfirming(true),
              },
            ]}
          />
        }
      />
      {confirming && (
        <ConfirmRemoval
          title={`Disconnect ${grant.clientName}?`}
          body={`${grant.clientName} can no longer use ${grant.serverHandle}. You can connect it again from ${grant.clientName}.`}
          action="Disconnect"
          onConfirm={() => onRevoke(grant)}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  );
}

export function AppList({
  grants,
  onRevoke,
}: {
  grants: readonly OAuthGrantView[];
  onRevoke: (grant: OAuthGrantView) => Promise<void>;
}) {
  if (grants.length === 0) return null;
  return (
    <div className="mt-3 rounded-xl border border-border bg-card p-2 shadow-sm">
      <h3 className="px-3 pb-1.5 pt-1.5 text-base font-semibold tracking-tight">
        Connected apps
      </h3>
      <div className="pl-1">
        {grants.map((grant) => (
          <AppRow key={grant.id} grant={grant} onRevoke={onRevoke} />
        ))}
      </div>
    </div>
  );
}
