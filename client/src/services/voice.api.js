import { api } from "@/lib/apiClient";

/**
 * The workspace's own voices - cloned here through ElevenLabs from a sample,
 * or cloned in LiveKit Cloud and added by id.
 */
export const voiceApi = {
  list: async () => (await api.get("/voices")).voices,
  /** `{ cloning }` - whether this server can clone voices itself. */
  capabilities: () => api.get("/voices/capabilities"),
  create: async ({ name, voiceId, gender }) =>
    (await api.post("/voices", { name, voiceId, ...(gender && { gender }) })).voice,
  /** Sends a recorded or uploaded sample to be cloned. */
  clone: async ({ name, description, gender, sample, fileName }) => {
    const form = new FormData();
    form.append("name", name);
    if (description) form.append("description", description);
    if (gender) form.append("gender", gender);
    form.append("consent", "true");
    form.append("sample", sample, fileName);
    return (await api.upload("/voices/clone", form)).voice;
  },
  remove: (id) => api.del(`/voices/${id}`),
};
