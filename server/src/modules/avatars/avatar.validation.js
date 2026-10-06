import { z } from "zod";
import { behaviourFields, gender } from "../studio/studio.validation.js";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid id");

// The platforms LemonSlice can join. Only their https links are accepted, so
// the field cannot send the meeting bot anywhere else.
const MEETING_HOSTS = [
  /(^|\.)zoom\.us$/i,
  /^meet\.google\.com$/i,
  /(^|\.)teams\.microsoft\.com$/i,
  /(^|\.)teams\.live\.com$/i,
  /(^|\.)webex\.com$/i,
];
function isMeetingUrl(raw) {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && MEETING_HOSTS.some((re) => re.test(url.hostname));
  } catch {
    return false;
  }
}

export const avatarValidation = {
  byId: { params: z.object({ id: objectId }) },
  update: {
    params: z.object({ id: objectId }),
    body: z
      .object({
        name: z.string().trim().min(1, "Name is required").max(80).optional(),
        gender: gender.optional(),
        render: z
          .object({
            aspectRatio: z.enum(["2x3", "9x16", "1x1"]).optional(),
            model: z.enum(["standard", "flash", "lite"]).optional(),
          })
          .optional(),
        // A blank clears the call-length cap back to the install default.
        persona: behaviourFields
          .extend({ maxCallSeconds: behaviourFields.shape.maxCallSeconds.or(z.literal("")) })
          .optional(),
      })
      .strict(),
  },
  learnWebsite: {
    params: z.object({ id: objectId }),
    body: z.object({
      url: z.string().trim().min(3, "Enter the website's address").max(2000),
      // Also write the avatar's instructions and greeting from the site.
      applyBrief: z.boolean().optional(),
    }),
  },
  document: { params: z.object({ id: objectId, docId: objectId }) },
  mcpServer: { params: z.object({ id: objectId, serverId: objectId }) },
  addMcpServer: {
    params: z.object({ id: objectId }),
    body: z.object({
      name: z.string().trim().min(1, "Give the server a name").max(40),
      url: z.string().trim().url("Enter the MCP server's URL").max(2000),
      authToken: z.string().trim().max(4000).optional(),
    }),
  },
  setMcpServerEnabled: {
    params: z.object({ id: objectId, serverId: objectId }),
    body: z.object({ enabled: z.boolean() }),
  },
  joinMeeting: {
    params: z.object({ id: objectId }),
    body: z.object({
      meetingUrl: z
        .string()
        .trim()
        .max(2000)
        .refine(isMeetingUrl, "Paste a Zoom, Google Meet, Microsoft Teams or Webex meeting link"),
    }),
  },
  leaveMeeting: { params: z.object({ id: objectId, conversationId: objectId }) },
  // Multipart: an `image` file, or a Library face id as a text field.
  replaceVisuals: {
    params: z.object({ id: objectId }),
    body: z.object({
      faceId: z
        .string()
        .regex(/^face_[fm]\d{2}$/, "Unknown Library face")
        .optional(),
    }),
  },
  setShare: {
    params: z.object({ id: objectId }),
    body: z.object({ enabled: z.boolean() }),
  },
};
