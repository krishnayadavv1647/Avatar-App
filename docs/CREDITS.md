# Credits

Calls are paid for in credits. A person sees a balance and what it buys ("250 credits = 10 minutes of Standard calls"); an admin sets what a minute costs, what plans give, and what can be bought.

## How a call is paid for

- **The price of a minute depends on the avatar's render model** (set on its settings page): Standard 25, Flash 15, Lite 10 credits a minute by default. An admin changes them under Admin > Credits.
- **A call is charged when it ends,** for the seconds it ran, at the rate it *started* with - changing a rate never reprices a call already running.
- **The clock starts at the first word spoken** - the avatar's greeting, or the caller speaking first (`agent/callStart.js`). Not when the worker picks the job up, not while the caller answers the microphone prompt (`agent/callReady.js`), and not while the avatar is still thinking up its greeting. A call where nobody speaks within 45 seconds never starts and is never billed. The length limit and the silence watch start with the clock.
- **The vendor (LemonSlice) is started only once the caller is in the room with a microphone** (`agent/callReady.js`), because it bills for as long as its session is open. A caller still answering the microphone prompt, or who never allows it, costs nothing at the vendor; the worker gives up after 90 seconds. What is left on our side of the vendor's meter is its own start-up (a few seconds) before the first word, which is not billed to the person.
- **A greeting the owner wrote is spoken as written** (`session.say`, no model in between), so there is no "thinking" before the first word and no tokens spent; with no greeting the model makes one up. (`greetingFor` in `agent/callStart.js`.)
- **A call runs for five minutes unless its avatar says otherwise** (`DEFAULT_CALL_SECONDS`; the owner raises it under Settings > Maximum call length, up to four hours). An open call is billed every second whether anyone is talking or not, so a tab left open on a share link would otherwise run until the credits did. The same limit is the only cap on what one caller on a public link can spend.
- **A call nobody is talking in is ended after a minute of silence** (`IDLE_CALL_SECONDS`, 0 turns it off). The avatar asks "are you still there?" once, about twenty seconds before, and says goodbye when it ends it (reason "idle"). The person speaking, or the avatar mid-answer, is never silence, and meetings are exempt. Code: `agent/idleWatch.js`, wired in `agent/worker.js` once the call has really begun.
- **Ending a call sets its duration in the same atomic write as its status** (`roomService.finish`), so the hang-up and the worker seeing the room close cannot disagree about how long it ran. A call that ended with minutes and no charge (a failed write) is charged on the next minute's check, but only within the hour after it ended (`chargeMissedCalls`).
- **A call will not start** unless there is at least a minute's worth of credits (402, `insufficient_credits`, saying what a minute costs). Credits being used by calls that are running already count as spent.
- **A running call is ended when the credits run out.** `modules/billing/creditEnforcer.js` checks every 15 seconds and ends every call in the workspace (reason "out of credits"); a call can overrun by at most one check. It runs in the API, so it covers every kind of call.
- A plan with **Unlimited credits** is never refused, charged or ended.

## Why 25 a Standard minute

The avatar vendor (LemonSlice) charges about 24 of its own credits a minute on its standard model (its Starter plan: 1,000 credits for 41 minutes, $8). A Standard minute here is 25 credits, so one credit here is about one credit there, and with a credit worth about two cents a minute is billed at about 50 cents against a cost of roughly a quarter of a dollar all in. Flash and Lite keep their old proportions; the vendor does not publish what they cost.

**The rate went from 10 to 25 in October 2026.** Balances were multiplied by 2.5 once, with `node src/scripts/migrate-credit-rate.js --apply` (a dry run is the default; it shows each account's before and after, refuses while calls are running, and is safe to repeat - one ledger entry per workspace, marked "Credit rate change"). Plan minutes did not change: a plan's credits are its minutes times the Standard rate. Explicit monthly credits on a plan and the credits in a pack are multiplied in the same run.

## Where credits come from

Everything is a row in the ledger (`CreditTransaction`); the balance is their sum, kept on `CreditAccount`.

| Kind | What |
|---|---|
| `plan_grant` | The plan's monthly credits. Topped up to the plan's amount each calendar month (UTC) the first time the balance is read, on plan assignment, and by a half-hourly sweep. Moving up mid-month gives the difference; nothing is ever taken back. |
| `signup_grant` | Welcome credits (default 250: ten minutes of Standard), once, for an account that starts with no plan. |
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
