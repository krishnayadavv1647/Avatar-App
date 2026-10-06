# Credits

Calls are paid for in credits. A person sees a balance and what it buys ("240 credits = 24 minutes of Standard calls"); an admin sets what a minute costs, what plans give, and what can be bought.

## How a call is paid for

- **The price of a minute depends on the avatar's render model** (set on its settings page): Standard 10, Flash 6, Lite 4 credits a minute by default. An admin changes them under Admin > Credits.
- **A call is charged when it ends,** for the seconds it ran, at the rate it *started* with - changing a rate never reprices a call already running.
- **A call will not start** unless there is at least a minute's worth of credits (402, `insufficient_credits`, saying what a minute costs). Credits being used by calls that are running already count as spent.
- **A running call is ended when the credits run out.** `modules/billing/creditEnforcer.js` checks every 15 seconds and ends every call in the workspace (reason "out of credits"); a call can overrun by at most one check. It runs in the API, so it covers every kind of call.
- A plan with **Unlimited credits** is never refused, charged or ended.

## Where credits come from

Everything is a row in the ledger (`CreditTransaction`); the balance is their sum, kept on `CreditAccount`.

| Kind | What |
|---|---|
| `plan_grant` | The plan's monthly credits. Topped up to the plan's amount each calendar month (UTC) the first time the balance is read, on plan assignment, and by a half-hourly sweep. Moving up mid-month gives the difference; nothing is ever taken back. |
| `signup_grant` | Welcome credits (default 100), once, for an account that starts with no plan. |
| `admin_grant` / `admin_deduct` | An admin on a person's page, with a required reason, audit-logged. |
| `purchase` | A credit pack bought with Stripe. |
| `usage` | A finished call (negative). |

Credits do not expire. A grant or charge with a `ref` can only be applied once per workspace, so retried webhooks and two processes ending the same call cannot double-count.

Plans made before credits existed have no `monthlyCredits`; they are worth their old included minutes at the Standard rate. Old "bonus minutes" become credits the first time the account is looked at. Calls made before credits were introduced are not charged retrospectively.

## Selling packs (Stripe)

1. Admin > Credits > Credit packs: make the packs (name, credits, price, optional badge).
2. Admin > API Keys: save the Stripe **secret key** and the **webhook signing secret**. Both are needed; packs are only offered once both are set.
3. In Stripe, add a webhook endpoint at `https://<api-host>/api/webhooks/stripe` for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `charge.refunded`, `charge.dispute.created`.

Credits are added by the webhook, not by the page the person returns to, so a payment is credited even if they close the tab. Refunds and disputes do not remove credits by themselves: they write a warning to Error Logs and an admin removes the credits from the person's page.

## Where things are

- Core: `server/src/modules/billing/credit.service.js` (rates, balance, grants, charging, summary), `creditEnforcer.js`.
- Person's API: `GET /api/billing/credits`, `GET /api/billing/credit-transactions`, `POST /api/billing/checkout`.
- Admin API: `/api/admin/credits/settings`, `/credit-packs`, `/credit-transactions`, `/users/:id/credits`.
- Screens: Credits page (`/credits`), the balance in the sidebar, the meter under a call, Admin > Credits, and the Credits card on a user's page.
