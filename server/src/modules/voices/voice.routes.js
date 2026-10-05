import { Router } from "express";
import multer from "multer";
import { voiceController } from "./voice.controller.js";
import { voiceValidation } from "./voice.validation.js";
import { validate } from "../../middleware/validate.js";
import { resolveWorkspace } from "../../middleware/workspace.js";

// Held in memory and passed straight to ElevenLabs; never written anywhere.
// ElevenLabs takes samples up to about 10 MB.
const uploadSample = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

const router = Router();

router.use(resolveWorkspace);

router.get("/", voiceController.list);
router.get("/capabilities", voiceController.capabilities);
router.post("/", validate(voiceValidation.create), voiceController.create);
// Multer before validate: the text fields only exist once the form is parsed.
router.post("/clone", uploadSample.single("sample"), validate(voiceValidation.clone), voiceController.clone);
router.post("/import", validate(voiceValidation.importElevenLabs), voiceController.importElevenLabs);
router.delete("/:voiceId", validate(voiceValidation.remove), voiceController.remove);

export default router;
