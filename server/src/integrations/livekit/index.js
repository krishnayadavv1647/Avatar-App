import {
  AccessToken,
  AgentDispatchClient,
  EgressClient,
  EgressStatus,
  EncodedFileOutput,
  EncodedFileType,
  EncodingOptions,
  RoomAgentDispatch,
  RoomConfiguration,
  RoomServiceClient,
  S3Upload,
} from "livekit-server-sdk";
import { env } from "../../config/env.js";

/**
 * LiveKit access is funnelled through here so no module outside this file ever
 * touches LIVEKIT_API_SECRET. The secret must never reach the browser - the
 * client only ever receives a signed, short-lived token.
 *
 * Works against LiveKit Cloud or the self-hosted server in docker-compose.
 * The dev container uses the well-known devkey/secret pair, which is why the
 * defaults below exist: a fresh clone connects with no account.
 */

const DEV_DEFAULTS = {
  url: "ws://localhost:7880",
  apiKey: "devkey",
  apiSecret: "secret",
};

export function livekitConfig() {
  return {
    url: env.livekit.url || DEV_DEFAULTS.url,
    apiKey: env.livekit.apiKey || DEV_DEFAULTS.apiKey,
    apiSecret: env.livekit.apiSecret || DEV_DEFAULTS.apiSecret,
    agentName: env.livekit.agentName,
    /** True when running against the local dev container rather than Cloud. */
    isDev: !env.livekit.apiKey,
  };
}

/**
 * Mint a join token and ask LiveKit to dispatch our agent into the same room.
 *
 * The dispatch is what makes the avatar show up: without it the participant
 * joins an empty room and waits forever.
 *
 * @param {{ roomName: string, identity: string, name?: string, metadata?: object }} input
 */
export async function createJoinToken({ roomName, identity, name, metadata = {} }) {
  const cfg = livekitConfig();
  const metadataJson = JSON.stringify(metadata);

  const at = new AccessToken(cfg.apiKey, cfg.apiSecret, {
    identity,
    name: name || identity,
    ttl: "1h",
  });

  at.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  at.roomConfig = new RoomConfiguration({
    metadata: metadataJson,
    agents: [new RoomAgentDispatch({ agentName: cfg.agentName, metadata: metadataJson })],
  });

  return {
    token: await at.toJwt(),
    serverUrl: cfg.url,
    room: roomName,
    agentName: cfg.agentName,
  };
}

let roomService;

/** Admin client, for ending calls and reading room state. */
export function getRoomService() {
  if (!roomService) {
    const cfg = livekitConfig();
    // RoomServiceClient speaks HTTP; the token URL is a websocket URL.
    const httpUrl = cfg.url.replace(/^ws/, "http");
    roomService = new RoomServiceClient(httpUrl, cfg.apiKey, cfg.apiSecret);
  }
  return roomService;
}

export async function endRoom(roomName) {
  await getRoomService().deleteRoom(roomName);
}

/* ------------------------------------------------------------------------ */
/* Preview clips                                                             */
/* ------------------------------------------------------------------------ */

/**
 * Rooms whose job is to record an avatar's hover clip rather than host a call.
 * The worker tells the two apart by this prefix, so a preview never touches
 * conversations, transcripts or usage.
 */
export const PREVIEW_ROOM_PREFIX = "preview-";

const httpUrl = () => livekitConfig().url.replace(/^ws/, "http");

/**
 * Sends the agent into a fresh room with nobody else in it. A call's agent is
 * dispatched by the caller's token; a preview has no caller, so the dispatch
 * is made directly.
 */
export async function dispatchPreview({ roomName, avatarId }) {
  return dispatchAgent({ roomName, metadata: { preview: true, avatarId } });
}

/**
 * Creates a room and sends the agent into it with no one else there - for
 * jobs with no caller holding a token: a preview recording, or an avatar
 * going off to sit in an external meeting.
 */
export async function dispatchAgent({ roomName, metadata }) {
  const cfg = livekitConfig();
  // Short empty timeout: if anything goes wrong the room does not linger.
  await getRoomService().createRoom({ name: roomName, emptyTimeout: 60, maxParticipants: 4 });
  const dispatch = new AgentDispatchClient(httpUrl(), cfg.apiKey, cfg.apiSecret);
  return dispatch.createDispatch(roomName, cfg.agentName, { metadata: JSON.stringify(metadata) });
}

let egressClient;
function getEgress() {
  if (!egressClient) {
    const cfg = livekitConfig();
    egressClient = new EgressClient(httpUrl(), cfg.apiKey, cfg.apiSecret);
  }
  return egressClient;
}

/**
 * Records one video track to an MP4 in the R2 bucket. Video only: the clip
 * plays muted on hover, so audio would only make the file bigger.
 */
export async function recordTrackToR2({ roomName, videoTrackId, key, width, height }) {
  const { accountId, accessKeyId, secretAccessKey, bucket } = env.storage;
  const s3 = new S3Upload({
    accessKey: accessKeyId,
    secret: secretAccessKey,
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    bucket,
    forcePathStyle: true,
  });
  const file = new EncodedFileOutput({
    fileType: EncodedFileType.MP4,
    filepath: key,
    output: { case: "s3", value: s3 },
  });
  return getEgress().startTrackCompositeEgress(roomName, file, {
    videoTrackId,
    encodingOptions: new EncodingOptions({ width, height, framerate: 25, videoBitrate: 1200 }),
  });
}

export async function stopRecording(egressId) {
  return getEgress().stopEgress(egressId);
}

/** The recording's current state, as LiveKit reports it. */
export async function recordingInfo(egressId) {
  const [info] = await getEgress().listEgress({ egressId });
  return info || null;
}

export { EgressStatus };
