import crypto from "node:crypto";
import { asyncHandler } from "../../../middleware/validate.js";
import { getStorage } from "../../../integrations/storage/registry.js";
import { PROVIDER_IDS } from "../../../avatar/capabilities.js";
import { analyticsService } from "./analytics.service.js";
import { apiConfigService } from "./apiConfig.service.js";
import { configService } from "./config.service.js";
import { errorLogsService } from "./errorLogs.service.js";
import { audit } from "./audit.js";

const fail = (status, message) => Object.assign(new Error(message), { statusCode: status });

/** What the logo / favicon upload accepts, as the reference app does. */
const IMAGE_TYPES = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/svg+xml": ".svg",
  "image/x-icon": ".ico",
  "image/vnd.microsoft.icon": ".ico",
};

export const systemController = {
  analytics: asyncHandler(async (req, res) => {
    res.json(await analyticsService.analytics(req.query));
  }),

  creditUsage: asyncHandler(async (req, res) => {
    res.json(await analyticsService.creditUsage(req.query));
  }),

  saveCostRules: asyncHandler(async (req, res) => {
    const unknown = Object.keys(req.body.rules).filter((id) => !PROVIDER_IDS.includes(id));
    if (unknown.length) throw fail(400, `Unknown provider: ${unknown.join(", ")}`);
    await configService.saveCostRules(req.body.rules, req.admin._id);
    await audit(req, "admin.cost_rules.update", { providers: Object.keys(req.body.rules) });
    res.json({ rules: await analyticsService.rules() });
  }),

  listApiConfigs: asyncHandler(async (req, res) => {
    res.json(await apiConfigService.list());
  }),

  updateApiConfig: asyncHandler(async (req, res) => {
    const { config, changed } = await apiConfigService.update(req.params.serviceName, req.body, req.admin._id);
    // Names of what changed, never the key.
    await audit(req, "admin.api_config.update", { target: req.params.serviceName, service: req.params.serviceName, changed });
    res.json({ config });
  }),

  testApiConfig: asyncHandler(async (req, res) => {
    res.json(await apiConfigService.test(req.params.serviceName));
  }),

  testStorage: asyncHandler(async (req, res) => {
    res.json(await apiConfigService.testStorage());
  }),

  getConfig: asyncHandler(async (req, res) => {
    res.json(await configService.get());
  }),

  saveConfig: asyncHandler(async (req, res) => {
    const result = await configService.save(req.body.settings, req.admin._id);
    await audit(req, "admin.config.update", { keys: result.saved });
    res.json({ ...result, ...(await configService.get()) });
  }),

  /** Logo and favicon images, stored through the configured storage driver. */
  uploadImage: asyncHandler(async (req, res) => {
    const file = req.file;
    if (!file) throw fail(400, "No file selected. Please choose a file to upload.");
    const ext = IMAGE_TYPES[file.mimetype];
    if (!ext) throw fail(400, `Invalid file type: ${file.mimetype}. Please upload PNG, JPG, SVG, or ICO files.`);

    const stored = await getStorage().put({
      buffer: file.buffer,
      key: `branding/${crypto.randomUUID()}${ext}`,
      contentType: file.mimetype,
    });
    res.status(201).json({ url: stored.publicUrl });
  }),

  listErrorLogs: asyncHandler(async (req, res) => {
    res.json(await errorLogsService.list(req.query));
  }),

  setErrorLogStatus: asyncHandler(async (req, res) => {
    res.json(await errorLogsService.setStatus(req.params.id, req.body.status));
  }),

  removeErrorLog: asyncHandler(async (req, res) => {
    res.json(await errorLogsService.remove(req.params.id));
  }),

  clearResolvedErrorLogs: asyncHandler(async (req, res) => {
    const result = await errorLogsService.clearResolved();
    await audit(req, "admin.error_logs.clear_resolved", { deleted: result.deleted });
    res.json(result);
  }),
};
