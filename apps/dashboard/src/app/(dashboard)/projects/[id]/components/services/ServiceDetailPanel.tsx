"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { usePlatform } from "@/context/PlatformContext";
import { useToast } from "@/context/ToastContext";
import { useCloudDeployPricing } from "@/hooks/useCloudDeployPricing";
import { useServiceEnvironmentApply } from "@/hooks/useServiceEnvironmentApply";
import { getServiceStatus, ServiceStatusBadge } from "@/components/services/ServiceStatusBadge";
import {
  serviceKind,
  serviceUsesDeployPipeline,
  serviceCanStartWithoutBuild,
  servicesApi,
  type Service,
  type ServiceContainer,
  type ServiceInput,
} from "@/lib/api/services";
import { deployApi } from "@/lib/api/deploy";
import { serviceDisplayUrl } from "@/utils/route-display";
import {
  Play,
  Square,
  Loader2,
  ExternalLink,
  Power,
  RotateCw,
  Rocket,
  ChevronDown,
  Check,
  Settings,
  Trash2,
  DatabaseBackup,
  PlayCircle,
  Plus,
  Save,
  MonitorSmartphone,
  PlugZap,
} from "lucide-react";
import { backupsApi, getApiErrorCode, getApiErrorMessage, type BackupPolicy } from "@/lib/api";
import { PolicyEditor } from "@/components/backup/PolicyEditor";
import { BackupRunCard } from "@/components/backup/BackupRunCard";
import { ServiceTerminal } from "@/components/terminal/ServiceTerminal";
import { useTheme } from "@/components/theme-provider";
import { Tabs, type TabDef } from "@/components/ui/Tabs";
import { Button } from "@/components/ui/button";
import DropdownMenu from "@/components/ui/DropdownMenu";
import { ServiceSettingsForm } from "./ServiceSettingsForm";
import { ServiceEnvironmentPanel } from "./ServiceEnvironmentPanel";
import { TerminalLogs } from "../logs/TerminalLogs";
import { endpoints } from "@/lib/api/endpoints";
import { useI18n, interpolate } from "@/components/i18n-provider";
import { useLocalhostForward } from "@/hooks/useLocalhostForward";
import { UseInProjectModal } from "../UseInProjectModal";
import { ServiceOverview } from "./ServiceOverview";
import { ServiceVolumesPanel } from "./ServiceVolumesPanel";
import { ServiceDomainsPanel } from "./ServiceDomainsPanel";
import type { ServiceDomainIntent } from "./ServicePortsCard";
import { configuredServiceEndpoints } from "@/lib/service-endpoints";

type ServiceTab = "overview" | "terminal" | "logs" | "env" | "domains" | "volumes" | "settings" | "backup";
const SERVICE_TAB_DEFS: TabDef<ServiceTab>[] = [
  { key: "overview", label: "Overview" },
  { key: "terminal", label: "Terminal" },
  { key: "logs", label: "Logs" },
  { key: "env", label: "Environment" },
  { key: "domains", label: "Domains" },
  { key: "volumes", label: "Volumes" },
  { key: "backup", label: "Backup" },
  { key: "settings", label: "Settings" },
];
const SERVICE_TABS = SERVICE_TAB_DEFS.map((t) => t.key);
/* ── Props ──────────────────────────────────────────────────────────── */

interface ServiceDetailPanelProps {
  service: Service;
  container?: ServiceContainer;
  /** An outstanding runtime read, distinct from a confirmed stopped service. */
  containerChecking?: boolean;
  projectId: string;
  projectSlugBase: string;
  /** Tab to open on mount (from the URL: /services/[id]/[tab]). */
  initialTab?: string;
  onRefresh: () => void | Promise<void>;
  onDeleted?: () => void;
  /** Project context — supplied by the caller instead of read from
   *  ProjectSettingsContext, so the panel renders outside the projects route
   *  tree (e.g. the server-detail Services tab). The projects route passes these
   *  from `useProjectSettings()`. */
  projectType?: string;
  activeDeploymentId?: string | null;
  deployTarget?: string | null;
  /** Server the project is deployed to — gates the desktop tunnel "Open". */
  serverId?: string | null;
  /** Sibling services for the header switcher (same project). */
  siblingServices?: Service[];
  /** Deep-link the active tab into the URL (projects route). Off at server level. */
  deepLink?: boolean;
  /** Override the service switcher — server level swaps in place instead of
   *  routing to /projects/…. When omitted, routes as before. */
  onSwitchService?: (targetId: string, tab: string) => void;
}

/* ── Panel ──────────────────────────────────────────────────────────── */

export function ServiceDetailPanel({
  service,
  container,
  containerChecking,
  projectId,
  projectSlugBase,
  initialTab,
  onRefresh,
  onDeleted,
  projectType,
  activeDeploymentId,
  deployTarget,
  serverId,
  siblingServices,
  deepLink = true,
  onSwitchService,
}: ServiceDetailPanelProps) {
  const { baseDomain } = usePlatform();
  const { showToast } = useToast();
  const showCloudPricing = useCloudDeployPricing();
  const environmentApply = useServiceEnvironmentApply(projectId, onRefresh);
  const { t } = useI18n();
  const { resolvedTheme } = useTheme();
  const router = useRouter();
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [redeploying, setRedeploying] = useState(false);
  const applyingEnvironment = environmentApply.applyingServiceId !== null;
  const serviceOperationBusy = actionLoading !== null || deploying || redeploying || applyingEnvironment;
  const status = getServiceStatus(service, container, containerChecking);

  // Desktop-only "Open": SSH-forward this service's published host port onto
  // localhost and open it — the same affordance the project card offers. Hidden
  // unless we're a desktop dashboard managing a remote server (backend 404s
  // otherwise). Port comes from the live container, else the compose mapping.
  const { canForward, forward } = useLocalhostForward({ serverId, deployTarget });
  const [openingLocal, setOpeningLocal] = useState(false);
  const forwardPort =
    container?.hostPort ||
    (() => {
      for (const p of service.ports ?? []) {
        const parts = String(p).split(":");
        const host = parts.length >= 2 ? Number(parts[parts.length - 2]) : NaN;
        if (Number.isFinite(host)) return host;
      }
      return service.exposedPort ? Number(service.exposedPort) : 0;
    })();
  const canOpenLocal = canForward && Number.isFinite(forwardPort) && forwardPort > 0;
  const openOnLocalhost = async () => {
    if (!forwardPort || openingLocal) return;
    setOpeningLocal(true);
    try {
      await forward(forwardPort, "open");
    } finally {
      setOpeningLocal(false);
    }
  };

  // Backup only applies to compose services (stateful containers) — never
  // monorepo sub-apps (source-built frontends).
  const supportsBackup = serviceKind(service) === "compose";

  // Two-mode split (pipeline vs image app) + launchability — shared helpers so
  // this classification can't drift from the other call sites. See services.ts.
  const usesDeployPipeline = serviceUsesDeployPipeline(service, projectType);
  const canStartWithoutBuild = serviceCanStartWithoutBuild(service);

  // ── Tabs ─────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<ServiceTab>(() =>
    SERVICE_TABS.includes(initialTab as ServiceTab) ? (initialTab as ServiceTab) : "overview",
  );
  const [environmentVisited, setEnvironmentVisited] = useState(initialTab === "env");
  const [envDirty, setEnvDirty] = useState(false);
  useEffect(() => {
    if (activeTab === "env") setEnvironmentVisited(true);
  }, [activeTab]);
  const [domainIntent, setDomainIntent] = useState<ServiceDomainIntent>({});
  const changeTab = (tab: ServiceTab) => {
    setActiveTab(tab);
    // Deep-link the tab without a route push (scroll-preserving), matching
    // ProjectSidebar's tab-sync so back/forward and refresh land on it. Skipped
    // off the projects route (server level) where that URL shape doesn't apply.
    if (deepLink && typeof window !== "undefined") {
      const scrollY = window.scrollY;
      window.history.replaceState({}, "", `/projects/${projectId}/services/${service.id}/${tab}`);
      requestAnimationFrame(() => window.scrollTo(0, scrollY));
    }
  };

  // ── Service switcher ─────────────────────────────────────────────────
  // Jump to another service WITHOUT leaving the current tab (Terminal stays
  // Terminal, Env stays Env, …). Routing carries the tab in the URL and the
  // panel is keyed by service id upstream, so it remounts cleanly on the same
  // tab. Backup is compose-only — fall back to Overview if the target can't
  // show it, so a switch never lands on an empty hidden tab.
  const switchableServices = siblingServices ?? [];
  const canSwitchService = switchableServices.length > 1;
  const switchService = (targetId: string) => {
    if (targetId === service.id) return;
    const target = switchableServices.find((s) => s.id === targetId);
    const targetTab =
      activeTab === "backup" && target && serviceKind(target) !== "compose"
        ? "overview"
        : activeTab;
    if (onSwitchService) onSwitchService(targetId, targetTab);
    else router.push(`/projects/${projectId}/services/${targetId}/${targetTab}`);
  };

  // ── Terminal section state ──────────────────────────────────────────
  // Lazy-mount: the WS only opens once the user opens the Terminal tab, so
  // service pages don't burn a session slot per page view. A resume token
  // persists per-service in localStorage so refresh / tab-switch reattaches
  // the parked session rather than spawning a fresh shell.
  const [terminalResumeToken, setTerminalResumeToken] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const key = `openship.serviceterm.resume.${service.id}`;
    setTerminalResumeToken(window.localStorage.getItem(key));
  }, [service.id]);
  const persistResumeToken = (token: string | null) => {
    setTerminalResumeToken(token);
    if (typeof window === "undefined") return;
    const key = `openship.serviceterm.resume.${service.id}`;
    if (token) window.localStorage.setItem(key, token);
    else window.localStorage.removeItem(key);
  };

  // ── Backup section state ────────────────────────────────────────────
  const [backupPolicy, setBackupPolicy] = useState<BackupPolicy | null>(null);
  const [backupEditorOpen, setBackupEditorOpen] = useState(false);
  const [backupAfterSave, setBackupAfterSave] = useState(false);
  const [activeBackupRunId, setActiveBackupRunId] = useState<string | null>(null);
  const [backupLoading, setBackupLoading] = useState(false);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [backupRevision, setBackupRevision] = useState(0);
  const [backupRunning, setBackupRunning] = useState(false);
  const backupScope = `${projectId}:${service.id}`;
  const backupScopeRef = useRef<string | null>(backupScope);
  const backupRequestRef = useRef<object | null>(null);
  const backupVisible = (activeTab === "backup" || activeTab === "volumes") && supportsBackup;

  useEffect(() => {
    backupScopeRef.current = backupScope;
    setBackupPolicy(null);
    setActiveBackupRunId(null);
    setBackupEditorOpen(false);
    setBackupAfterSave(false);
    setBackupError(null);
    setBackupRunning(false);
    backupRequestRef.current = null;
    return () => {
      backupScopeRef.current = null;
      backupRequestRef.current = null;
    };
  }, [backupScope]);

  useEffect(() => {
    if (!backupVisible) return;
    let alive = true;
    setBackupLoading(true);
    setBackupError(null);
    void backupsApi
      .listPolicies(projectId)
      .then((res) => {
        if (!alive) return;
        const policy = res.data.find((p) => p.serviceId === service.id) ?? null;
        setBackupPolicy(policy);
      })
      .catch((error) => {
        if (alive) setBackupError(getApiErrorMessage(error, t.projectDetail.services.detail.storage.backupLoadFailed));
      })
      .finally(() => { if (alive) setBackupLoading(false); });
    return () => {
      alive = false;
    };
  }, [projectId, service.id, backupVisible, backupRevision, t.projectDetail.services.detail.storage.backupLoadFailed]);

  const reloadBackupPolicy = async (): Promise<void> => {
    setBackupRevision((value) => value + 1);
  };

  const handleBackupNow = async (policy = backupPolicy): Promise<void> => {
    if (
      !policy ||
      policy.serviceId !== service.id ||
      backupScopeRef.current !== backupScope ||
      backupRequestRef.current
    )
      return;
    const request = {};
    backupRequestRef.current = request;
    setBackupRunning(true);
    try {
      const res = await backupsApi.runNow(policy.id);
      if (backupRequestRef.current === request) setActiveBackupRunId(res.data.runId);
    } catch (err) {
      if (backupRequestRef.current === request)
        showToast(
          getApiErrorMessage(err, t.projectDetail.services.detail.toast.backupRunFailed),
          "error",
        );
    } finally {
      if (backupRequestRef.current === request) {
        backupRequestRef.current = null;
        setBackupRunning(false);
      }
    }
  };

  const handleVolumeBackup = () => {
    if (backupLoading || backupError) return;
    if (backupPolicy) void handleBackupNow();
    else {
      setBackupAfterSave(true);
      setBackupEditorOpen(true);
    }
  };

  const backupFeedback =
    activeBackupRunId || backupError ? (
      <>
        {activeBackupRunId && <BackupRunCard runId={activeBackupRunId} />}
        {backupError && (
          <div className="space-y-3">
            <p role="alert" className="text-sm text-danger">
              {backupError}
            </p>
            <Button variant="outline" size="sm" onClick={() => void reloadBackupPolicy()}>
              {t.projectDetail.services.detail.storage.retry}
            </Button>
          </div>
        )}
      </>
    ) : null;

  // Null when the service has no route: it is reachable on its port, and the
  // derived `<project>-<service>` host this used to print never existed.
  const resolvedUrl = serviceDisplayUrl(service, {
    projectLabel: projectSlugBase,
    baseDomain,
    kind: serviceKind(service),
  });

  // Hero subtitle: the image, or the build context — but not a bare "." (the
  // default compose build context), which reads as a stray dot.
  const sourceLabel =
    service.image?.trim() ||
    (service.build && service.build.trim() && service.build.trim() !== "."
      ? service.build.trim()
      : "");

  /* ── Handlers ───────────────────────────────────────────────── */

  const handleContainerAction = async (action: "start" | "stop" | "restart") => {
    if (serviceOperationBusy) return;
    setActionLoading(action);
    try {
      if (action === "start") await servicesApi.start(projectId, service.id);
      else if (action === "stop") await servicesApi.stop(projectId, service.id);
      else await servicesApi.restart(projectId, service.id);
      onRefresh();
    } catch (err) {
      if (action === "restart" && getApiErrorCode(err) === "SERVICE_CONFIG_STALE") {
        showToast(
          envDirty
            ? t.projectDetail.services.detail.environmentApply.saveFirst
            : interpolate(t.projectDetail.services.detail.environmentApply.restartBlocked, { name: service.name }),
          "info",
          service.name,
        );
        changeTab("env");
        return;
      }
      if (action !== "stop" && showCloudPricing(err)) return;
      showToast(
        getApiErrorMessage(err, t.projectDetail.services.detail.toast.deployFailed),
        "error",
        service.name,
      );
    } finally {
      setActionLoading(null);
    }
  };

  const handleToggleEnabled = async () => {
    setSaving(true);
    try {
      await servicesApi.update(projectId, service.id, { enabled: !service.enabled });
      onRefresh();
    } finally {
      setSaving(false);
    }
  };

  /**
   * Deploy/start a service that has no live container yet. This is the
   * "first-run" path - services.create() saves a DB row but doesn't start
   * a container until the project deploys. If the service is currently
   * disabled, flip it enabled first - otherwise the redeploy pipeline would
   * just skip it.
   */
  const handleDeployStart = async () => {
    setDeploying(true);
    try {
      // Start = provision + launch this service, using its project Docker
      // workspace for Compose. No build page, no
      // one-deploy lock, never touches the main app. servicesApi.start
      // provisions-if-missing server-side (and enables the service first).
      const res = await servicesApi.start(projectId, service.id);
      if ((res as any)?.success === false) {
        setDeploying(false);
        showToast(
          (res as any)?.error || t.projectDetail.services.detail.toast.deployFailed,
          "error",
          service.name,
        );
        return;
      }
      showToast(
        interpolate(t.projectDetail.services.detail.toast.serviceStarting, { name: service.name }),
        "success",
        t.projectDetail.services.detail.toast.serviceTitle,
      );
      setDeploying(false);
      onRefresh();
    } catch (err) {
      setDeploying(false);
      if (showCloudPricing(err)) return;
      showToast(
        getApiErrorMessage(err, t.projectDetail.services.detail.toast.deployFailed),
        "error",
        service.name,
      );
    }
  };

  /**
   * PIPELINE services only (compose stack / monorepo sub-app / source-built):
   * rebuild + redeploy ONLY this service and land on the build screen. Image
   * apps don't get this — they Start/Stop.
   */
  const handleRedeployService = async () => {
    if (!activeDeploymentId) {
      showToast(t.projectDetail.services.detail.toast.deployFirstRedeploy, "error", service.name);
      return;
    }
    if (!service.enabled) {
      showToast(t.projectDetail.services.detail.toast.enableBeforeRedeploy, "error", service.name);
      return;
    }
    setRedeploying(true);
    try {
      const res = await deployApi.trigger({ projectId, serviceIds: [service.id] });
      if ((res as any)?.success === false) {
        setRedeploying(false);
        showToast(
          (res as any)?.error || t.projectDetail.services.detail.toast.redeployFailed,
          "error",
          service.name,
        );
        return;
      }
      const newId = res?.data?.deployment?.id;
      router.push(newId ? `/build/${newId}` : `/projects/${projectId}/deployments`);
    } catch (err) {
      setRedeploying(false);
      if (showCloudPricing(err)) return;
      showToast(
        getApiErrorMessage(err, t.projectDetail.services.detail.toast.redeployFailed),
        "error",
        service.name,
      );
    }
  };

  // While `deploying` is true, poll for the container to appear. The redeploy
  // fires-and-forgets on the backend, so watching the service's container
  // state is the only client-side completion signal.
  useEffect(() => {
    if (!deploying) return;
    if (container?.containerId) {
      setDeploying(false);
      return;
    }

    let cancelled = false;
    let elapsed = 0;
    const POLL_INTERVAL = 4_000;
    const POLL_TIMEOUT = 90_000;
    const interval = setInterval(() => {
      if (cancelled) return;
      elapsed += POLL_INTERVAL;
      void onRefresh();
      if (elapsed >= POLL_TIMEOUT) {
        clearInterval(interval);
        setDeploying(false);
        showToast(t.projectDetail.services.detail.toast.stillStarting, "error", service.name);
      }
    }, POLL_INTERVAL);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [deploying, container?.containerId, onRefresh, service.name, showToast]);

  const handleUpdateService = async (data: Partial<ServiceInput>) => {
    const result = await servicesApi.update(projectId, service.id, data);
    if (!result.success) {
      throw new Error(t.projectDetail.services.detail.toast.updateFailed);
    }

    await onRefresh();
    showToast(
      t.projectDetail.services.detail.toast.serviceUpdated,
      "success",
      data.name ?? service.name,
    );
  };

  const handleDeleteService = async () => {
    setDeleting(true);
    try {
      const result = await servicesApi.delete(projectId, service.id);
      if (!result.success) {
        throw new Error(t.projectDetail.services.detail.toast.deleteFailed);
      }
      showToast(t.projectDetail.services.detail.toast.serviceDeleted, "success", service.name);
      setConfirmDelete(false);
      onDeleted?.();
      await onRefresh();
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : t.projectDetail.services.detail.toast.deleteFailed,
        "error",
      );
    } finally {
      setDeleting(false);
    }
  };

  /* ── Render ─────────────────────────────────────────────────── */

  return (
    <div className="space-y-5">
      <UseInProjectModal open={shareOpen} onClose={() => setShareOpen(false)} sourceProjectId={projectId} sourceServiceId={service.id} />
      {/* ── Heading (simple, no card) ──────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex items-center gap-2.5">
          {canSwitchService ? (
            <DropdownMenu
              align="left"
              triggerClassName="group inline-flex items-center gap-1.5 rounded-lg -ms-1.5 px-1.5 py-0.5 transition-colors hover:bg-muted/50"
              trigger={
                <>
                  <span className="text-xl font-semibold tracking-tight text-foreground">
                    {service.name}
                  </span>
                  <ChevronDown className="size-4 text-muted-foreground transition-colors group-hover:text-foreground" />
                </>
              }
              actions={switchableServices.map((s) => ({
                id: s.id,
                label: s.name,
                icon:
                  s.id === service.id ? (
                    <Check className="size-4 text-primary" />
                  ) : (
                    <span
                      className={`size-1.5 rounded-full ${s.enabled ? "bg-success-solid" : "bg-muted-foreground/40"}`}
                    />
                  ),
                disabled: s.id === service.id,
                onClick: () => switchService(s.id),
              }))}
            />
          ) : (
            <h2 className="text-xl font-semibold tracking-tight text-foreground">{service.name}</h2>
          )}
          <ServiceStatusBadge status={status} />
        </div>
        <div className="flex min-w-0 items-center gap-3">
          {service.enabled && (
            <button type="button" onClick={() => setShareOpen(true)}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/50">
              <PlugZap className="size-3.5" />{t.projects.connections.useInProject}
            </button>
          )}
          {canOpenLocal && (
            <button
              type="button"
              onClick={openOnLocalhost}
              disabled={openingLocal}
              title={t.projects.connections.openLocalhost}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border/60 px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted/50 disabled:opacity-60"
            >
              <MonitorSmartphone className={openingLocal ? "size-3.5 animate-pulse" : "size-3.5"} />
              {t.projects.connections.openShort}
            </button>
          )}
          {resolvedUrl ? (
            <a
              href={resolvedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-w-0 items-center gap-1.5 text-sm font-medium text-foreground transition-colors hover:text-foreground/70"
            >
              <span className="truncate">{resolvedUrl.replace("https://", "")}</span>
              <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
            </a>
          ) : sourceLabel ? (
            <span className="truncate text-sm text-muted-foreground">{sourceLabel}</span>
          ) : null}
        </div>
        {/* Another container on the host also answers to this service — a
            leftover from an adopt/redeploy. It isn't the one we manage, and it
            may still be holding a port or a volume. */}
        {container?.duplicates && container.duplicates.length > 0 && (
          <p className="mt-1 text-xs text-warning">
            {interpolate(t.projectDetail.services.detail.duplicateContainers, {
              names: container.duplicates.join(", "),
            })}
          </p>
        )}
      </div>

      {/* ── Tab strip ──────────────────────────────────────────── */}
      <Tabs
        className="border-b-0"
        size="sm"
        fullWidth
        tabs={SERVICE_TAB_DEFS.map((def) => ({
          ...def,
          label: t.projectDetail.services.detail.tabs[def.key],
          href: deepLink ? `/projects/${projectId}/services/${service.id}/${def.key}` : undefined,
          ...(def.key === "volumes" && service.volumes?.length ? { count: service.volumes.length } : {}),
          ...(def.key === "domains" && configuredServiceEndpoints(service).length ? { count: configuredServiceEndpoints(service).length } : {}),
          ...(def.key === "backup" ? { hidden: !supportsBackup } : {}),
        }))}
        value={activeTab}
        onChange={changeTab}
      />

      {/* ── Overview ───────────────────────────────────────────── */}
      {activeTab === "overview" && (
        <ServiceOverview
          service={service}
          container={container}
          projectId={projectId}
          deployTarget={deployTarget}
          onSettings={() => changeTab("settings")}
          onDomains={(intent) => { setDomainIntent(intent); changeTab("domains"); }}
        />
      )}

      {activeTab === "domains" && (
        <ServiceDomainsPanel
          key={`${service.id}:${domainIntent.port ?? "all"}:${domainIntent.add ?? false}`}
          projectId={projectId}
          serviceId={service.id}
          intent={domainIntent}
          onChanged={onRefresh}
        />
      )}

      {activeTab === "volumes" && (
        <ServiceVolumesPanel
          key={service.id}
          service={service}
          projectId={projectId}
          deployTarget={deployTarget}
          onSave={(volumes) => handleUpdateService({ volumes })}
          onBackup={supportsBackup ? handleVolumeBackup : undefined}
          backupBusy={backupLoading || backupRunning || !!backupError}
          backupFeedback={supportsBackup ? backupFeedback : undefined}
        />
      )}

      {/* ── Terminal ───────────────────────────────────────────── */}
      {activeTab === "terminal" &&
        (status === "running" ? (
          <div className="min-h-[460px]">
            <ServiceTerminal
              serviceId={service.id}
              enabled={true}
              name={service.name}
              theme={resolvedTheme === "light" ? "light" : "dark"}
              resumeToken={terminalResumeToken}
              onResumeTokenChange={persistResumeToken}
            />
          </div>
        ) : (
          <div className="flex min-h-[220px] items-center justify-center rounded-2xl border border-dashed border-border/50 bg-muted/10 text-[12px] text-muted-foreground">
            {status === "checking" || status === "unknown" ? (
              <ServiceStatusBadge status={status} />
            ) : (
              t.projectDetail.services.detail.startShellHint
            )}
          </div>
        ))}

      {/* ── Logs ───────────────────────────────────────────────── */}
      {activeTab === "logs" && (
        <div className="min-h-[460px]">
          <TerminalLogs
            projectId={projectId}
            projectName={service.name}
            streamTarget={endpoints.services.logsStream(projectId, service.id)}
            historyTarget={endpoints.services.logs(projectId, service.id)}
            onLogsChange={() => {
              /* view-only; the panel doesn't need the buffer */
            }}
          />
        </div>
      )}

      {(activeTab === "env" || environmentVisited) && (
        <div hidden={activeTab !== "env"}>
          <ServiceEnvironmentPanel
            key={`${projectId}:${service.id}`}
            projectId={projectId}
            service={service}
            applying={applyingEnvironment}
            operationBusy={serviceOperationBusy}
            onDirtyChange={setEnvDirty}
            onApply={() => environmentApply.apply(service)}
          />
        </div>
      )}

      {/* ── Settings (replaces the old edit modal) ─────────────── */}
      {activeTab === "settings" && (
        <div className="space-y-5">
          {/* Controls — lifecycle + delete live with the service's settings. */}
          <div className="bg-card rounded-2xl border border-border/50 p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-2 flex-wrap">
                {container?.containerId ? (
                  <>
                    {/* A container that's up OR bouncing OR whose state we can't
                        read is NOT something to offer "Start" on — Stop/Restart
                        are the honest actions. Only a genuinely down container
                        gets Start. */}
                    {status !== "stopped" && status !== "failed" && (
                      <>
                        <ActionButton
                          icon={Square}
                          label={t.projectDetail.services.detail.stop}
                          loading={actionLoading === "stop"}
                          disabled={serviceOperationBusy}
                          onClick={() => handleContainerAction("stop")}
                          variant="danger"
                        />
                        <ActionButton
                          icon={RotateCw}
                          label={t.projectDetail.services.detail.restart}
                          loading={actionLoading === "restart"}
                          disabled={serviceOperationBusy}
                          onClick={() => handleContainerAction("restart")}
                          variant="warning"
                        />
                      </>
                    )}
                    {(status === "stopped" || status === "failed") && (
                      <ActionButton
                        icon={Play}
                        label={t.projectDetail.services.detail.start}
                        loading={actionLoading === "start"}
                        disabled={serviceOperationBusy}
                        onClick={() => handleContainerAction("start")}
                        variant="success"
                      />
                    )}
                  </>
                ) : (
                  // No workspace/container yet → Start provisions + launches it
                  // inline (its own container / Oblien workspace). No build page,
                  // no redeploy. A source-built service (no image) can't launch
                  // this way — it shows Redeploy (below) instead of Start.
                  canStartWithoutBuild &&
                  ["stopped", "failed", "disabled"].includes(status) && (
                    <ActionButton
                      icon={Play}
                      label={
                        deploying
                          ? t.projectDetail.services.detail.starting
                          : t.projectDetail.services.detail.start
                      }
                      loading={deploying}
                      disabled={serviceOperationBusy}
                      onClick={handleDeployStart}
                      variant="success"
                    />
                  )
                )}
                {/* Pipeline services (compose / monorepo / source-built) keep the
                    per-service Redeploy → build page. Image apps never show it. */}
                {usesDeployPipeline && service.enabled && activeDeploymentId && (
                  <ActionButton
                    icon={Rocket}
                    label={
                      redeploying
                        ? t.projectDetail.services.detail.redeploying
                        : t.projectDetail.services.detail.redeploy
                    }
                    loading={redeploying}
                    disabled={serviceOperationBusy}
                    onClick={handleRedeployService}
                    variant="primary"
                  />
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleToggleEnabled}
                  disabled={saving}
                  className={`inline-flex h-9 items-center gap-2 rounded-xl px-4 text-[13px] font-medium transition-colors disabled:opacity-50 ${
                    service.enabled
                      ? "bg-danger-bg text-danger hover:bg-danger-solid/20"
                      : "bg-success-bg text-success hover:bg-success-solid/20"
                  }`}
                >
                  {saving ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Power className="size-4" />
                  )}
                  {service.enabled
                    ? t.projectDetail.services.detail.disableService
                    : t.projectDetail.services.detail.enableService}
                </button>
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="inline-flex h-9 items-center gap-2 rounded-xl px-4 text-[13px] font-medium bg-danger-bg text-danger hover:bg-danger-solid/20 transition-colors"
                >
                  <Trash2 className="size-4" />
                  {t.projectDetail.services.detail.delete}
                </button>
              </div>
            </div>
          </div>

          <ServiceSettingsForm
            service={service}
            includeVolumes={false}
            siblingServiceNames={switchableServices
              .filter((s) => s.id !== service.id)
              .map((s) => s.name)
              .filter((n): n is string => Boolean(n))}
            onSubmit={handleUpdateService}
          />
        </div>
      )}

      {/* ── Backup ─────────────────────────────────────────────── */}
      {activeTab === "backup" && supportsBackup && (
        <div className="bg-card rounded-2xl border border-border/50 p-5">
          <SectionHeader
            title={t.projectDetail.services.detail.backup}
            subtitle={
              !backupLoading && !backupError && backupPolicy
                ? `${backupPolicy.payloadKind} · ${backupPolicy.cronExpression ? interpolate(t.projectDetail.services.detail.backupSubtitle.cron, { expr: backupPolicy.cronExpression }) : t.projectDetail.services.detail.backupSubtitle.manualOnly}${backupPolicy.triggerOnPreDeploy ? ` · ${t.projectDetail.services.detail.backupSubtitle.preDeploy}` : ""}${backupPolicy.webhookToken ? ` · ${t.projectDetail.services.detail.backupSubtitle.webhook}` : ""}`
                : !backupLoading && !backupError ? t.projectDetail.services.detail.backupSubtitle.none : undefined
            }
            icon={DatabaseBackup}
          />
          <div className="space-y-3">
            {backupFeedback}

            {backupLoading ? (
              <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                {t.projectDetail.services.detail.storage.loadingBackups}
              </div>
            ) : (
              !backupError && (
                <div className="flex flex-wrap items-center gap-2">
                  {backupPolicy ? (
                    <>
                      <button
                        onClick={() => void handleBackupNow()}
                        disabled={backupRunning}
                        className="inline-flex min-h-9 items-center gap-1.5 rounded-xl bg-primary px-3.5 text-[13px] font-medium text-primary-foreground transition-opacity hover:opacity-90"
                      >
                        {backupRunning ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <PlayCircle className="size-4" />
                        )}
                        {t.projectDetail.services.detail.backupNow}
                      </button>
                      <button
                        onClick={() => {
                          setBackupAfterSave(false);
                          setBackupEditorOpen(true);
                        }}
                        className="inline-flex min-h-9 items-center gap-1.5 rounded-xl bg-foreground/[0.06] px-3.5 text-[13px] font-medium text-foreground transition-colors hover:bg-foreground/[0.1]"
                      >
                        <Settings className="size-4" />
                        {t.projectDetail.services.detail.editPolicy}
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => {
                        setBackupAfterSave(false);
                        setBackupEditorOpen(true);
                      }}
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-xl bg-foreground/[0.06] px-3.5 text-[13px] font-medium text-foreground transition-colors hover:bg-foreground/[0.1]"
                    >
                      <Plus className="size-4" />
                      {t.projectDetail.services.detail.createPolicy}
                    </button>
                  )}
                </div>
              )
            )}
          </div>
        </div>
      )}

      {backupEditorOpen && (
        <PolicyEditor
          projectId={projectId}
          serviceId={service.id}
          serviceName={service.name}
          serviceImage={service.image}
          existing={backupPolicy}
          submitLabel={
            backupAfterSave ? t.projectDetail.services.detail.storage.saveAndBackup : undefined
          }
          onClose={() => setBackupEditorOpen(false)}
          onSaved={async (policy) => {
            if (backupScopeRef.current !== backupScope) return;
            setBackupEditorOpen(false);
            setBackupPolicy(policy);
            await reloadBackupPolicy();
            if (backupAfterSave) await handleBackupNow(policy);
          }}
        />
      )}

      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
          onClick={() => setConfirmDelete(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-border/60 bg-card p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-foreground">
              {t.projectDetail.services.detail.deleteTitle}
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {interpolate(t.projectDetail.services.detail.deleteBody, { name: service.name })}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
                className="inline-flex h-10 items-center rounded-xl bg-foreground/[0.06] px-4 text-sm font-medium text-foreground transition-colors hover:bg-foreground/[0.1] disabled:opacity-50"
              >
                {t.projectDetail.services.detail.deleteCancel}
              </button>
              <button
                onClick={handleDeleteService}
                disabled={deleting}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-danger-solid px-4 text-sm font-medium text-white transition-colors hover:bg-danger-solid/90 disabled:opacity-50"
              >
                {deleting && <Loader2 className="size-4 animate-spin" />}
                {t.projectDetail.services.detail.deleteConfirm}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Primitives ─────────────────────────────────────────────────────── */

function SectionHeader({
  title,
  subtitle,
  icon: Icon,
  right,
}: {
  title: string;
  subtitle?: string;
  icon: React.ComponentType<{ className?: string }>;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon className="size-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        </div>
        {right}
      </div>
      {subtitle && (
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{subtitle}</p>
      )}
    </div>
  );
}

function ActionButton({
  icon: Icon,
  label,
  loading,
  disabled,
  onClick,
  variant,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  loading: boolean;
  disabled?: boolean;
  onClick: () => void;
  variant: "success" | "danger" | "warning" | "primary";
}) {
  const colors = {
    success: "bg-success-bg text-success hover:bg-success-solid/20",
    danger: "bg-danger-bg text-danger hover:bg-danger-solid/20",
    warning: "bg-warning-bg text-warning hover:bg-warning-solid/20",
    primary: "bg-primary/10 text-primary hover:bg-primary/20",
  };
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      disabled={loading || disabled}
      className={`inline-flex h-9 items-center gap-2 rounded-xl px-4 text-[13px] font-medium transition-colors disabled:opacity-50 ${colors[variant]}`}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : <Icon className="size-4" />}
      {label}
    </button>
  );
}
