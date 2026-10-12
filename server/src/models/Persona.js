import mongoose from "mongoose";

/** How an avatar behaves, kept separate from how it looks. */
const personaSchema = new mongoose.Schema(
  {
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    name: { type: String, required: true, trim: true },
    systemPrompt: { type: String, required: true },
    // Unset means the install default - see ai/catalog.js defaultLlmModel.
    llmModel: String,
    temperature: { type: Number, min: 0, max: 2, default: 0.7 },
    greeting: String,

    /** BCP-47-ish code driving STT, TTS and the vendor's own language setting. */
    language: { type: String, default: "en" },

    /**
     * How the avatar moves, as opposed to what it says.
     *
     * LemonSlice steers gesture and demeanour with a separate prompt; feeding
     * it the conversational brief produces an avatar that gestures like a
     * customer-service script. The renderer has always read these - they were
     * simply missing from the model.
     */
    motionPrompt: String,
    idlePrompt: String,

    /** TTS voice id for the configured TTS model; unset uses TTS_VOICE. */
    voice: String,
    /** 1 is natural. Mapped onto whatever the TTS model calls its speed option. */
    voiceSpeed: { type: Number, min: 0.5, max: 1.5 },

    /** Appends RECOMMENDED_PROMPT (ai/prompts/personality.js) to the brief. */
    useDefaultPrompt: { type: Boolean, default: false },

    /** Hard ceiling for one call. Falls back to MAX_CALL_SECONDS when unset. */
    maxCallSeconds: { type: Number, min: 60, max: 14400 },

    /** Gives the avatar the save_lead tool: it can store a caller's contact details as a lead. */
    captureLeads: { type: Boolean, default: false },
    /** Gives the avatar the request_human tool: a caller can ask for a person and it is recorded and the owner told. */
    humanHandoff: { type: Boolean, default: false },

    tools: [{ name: String, description: String, schema: mongoose.Schema.Types.Mixed }],
  },
  { timestamps: true },
);

export const Persona = mongoose.model("Persona", personaSchema);
