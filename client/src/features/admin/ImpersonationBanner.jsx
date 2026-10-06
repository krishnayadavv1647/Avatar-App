import { useEffect, useState } from "react";
import { useAuth } from "@/store/auth.store";
import Button from "@/components/common/Button";
import { exitImpersonation } from "./impersonation";

/**
 * Always on screen while an admin is acting as a user: who, how long is left,
 * and the way out. A pill at the bottom rather than a bar at the top, so it
 * sits over every page - including the ones outside the app shell - without
 * pushing any of them down.
 */
export default function ImpersonationBanner() {
  const impersonating = useAuth((s) => s.impersonating);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!impersonating) return undefined;
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, [impersonating]);

  const left = impersonating ? new Date(impersonating.expiresAt).getTime() - now : 0;

  // The token has run out: its requests would only fail, so go back.
  useEffect(() => {
    if (impersonating && left <= 0) exitImpersonation();
  }, [impersonating, left]);

  if (!impersonating) return null;

  const minutes = Math.max(1, Math.ceil(left / 60_000));
  const who = impersonating.as.name || impersonating.as.email;

  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 z-[70] flex w-[min(94vw,640px)] -translate-x-1/2 flex-wrap items-center justify-between gap-3 rounded-lg border border-yellow bg-surface px-4 py-3 shadow-lg"
    >
      <p className="min-w-0 text-ui">
        <span className="font-semibold text-yellow">Acting as {who}</span>
        <span className="text-text-muted">
          {" "}
          · changes are real and logged · {minutes} min left
        </span>
      </p>
      <Button size="sm" variant="secondary" onClick={exitImpersonation}>
        Exit
      </Button>
    </div>
  );
}
