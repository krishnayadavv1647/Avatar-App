import { api } from "@/lib/apiClient";

/** The signed-in person's credits: balance, what it buys, packs for sale, history. */
export const creditsApi = {
  /**
   * `{ balance, available, unlimited, rates, equivalents, low, plan, nextGrantAt, packs, purchasable }`.
   * `available` is the balance less what calls running right now have used.
   */
  summary: () => api.get("/billing/credits"),
  transactions: (page = 1) => api.get(`/billing/credit-transactions?page=${page}`),
  /** Starts buying a pack; resolves to `{ url }`, the Stripe page to send the person to. */
  checkout: (packId) => api.post("/billing/checkout", { packId }),
};
