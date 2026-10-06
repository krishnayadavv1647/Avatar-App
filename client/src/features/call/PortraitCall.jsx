import CreditMeter from "@/features/credits/CreditMeter";
import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  VideoTrack,
  useLocalParticipant,
  useTracks,
  useVoiceAssistant,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import MediaPreview from "@/components/media/MediaPreview";
import CallOrb, { avatarFace, warmFace } from "./CallOrb";
import DailyCall from "./DailyCall";
import { useCall } from "./useCall";

/**
 * A call in one portrait frame, laid out like LemonSlice's avatar page.
 *
 * Before the call the frame plays the avatar's preview with a Start call pill
 * at its foot; once connected the live video takes over the same frame and the
 * pill becomes the mic and hang-up controls. The frame follows the avatar's
 * render aspect ratio, so what is on screen is what the vendor draws.
 *
 * Starting and ending go through useCall, so hanging up lands on the
 * transcript. A full-pipeline vendor hands back its own room, which only fits
 * its own iframe - that case falls back to DailyCall.
 */
const ASPECT = { "2x3": "aspect-[2/3]", "9x16": "aspect-[9/16]", "1x1": "aspect-square" };
const RATIO = { "2x3": 2 / 3, "9x16": 9 / 16, "1x1": 1 };

/**
 * The frame is sized by its width, never wider than the screen: as tall as
 * fits under the page header (at most 700px), unless the screen is too narrow
 * for that, in which case it takes the full width and its height follows from
 * the aspect ratio. Sizing it by height let a portrait frame run off a phone.
 */
const frameWidth = (ratio) => ({
  width: `min(100%, calc(min(700px, 100dvh - 11rem) * ${ratio}))`,
});

export default function PortraitCall({ avatar }) {
  const { connection, starting, ending, error, setError, start, hangUp } = useCall(avatar._id);

  // The connecting animation (CallOrb). It runs from pressing Start until the live
  // video is there and the bubble has swelled back into a sharp card; then the
  // canvas fades and the video shows. Anyone who asked their system for less motion,
  // or whose browser has no WebGL, gets the plain screen instead.
  const [hasVideo, setHasVideo] = useState(false);
  const [orbReady, setOrbReady] = useState(false);
  const [orbFading, setOrbFading] = useState(false);
  const [orbDone, setOrbDone] = useState(false);
  const [orbOff, setOrbOff] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  // The picture is fetched ahead, so the bubble has something to draw the moment Start is pressed.
  const face = useMemo(() => avatarFace(avatar), [avatar]);
  useEffect(() => {
    if (!orbOff) warmFace(face);
  }, [face, orbOff]);

  // A call that ended, or never started, leaves nothing to carry into the next one.
  useEffect(() => {
    if (connection || starting) return;
    setHasVideo(false);
    setOrbReady(false);
    setOrbFading(false);
    setOrbDone(false);
  }, [connection, starting]);

  useEffect(() => {
    if (!orbFading) return undefined;
    const id = setTimeout(() => setOrbDone(true), 400); // the canvas's own fade
    return () => clearTimeout(id);
  }, [orbFading]);

  const orbOn = !orbOff && !orbDone && (starting || Boolean(connection));
  // Only once the bubble has its picture does the page stand down its own copy.
  const coveredByOrb = orbOn && orbReady;
  const revealed = orbOff || orbFading || orbDone;

  if (connection && connection.transport !== "livekit") {
    return (
      <div className="w-full max-w-2xl">
        <DailyCall avatar={avatar} joinUrl={connection.url} onHangUp={hangUp} ending={ending} />
      </div>
    );
  }

  const aspect = ASPECT[avatar.render?.aspectRatio] ? avatar.render.aspectRatio : "2x3";
  const frame = clsx(
    "relative overflow-hidden rounded-[28px] bg-surface-2 sm:rounded-[40px]",
    ASPECT[aspect],
  );

  return (
    <div className="flex w-full flex-col items-center">
      {/* The animation's glow reaches past the frame, so it is drawn outside the frame's clipping. */}
      <div className="relative" style={frameWidth(RATIO[aspect])}>
        <div className={clsx(frame, "w-full", coveredByOrb && "bg-transparent")}>
          {connection ? (
            <LiveKitRoom
              token={connection.token}
              serverUrl={connection.url}
              connect
              audio
              video={false}
              onDisconnected={hangUp}
              onError={(err) => setError(err.message)}
              className="absolute inset-0"
            >
              <Live
                avatar={avatar}
                onHangUp={hangUp}
                ending={ending}
                revealed={revealed}
                coveredByOrb={coveredByOrb}
                onVideo={setHasVideo}
              />
            </LiveKitRoom>
          ) : (
            <>
              {!coveredByOrb && <Preview avatar={avatar} dim={starting} />}
              {starting && orbOn ? (
                <StatusPill>Connecting…</StatusPill>
              ) : (
                <div className="absolute inset-x-0 bottom-6 z-20 flex justify-center">
                  <button
                    type="button"
                    onClick={start}
                    disabled={starting || !avatar.callable}
                    className="flex h-12 items-center gap-2.5 rounded-full bg-black/55 px-5 text-body font-semibold text-white backdrop-blur transition-colors hover:bg-black/70 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <CameraIcon />
                    {starting ? "Connecting…" : "Start call"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {orbOn && (
          <CallOrb
            face={face}
            state={hasVideo ? "connected" : "calling"}
            fading={orbFading}
            onReady={() => setOrbReady(true)}
            onSettled={() => setOrbFading(true)}
            onUnsupported={() => setOrbOff(true)}
          />
        )}

      </div>

      {avatar.callable && <CreditMeter avatar={avatar} calling={Boolean(connection)} />}

      {error && (
        <p className="mt-4 max-w-md rounded border border-red-line bg-red-dim px-4 py-3 text-center text-ui text-red">
          {error}
        </p>
      )}
      {!avatar.callable && !connection && (
        <p className="mt-4 text-ui text-text-faint">
          {avatar.unavailableReason || `Avatar is ${avatar.status} — not callable yet`}
        </p>
      )}
    </div>
  );
}

/** The avatar's talking clip when it has one, otherwise its picture. */
function Preview({ avatar, dim = false }) {
  return avatar.previewVideoUrl ? (
    <video
      src={avatar.previewVideoUrl}
      poster={avatar.previewUrl}
      autoPlay
      muted
      loop
      playsInline
      aria-label={avatar.name}
      className={clsx("absolute inset-0 h-full w-full object-cover transition-opacity", dim && "opacity-60")}
    />
  ) : (
    <MediaPreview
      src={avatar.previewUrl}
      alt={avatar.name}
      className={clsx("absolute inset-0 h-full w-full object-cover transition-opacity", dim && "opacity-60")}
    />
  );
}

const SLOW_JOIN_MS = 30_000;

const STATE_LABEL = {
  connecting: "Connecting…",
  initializing: "Getting ready…",
  listening: "Listening",
  thinking: "Thinking…",
  speaking: "Speaking",
  disconnected: "Call ended",
};

function Live({ avatar, onHangUp, ending, revealed = true, coveredByOrb = false, onVideo }) {
  const { state } = useVoiceAssistant();
  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant();
  // The agent is the only remote participant; its camera track is the avatar.
  const tracks = useTracks([Track.Source.Camera], { onlySubscribed: true });
  const video = tracks.find((t) => !t.participant.isLocal);

  // Tells the page the avatar is here, which is what turns the bubble back into a card.
  useEffect(() => {
    onVideo?.(Boolean(video));
    return () => onVideo?.(false);
  }, [video, onVideo]);

  // The worker ends a call it cannot start, which hangs up here too. If
  // nothing has joined at all after a while - no worker picked the call up -
  // say so instead of "Connecting..." forever.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (video) return undefined;
    const timer = setTimeout(() => setSlow(true), SLOW_JOIN_MS);
    return () => clearTimeout(timer);
  }, [video]);

  return (
    <>
      {video ? (
        // Held back until the bubble has swelled into a card, then faded in.
        <VideoTrack
          trackRef={video}
          className={clsx(
            "absolute inset-0 h-full w-full object-cover transition-opacity duration-300",
            revealed ? "opacity-100" : "opacity-0",
          )}
        />
      ) : (
        // The vendor takes a moment to publish; keep the face up meanwhile (the bubble is
        // showing it when the animation is on).
        !coveredByOrb && <Preview avatar={avatar} dim />
      )}

      <StatusPill>{video ? STATE_LABEL[state] || "Connecting…" : "Connecting…"}</StatusPill>

      {slow && !video && (
        <p className="absolute inset-x-6 bottom-24 z-20 rounded-2xl bg-black/65 px-4 py-3 text-center text-ui text-white backdrop-blur">
          The avatar hasn&apos;t joined yet. End the call and try again in a moment.
        </p>
      )}

      <div className="absolute inset-x-0 bottom-6 z-20 flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)}
          aria-label={isMicrophoneEnabled ? "Mute microphone" : "Unmute microphone"}
          title={isMicrophoneEnabled ? "Mute" : "Unmute"}
          className={clsx(
            "flex h-12 w-12 items-center justify-center rounded-full backdrop-blur transition-colors",
            isMicrophoneEnabled ? "bg-black/55 text-white hover:bg-black/70" : "bg-white text-black hover:bg-white/90",
          )}
        >
          {isMicrophoneEnabled ? <MicIcon /> : <MicOffIcon />}
        </button>
        <button
          type="button"
          onClick={onHangUp}
          disabled={ending}
          className="flex h-12 items-center gap-2.5 rounded-full bg-red px-5 text-body font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          <PhoneDownIcon />
          {ending ? "Ending…" : "End call"}
        </button>
      </div>

      {/* Without this the agent's audio track is never played. */}
      <RoomAudioRenderer />
    </>
  );
}

/** The label at the top of the frame. Above the animation's canvas, which would otherwise cover it. */
function StatusPill({ children }) {
  return (
    <span className="absolute left-1/2 top-5 z-20 -translate-x-1/2 rounded-full bg-black/55 px-3.5 py-1.5 text-ui font-medium text-white backdrop-blur">
      {children}
    </span>
  );
}

function CameraIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="2.5" y="6" width="13" height="12" rx="2.5" />
      <path d="m17 10.2 3.4-2.3a.7.7 0 0 1 1.1.6v7a.7.7 0 0 1-1.1.6L17 13.8Z" />
    </svg>
  );
}

const line = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
};

function MicIcon() {
  return (
    <svg {...line}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
    </svg>
  );
}

function MicOffIcon() {
  return (
    <svg {...line}>
      <path d="M15 9.5V6a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 4.6 2.5M5.5 11a6.5 6.5 0 0 0 10.4 5.2M18.5 11a6.5 6.5 0 0 1-.6 2.7M12 17.5V21M4 4l16 16" />
    </svg>
  );
}

function PhoneDownIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 9c-3.4 0-6.5 1-8.7 2.6-.6.5-.8 1.3-.5 2l.9 2c.3.7 1.1 1 1.8.8l2.6-.9c.6-.2 1-.8.9-1.4l-.2-1.5a13 13 0 0 1 6.4 0l-.2 1.5c-.1.6.3 1.2.9 1.4l2.6.9c.7.2 1.5-.1 1.8-.8l.9-2c.3-.7.1-1.5-.5-2C18.5 10 15.4 9 12 9Z" />
    </svg>
  );
}
