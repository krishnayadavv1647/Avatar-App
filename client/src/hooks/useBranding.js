import { useQuery } from "@tanstack/react-query";
import { siteConfigApi } from "@/services/admin.system.api";

export const DEFAULT_BRAND = { name: "Avatar Studio", logoUrl: "/logo.png", faviconUrl: "" };

/** The app's public settings, shared by everything that shows the brand. */
export function useSiteConfig() {
  return useQuery({
    queryKey: ["site-config"],
    queryFn: siteConfigApi.get,
    staleTime: 5 * 60_000,
    // Branding is cosmetic: if it cannot load, the built-in look stays.
    retry: 0,
  });
}

/**
 * The name and logo to show. An unset setting yields exactly what the app
 * showed before there was a setting, so nothing changes until an admin
 * chooses something.
 */
export function useBranding() {
  const { data } = useSiteConfig();
  return {
    name: data?.app_name || DEFAULT_BRAND.name,
    logoUrl: data?.logo_url || DEFAULT_BRAND.logoUrl,
    faviconUrl: data?.favicon_url || DEFAULT_BRAND.faviconUrl,
  };
}
