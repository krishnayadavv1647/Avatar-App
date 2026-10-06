import { Avatar } from "../../models/index.js";

/**
 * All avatar queries are workspace-scoped at this layer, so no caller can
 * accidentally read across tenants by forgetting a filter.
 */
export const avatarRepository = {
  listByWorkspace: (workspaceId) =>
    Avatar.find({ workspaceId, draft: { $ne: true } }).sort({ createdAt: -1 }).populate("personaId voiceId").lean(),

  findById: (workspaceId, id) =>
    Avatar.findOne({ _id: id, workspaceId }).populate("personaId voiceId").lean(),

  create: (doc) => Avatar.create(doc),

  updateById: (workspaceId, id, patch) =>
    Avatar.findOneAndUpdate({ _id: id, workspaceId }, patch, { new: true }).lean(),

  deleteById: (workspaceId, id) => Avatar.findOneAndDelete({ _id: id, workspaceId }).lean(),
};
