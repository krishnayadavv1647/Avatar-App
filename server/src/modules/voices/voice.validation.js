import { z } from "zod";
import { isCustomVoice } from "../../ai/catalog.js";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid id");

const name = z.string().trim().min(1, "Give the voice a name").max(60);
const gender = z.enum(["female", "male"]).optional();
const language = z.string().trim().min(2).max(10).optional();

export const voiceValidation = {
  create: {
    body: z.object({
      name,
      voiceId: z
        .string()
        .trim()
        .refine(isCustomVoice, "Paste the voice ID from LiveKit Cloud - it starts with v_"),
      gender,
      language,
    }),
  },
  // Multipart fields arrive as strings, hence "true" rather than a boolean.
  clone: {
    body: z.object({
      name,
      description: z.string().trim().max(300).optional(),
      gender: z.enum(["female", "male", ""]).optional().transform((g) => g || undefined),
      language,
      consent: z.literal("true", {
        errorMap: () => ({ message: "Confirm you have the right to clone this voice" }),
      }),
    }),
  },
  remove: { params: z.object({ voiceId: objectId }) },
};
