import { SystemConfig } from "../../../models/index.js";
import { env } from "../../../config/env.js";
import {
  CONFIG_BY_KEY,
  CONFIG_CATALOG,
  CONFIG_SECTIONS,
  COST_RULES_KEY,
  checkSetting,
} from "./config.catalog.js";

const fail = (status, message, details) => Object.assign(new Error(message), { statusCode: status, details });

/** The public subset is read on every page load, so it is kept for a short while. */
const PUBLIC_TTL_MS = 30_000;
let publicCache = null;

const PUBLIC_KEYS = CONFIG_CATALOG.filter((c) => c.public).map((c) => c.key);

/** Stored values over defaults. An empty stored value means "use the default". */
async function effectiveValues(keys = CONFIG_CATALOG.map((c) => c.key)) {
  const rows = await SystemConfig.find({ key: { $in: keys } }).select("key value").lean();
  const stored = new Map(rows.map((r) => [r.key, r.value]));
  return Object.fromEntries(
    keys.map((key) => {
      const value = stored.get(key);
      return [key, value !== undefined && value !== "" ? value : CONFIG_BY_KEY.get(key).default];
    }),
  );
}

export const configService = {
  /** The form: section copy, every definition, the current values and the MCP address. */
  async get() {
    return {
      sections: CONFIG_SECTIONS,
      definitions: CONFIG_CATALOG.map(({ key, section, label, description, type, placeholder, max }) => ({
        key,
        section,
        label,
        description,
        type,
        placeholder,
        max,
      })),
      settings: await effectiveValues(),
      mcpUrl: await this.mcpUrl(),
    };
  },

  /**
   * Saves every submitted setting, or none of them if any is invalid, so a form
   * with one bad field does not half-save.
   */
  async save(input, adminId) {
    const problems = [];
    const clean = [];
    for (const [key, raw] of Object.entries(input)) {
      const def = CONFIG_BY_KEY.get(key);
      if (!def) {
        problems.push({ path: key, message: `Unknown setting "${key}"` });
        continue;
      }
      const checked = checkSetting(def, raw);
      if (checked.error) problems.push({ path: key, message: checked.error });
      else clean.push({ def, value: checked.value });
    }
    if (problems.length) throw fail(400, "Validation failed", problems);

    if (clean.length) {
      await SystemConfig.bulkWrite(
        clean.map(({ def, value }) => ({
          updateOne: {
            filter: { key: def.key },
            update: { $set: { value, description: def.description, updatedBy: adminId } },
            upsert: true,
          },
        })),
      );
    }
    publicCache = null;
    return { saved: clean.map((c) => c.def.key) };
  },

  /** Name, branding, support contact and videos - nothing an anonymous visitor should not see. */
  async publicConfig() {
    if (publicCache && Date.now() - publicCache.at < PUBLIC_TTL_MS) return publicCache.value;
    const value = await effectiveValues(PUBLIC_KEYS);
    publicCache = { at: Date.now(), value };
    return value;
  },

  /** Where AI tools connect: the configured domain, else the API's own address. */
  async mcpUrl() {
    const { app_public_domain: domain } = await effectiveValues(["app_public_domain"]);
    const base = domain || env.publicUrl || env.clientOrigin;
    return `${base.replace(/\/+$/, "")}/api/mcp`;
  },

  /** The saved $/min overrides by provider id, or {} if none (or unreadable). */
  async costRules() {
    const row = await SystemConfig.findOne({ key: COST_RULES_KEY }).select("value").lean();
    try {
      const parsed = row?.value ? JSON.parse(row.value) : {};
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  },

  async saveCostRules(rules, adminId) {
    await SystemConfig.updateOne(
      { key: COST_RULES_KEY },
      {
        $set: {
          value: JSON.stringify(rules),
          description: "Actual provider cost per minute, by provider (Admin → Credit Usage)",
          updatedBy: adminId,
        },
      },
      { upsert: true },
    );
  },
};
