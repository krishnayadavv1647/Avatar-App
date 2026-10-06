import { adminService } from "./admin.service.js";
import { usersService } from "./users.service.js";
import { impersonationService } from "./impersonation.service.js";
import { plansService } from "./plans.service.js";
import { invitationService } from "../invitations/invitation.service.js";
import { asyncHandler } from "../../middleware/validate.js";
import { isPlatformAdmin } from "../../middleware/admin.js";
import { User } from "../../models/index.js";

/** Who is acting and from where - recorded with every change an admin makes. */
const actor = (req) => ({ admin: req.admin, ip: req.ip });

export const adminController = {
  /** Whether the caller is a platform admin - the client uses it to show the Admin link. */
  access: asyncHandler(async (req, res) => {
    const user = await User.findById(req.auth.userId).select("email platformAdmin").lean();
    res.json({ admin: isPlatformAdmin(user) });
  }),

  /** Signs the admin in as that user for an hour; see impersonation.service.js. */
  impersonate: asyncHandler(async (req, res) => {
    res.json(await impersonationService.start(req.params.id, actor(req)));
  }),

  stats: asyncHandler(async (req, res) => {
    res.json(await adminService.stats());
  }),

  overview: asyncHandler(async (req, res) => {
    res.json(await adminService.overview(req.query));
  }),

  listUsers: asyncHandler(async (req, res) => {
    res.json(await adminService.listUsers(req.query));
  }),

  createUser: asyncHandler(async (req, res) => {
    res.status(201).json(await usersService.create(req.body, actor(req)));
  }),

  updateUser: asyncHandler(async (req, res) => {
    res.json(await usersService.update(req.params.id, req.body, actor(req)));
  }),

  removeUser: asyncHandler(async (req, res) => {
    res.json(await usersService.remove(req.params.id, actor(req)));
  }),

  /** The filtered users as a CSV download. */
  exportUsers: asyncHandler(async (req, res) => {
    const csv = await usersService.exportCsv(req.query);
    res.set({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="users_export_${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    });
    // A byte-order mark so Excel reads names in UTF-8 rather than guessing.
    res.send(`\uFEFF${csv}`);
  }),

  listInvitations: asyncHandler(async (req, res) => {
    res.json(await invitationService.list(req.query));
  }),

  createInvitation: asyncHandler(async (req, res) => {
    res.status(201).json(await invitationService.create(req.body, actor(req)));
  }),

  revokeInvitation: asyncHandler(async (req, res) => {
    res.json(await invitationService.revoke(req.params.id, actor(req)));
  }),

  getUser: asyncHandler(async (req, res) => {
    res.json(await adminService.getUser(req.params.id));
  }),

  block: asyncHandler(async (req, res) => {
    res.json(await adminService.block(req.params.id, req.body, actor(req)));
  }),

  unblock: asyncHandler(async (req, res) => {
    res.json(await adminService.unblock(req.params.id, actor(req)));
  }),

  assignPlan: asyncHandler(async (req, res) => {
    res.json(await adminService.assignPlan(req.params.id, req.body, actor(req)));
  }),

  listPlans: asyncHandler(async (req, res) => {
    res.json({ plans: await plansService.list() });
  }),

  createPlan: asyncHandler(async (req, res) => {
    res.status(201).json({ plan: await plansService.create(req.body, req.admin._id) });
  }),

  addPlanTemplates: asyncHandler(async (req, res) => {
    res.json(await plansService.addTemplates(req.admin._id));
  }),

  uploadPlanThumbnail: asyncHandler(async (req, res) => {
    res.status(201).json(await plansService.uploadThumbnail(req.file));
  }),

  updatePlan: asyncHandler(async (req, res) => {
    res.json({ plan: await plansService.update(req.params.id, req.body) });
  }),

  removePlan: asyncHandler(async (req, res) => {
    res.json(await plansService.remove(req.params.id));
  }),
};
