"use client";

import React, { useLayoutEffect, useRef } from "react";

export interface TabDef<K extends string = string> {
  key: K;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  /** Badge after the label — how many rows this tab holds. `0` still renders. */
  count?: number;
  /** When true the tab is not rendered (e.g. Backup only for stateful services). */
  hidden?: boolean;
  /**
   * Deep-link target. When set the tab renders as an <a> so the URL is
   * shareable and cmd/ctrl-click opens a new tab; a plain click is still
   * intercepted and handed to `onChange` for an instant client-side switch.
   * Without it the tab is a plain button (local view state).
   */
  href?: string;
}

interface TabsProps<K extends string> {
  tabs: TabDef<K>[];
  value: K;
  onChange: (key: K) => void;
  className?: string;
  size?: "sm" | "md";
  fullWidth?: boolean;
}

/**
 * Underline tab strip — the shared version of the pattern hand-rolled across
 * billing, the servers detail page, and the project logs view (border-b strip,
 * `px-4 py-2.5` items, `bg-primary` active underline). Controlled: the caller
 * owns the active `value`.
 */
export function Tabs<K extends string>({
  tabs,
  value,
  onChange,
  className = "",
  size = "md",
  fullWidth = false,
}: TabsProps<K>) {
  const stripRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const strip = stripRef.current;
    const active = activeRef.current;
    if (!strip || !active) return;
    // Shortcuts can select a tab outside the visible strip. Scroll only this
    // row, preserving the page's vertical position, including in RTL layouts.
    const revealActive = () => {
      const bounds = strip.getBoundingClientRect();
      const tab = active.getBoundingClientRect();
      const delta = tab.left < bounds.left ? tab.left - bounds.left
        : tab.right > bounds.right ? tab.right - bounds.right : 0;
      if (delta) strip.scrollBy({ left: delta });
    };
    revealActive();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(revealActive);
    observer.observe(strip);
    observer.observe(active);
    return () => observer.disconnect();
  }, [value, size, fullWidth]);

  const captureActive = (element: HTMLElement | null) => { activeRef.current = element; };

  return (
    <div ref={stripRef} className={`flex items-center gap-1 overflow-x-auto border-b border-border/50 scrollbar-hide ${className}`}>
      {tabs
        .filter((tab) => !tab.hidden)
        .map(({ key, label, icon: Icon, href, count }) => {
          const active = key === value;
          const className = `relative inline-flex shrink-0 items-center gap-2 whitespace-nowrap py-2.5 font-medium transition-colors ${fullWidth ? "grow basis-0 justify-center" : ""} ${size === "sm" ? "px-3 text-[13px]" : "px-4 text-sm"} ${
            active ? "text-foreground" : "text-muted-foreground hover:text-foreground/70"
          }`;
          const inner = (
            <>
              {Icon && <Icon className="size-4" />}
              {label}
              {count !== undefined && (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums ${
                    active ? "bg-muted text-foreground" : "bg-muted/60 text-muted-foreground"
                  }`}
                >
                  {count}
                </span>
              )}
              {active && (
                // Match the item's horizontal padding, so the underline is as
                // wide as the label it marks. That also puts the FIRST tab's
                // underline on the container's content edge instead of a padding
                // box's worth to the left of it — inside a card, an indicator that
                // starts left of every other left edge reads as a misalignment.
                <span className={`absolute bottom-0 h-0.5 rounded-full bg-primary ${size === "sm" ? "start-3 end-3" : "start-4 end-4"}`} />
              )}
            </>
          );
          return href ? (
            <a
              key={key}
              ref={active ? captureActive : undefined}
              href={href}
              aria-current={active ? "page" : undefined}
              className={className}
              onClick={(e) => {
                // Let the browser handle modified clicks (new tab / window);
                // intercept a plain click for an instant client-side switch.
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                e.preventDefault();
                onChange(key);
              }}
            >
              {inner}
            </a>
          ) : (
            <button key={key} ref={active ? captureActive : undefined} type="button" onClick={() => onChange(key)} className={className}>
              {inner}
            </button>
          );
        })}
    </div>
  );
}

export default Tabs;
