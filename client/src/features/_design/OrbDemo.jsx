import { useEffect, useState } from "react";
import clsx from "clsx";
import Button from "@/components/common/Button";
import CallOrb from "@/features/call/CallOrb";

/**
 * The call screen's connecting animation on its own, with the three moments of a
 * call as buttons: Start (the card pulls into a bubble), Connect (it swells back
 * into a card and fades into what is underneath, here a stand-in for live
 * video), End. It follows the same steps PortraitCall does, minus LiveKit.
 *
 * With no real avatar the picture is the drawn placeholder.
 */
// Nothing to load, so the drawn placeholder is the picture.
const FACE = { key: "design-preview", load: () => Promise.reject(new Error("demo")), name: "Maya" };

export default function OrbDemo() {
  const [phase, setPhase] = useState("idle"); // idle | calling | connected
  const [ready, setReady] = useState(false);
  const [fading, setFading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!fading) return undefined;
    const id = setTimeout(() => setDone(true), 400);
    return () => clearTimeout(id);
  }, [fading]);

  const reset = () => {
    setPhase("idle");
    setReady(false);
    setFading(false);
    setDone(false);
  };

  const on = phase !== "idle" && !done;

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="relative w-[260px]">
        <div
          className={clsx(
            "relative aspect-[2/3] overflow-hidden rounded-[28px] sm:rounded-[40px]",
            on && ready ? "bg-transparent" : "bg-surface-2",
          )}
        >
          {/* Stands in for the live video. */}
          <div
            aria-label="live video"
            className={clsx(
              "absolute inset-0 flex items-center justify-center bg-gradient-to-b from-green-dim to-surface-3 text-ui text-text-muted transition-opacity duration-300",
              fading || done ? "opacity-100" : "opacity-0",
            )}
          >
            live video
          </div>
          {phase === "idle" && (
            <div className="absolute inset-0 flex items-center justify-center bg-surface-3 text-ui text-text-faint">
              avatar picture
            </div>
          )}
        </div>
        {on && (
          <CallOrb
            face={FACE}
            state={phase === "connected" ? "connected" : "calling"}
            fading={fading}
            onReady={() => setReady(true)}
            onSettled={() => setFading(true)}
          />
        )}
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={() => setPhase("calling")} disabled={phase !== "idle"}>
          Start call
        </Button>
        <Button variant="secondary" onClick={() => setPhase("connected")} disabled={phase !== "calling"}>
          Simulate connect
        </Button>
        <Button variant="ghost" onClick={reset} disabled={phase === "idle"}>
          End
        </Button>
        <span className="min-w-24 text-ui text-text-muted" role="status">
          {phase === "idle" ? "Idle" : phase === "calling" ? "Calling…" : "Connected"}
        </span>
      </div>
    </div>
  );
}
