/** One reviewed route in a Docker Compose migration. Paths are HTTP locations. */
export interface MigrationRouteSpec {
  exposedPort?: string;
  domainType: "free" | "custom";
  domain?: string;
  customDomain?: string;
  targetPath?: string;
  exact?: boolean;
}

/** Container ID → routes; legacy service-name keys and single routes are accepted. */
export type MigrationServiceRoutes = Record<string, MigrationRouteSpec | MigrationRouteSpec[]>;
