"use client";

import { Loader2 } from "lucide-react";
import { useI18n } from "@/components/i18n-provider";
import type { Service, ServiceContainer } from "@/lib/api/services";

/** Only a runtime response can say an enabled service is stopped. */
export function getServiceStatus(
  service: Pick<Service, "enabled">,
  container?: ServiceContainer,
  checking = false,
): string {
  return container?.status ?? (checking ? "checking" : service.enabled ? "unknown" : "disabled");
}

/** Shared by the service list and detail view so pending and unknown agree. */
export function ServiceStatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  const labels = t.projects.serviceStatus;
  const map: Record<string, { ring: string; text: string; label: string }> = {
    checking: {
      ring: "",
      text: "text-muted-foreground",
      label: labels.checking,
    },
    running: {
      ring: "border-success-solid",
      text: "text-success",
      label: labels.running,
    },
    stopped: {
      ring: "border-muted-foreground/40",
      text: "text-muted-foreground",
      label: labels.stopped,
    },
    disabled: {
      ring: "border-muted-foreground/30",
      text: "text-muted-foreground/60",
      label: labels.disabled,
    },
    failed: { ring: "border-danger-solid", text: "text-danger", label: labels.failed },
    starting: {
      ring: "border-warning-solid animate-pulse",
      text: "text-warning",
      label: labels.starting,
    },
    restarting: {
      ring: "border-warning-solid animate-pulse",
      text: "text-warning",
      label: labels.restarting,
    },
    unknown: {
      ring: "border-muted-foreground/40",
      text: "text-muted-foreground",
      label: labels.unknown,
    },
  };
  const shown = map[status] ?? map.unknown;
  return (
    <span
      role="status"
      className={`inline-flex items-center gap-1.5 text-xs font-medium ${shown.text}`}
    >
      {status === "checking" ? (
        <Loader2 aria-hidden="true" className="size-2.5 animate-spin" />
      ) : (
        <span aria-hidden="true" className={`size-2.5 rounded-full border-2 ${shown.ring}`} />
      )}
      {shown.label}
    </span>
  );
}
