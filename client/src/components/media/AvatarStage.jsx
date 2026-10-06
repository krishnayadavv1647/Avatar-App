import { useEffect, useState } from "react";
import { RoomAudioRenderer, VideoTrack, useTracks } from "@livekit/components-react";
import { Track } from "livekit-client";
import clsx from "clsx";
import CallOrb from "@/features/call/CallOrb";
import MediaPreview from "./MediaPreview";

/**
 * The avatar's video.
 *
 * Video does not arrive the instant the agent joins - the renderer has to
 * publish a track first - so until an actual track exists the avatar's picture
 * is drawn as the connecting animation (when a `face` is given and the browser
 * allows it), and it settles into the live video once that arrives.
 */
export default function AvatarStage({ avatarName, previewUrl, isSpeaking, face }) {
  const tracks = useTracks([Track.Source.Camera], { onlySubscribed: true });
  // The agent is the only remote participant; its camera track is the avatar.
  const avatarTrack = tracks.find((t) => !t.participant.isLocal);

  const [orbOff, setOrbOff] = useState(() => !face || window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [orbReady, setOrbReady] = useState(false);
  const [orbFading, setOrbFading] = useState(false);
  const [orbDone, setOrbDone] = useState(false);

  useEffect(() => {
    if (!orbFading) return undefined;
    const id = setTimeout(() => setOrbDone(true), 400);
    return () => clearTimeout(id);
  }, [orbFading]);

  const orbOn = !orbOff && !orbDone;
  const covered = orbOn && orbReady;
  const revealed = orbOff || orbFading || orbDone;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex items-center justify-between gap-3 px-5 py-3">
        <span className="font-medium">{avatarName || "Avatar"}</span>
        <span
          className={`rounded-full px-2.5 py-1 text-label ${
            isSpeaking ? "bg-green-dim text-green" : "bg-surface-3 text-text-muted"
          }`}
        >
          {isSpeaking ? "Speaking" : "Listening"}
        </span>
      </div>

      <div className={clsx("relative aspect-square w-full overflow-hidden", covered ? "bg-transparent" : "bg-surface-2")}>
        {avatarTrack && (
          <VideoTrack
            trackRef={avatarTrack}
            className={clsx("h-full w-full object-cover transition-opacity duration-300", !revealed && "opacity-0")}
          />
        )}
        {!avatarTrack && !covered && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
            {previewUrl && (
              <MediaPreview
                src={previewUrl}
                className="h-32 w-32 rounded-lg opacity-40 grayscale"
              />
            )}
            <span className="text-ui text-text-muted">Waiting for avatar video…</span>
          </div>
        )}
        {orbOn && (
          <CallOrb
            face={face}
            state={avatarTrack ? "connected" : "calling"}
            fading={orbFading}
            radius={0}
            onReady={() => setOrbReady(true)}
            onSettled={() => setOrbFading(true)}
            onUnsupported={() => setOrbOff(true)}
          />
        )}
        {covered && !avatarTrack && (
          <span className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full bg-surface/80 px-3 py-1 text-label text-text-muted">
            Connecting…
          </span>
        )}
      </div>

      {/* Without this the agent's audio track is never played. */}
      <RoomAudioRenderer />
    </div>
  );
}
