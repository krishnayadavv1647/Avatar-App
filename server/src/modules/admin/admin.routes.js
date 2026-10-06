import { Router } from "express";
import multer from "multer";
import { adminController } from "./admin.controller.js";
import { adminValidation } from "./admin.validation.js";
import { validate } from "../../middleware/validate.js";
import systemRoutes from "./system/system.routes.js";
import commsRoutes from "./comms/comms.routes.js";
import creditsRoutes from "./credits/credits.routes.js";
import { requirePlatformAdmin } from "../../middleware/admin.js";

// The plan thumbnail goes straight to the storage driver, never to disk here.
const uploadThumbnail = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

const router = Router();

// Answers for anyone signed in, so the client can decide whether to show Admin.
router.get("/access", adminController.access);

// Everything below is platform admins only.
router.use(requirePlatformAdmin);

// The four figures at the top of the admin panel.
router.get("/stats", adminController.stats);

// The panel's tabs, each in its own router.
router.use(systemRoutes);
router.use(commsRoutes);
router.use(creditsRoutes);

router.get("/overview", validate(adminValidation.overview), adminController.overview);

router.get("/users", validate(adminValidation.listUsers), adminController.listUsers);
router.post("/users", validate(adminValidation.createUser), adminController.createUser);
// Before /users/:id, or "export.csv" would be read as an id.
router.get("/users/export.csv", validate(adminValidation.exportUsers), adminController.exportUsers);
router.get("/users/:id", validate(adminValidation.byId), adminController.getUser);
router.patch("/users/:id", validate(adminValidation.updateUser), adminController.updateUser);
router.delete("/users/:id", validate(adminValidation.byId), adminController.removeUser);
router.post("/users/:id/impersonate", validate(adminValidation.byId), adminController.impersonate);
router.post("/users/:id/block", validate(adminValidation.block), adminController.block);
router.delete("/users/:id/block", validate(adminValidation.byId), adminController.unblock);
router.put("/users/:id/plan", validate(adminValidation.assignPlan), adminController.assignPlan);

router.get("/invitations", validate(adminValidation.listInvitations), adminController.listInvitations);
router.post("/invitations", validate(adminValidation.createInvitation), adminController.createInvitation);
router.delete("/invitations/:id", validate(adminValidation.byId), adminController.revokeInvitation);

router.get("/plans", adminController.listPlans);
router.post("/plans", validate(adminValidation.createPlan), adminController.createPlan);
router.post("/plans/templates", adminController.addPlanTemplates);
router.post("/plans/thumbnail", uploadThumbnail.single("file"), adminController.uploadPlanThumbnail);
router.patch("/plans/:id", validate(adminValidation.updatePlan), adminController.updatePlan);
router.delete("/plans/:id", validate(adminValidation.byId), adminController.removePlan);

export default router;
