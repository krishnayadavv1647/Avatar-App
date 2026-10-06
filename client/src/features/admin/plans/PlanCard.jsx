import Button from "@/components/common/Button";
import { Badge } from "@/components/forms/controls";
import { money } from "../format";

/**
 * One plan as a card: picture, name and price, status, what it includes, and
 * Edit / Delete. The price suffix says what the plan actually is - "/month" or
 * "one time" - which the system this was modelled on got backwards.
 */
export default function PlanCard({ plan, onEdit, onDelete }) {
  const lifetime = plan.durationType === "lifetime";

  return (
    <div className="flex h-full flex-col rounded-lg border border-border bg-surface-2 p-5">
      <div className="flex-grow">
        {plan.thumbnailUrl && (
          <div className="mb-4 aspect-video overflow-hidden rounded-lg bg-surface-3">
            <img src={plan.thumbnailUrl} alt={`${plan.name} thumbnail`} className="h-full w-full object-cover" />
          </div>
        )}

        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-h3 font-semibold" title={plan.name}>
              {plan.name}
            </h3>
            <p className="mt-1 text-h2 font-semibold">
              {plan.priceCents ? money(plan.priceCents) : "Free"}
              {plan.priceCents > 0 && (
                <span className="ml-1 text-ui font-normal text-text-muted">{lifetime ? "one time" : "/month"}</span>
              )}
            </p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Badge tone={plan.active ? "green" : "red"}>{plan.active ? "Active" : "Inactive"}</Badge>
            {!plan.visible && <Badge tone="neutral">Hidden</Badge>}
            {plan.isDefault && <Badge tone="outline">Default</Badge>}
          </div>
        </div>

        <div className="my-4 space-y-3 text-ui text-text-muted">
          <div className="flex flex-wrap gap-2">
          <Chip>
            {plan.unlimitedCredits
              ? "Credits: Unlimited"
              : `${(plan.monthlyCredits ?? 0).toLocaleString()} credits / month`}
          </Chip>
          <Chip>Display Order: {plan.displayOrder ?? 0}</Chip>
          <Chip>
            {plan.users} user{plan.users === 1 ? "" : "s"}
          </Chip>
          </div>
          {plan.conditionBoxDescription && (
            <p className="rounded-lg border border-border bg-bg p-2 text-label italic">
              Condition: {plan.conditionBoxDescription}
            </p>
          )}
        </div>

        <div className="border-t border-border pt-3">
          <h4 className="text-ui font-semibold">Limits:</h4>
          <ul className="mt-2 list-inside list-disc space-y-1 text-ui text-text-muted">
            <li>
              {plan.concurrencyLimit} call{plan.concurrencyLimit === 1 ? "" : "s"} at once
            </li>
            <li>{plan.maxAvatars ? `Up to ${plan.maxAvatars} avatar${plan.maxAvatars === 1 ? "" : "s"}` : "Unlimited avatars"}</li>
            <li>{plan.unlimitedCredits ? "Calls never use up credits" : "Calls use credits at the avatar's rate"}</li>
          </ul>
        </div>
      </div>

      <div className="mt-auto flex gap-2 pt-4">
        <Button variant="secondary" size="sm" fullWidth onClick={onEdit}>
          Edit
        </Button>
        <Button variant="danger" size="sm" fullWidth onClick={onDelete}>
          Delete
        </Button>
      </div>
    </div>
  );
}

function Chip({ children }) {
  return <span className="rounded bg-surface-3 px-2 py-0.5 font-mono text-label">{children}</span>;
}
