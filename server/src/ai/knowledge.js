import path from "node:path";

/**
 * Knowledge base: documents an avatar can draw on during a call.
 *
 * Deliberately simple - the text is extracted once, at upload, and placed in
 * the language model's instructions at call time. No embeddings or retrieval:
 * an avatar's reference material is usually a few pages, and a call cannot
 * afford a retrieval round-trip before every spoken reply. The budgets below
 * are what keep that honest.
 */

/** Upload size, before extraction. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** One document's text is cut here, and marked as cut. */
export const MAX_DOC_CHARS = 100_000;
/** Documents per avatar. */
export const MAX_DOCS = 10;
/** Everything sent to the model on a call, across all documents (~15k tokens). */
export const CONTEXT_BUDGET_CHARS = 60_000;

const KINDS = {
  ".pdf": "pdf",
  ".docx": "docx",
  ".txt": "text",
  ".md": "text",
  ".markdown": "text",
};

/** What the upload picker offers; extensions, because browsers disagree on MIME types for .md. */
export const ACCEPTED_EXTENSIONS = Object.keys(KINDS);

const unprocessable = (message) => {
  const err = new Error(message);
  err.statusCode = 422;
  return err;
};

/**
 * Plain text from an uploaded file, or a 422 saying why there is none.
 *
 * @param {{ buffer: Buffer, originalname?: string }} file
 * @returns {Promise<{ text: string, truncated: boolean }>}
 */
export async function extractText(file) {
  const ext = path.extname(file.originalname || "").toLowerCase();
  const kind = KINDS[ext];
  if (!kind) {
    throw unprocessable(`Unsupported document type "${ext || "none"}". Use PDF, DOCX, TXT or MD.`);
  }

  let raw;
  try {
    raw = await EXTRACTORS[kind](file.buffer);
  } catch (err) {
    throw unprocessable(`Could not read that ${ext.slice(1).toUpperCase()}: ${err.message}`);
  }

  const text = normalise(raw);
  if (!text) {
    throw unprocessable(
      kind === "pdf"
        ? "That PDF has no selectable text - scanned pages need OCR before they can be used."
        : "That document is empty.",
    );
  }

  return text.length > MAX_DOC_CHARS
    ? { text: text.slice(0, MAX_DOC_CHARS), truncated: true }
    : { text, truncated: false };
}

// Loaded on first use so the API does not pay for a PDF engine at startup.
const EXTRACTORS = {
  async pdf(buffer) {
    const { extractText: pdfText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await pdfText(pdf, { mergePages: true });
    return text;
  },
  async docx(buffer) {
    const mammoth = await import("mammoth");
    const { value } = await (mammoth.default ?? mammoth).extractRawText({ buffer });
    return value;
  },
  async text(buffer) {
    return buffer.toString("utf8");
  },
};

/** Collapses runs of blank lines and trailing spaces; keeps paragraph breaks. */
function normalise(text) {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Which documents reach a call, mirroring knowledgePrompt: oldest first until
 * the budget runs out. "partial" is the one cut at the limit, "none" is left out.
 * Takes `{ name, chars }` so a listing need not load every document's text.
 *
 * @returns {Array<{ name: string, chars: number, reachesCalls: "full" | "partial" | "none" }>}
 */
export function budgetReport(documents, budget = CONTEXT_BUDGET_CHARS) {
  let remaining = budget;
  return (documents || []).map((doc) => {
    const chars = doc.chars ?? doc.text?.length ?? 0;
    let reachesCalls = "full";
    if (remaining <= 0) reachesCalls = "none";
    else if (chars > remaining) reachesCalls = "partial";
    remaining -= chars;
    return { name: doc.name, chars, reachesCalls };
  });
}

/**
 * The instructions block for a call, or "" with no documents.
 *
 * Documents go in oldest first until the budget runs out; the one that
 * crosses it is cut, and anything after it is left out and named, so the
 * model knows it has not seen everything rather than inventing the rest.
 *
 * @param {Array<{ name: string, text: string }>} documents
 */
export function knowledgePrompt(documents, budget = CONTEXT_BUDGET_CHARS) {
  if (!documents?.length) return "";

  let remaining = budget;
  const included = [];
  const omitted = [];

  for (const doc of documents) {
    if (remaining <= 0) {
      omitted.push(doc.name);
      continue;
    }
    const text = doc.text.length > remaining ? `${doc.text.slice(0, remaining)}\n[...cut for length]` : doc.text;
    remaining -= doc.text.length;
    included.push(`<document name="${doc.name.replace(/"/g, "'")}">\n${text}\n</document>`);
  }

  return [
    "Reference documents follow. Use them to answer questions when they are relevant.",
    "If the answer is not in them and you do not know it, say so instead of guessing.",
    "Speak naturally - summarise, never read a document out word for word.",
    "",
    ...included,
    ...(omitted.length ? [`\n(Not included, for length: ${omitted.join(", ")}.)`] : []),
  ].join("\n");
}
