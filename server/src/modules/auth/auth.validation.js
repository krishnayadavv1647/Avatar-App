import { z } from "zod";

export const authValidation = {
  register: {
    body: z.object({
      email: z.string().trim().email().max(200),
      // Length beats composition rules: long passphrases survive better than
      // short strings padded with symbols.
      password: z.string().min(10, "Use at least 10 characters").max(200),
      name: z.string().trim().max(80).optional(),
      workspaceName: z.string().trim().max(80).optional(),
    }),
  },
  login: {
    body: z.object({
      email: z.string().trim().email().max(200),
      password: z.string().min(1).max(200),
    }),
  },
  google: {
    // The ID token from Google's button; verified in google.js.
    body: z.object({ credential: z.string().min(20).max(4096) }),
  },
  refresh: {
    body: z.object({ refreshToken: z.string().min(1) }),
  },
};
