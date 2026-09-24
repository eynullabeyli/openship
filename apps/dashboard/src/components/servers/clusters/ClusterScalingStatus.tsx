"use client";

import { CheckCircle2, Circle, CircleAlert, Loader2 } from "lucide-react";
import type { ComputeCluster } from "@repo/contracts";
import { useI18n } from "@/components/i18n-provider";

/** Network connectivity alone does not make a server pool ready to run applications. */
export function clusterScalingState(cluster?: Pick<ComputeCluster, "scaling">) {
  if (cluster?.scaling === undefined) return "unknown";
  if (cluster.scaling === null || cluster.scaling.status === "removed") return "not_enabled";
  return cluster.scaling.status;
}

export function ClusterScalingStatus({ cluster }: { cluster: ComputeCluster }) {
  const { t } = useI18n();
  const status = clusterScalingState(cluster);
  const running = status === "setting_up" || status === "removing";
  const attention = status === "failed" || status === "interrupted";
  const Icon = running
    ? Loader2
    : status === "ready"
      ? CheckCircle2
      : attention
        ? CircleAlert
        : Circle;
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-medium ${status === "ready" ? "text-success" : attention ? "text-warning" : "text-muted-foreground"}`}
    >
      <Icon aria-hidden="true" className={`size-3.5 shrink-0 ${running ? "animate-spin" : ""}`} />
      {t.servers.runtime.status[status]}
    </span>
  );
}
