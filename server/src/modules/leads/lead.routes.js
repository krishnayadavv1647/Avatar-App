import { Router } from "express";
import { z } from "zod";
import { leadService } from "./lead.service.js";
import { asyncHandler, validate } from "../../middleware/validate.js";
import { resolveWorkspace } from "../../middleware/workspace.js";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid id");
const listQuery = z.object({
  avatarId: objectId.optional(),
  status: z.enum(["new", "contacted", "closed"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

/** What callers left with their avatars: leads, and requests for a person. */
const router = Router();
router.use(resolveWorkspace);

router.get(
  "/",
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    res.json({ leads: await leadService.list(req.workspace._id, req.query) });
  }),
);

router.get(
  "/export.csv",
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const leads = await leadService.list(req.workspace._id, { ...req.query, limit: 500 });
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader("content-disposition", 'attachment; filename="leads.csv"');
    res.send(leadService.toCsv(leads));
  }),
);

router.get(
  "/handoffs",
  validate({ query: z.object({ status: z.enum(["open", "done"]).optional(), limit: z.coerce.number().int().min(1).max(500).default(100) }) }),
  asyncHandler(async (req, res) => {
    res.json({ handoffs: await leadService.listHandoffs(req.workspace._id, req.query) });
  }),
);

router.patch(
  "/handoffs/:id",
  validate({ params: z.object({ id: objectId }), body: z.object({ status: z.enum(["open", "done"]) }) }),
  asyncHandler(async (req, res) => {
    res.json({ handoff: await leadService.setHandoffStatus(req.workspace._id, req.params.id, req.body.status) });
  }),
);

router.patch(
  "/:id",
  validate({ params: z.object({ id: objectId }), body: z.object({ status: z.enum(["new", "contacted", "closed"]) }) }),
  asyncHandler(async (req, res) => {
    res.json({ lead: await leadService.setStatus(req.workspace._id, req.params.id, req.body.status) });
  }),
);

export default router;
