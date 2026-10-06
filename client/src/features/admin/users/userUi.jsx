import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { money } from "../format";

/** Small pieces the Users, Invite and Plans tabs share. */

const SOURCE_PATHS = {
  invited: "M2 3.5h12v9H2zM2 4.5l6 4.5 6-4.5",
  manual: "M8 3v10M3 8h10",
  signup: "M8 7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM3 14c0-2.5 2.2-4 5-4s5 1.5 5 4",
};

export const SOURCE_LABEL = { invited: "Invited", manual: "Manual", signup: "Sign-up" };

/** The small glyph on an avatar circle that says how the account came to be. */
export function SourceIcon({ source, size = 12, className }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d={SOURCE_PATHS[source] || SOURCE_PATHS.signup} />
    </svg>
  );
}

/** "Starter ($29.00/mo - 100 min)": how a plan reads in a picker. */
export function planLabel(plan) {
  const price = plan.priceCents ? `${money(plan.priceCents)}${plan.durationType === "lifetime" ? " one time" : "/mo"}` : "$0";
  const minutes = plan.includedMinutes ? `${plan.includedMinutes.toLocaleString()} min` : "no minute cap";
  return `${plan.name} (${price} - ${minutes})`;
}

/** What a plan's minutes read as, where 0 means there is no monthly cap. */
export const planMinutesLabel = (minutes) => (minutes > 0 ? `${minutes.toLocaleString()} min` : "No monthly cap");

/** How a user's total allowance reads: plan plus bonus, or "No cap" when the plan has none. */
export function allowance({ planMinutes, bonusMinutes }) {
  if (!planMinutes) {
    return { total: "No cap", detail: bonusMinutes > 0 ? `Bonus ${bonusMinutes} (plan has no cap)` : "Plan: no monthly cap" };
  }
  return {
    total: `${(planMinutes + bonusMinutes).toLocaleString()} min`,
    detail: `Plan: ${planMinutes.toLocaleString()}${bonusMinutes > 0 ? ` + Bonus: ${bonusMinutes.toLocaleString()}` : ""}`,
  };
}

/** A ⋯ button with a dropdown. Closes on an outside click, Escape, or choosing an item. */
export function RowMenu({ label, items }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => !root.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="rounded p-2 text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <circle cx="3" cy="8" r="1.4" />
          <circle cx="8" cy="8" r="1.4" />
          <circle cx="13" cy="8" r="1.4" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-20 mt-1 min-w-[170px] rounded-lg border border-border-strong bg-surface-2 p-1 shadow-lg"
        >
          {items.map((item, i) =>
            item.separator ? (
              <div key={i} className="my-1 border-t border-border" />
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                title={item.title}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
                className={clsx(
                  "block w-full rounded px-3 py-2 text-left text-ui transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                  item.danger ? "text-red hover:bg-red-dim" : "text-text hover:bg-surface-hover",
                )}
              >
                {item.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

/** A plain-field class for the few inputs the shared controls do not cover (search). */
export const INPUT_CLASS =
  "h-10 w-full rounded border border-border bg-bg px-3 text-ui text-text outline-none transition-colors placeholder:text-text-faint focus:border-border-strong disabled:opacity-40";
