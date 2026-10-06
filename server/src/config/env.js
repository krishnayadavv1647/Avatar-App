import "dotenv/config";
import crypto from "node:crypto";

/**
 * Every environment read happens here. Modules import the parsed object rather
 * than touching process.env, so a missing variable fails at boot with a clear
 * message instead of surfacing as `undefined` deep inside a request.
 */

const required = (key) => {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
};

const optional = (key, fallback = "") => process.env[key] || fallback;

const ephemeral = new Map();

function devSecret(kind) {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      `Missing JWT_${kind.toUpperCase()}_SECRET. Generate one with: ` +
        `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`,
    );
  }
  if (!ephemeral.has(kind)) {
    ephemeral.set(kind, crypto.randomBytes(48).toString("hex"));
  }
  return ephemeral.get(kind);
}

export const env = {
  nodeEnv: optional("NODE_ENV", "development"),
  port: Number(optional("PORT", "4000")),
  // On Render the service's own public address is a sensible default: when the
  // API also serves the web app (see SERVE_CLIENT), they share one origin.
  clientOrigin: optional("CLIENT_ORIGIN", optional("RENDER_EXTERNAL_URL", "http://localhost:5173")),

  // Serve the built web app (client/dist) from this API, so the whole product
  // is one service. On in production when a build exists; "false" turns it off
  // for setups that host the web app elsewhere, "true" forces it in development.
  serveClient: optional("SERVE_CLIENT"),

  // Platform admins - the people who can open /admin and see every user.
  // Configured here rather than stored on the user, so no API call can grant it.
  adminEmails: optional("ADMIN_EMAILS", "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),

  mongoUri: optional("MONGO_URI", "mongodb://localhost:27017/avatar_app"),
  redisUrl: optional("REDIS_URL", "redis://localhost:6379"),

  jwt: {
    // Empty secrets would make jwt.sign throw on the first request. In
    // development an ephemeral pair keeps a fresh clone working; in production
    // a missing secret is fatal, because generating one per process would
    // silently sign out every user on each deploy and break multi-instance.
    accessSecret: optional("JWT_ACCESS_SECRET") || devSecret("access"),
    refreshSecret: optional("JWT_REFRESH_SECRET") || devSecret("refresh"),
    accessTtl: optional("JWT_ACCESS_TTL", "15m"),
    refreshTtl: optional("JWT_REFRESH_TTL", "30d"),
  },

  // This API's own public address, for the OAuth documents MCP connectors read.
  // Differs from clientOrigin when the web app is hosted apart (a static site
  // beside the API); Render sets RENDER_EXTERNAL_URL on the API service itself.
  publicUrl: optional("PUBLIC_URL") || optional("RENDER_EXTERNAL_URL"),

  // Encrypts the auth tokens saved for MCP servers. Falls back to the refresh
  // secret so an install that already has one needs no new variable; the API
  // and the agent worker must both see the same value to read a saved token.
  mcpEncryptionKey: optional("MCP_ENCRYPTION_KEY") || optional("JWT_REFRESH_SECRET"),

  // "Continue with Google". The OAuth Web client id from Google Cloud Console;
  // the browser asks for it at /api/auth/config. Unset hides the button.
  google: {
    clientId: optional("GOOGLE_CLIENT_ID"),
  },

  // Deliberately no default. Defaulting to the stub meant every install
  // silently preferred it over real, configured vendors - including ones where
  // someone had paid for a key. Unset now means "pick the cheapest real vendor",
  // and a fresh clone with no keys gets an error naming the fix instead of a
  // fake avatar that looks real.
  avatarProvider: optional("AVATAR_PROVIDER"),
  lemonsliceApiKey: optional("LEMONSLICE_API_KEY"),

  maxCallSeconds: Number(optional("MAX_CALL_SECONDS", "3600")),

  // Vendors are not assumed to sign their webhooks, so the callback URL carries
  // an unguessable token and we verify that instead. See webhooks/provider.webhook.js.
  webhookSecret: optional("WEBHOOK_SECRET"),

  livekit: {
    url: optional("LIVEKIT_URL"),
    apiKey: optional("LIVEKIT_API_KEY"),
    apiSecret: optional("LIVEKIT_API_SECRET"),
    agentName: optional("AGENT_NAME", "avatar-agent"),
  },

  // Tuning for the agent worker on a small machine. In production the agents
  // SDK keeps up to four job processes warm and refuses new calls above 70%
  // CPU load - generous on a real server, fatal on a small shared instance
  // (out of memory, or "avatar hasn't joined" because the worker says it is
  // full). Unset means the SDK's defaults.
  agent: {
    idleProcesses: Number(optional("AGENT_IDLE_PROCESSES")) || undefined,
    // Load is CPU use as a fraction of the instance's own CPU quota, so on a
    // fractional-CPU instance almost any work reads as ~1.0. A value above 1
    // means "never refuse a call for load".
    loadThreshold: Number(optional("AGENT_LOAD_THRESHOLD")) || undefined,
    // How long a job process may take to start. The SDK allows 10 seconds,
    // which a slow shared CPU cannot meet: the process is killed and retried
    // forever ("runner initialization timed out") and never takes a call.
    initTimeoutMs: Number(optional("AGENT_INIT_TIMEOUT_MS")) || undefined,
  },

  deepgramApiKey: optional("DEEPGRAM_API_KEY"),
  cartesiaApiKey: optional("CARTESIA_API_KEY"),
  anthropicApiKey: optional("ANTHROPIC_API_KEY"),
  defaultLlmModel: optional("DEFAULT_LLM_MODEL", "claude-sonnet-5"),
  // LiveKit Inference has no Anthropic models, so the no-key path needs a
  // hosted id in "provider/model" form rather than the Claude id above.
  fallbackLlmModel: optional("FALLBACK_LLM_MODEL", "google/gemma-4-31b-it"),
  sttModel: optional("STT_MODEL", "deepgram/nova-3"),
  sttLanguage: optional("STT_LANGUAGE", "en"),
  ttsModel: optional("TTS_MODEL", "inworld/inworld-tts-2"),
  // Inference TTS requires a voice as well as a model.
  ttsVoice: optional("TTS_VOICE", "Ashley"),
  // Custom voices (v_* ids cloned in the LiveKit Cloud dashboard) only speak
  // through the models LiveKit clones them onto - Cartesia and Inworld 1.5 -
  // so calls with one switch to this model instead of TTS_MODEL.
  customVoiceTtsModel: optional("CUSTOM_VOICE_TTS_MODEL", "cartesia/sonic-3"),

  // Voice cloning: someone uploads or records their own voice, ElevenLabs
  // clones it, and avatars using it speak through ElevenLabs directly (with
  // this key) instead of LiveKit Inference. Unset means cloning is off.
  elevenlabs: {
    apiKey: optional("ELEVENLABS_API_KEY"),
    // Flash is ElevenLabs' low-latency model - what a live call needs.
    model: optional("ELEVENLABS_TTS_MODEL", "eleven_flash_v2_5"),
  },

  // Where the API is reachable from outside. The local storage driver builds
  // its URLs from this, so a tunnel host belongs here when testing a real vendor.
  publicBaseUrl: optional("PUBLIC_BASE_URL", `http://localhost:${optional("PORT", "4000")}`),

  // Free hosts sleep a service that gets no traffic; pinging our own public
  // address prevents it (see config/keepAlive.js). Render supplies
  // RENDER_EXTERNAL_URL itself, so there it needs no configuration. Keep the
  // interval under the host's idle limit - Render's is 15 minutes.
  keepAlive: {
    url: optional("KEEP_ALIVE_URL", optional("RENDER_EXTERNAL_URL")),
    minutes: Math.max(1, Number(optional("KEEP_ALIVE_MINUTES", "10")) || 10),
  },

  storageDriver: optional("STORAGE_DRIVER", "local"),
  storage: {
    accountId: optional("R2_ACCOUNT_ID"),
    accessKeyId: optional("R2_ACCESS_KEY_ID"),
    secretAccessKey: optional("R2_SECRET_ACCESS_KEY"),
    bucket: optional("R2_BUCKET"),
    publicBaseUrl: optional("R2_PUBLIC_BASE_URL"),
  },

  stripe: {
    secretKey: optional("STRIPE_SECRET_KEY"),
    webhookSecret: optional("STRIPE_WEBHOOK_SECRET"),
  },

  required,
};

export const isProd = env.nodeEnv === "production";
