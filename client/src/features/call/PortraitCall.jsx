import { useEffect, useState } from "react";
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
      <div className={frame} style={frameWidth(RATIO[aspect])}>
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
            <Live avatar={avatar} onHangUp={hangUp} ending={ending} />
          </LiveKitRoom>
        ) : (
          <>
            <Preview avatar={avatar} dim={starting} />
            <div className="absolute inset-x-0 bottom-6 flex justify-center">
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
          </>
        )}
      </div>

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

function Live({ avatar, onHangUp, ending }) {
  const { state } = useVoiceAssistant();
  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant();
  // The agent is the only remote participant; its camera track is the avatar.
  const tracks = useTracks([Track.Source.Camera], { onlySubscribed: true });
  const video = tracks.find((t) => !t.participant.isLocal);

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
        <VideoTrack trackRef={video} className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        // The vendor takes a moment to publish; keep the face up meanwhile.
        <Preview avatar={avatar} dim />
      )}

      <span className="absolute left-1/2 top-5 -translate-x-1/2 rounded-full bg-black/55 px-3.5 py-1.5 text-ui font-medium text-white backdrop-blur">
        {video ? STATE_LABEL[state] || "Connecting…" : "Connecting…"}
      </span>

      {slow && !video && (
        <p className="absolute inset-x-6 bottom-24 rounded-2xl bg-black/65 px-4 py-3 text-center text-ui text-white backdrop-blur">
          The avatar hasn&apos;t joined yet. End the call and try again in a moment.
        </p>
      )}

      <div className="absolute inset-x-0 bottom-6 flex items-center justify-center gap-3">
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
