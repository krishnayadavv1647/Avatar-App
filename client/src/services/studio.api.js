import { api } from "@/lib/apiClient";

export const studioApi = {
  /** What this install can offer: storage driver, usable vendors, upload limits. */
  options: () => api.get("/studio/options"),

  /** Ready-made avatars from every configured vendor that has them. */
  stock: async () => (await api.get("/studio/stock")).avatars,

  /** Records whether a ready-made face is a female or male character. */
  setStockGender: ({ providerId, providerAvatarId, gender }) =>
    api.put("/studio/stock/gender", { providerId, providerAvatarId, gender }),

  async createFromStock({ providerId, providerAvatarId, name, gender, behaviour }) {
    const { avatar } = await api.post("/studio/stock", {
      providerId,
      providerAvatarId,
      // Left out when blank, so the server falls back to the vendor's name.
      ...(name && { name }),
      ...(gender && { gender }),
      ...(behaviour && { behaviour }),
    });
    return avatar;
  },

  async createFromPhoto({ file, name, providerId, gender, behaviour }) {
    const form = new FormData();
    form.append("name", name);
    if (providerId) form.append("providerId", providerId);
    if (gender) form.append("gender", gender);
    // Multipart has no nesting, so the brief travels as JSON and the server
    // parses it back before validating.
    if (behaviour) form.append("behaviour", JSON.stringify(behaviour));
    form.append("image", file);

    // Goes through the shared client so it gets the token and the 401 retry.
    const { avatar } = await api.upload("/studio/photo", form);
    return avatar;
  },

  /**
   * "Generate image" and "Edit image" (Kie.ai). Each starts a picture and
   * returns `{ taskId }`; `task` says how it is going, `file` is the finished
   * picture. See features/studio/imageGen.js for the loop that ties them together.
   */
  image: {
    generate: ({ prompt, aspectRatio }) => api.post("/studio/image/generate", { prompt, aspectRatio }),
    edit: (file, prompt) => {
      const form = new FormData();
      form.append("prompt", prompt);
      form.append("image", file);
      return api.upload("/studio/image/edit", form);
    },
    task: (id) => api.get(`/studio/image/tasks/${id}`),
    file: (id) => api.blob(`/studio/image/tasks/${id}/file`),
  },

  /**
   * The creator's Preview: a hidden draft avatar records a talking clip. `status`
   * is `{ status: "making" | "ready" | "failed", url? }`; `keep` turns the draft
   * into the avatar, `discard` deletes it.
   */
  preview: {
    fromPhoto: ({ file, name, gender, behaviour }) => {
      const form = new FormData();
      form.append("name", name);
      if (gender) form.append("gender", gender);
      if (behaviour) form.append("behaviour", JSON.stringify(behaviour));
      form.append("image", file);
      return api.upload("/studio/preview/photo", form);
    },
    fromStock: ({ providerAvatarId, name, gender, behaviour }) =>
      api.post("/studio/preview/stock", {
        providerId: "library",
        providerAvatarId,
        ...(name && { name }),
        ...(gender && { gender }),
        ...(behaviour && { behaviour }),
      }),
    status: (id) => api.get(`/studio/preview/${id}`),
    keep: (id) => api.post(`/studio/preview/${id}/keep`).then((r) => r.avatar),
    discard: (id) => api.del(`/studio/preview/${id}`),
  },
};
