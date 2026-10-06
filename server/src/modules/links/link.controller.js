import { linkService } from "./link.service.js";
import { asyncHandler } from "../../middleware/validate.js";

export const linkController = {
  describe: asyncHandler(async (req, res) => {
    res.json(await linkService.describe(req.params.token));
  }),

  previewImage: asyncHandler(async (req, res) => {
    const { buffer, type } = await linkService.previewImage(req.params.token);
    // Short, so a link that is switched off stops serving it soon.
    res.setHeader("Cache-Control", "private, max-age=300");
    res.type(type).send(buffer);
  }),

  start: asyncHandler(async (req, res) => {
    res.status(201).json(await linkService.startCall(req.params.token, req.body));
  }),

  end: asyncHandler(async (req, res) => {
    res.json(
      await linkService.endCall(req.params.token, req.params.conversationId, req.body.callToken),
    );
  }),
};
