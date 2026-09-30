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
  document: { params: z.object({ id: objectId, docId: objectId }) },
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
  setShare: {
    params: z.object({ id: objectId }),
    body: z.object({ enabled: z.boolean() }),
  },
};
