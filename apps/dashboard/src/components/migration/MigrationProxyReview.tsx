"use client";

import { Globe, AlertTriangle } from "lucide-react";
import { useI18n, interpolate } from "@/components/i18n-provider";
import type { DiscoveredStack } from "@/lib/api";

/** Discovery belongs in the review step, including routes we could not match. */
export function MigrationProxyReview({ stack }: { stack: DiscoveredStack }) {
  const { t } = useI18n();
  const copy = t.migration.wizard.edgeReview;
  const warnings = [...new Set(stack.warnings)];
  if (!stack.proxy && warnings.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-3 text-sm">
      {stack.proxy && (
        <div className="flex items-start gap-2.5">
          <Globe className="size-4 shrink-0 mt-0.5 text-muted-foreground" />
          <div className="space-y-1">
            <p className="font-medium text-foreground">
              {interpolate(copy.detected, {
                proxy: stack.proxy.ours ? "Openship" : stack.proxy.kind,
              })}
            </p>
            <p className="text-muted-foreground leading-relaxed">{copy.handoff}</p>
          </div>
        </div>
      )}
      {warnings.length > 0 && (
        <details>
          <summary className="cursor-pointer text-warning">
            <AlertTriangle className="inline size-4 mr-2 align-text-bottom" />
            {interpolate(copy.warnings, { count: String(warnings.length) })}
          </summary>
          <ul className="mt-2 space-y-1.5 pl-5 list-disc text-muted-foreground">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
