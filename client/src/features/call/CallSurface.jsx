import { LiveKitRoom, useVoiceAssistant } from "@livekit/components-react";
import AvatarStage from "@/components/media/AvatarStage";
import CallControls from "@/components/media/CallControls";
import DailyCall from "./DailyCall";

/**
 * The live part of a call, for whichever transport the API handed back.
 *
 * Shared by the signed-in call room and the public share-link page, so a guest
 * gets exactly the call the owner tested.
 *
 * `onEnd` fires for the caller's own hang-up and for the room closing by
 * itself - the time limit, or the far end going away - so the page can move on
 * either way instead of sitting on a dead call.
 */
export default function CallSurface({ connection, avatar, face, onEnd, ending, onError }) {
  if (connection.transport === "daily") {
    // Full-pipeline vendors host the call themselves; we only embed their room.
    return <DailyCall avatar={avatar} joinUrl={connection.url} onHangUp={onEnd} ending={ending} />;
  }

  if (connection.transport !== "livekit") {
    return <p className="text-text-muted">Unsupported transport &quot;{connection.transport}&quot;</p>;
  }

  return (
    <LiveKitRoom
      token={connection.token}
      serverUrl={connection.url}
      connect
      audio
      video={false}
      onDisconnected={onEnd}
      onError={(err) => onError?.(err.message)}
    >
      <ActiveCall avatar={avatar} face={face} onHangUp={onEnd} ending={ending} />
    </LiveKitRoom>
  );
}

const STATE_LABEL = {
  connecting: "Connecting…",
  initializing: "Getting ready…",
  listening: "Listening",
  thinking: "Thinking…",
  speaking: "Speaking",
  disconnected: "Call ended",
};

function ActiveCall({ avatar, face, onHangUp, ending }) {
  const { state } = useVoiceAssistant();

  return (
    <>
      <AvatarStage
        avatarName={avatar.name}
        previewUrl={avatar.previewUrl}
        face={face}
        isSpeaking={state === "speaking"}
      />
      <CallControls onHangUp={onHangUp} ending={ending} />
      <p className="mt-4 text-ui text-text-faint">{STATE_LABEL[state] || "Connecting…"}</p>
    </>
  );
}
