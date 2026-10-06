import { Link } from "react-router-dom";
import clsx from "clsx";
import { formatCredits, formatMinutes, rateFor, useCredits } from "./useCredits";

/**
 * Under the call: what a minute with this avatar costs and what is left - the
 * answer to "how long can I talk?" before pressing Start, and a countdown once
 * the call is running. Nothing for an unlimited plan, which has nothing to run
 * out of.
 *
 * While calling it asks every ten seconds; the server ends the call itself when
 * the credits are gone, so this is a warning, not the thing that stops it.
 */
export default function CreditMeter({ avatar, calling = false }) {
  const { data } = useCredits({ poll: calling ? 10_000 : 60_000 });
  if (!data || data.unlimited) return null;

  const rate = rateFor(data.rates, avatar);
  const minutesLeft = data.available / rate;
  const out = data.available < (calling ? 0.01 : rate);
  const nearly = !out && minutesLeft < 2;

  return (
    <div
      className={clsx(
        "mt-4 flex max-w-md flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-full border px-4 py-2 text-center text-ui",
        out ? "border-red-line bg-red-dim text-red" : nearly ? "border-border-strong bg-surface-2 text-yellow" : "border-border bg-surface-2 text-text-muted",
      )}
      role={out || nearly ? "alert" : "status"}
    >
      {calling ? (
        <span>
          {out
            ? "You are out of credits. The call is ending."
            : nearly
              ? `Your credits are about to run out: ${formatCredits(data.available)} left. The call ends when they do.`
              : `${formatCredits(data.available)} credits left, about ${formatMinutes(minutesLeft)} min`}
        </span>
      ) : (
        <span>
          {rate} credits a minute · you have {formatCredits(data.available)} (about {formatMinutes(minutesLeft)} min)
        </span>
      )}
      {!calling && (out || nearly || data.low) && (
        <Link to="/credits" className="font-medium text-text underline-offset-2 hover:underline">
          Get credits
        </Link>
      )}
    </div>
  );
}
