import { api } from "@/lib/apiClient";

export const avatarApi = {
  list: () => api.get("/avatars").then((r) => r.avatars),
  get: (id) => api.get(`/avatars/${id}`).then((r) => r.avatar),
  /** Partial settings: `{ name?, gender?, render?, persona? }`. */
  update: (id, patch) => api.patch(`/avatars/${id}`, patch).then((r) => r.avatar),
  remove: (id) => api.del(`/avatars/${id}`),

  /** Knowledge base. Listings carry name and size, never the extracted text. */
  documents: (id) => api.get(`/avatars/${id}/documents`).then((r) => r.documents),
  addDocument: (id, file) => {
    const form = new FormData();
    form.append("file", file);
    return api.upload(`/avatars/${id}/documents`, form).then((r) => r.document);
  },
  removeDocument: (id, docId) => api.del(`/avatars/${id}/documents/${docId}`),

  /** MCP servers: `{ _id, name, url, enabled, toolNames }`. The token is write-only. */
  mcpServers: (id) => api.get(`/avatars/${id}/mcp-servers`).then((r) => r.servers),
  addMcpServer: (id, body) => api.post(`/avatars/${id}/mcp-servers`, body).then((r) => r.server),
  setMcpServerEnabled: (id, serverId, enabled) =>
    api.patch(`/avatars/${id}/mcp-servers/${serverId}`, { enabled }).then((r) => r.server),
  removeMcpServer: (id, serverId) => api.del(`/avatars/${id}/mcp-servers/${serverId}`),

  /** Public share link: `{ enabled, token }`. */
  getShare: (id) => api.get(`/avatars/${id}/share`).then((r) => r.share),
  setShare: (id, enabled) => api.put(`/avatars/${id}/share`, { enabled }).then((r) => r.share),
  /** New token; every copy of the old link stops working. */
  resetShare: (id) => api.post(`/avatars/${id}/share/reset`).then((r) => r.share),

  /** Sends the avatar into a Zoom / Meet / Teams / Webex meeting: `{ conversationId }`. */
  joinMeeting: (id, meetingUrl) => api.post(`/avatars/${id}/meeting`, { meetingUrl }),
  /** Takes it out again, ending that call. */
  leaveMeeting: (id, conversationId) => api.post(`/avatars/${id}/meeting/${conversationId}/leave`),

  /** A new face: `{ file }` (an uploaded photo) or `{ faceId }` (a Library face). */
  replaceVisuals: (id, { file, faceId }) => {
    const form = new FormData();
    if (file) form.append("image", file);
    if (faceId) form.append("faceId", faceId);
    return api.upload(`/avatars/${id}/visuals`, form).then((r) => r.avatar);
  },

  /** The avatar's still picture as a Blob, same-origin, so a canvas may draw it. */
  previewImage: (id) => api.blob(`/avatars/${id}/preview-image`),

  /** Records the card's hover clip in the background: `{ started, reason? }`. */
  makePreview: (id) => api.post(`/avatars/${id}/preview-video`),
};

/** The address a share token is opened at. */
export const shareUrl = (token) => `${window.location.origin}/talk/${token}`;
export const embedUrl = (token) => `${window.location.origin}/embed/${token}`;
export const widgetScriptUrl = () => `${window.location.origin}/embed.js`;
