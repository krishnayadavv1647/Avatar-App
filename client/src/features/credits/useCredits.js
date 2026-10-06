import { useQuery } from "@tanstack/react-query";
import { creditsApi } from "@/services/credits.api";

/**
 * The person's credits. Shared by the sidebar, the credits page and the call
 * screens, which is why they are one query: three screens, one request.
 * `poll` is how often to ask again, in ms - a call watches closely, the sidebar
 * only now and then.
 */
export function useCredits({ poll = 60_000 } = {}) {
  return useQuery({
    queryKey: ["credits"],
    queryFn: creditsApi.summary,
    refetchInterval: poll,
    staleTime: 5_000,
  });
}

/** Credits for people: whole numbers plain, a fraction to one place, never rounded up. */
export function formatCredits(n) {
  const value = Math.floor(Math.max(0, n) * 10) / 10;
  return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(1);
}

/** Minutes for people: "about 24", "16.6", "under 1". */
export function formatMinutes(minutes) {
  if (minutes <= 0) return "0";
  if (minutes < 1) return "under 1";
  if (minutes >= 100) return Math.round(minutes).toLocaleString();
  return Number.isInteger(minutes) ? String(minutes) : minutes.toFixed(1);
}

/** Credits per minute for an avatar: its render model's rate. */
export const rateFor = (rates, avatar) => rates?.[avatar?.render?.model] ?? rates?.standard ?? 10;

export const RENDER_LABEL = { standard: "Standard", flash: "Flash", lite: "Lite" };

export const money = (cents, currency = "usd") =>
  new Intl.NumberFormat(undefined, { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
