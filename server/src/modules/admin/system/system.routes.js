import { Router } from "express";
import multer from "multer";
import { validate } from "../../../middleware/validate.js";
import avatarsRoutes from "../avatars/avatars.routes.js";
import { systemController } from "./system.controller.js";
import { systemValidation } from "./system.validation.js";

/** Admin API: analytics, credit usage, API keys, app config, error logs. Mounted under /api/admin (platform admins only). Owned by the System tabs. */
const router = Router();

// Held in memory and handed straight to the storage driver, like avatar uploads.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

/** Runs multer and turns its size error into the same message the form shows. */
const singleImage = (req, res, next) =>
  upload.single("file")(req, res, (err) => {
    if (!err) return next();
    const failure = new Error(
      err.code === "LIMIT_FILE_SIZE" ? "File is too large. Maximum size is 10MB." : err.message,
    );
    failure.statusCode = 400;
    next(failure);
  });

// Every avatar across all users (read-only), kept in its own module.
router.use(avatarsRoutes);

router.get("/analytics", validate(systemValidation.tz), systemController.analytics);

router.get("/credit-usage", validate(systemValidation.creditUsage), systemController.creditUsage);
router.put("/credit-usage/rules", validate(systemValidation.costRules), systemController.saveCostRules);

router.get("/api-configs", systemController.listApiConfigs);
router.put("/api-configs/:serviceName", validate(systemValidation.updateApiConfig), systemController.updateApiConfig);
router.post("/api-configs/:serviceName/test", validate(systemValidation.serviceName), systemController.testApiConfig);
router.post("/system/storage-test", systemController.testStorage);

router.get("/config", systemController.getConfig);
router.put("/config", validate(systemValidation.saveConfig), systemController.saveConfig);
router.post("/config/upload", singleImage, systemController.uploadImage);

router.get("/error-logs", validate(systemValidation.errorLogs), systemController.listErrorLogs);
// Before /:id, which would otherwise read "resolved" as an id.
router.delete("/error-logs/resolved", systemController.clearResolvedErrorLogs);
router.patch("/error-logs/:id", validate(systemValidation.errorLogStatus), systemController.setErrorLogStatus);
router.delete("/error-logs/:id", validate(systemValidation.errorLogId), systemController.removeErrorLog);

export default router;
