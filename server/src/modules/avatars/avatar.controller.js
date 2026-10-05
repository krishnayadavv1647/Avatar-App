import { avatarService } from "./avatar.service.js";
import { knowledgeService } from "./knowledge.service.js";
import { previewService } from "./preview.service.js";
import { studioService } from "../studio/studio.service.js";
import { roomService } from "../rooms/room.service.js";
import { asyncHandler } from "../../middleware/validate.js";

export const avatarController = {
  list: asyncHandler(async (req, res) => {
    res.json({ avatars: await avatarService.list(req.workspace._id) });
  }),

  get: asyncHandler(async (req, res) => {
    res.json({ avatar: await avatarService.get(req.workspace._id, req.params.id) });
  }),

  update: asyncHandler(async (req, res) => {
    res.json({ avatar: await avatarService.update(req.workspace._id, req.params.id, req.body) });
  }),

  remove: asyncHandler(async (req, res) => {
    res.json(await avatarService.remove(req.workspace._id, req.params.id));
  }),

  listDocuments: asyncHandler(async (req, res) => {
    res.json({ documents: await knowledgeService.list(req.workspace._id, req.params.id) });
  }),

  addDocument: asyncHandler(async (req, res) => {
    const document = await knowledgeService.add(
      req.workspace._id,
      req.params.id,
      req.file,
      req.auth?.userId,
    );
    res.status(201).json({ document });
  }),

  removeDocument: asyncHandler(async (req, res) => {
    res.json(await knowledgeService.remove(req.workspace._id, req.params.id, req.params.docId));
  }),

  getShare: asyncHandler(async (req, res) => {
    res.json({ share: await avatarService.getShare(req.workspace._id, req.params.id) });
  }),

  setShare: asyncHandler(async (req, res) => {
    res.json({ share: await avatarService.setShare(req.workspace._id, req.params.id, req.body) });
  }),

  resetShare: asyncHandler(async (req, res) => {
    res.json({ share: await avatarService.resetShare(req.workspace._id, req.params.id) });
  }),

  /**
   * Sends the avatar into a Zoom / Meet / Teams / Webex meeting through
   * LemonSlice. It is an ordinary call underneath - same limits, same history,
   * same metering - that happens to take place in someone else's meeting.
   */
  joinMeeting: asyncHandler(async (req, res) => {
    const { conversationId } = await roomService.startCall({
      workspace: req.workspace,
      avatarId: req.params.id,
      userId: req.auth?.userId,
      source: "meeting",
      meetingUrl: req.body.meetingUrl,
    });
    res.status(202).json({ conversationId });
  }),

  /** Takes the avatar out of the meeting and ends that call. */
  leaveMeeting: asyncHandler(async (req, res) => {
    res.json(
      await roomService.endCall({
        workspace: req.workspace,
        conversationId: req.params.conversationId,
        endReason: "removed from meeting",
      }),
    );
  }),

  /** "Edit avatar visuals": a new photo or Library face for an existing avatar. */
  replaceVisuals: asyncHandler(async (req, res) => {
    await studioService.replaceVisuals({
      workspace: req.workspace,
      avatarId: req.params.id,
      file: req.file,
      faceId: req.body.faceId,
      userId: req.auth?.userId,
    });
    res.json({ avatar: await avatarService.get(req.workspace._id, req.params.id) });
  }),

  /** Makes (or remakes) the avatar's hover clip; see preview.service.js. */
  makePreview: asyncHandler(async (req, res) => {
    // get() is scoped to the workspace, so another workspace's avatar 404s.
    await avatarService.get(req.workspace._id, req.params.id);
    const result = await previewService.request(req.params.id, { force: true });
    if (!result.started) {
      // In the app's usual error shape, so the reason reaches the person.
      throw Object.assign(new Error(`Could not make a preview video: ${result.reason}.`), { statusCode: 409 });
    }
    res.status(202).json(result);
  }),
};
