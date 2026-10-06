import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { queryClient } from "@/lib/queryClient";
import ImpersonationBanner from "@/features/admin/ImpersonationBanner";
import { Toaster } from "@/components/feedback/Toast";
import SiteConfigApplier from "./SiteConfigApplier";

export default function AppProviders({ children }) {
  return (
    <QueryClientProvider client={queryClient}>
      <SiteConfigApplier />
      <BrowserRouter>{children}</BrowserRouter>
      <Toaster />
      <ImpersonationBanner />
    </QueryClientProvider>
  );
}
