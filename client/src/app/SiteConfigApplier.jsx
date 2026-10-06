import { useEffect } from "react";
import { useBranding, useSiteConfig } from "@/hooks/useBranding";

/**
 * Applies the admin's branding to the page itself: the tab title and the
 * favicon. Renders nothing. Only acts on what is set, so a fresh install keeps
 * the title and icon in index.html.
 */
export default function SiteConfigApplier() {
  const { data } = useSiteConfig();
  const { name, faviconUrl } = useBranding();

  useEffect(() => {
    if (data?.app_name) document.title = name;
  }, [data?.app_name, name]);

  useEffect(() => {
    if (!faviconUrl) return;
    let link = document.querySelector('link[rel="icon"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    // The type from index.html would be wrong for an .ico or .svg.
    link.removeAttribute("type");
    link.href = faviconUrl;
  }, [faviconUrl]);

  return null;
}
