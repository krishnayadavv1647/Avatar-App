import { ApiConfiguration } from "../../../models/index.js";
import { env } from "../../../config/env.js";
import { logger } from "../../../config/logger.js";
import { seal, open } from "../../../utils/secretBox.js";
import { getProvider } from "../../../avatar/providers/registry.js";
import { getStorage } from "../../../integrations/storage/registry.js";

/**
 * Vendor API keys an admin can set from the panel.
 *
 * A key saved here takes effect without a redeploy: applyApiConfigs() copies
 * it over the env field the rest of the app reads. That works because every
 * consumer reads `env.<field>` when it needs the key (checked: agent/pipeline,
 * preflight, ai/catalog, voices, the renderer registry), not once at import.
 * The one exception is the LemonSlice provider, which the registry builds once
 * and keeps - applyKey() updates that instance's key as well, so no provider
 * needs a restart.
 *
 * Credentials that cannot be swapped under a running process (LiveKit, R2,
 * Stripe) are not editable here; environmentStatus() only reports them.
 *
 * Deepgram and Cartesia keys exist in config/env.js but nothing reads them -
 * speech goes through LiveKit Inference - so they are deliberately not listed:
 * a field that accepts a key and does nothing would be a lie.
 */

const fail = (status, message) => Object.assign(new Error(message), { statusCode: status });

/**
 * @typedef {Object} ProviderDef
 * @property {string} serviceName
 * @property {string} displayName
 * @property {string} description
 * @property {boolean} [required]
 * @property {string} envVar        the variable that sets it outside the panel
 * @property {string} baseUrl
 * @property {string} documentation
 * @property {() => string} get     the env value right now
 * @property {(value: string) => void} set
 * @property {(baseUrl: string, key: string) => { url: string, headers: Record<string,string> }} probe
 *   a cheap, authenticated, read-only request that distinguishes a bad key from a good one
 */

/** @type {ProviderDef[]} */
export const API_PROVIDERS = [
  {
    serviceName: "lemonslice",
    displayName: "LemonSlice",
    description: "Renders the live avatar video in calls. Without a key no call can start.",
    required: true,
    envVar: "LEMONSLICE_API_KEY",
    baseUrl: "https://lemonslice.com/api",
    documentation: "https://lemonslice.com/docs",
    get: () => env.lemonsliceApiKey,
    set(value) {
      env.lemonsliceApiKey = value;
      // The registry builds this provider once and keeps its key, so it is
      // updated in place rather than waiting for a restart.
      try {
        getProvider("lemonslice").apiKey = value;
      } catch (err) {
        logger.warn({ err: err.message }, "could not refresh the cached LemonSlice provider");
      }
    },
    probe: (base, key) => ({ url: `${base}/agents`, headers: { "X-API-Key": key } }),
  },
  {
    serviceName: "anthropic",
    displayName: "Anthropic (Claude)",
    description: "The language model avatars think with. Without it calls use the hosted fallback model.",
    envVar: "ANTHROPIC_API_KEY",
    baseUrl: "https://api.anthropic.com",
    documentation: "https://docs.anthropic.com/en/api/getting-started",
    get: () => env.anthropicApiKey,
    set: (value) => {
      env.anthropicApiKey = value;
    },
    probe: (base, key) => ({
      url: `${base}/v1/models?limit=1`,
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
    }),
  },
  {
    serviceName: "elevenlabs",
    displayName: "ElevenLabs",
    description: "Voice cloning and cloned voices in calls. Without a key cloning is switched off.",
    envVar: "ELEVENLABS_API_KEY",
    baseUrl: "https://api.elevenlabs.io",
    documentation: "https://elevenlabs.io/docs/api-reference/introduction",
    get: () => env.elevenlabs.apiKey,
    set: (value) => {
      env.elevenlabs.apiKey = value;
    },
    probe: (base, key) => ({ url: `${base}/v1/models`, headers: { "xi-api-key": key } }),
  },
];

const BY_NAME = new Map(API_PROVIDERS.map((p) => [p.serviceName, p]));

/**
 * What each env field held before any saved key replaced it. Captured once, so
 * switching a config off (or removing its key) puts the environment value back
 * instead of leaving the last saved key in place.
 */
const envOriginals = new Map();
function captureOriginals() {
  for (const p of API_PROVIDERS) if (!envOriginals.has(p.serviceName)) envOriginals.set(p.serviceName, p.get() || "");
}

/** Forgets what the environment held, so the next call re-reads it. For tests that change env on purpose. */
export const forgetEnvOriginals = () => envOriginals.clear();

/** The key stored for a row, decrypted; "" if there is none or it cannot be read. */
function storedKey(row) {
  if (!row?.apiKey) return "";
  try {
    return open(row.apiKey);
  } catch (err) {
    // The encryption key changed since this was saved. Say so rather than hide it.
    logger.warn({ serviceName: row.serviceName, err: err.message }, "stored API key could not be decrypted");
    return "";
  }
}

/**
 * Copies every active, saved key over the env field that vendor reads, and
 * restores the environment value for the rest. Cheap enough to call often: the
 * API at boot and after each save, the agent worker at the start of each job
 * (it is a separate process and would otherwise never see a key saved later).
 *
 * @returns {Promise<string[]>} service names now served from the database
 */
export async function applyApiConfigs() {
  captureOriginals();
  const rows = await ApiConfiguration.find().lean();
  const byName = new Map(rows.map((r) => [r.serviceName, r]));
  const fromDatabase = [];

  for (const p of API_PROVIDERS) {
    const row = byName.get(p.serviceName);
    const key = row?.isActive ? storedKey(row) : "";
    p.set(key || envOriginals.get(p.serviceName));
    if (key) fromDatabase.push(p.serviceName);
  }
  return fromDatabase;
}

/** Creates a row for every catalog provider that has none; never touches existing ones. */
async function ensureSeeded() {
  await ApiConfiguration.bulkWrite(
    API_PROVIDERS.map((p) => ({
      updateOne: {
        filter: { serviceName: p.serviceName },
        update: {
          $setOnInsert: {
            serviceName: p.serviceName,
            displayName: p.displayName,
            description: p.description,
            baseUrl: p.baseUrl,
            documentation: p.documentation,
            isActive: true,
            apiKey: "",
          },
        },
        upsert: true,
      },
    })),
  );
}

const last4 = (key) => (key ? key.slice(-4) : null);

/** A row as the panel sees it: never the key itself. */
function present(def, row) {
  const dbKey = storedKey(row);
  const envKey = envOriginals.get(def.serviceName) || "";
  const active = Boolean(row.isActive);
  // A saved key only counts while the config is active; otherwise the environment's does.
  const effective = active && dbKey ? dbKey : envKey;
  const source = active && dbKey ? "database" : envKey ? "environment" : "none";

  return {
    serviceName: def.serviceName,
    displayName: row.displayName || def.displayName,
    description: row.description || def.description,
    required: Boolean(def.required),
    envVar: def.envVar,
    baseUrl: row.baseUrl || def.baseUrl,
    documentation: row.documentation || def.documentation,
    isActive: active,
    key: { hasKey: Boolean(effective), last4: last4(effective), source, storedInDatabase: Boolean(row.apiKey) },
    usageStats: {
      totalRequests: row.usageStats?.totalRequests || 0,
      successfulRequests: row.usageStats?.successfulRequests || 0,
      failedRequests: row.usageStats?.failedRequests || 0,
      lastUsed: row.usageStats?.lastUsed || null,
    },
    // Nothing needs one today (see the file comment); the field is here so the
    // panel can say so honestly if a provider that does is ever added.
    needsRestart: false,
  };
}

/** Classifies a vendor's answer to the probe the way the admin needs it explained. */
export function classifyProbe(status, body) {
  if (status === 401 || status === 403) {
    return {
      outcome: "invalid",
      message: `Authentication failed (${status}): Invalid API key or insufficient permissions.`,
    };
  }
  if (status === 429) {
    return {
      outcome: "rate_limited",
      message: `Rate limit exceeded (${status}): Too many requests. Your API key is valid but you've hit the rate limit.`,
    };
  }
  if (status >= 200 && status < 300) {
    return { outcome: "valid", message: "Connection successful! API key is valid and working properly." };
  }
  const detail =
    body?.error?.message ||
    (typeof body?.detail === "string" ? body.detail : body?.detail?.message) ||
    body?.message ||
    `HTTP ${status}`;
  return {
    outcome: "warning",
    message: `API key is valid, but test request failed with: ${detail}`,
  };
}

export const apiConfigService = {
  /** Every provider panel, plus the credentials that are read-only here. */
  async list() {
    captureOriginals();
    await ensureSeeded();
    const rows = await ApiConfiguration.find().lean();
    const byName = new Map(rows.map((r) => [r.serviceName, r]));
    return {
      configs: API_PROVIDERS.map((def) => present(def, byName.get(def.serviceName))),
      environment: environmentStatus(),
    };
  },

  /**
   * Changes one config. The key is only touched when a new one is submitted
   * (or `clearKey` is set); leaving the field empty keeps the saved key.
   */
  async update(serviceName, input, adminId) {
    const def = BY_NAME.get(serviceName);
    if (!def) throw fail(404, "Unknown service");
    captureOriginals();
    await ensureSeeded();

    const set = { updatedBy: adminId };
    const changed = [];
    if (input.apiKey) {
      set.apiKey = seal(input.apiKey);
      changed.push("apiKey");
    } else if (input.clearKey) {
      set.apiKey = "";
      changed.push("clearKey");
    }
    if (input.baseUrl !== undefined) {
      set.baseUrl = input.baseUrl || def.baseUrl;
      changed.push("baseUrl");
    }
    if (input.isActive !== undefined) {
      set.isActive = input.isActive;
      changed.push("isActive");
    }

    const row = await ApiConfiguration.findOneAndUpdate({ serviceName }, { $set: set }, { new: true }).lean();
    // Takes effect now, in this process; the agent worker re-applies at each job.
    await applyApiConfigs();
    return { config: present(def, row), changed };
  },

  /**
   * A cheap authenticated request to the vendor, run from the server so the
   * key never reaches a browser. Uses the saved key if there is one, else the
   * environment's. Updates the request counters.
   */
  async test(serviceName) {
    const def = BY_NAME.get(serviceName);
    if (!def) throw fail(404, "Unknown service");
    captureOriginals();
    await ensureSeeded();

    const row = await ApiConfiguration.findOne({ serviceName }).lean();
    const key = storedKey(row) || envOriginals.get(serviceName) || "";
    if (!key) throw fail(400, "No API key to test. Save one first.");

    const base = (row.baseUrl || def.baseUrl).replace(/\/+$/, "");
    const { url, headers } = def.probe(base, key);

    let result;
    try {
      const res = await fetch(url, {
        headers: { accept: "application/json", ...headers },
        signal: AbortSignal.timeout((row.settings?.timeout || 30) * 1000),
      });
      const body = await res.json().catch(() => null);
      result = { ...classifyProbe(res.status, body), status: res.status };
    } catch (err) {
      result = {
        outcome: "error",
        message: `Connection test failed: ${err.message}. This could be a network issue or an invalid API key.`,
        status: null,
      };
    }

    // Valid keys and "valid, but the probe was odd" count as a success; a bad
    // key, a rate limit or an unreachable vendor count as a failure.
    const ok = result.outcome === "valid" || result.outcome === "warning";
    await ApiConfiguration.updateOne(
      { serviceName },
      {
        $inc: {
          "usageStats.totalRequests": 1,
          [ok ? "usageStats.successfulRequests" : "usageStats.failedRequests"]: 1,
        },
        ...(ok ? { $set: { "usageStats.lastUsed": new Date() } } : {}),
      },
    );

    return { ...result, ok, source: storedKey(row) ? "database" : "environment" };
  },

  /** A real round trip through the configured storage driver: write a probe, delete it. */
  async testStorage() {
    const storage = getStorage();
    const key = `healthcheck/${Date.now()}.txt`;
    try {
      const stored = await storage.put({ buffer: Buffer.from("avatar-app storage check"), key, contentType: "text/plain" });
      await storage.remove(stored.storageKey).catch(() => {});
      return {
        ok: true,
        driver: storage.id,
        reachableByVendors: storage.reachableByVendors,
        message:
          `Storage connection successful (${storage.id}).` +
          (storage.reachableByVendors ? "" : " Files are not reachable by avatar vendors from this address."),
      };
    } catch (err) {
      return { ok: false, driver: storage.id, reachableByVendors: false, message: err.message || "Could not write to storage." };
    }
  },
};

/* ------------------------------------------------- read-only credentials */

const mask = (value) => (value ? `••••${String(value).slice(-4)}` : null);

/** What is set in the server's environment for credentials the panel cannot change. */
function environmentStatus() {
  const field = (label, envVar, value, { secret = true } = {}) => ({
    label,
    envVar,
    configured: Boolean(value),
    preview: value ? (secret ? mask(value) : value) : null,
  });
  const group = (id, name, description, items) => ({
    id,
    name,
    description,
    configured: items.every((i) => i.configured),
    items,
  });

  const lkHost = (() => {
    try {
      return env.livekit.url ? new URL(env.livekit.url.replace(/^ws/, "http")).host : "";
    } catch {
      return env.livekit.url;
    }
  })();

  return [
    group("livekit", "LiveKit", "Realtime rooms and the agent worker. Changing these needs a restart of the API and the worker.", [
      field("Server URL", "LIVEKIT_URL", lkHost, { secret: false }),
      field("API key", "LIVEKIT_API_KEY", env.livekit.apiKey),
      field("API secret", "LIVEKIT_API_SECRET", env.livekit.apiSecret),
    ]),
    group("storage", "Storage", `Where uploads live (driver: ${env.storageDriver}). R2 credentials are read once at startup.`,
      env.storageDriver === "r2"
        ? [
            field("Account ID", "R2_ACCOUNT_ID", env.storage.accountId),
            field("Bucket", "R2_BUCKET", env.storage.bucket, { secret: false }),
            field("Access key ID", "R2_ACCESS_KEY_ID", env.storage.accessKeyId),
            field("Secret access key", "R2_SECRET_ACCESS_KEY", env.storage.secretAccessKey),
            field("Public base URL", "R2_PUBLIC_BASE_URL", env.storage.publicBaseUrl, { secret: false }),
          ]
        : [field("Driver", "STORAGE_DRIVER", env.storageDriver, { secret: false })],
    ),
    group("stripe", "Stripe", "Payments. Read at startup.", [
      field("Secret key", "STRIPE_SECRET_KEY", env.stripe.secretKey),
      field("Webhook secret", "STRIPE_WEBHOOK_SECRET", env.stripe.webhookSecret),
    ]),
  ];
}
