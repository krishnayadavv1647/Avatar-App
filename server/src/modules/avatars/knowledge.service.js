import { KnowledgeDocument } from "../../models/index.js";
import { avatarRepository } from "./avatar.repository.js";
import { MAX_DOCS, CONTEXT_BUDGET_CHARS, budgetReport, extractText } from "../../ai/knowledge.js";
import { logger } from "../../config/logger.js";

const notFound = (what) => {
  const err = new Error(`${what} not found`);
  err.statusCode = 404;
  return err;
};

/** Listing shape: everything but the text, which can be a hundred thousand characters. */
const summary = (doc) => ({
  _id: doc._id,
  name: doc.name,
  mime: doc.mime,
  bytes: doc.bytes,
  chars: doc.chars,
  truncated: doc.truncated,
  createdAt: doc.createdAt,
});

async function assertAvatar(workspaceId, avatarId) {
  const avatar = await avatarRepository.findById(workspaceId, avatarId);
  if (!avatar) throw notFound("Avatar");
  return avatar;
}

export const knowledgeService = {
  async list(workspaceId, avatarId) {
    await assertAvatar(workspaceId, avatarId);
    const docs = await KnowledgeDocument.find({ workspaceId, avatarId })
      .sort({ createdAt: 1 })
      .select("-text")
      .lean();
    // Whether each document actually reaches a call: past the budget it is cut or left out.
    const report = budgetReport(docs);
    return docs.map((doc, i) => ({ ...summary(doc), reachesCalls: report[i].reachesCalls }));
  },

  /** One document with its stored text - what the avatar actually has to draw on. */
  async get(workspaceId, avatarId, docId) {
    await assertAvatar(workspaceId, avatarId);
    const [all, doc] = await Promise.all([
      KnowledgeDocument.find({ workspaceId, avatarId }).sort({ createdAt: 1 }).select("name chars").lean(),
      KnowledgeDocument.findOne({ _id: docId, workspaceId, avatarId }).lean(),
    ]);
    if (!doc) throw notFound("Document");
    const report = budgetReport(all);
    const index = all.findIndex((d) => String(d._id) === String(doc._id));
    return {
      ...summary(doc),
      text: doc.text,
      reachesCalls: report[index].reachesCalls,
      budgetChars: CONTEXT_BUDGET_CHARS,
    };
  },

  async add(workspaceId, avatarId, file, userId) {
    await assertAvatar(workspaceId, avatarId);
    if (!file) {
      const err = new Error("No document uploaded");
      err.statusCode = 422;
      throw err;
    }

    const count = await KnowledgeDocument.countDocuments({ workspaceId, avatarId });
    if (count >= MAX_DOCS) {
      const err = new Error(`An avatar can hold ${MAX_DOCS} documents. Remove one first.`);
      err.statusCode = 422;
      throw err;
    }

    const { text, truncated } = await extractText(file);
    const doc = await KnowledgeDocument.create({
      workspaceId,
      avatarId,
      // multer decodes multipart filenames as latin1; names are UTF-8.
      name: Buffer.from(file.originalname, "latin1").toString("utf8"),
      mime: file.mimetype,
      bytes: file.size,
      text,
      chars: text.length,
      truncated,
      uploadedBy: userId,
    });

    logger.info({ avatarId: String(avatarId), chars: text.length, truncated }, "knowledge document added");
    return summary(doc);
  },

  /**
   * Saves text as a document. A document with the same name is replaced, so a
   * customer's changed details can be pushed again without piling up copies.
   * @returns {Promise<{ document: object, replaced: boolean }>}
   */
  async saveText(workspaceId, avatarId, { name, content }, userId) {
    await assertAvatar(workspaceId, avatarId);
    const { text, truncated } = await extractText({ buffer: Buffer.from(content, "utf8"), originalname: "text.txt" });

    const existing = await KnowledgeDocument.findOne({ workspaceId, avatarId, name }).select("_id");
    if (!existing && (await KnowledgeDocument.countDocuments({ workspaceId, avatarId })) >= MAX_DOCS) {
      const err = new Error(`An avatar can hold ${MAX_DOCS} documents. Remove one first.`);
      err.statusCode = 422;
      throw err;
    }

    const fields = { mime: "text/plain", bytes: Buffer.byteLength(content), text, chars: text.length, truncated, uploadedBy: userId };
    const doc = existing
      ? await KnowledgeDocument.findByIdAndUpdate(existing._id, fields, { new: true })
      : await KnowledgeDocument.create({ workspaceId, avatarId, name, ...fields });
    return { document: summary(doc), replaced: Boolean(existing) };
  },

  async remove(workspaceId, avatarId, docId) {
    await assertAvatar(workspaceId, avatarId);
    const deleted = await KnowledgeDocument.findOneAndDelete({ _id: docId, workspaceId, avatarId });
    if (!deleted) throw notFound("Document");
    return { id: docId };
  },

  /** Everything a call needs, oldest first - the order knowledgePrompt fills its budget in. */
  forCall: (avatarId) =>
    KnowledgeDocument.find({ avatarId }).sort({ createdAt: 1 }).select("name text").lean(),

  removeAllFor: (workspaceId, avatarId) => KnowledgeDocument.deleteMany({ workspaceId, avatarId }),
};
