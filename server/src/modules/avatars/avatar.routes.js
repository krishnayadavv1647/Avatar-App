import { Router } from "express";
import multer from "multer";
import { MAX_FILE_BYTES } from "../../ai/knowledge.js";
import { avatarController } from "./avatar.controller.js";
import { avatarValidation } from "./avatar.validation.js";
import { validate } from "../../middleware/validate.js";
import { resolveWorkspace } from "../../middleware/workspace.js";

// Held in memory: only the extracted text is kept, never the file.
const uploadDocument = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
});

// Same limits as a new photo avatar's upload; the service checks the type.
const uploadImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

const router = Router();

router.use(resolveWorkspace);

router.get("/", avatarController.list);
router.get("/:id", validate(avatarValidation.byId), avatarController.get);
router.patch("/:id", validate(avatarValidation.update), avatarController.update);
router.delete("/:id", validate(avatarValidation.byId), avatarController.remove);

// Knowledge base: documents the avatar can draw on during calls.
router.get("/:id/documents", validate(avatarValidation.byId), avatarController.listDocuments);
router.post(
  "/:id/documents",
  validate(avatarValidation.byId),
  uploadDocument.single("file"),
  avatarController.addDocument,
);
router.delete(
  "/:id/documents/:docId",
  validate(avatarValidation.document),
  avatarController.removeDocument,
);

// MCP servers: external tools the avatar can use during calls.
router.get("/:id/mcp-servers", validate(avatarValidation.byId), avatarController.listMcpServers);
router.post("/:id/mcp-servers", validate(avatarValidation.addMcpServer), avatarController.addMcpServer);
router.patch(
  "/:id/mcp-servers/:serverId",
  validate(avatarValidation.setMcpServerEnabled),
  avatarController.setMcpServerEnabled,
);
router.delete(
  "/:id/mcp-servers/:serverId",
  validate(avatarValidation.mcpServer),
  avatarController.removeMcpServer,
);

// The public link. Managing it needs an account; using it does not - see
// modules/links.
router.get("/:id/share", validate(avatarValidation.byId), avatarController.getShare);
router.put("/:id/share", validate(avatarValidation.setShare), avatarController.setShare);
router.post("/:id/share/reset", validate(avatarValidation.byId), avatarController.resetShare);

// Sending the avatar into an external meeting, and taking it out again.
router.post("/:id/meeting", validate(avatarValidation.joinMeeting), avatarController.joinMeeting);
router.post(
  "/:id/meeting/:conversationId/leave",
  validate(avatarValidation.leaveMeeting),
  avatarController.leaveMeeting,
);

// A new face for an existing avatar: an uploaded photo or a Library face.
// Multer first, so the multipart text field exists when validation runs.
router.post(
  "/:id/visuals",
  uploadImage.single("image"),
  validate(avatarValidation.replaceVisuals),
  avatarController.replaceVisuals,
);

// The short talking clip shown when hovering the avatar's card.
router.get("/:id/preview-image", validate(avatarValidation.byId), avatarController.previewImage);
router.post("/:id/preview-video", validate(avatarValidation.byId), avatarController.makePreview);

export default router;
