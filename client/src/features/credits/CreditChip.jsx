import { NavLink } from "react-router-dom";
import clsx from "clsx";
import { formatCredits, formatMinutes, useCredits } from "./useCredits";

/**
 * The balance, in the sidebar, on every page: "240 credits, about 24 min". Gets
 * yellow when it runs low and red when it is gone, and is the way to the credits
 * page. Says nothing for an unlimited plan beyond that it is unlimited.
 */
export default function CreditChip({ collapsed = false }) {
  const { data } = useCredits();
  if (!data) return null;

  const out = !data.unlimited && data.available <= 0;
  const tone = out ? "text-red" : data.low ? "text-yellow" : "text-text";
  const minutes = formatMinutes(data.equivalents?.standard ?? 0);
  const value = data.unlimited ? "Unlimited" : formatCredits(data.available);

  return (
    <NavLink
      to="/credits"
      title={data.unlimited ? "Credits: unlimited" : `${value} credits, about ${minutes} min of Standard calls`}
      className={({ isActive }) =>
        clsx(
          "mb-2 flex items-center rounded border border-border transition-colors hover:bg-surface-hover",
          isActive ? "bg-surface-active" : "bg-surface-2",
          collapsed ? "justify-center px-0 py-2" : "gap-3 px-3 py-2",
        )
      }
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={tone}>
        <path d="M9 1.5 3.5 9H8l-1 5.5L12.5 7H8z" />
      </svg>
      {!collapsed && (
        <span className="min-w-0 leading-tight">
          <span className={clsx("block text-ui font-semibold tabular-nums", tone)}>
            {value} {!data.unlimited && "credits"}
          </span>
          {!data.unlimited && <span className="block text-label text-text-faint">about {minutes} min</span>}
        </span>
      )}
    </NavLink>
  );
}
