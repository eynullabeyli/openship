"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, ExternalLink, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/i18n-provider";
import { useDeployment } from "@/context/DeploymentContext";
import { usesServiceDeployment } from "@/context/deployment/types";
import { usePlatform } from "@/context/PlatformContext";
import { invalidateProjectCaches } from "@/hooks/useProjectEndpoints";
import { resolvePublicEndpointHostname } from "@/lib/public-endpoint-payload";
import { encodeLocalSlug, encodeProjectSlug, encodeRepoSlug } from "@/utils/repoSlug";

export function DeploymentSuccessActions() {
  const { config, state } = useDeployment();
  const { baseDomain } = usePlatform();
  const { t } = useI18n();
  const router = useRouter();
  const copy = t.importProject.deploymentProcessing;
  const projectId = state.projectId || config.projectId;
  const failedServices = new Set(
    state.serviceStatuses
      .filter((service) => service.status === "failed")
      .map((service) => service.serviceName),
  );
  const endpoints = usesServiceDeployment(config)
    ? config.services
        .filter((service) => service.exposed && !failedServices.has(service.name))
        .flatMap<Parameters<typeof resolvePublicEndpointHostname>[0]>((service) =>
          service.publicEndpoints?.length ? service.publicEndpoints : [service],
        )
    : config.noPublicRoute
      ? []
      : config.publicEndpoints;
  const domain = endpoints
    .map((endpoint) =>
      endpoint.domainType !== "custom" && !baseDomain
        ? ""
        : resolvePublicEndpointHostname(endpoint, baseDomain),
    )
    .find(Boolean);

  const openProject = () => {
    if (!projectId) return;
    invalidateProjectCaches(projectId);
    router.push(`/projects/${projectId}`);
  };

  return (
    <div className="space-y-2">
      {domain && (
        <Button asChild className="w-full">
          <a href={`https://${domain}`} target="_blank" rel="noopener noreferrer">
            {copy.openSite}
            <ExternalLink />
          </a>
        </Button>
      )}
      <Button
        type="button"
        variant={domain ? "outline" : "default"}
        className="w-full"
        onClick={openProject}
        disabled={!projectId}
      >
        {copy.openProject}
        <ArrowRight className="rtl:rotate-180" />
      </Button>
    </div>
  );
}

export function DeploymentConfigurationAction({ className }: { className?: string }) {
  const { config, state } = useDeployment();
  const { t } = useI18n();
  const projectId = state.projectId || config.projectId;
  if (!projectId) return null;

  const slug = config.localPath
    ? encodeLocalSlug(config.localPath)
    : config.owner && config.repo
      ? encodeRepoSlug(config.owner, config.repo)
      : encodeProjectSlug(projectId);
  const params = new URLSearchParams({ projectId, mode: "config" });

  return (
    <Button asChild variant="outline" className={className}>
      <Link href={`/deploy/${slug}?${params.toString()}`}>
        <SlidersHorizontal />
        {t.importProject.composeDeployment.editConfiguration}
      </Link>
    </Button>
  );
}
