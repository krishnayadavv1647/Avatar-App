/**
 * Ready-made plans an admin can add in one click.
 *
 * Priced from the running cost of a call: LemonSlice is about $0.164 a minute
 * (see avatar/capabilities.js) plus a few cents for speech and the language
 * model, so every paid plan works out above $0.24 a minute. Credits are set at
 * ten to a Standard minute: Starter's 1,000 credits are 100 minutes. Adjust freely once
 * added - they are ordinary plans. None is made the default, so adding them
 * changes nothing for new sign-ups until an admin chooses.
 */
export const PLAN_TEMPLATES = [
  {
    key: "free",
    name: "Free",
    description: "Try it out: one avatar and a few minutes a month.",
    priceCents: 0,
    monthlyCredits: 100,
    concurrencyLimit: 1,
    maxAvatars: 1,
  },
  {
    key: "starter",
    name: "Starter",
    description: "For individuals getting started.",
    priceCents: 2900,
    monthlyCredits: 1000,
    concurrencyLimit: 2,
    maxAvatars: 3,
  },
  {
    key: "pro",
    name: "Pro",
    description: "For teams running avatars every day.",
    priceCents: 9900,
    monthlyCredits: 4000,
    concurrencyLimit: 5,
    maxAvatars: 10,
  },
  {
    key: "business",
    name: "Business",
    description: "For high-volume support and sales.",
    priceCents: 29900,
    monthlyCredits: 12000,
    concurrencyLimit: 20,
    maxAvatars: 0,
  },
];
