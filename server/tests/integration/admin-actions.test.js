/**
 * What admins can change: blocking accounts, and plans - creating them,
 * assigning them, and the limits they actually enforce.
 *
 * ADMIN_EMAILS is pinned to admin@example.com in setup-env.
 */
import "../setup-env.js";
import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import { signIn, signUp, startTestApp } from "../helpers.js";

let app;
let admin;
let stock;

before(async () => {
  app = await startTestApp();
  admin = await signUp(app.baseUrl, { email: "admin@example.com", name: "Admin" });
  const { body } = await admin.get("/api/studio/stock");
  [stock] = body.avatars;
});

after(() => app.stop());

const adopt = (client, name = "Face") =>
  client.post("/api/studio/stock", {
    providerId: stock.providerId,
    providerAvatarId: stock.providerAvatarId,
    name,
  });

const anon = async (method, path, body) => {
  const res = await fetch(`${app.baseUrl}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

let planCounter = 0;
const createPlan = (fields = {}) =>
  admin.post("/api/admin/plans", { key: `plan-${(planCounter += 1)}`, name: `Plan ${planCounter}`, ...fields });

describe("blocking", () => {
  test("shuts a user out everywhere, and ends at their share links", async () => {
    const user = await signUp(app.baseUrl);
    const avatar = (await adopt(user)).body.avatar;
    const share = await user.put(`/api/avatars/${avatar._id}/share`, { enabled: true });
    const token = share.body.share.token;

    const blocked = await admin.post(`/api/admin/users/${user.user.id}/block`, { reason: "Abuse" });
    assert.equal(blocked.status, 200);
    assert.equal(blocked.body.user.blocked, true);
    assert.equal(blocked.body.user.blockedReason, "Abuse");

    // An access token they already hold stops working at once.
    const api = await user.get("/api/avatars");
    assert.equal(api.status, 403);
    assert.equal(api.body.error.code, "account_blocked");

    const login = await anon("POST", "/api/auth/login", { email: user.email, password: user.password });
    assert.equal(login.status, 403);
    assert.equal(login.body.error.code, "account_blocked");

    const refresh = await anon("POST", "/api/auth/refresh", { refreshToken: user.refreshToken });
    assert.ok([401, 403].includes(refresh.status), "a refresh token issued before the block is dead");

    const guest = await anon("POST", `/api/links/${token}/calls`, { name: "Guest" });
    assert.equal(guest.status, 409);

    // The link page says so up front, rather than offering a call it will refuse.
    const page = await anon("GET", `/api/links/${token}`);
    assert.equal(page.body.available, false);
  });

  test("a wrong password still says only that, for a blocked account too", async () => {
    const user = await signUp(app.baseUrl);
    await admin.post(`/api/admin/users/${user.user.id}/block`, {});

    const login = await anon("POST", "/api/auth/login", { email: user.email, password: "not-the-password" });
    assert.equal(login.status, 401, "blocked status must not leak without the right password");
  });

  test("unblocking lets them back in", async () => {
    const user = await signUp(app.baseUrl);
    await admin.post(`/api/admin/users/${user.user.id}/block`, {});

    const unblocked = await admin.del(`/api/admin/users/${user.user.id}/block`);
    assert.equal(unblocked.status, 200);
    assert.equal(unblocked.body.user.blocked, false);

    const again = await signIn(app.baseUrl, { email: user.email, password: user.password });
    assert.equal((await again.get("/api/avatars")).status, 200);
  });

  test("admins cannot be blocked, and nobody can block themselves", async () => {
    const self = await admin.post(`/api/admin/users/${admin.user.id}/block`, {});
    assert.equal(self.status, 422);
  });

  test("only admins can block", async () => {
    const user = await signUp(app.baseUrl);
    const other = await signUp(app.baseUrl);
    const { status } = await user.post(`/api/admin/users/${other.user.id}/block`, {});
    assert.equal(status, 403);
  });

  test("the list and the overview show who is blocked", async () => {
    const user = await signUp(app.baseUrl);
    await admin.post(`/api/admin/users/${user.user.id}/block`, {});

    const { body } = await admin.get(`/api/admin/users?q=${encodeURIComponent(user.email)}`);
    assert.equal(body.users[0].blocked, true);

    const { body: overview } = await admin.get("/api/admin/overview");
    assert.ok(overview.users.blocked >= 1);
  });
});

describe("plans", () => {
  test("are created, listed with how many are on them, and edited", async () => {
    const created = await createPlan({ name: "Starter", priceCents: 900, monthlyCredits: 600 });
    assert.equal(created.status, 201);
    assert.equal(created.body.plan.users, 0);

    const edited = await admin.patch(`/api/admin/plans/${created.body.plan._id}`, { name: "Starter+" });
    assert.equal(edited.body.plan.name, "Starter+");

    const { body } = await admin.get("/api/admin/plans");
    assert.ok(body.plans.some((p) => p.name === "Starter+"));
  });

  test("refuse a duplicate key, and a key edit", async () => {
    const first = await createPlan();
    const dup = await admin.post("/api/admin/plans", { key: first.body.plan.key, name: "Again" });
    assert.equal(dup.status, 409);

    const rekey = await admin.patch(`/api/admin/plans/${first.body.plan._id}`, { key: "other" });
    assert.equal(rekey.status, 400);
  });

  test("only one plan is the default, and new sign-ups start on it", async () => {
    const a = await createPlan({ isDefault: true });
    const b = await createPlan({ isDefault: true });

    const { body } = await admin.get("/api/admin/plans");
    const defaults = body.plans.filter((p) => p.isDefault).map((p) => p._id);
    assert.deepEqual(defaults, [b.body.plan._id]);

    const newcomer = await signUp(app.baseUrl);
    const { body: detail } = await admin.get(`/api/admin/users/${newcomer.user.id}`);
    assert.equal(String(detail.subscription.planId), String(b.body.plan._id));

    // Leave no default behind for the other tests.
    await admin.patch(`/api/admin/plans/${b.body.plan._id}`, { isDefault: false });
    assert.ok(a.body.plan);
  });

  test("are assigned to a user, and an archived one cannot be", async () => {
    const user = await signUp(app.baseUrl);
    const plan = await createPlan({ name: "Pro" });

    const assigned = await admin.put(`/api/admin/users/${user.user.id}/plan`, { planId: plan.body.plan._id });
    assert.equal(assigned.status, 200);
    assert.equal(assigned.body.subscription.planName, "Pro");
    assert.equal(assigned.body.limits.planName, "Pro");

    const archived = await createPlan({ active: false });
    const refused = await admin.put(`/api/admin/users/${user.user.id}/plan`, { planId: archived.body.plan._id });
    assert.equal(refused.status, 422);
  });

  test("a plan in use cannot be deleted; an unused one can", async () => {
    const user = await signUp(app.baseUrl);
    const used = await createPlan();
    await admin.put(`/api/admin/users/${user.user.id}/plan`, { planId: used.body.plan._id });

    assert.equal((await admin.del(`/api/admin/plans/${used.body.plan._id}`)).status, 409);

    const unused = await createPlan();
    assert.equal((await admin.del(`/api/admin/plans/${unused.body.plan._id}`)).status, 200);
  });

  test("the ready-made plans are added once, and never made the default", async () => {
    const first = await admin.post("/api/admin/plans/templates");
    assert.equal(first.status, 200);
    assert.deepEqual(first.body.added, ["free", "starter", "pro", "business"]);
    assert.ok(first.body.plans.filter((p) => ["free", "starter", "pro", "business"].includes(p.key)).every((p) => !p.isDefault));

    // An admin's edit survives running it again.
    const pro = first.body.plans.find((p) => p.key === "pro");
    await admin.patch(`/api/admin/plans/${pro._id}`, { priceCents: 12345 });

    const again = await admin.post("/api/admin/plans/templates");
    assert.deepEqual(again.body.added, []);
    assert.equal(again.body.plans.find((p) => p.key === "pro").priceCents, 12345);
  });

  test("only admins manage plans", async () => {
    const user = await signUp(app.baseUrl);
    const { status } = await user.post("/api/admin/plans", { key: "sneaky", name: "Sneaky" });
    assert.equal(status, 403);
  });
});

describe("plan limits", () => {
  test("the avatar cap stops the next avatar", async () => {
    const user = await signUp(app.baseUrl);
    const plan = await createPlan({ maxAvatars: 1 });
    await admin.put(`/api/admin/users/${user.user.id}/plan`, { planId: plan.body.plan._id });

    assert.equal((await adopt(user, "One")).status, 201);
    const second = await adopt(user, "Two");
    assert.equal(second.status, 402);
    assert.match(second.body.error.message, /allows 1 avatar/);
  });

  /** Sets a user's credit balance to exactly `target`, through the admin's own credit endpoint. */
  const setBalance = async (user, target) => {
    const { body } = await admin.get(`/api/admin/users/${user.user.id}/credits`);
    const change = target - body.balance;
    if (change) {
      const res = await admin.post(`/api/admin/users/${user.user.id}/credits`, { credits: change, note: "Set up for a test" });
      assert.equal(res.status, 200);
    }
  };
  const call = (user, avatar) => user.post("/api/rooms", { avatarId: avatar._id });

  test("a call is refused below a minute's credits, and allowed once they are topped up", async () => {
    const user = await signUp(app.baseUrl);
    const plan = await createPlan({ monthlyCredits: 5 });
    await admin.put(`/api/admin/users/${user.user.id}/plan`, { planId: plan.body.plan._id });
    const avatar = (await adopt(user, "Caller")).body.avatar;

    // A Standard minute costs 10 credits.
    await setBalance(user, 5);
    const refused = await call(user, avatar);
    assert.equal(refused.status, 402);
    assert.equal(refused.body.error.code, "insufficient_credits");

    await setBalance(user, 10);
    const started = await call(user, avatar);
    assert.equal(started.status, 201);
    await user.del(`/api/rooms/${started.body.conversationId}`);
  });

  test("editing a plan's credits reaches people already on it, with no re-assigning", async () => {
    const user = await signUp(app.baseUrl);
    const plan = await createPlan({ monthlyCredits: 5 });
    await admin.put(`/api/admin/users/${user.user.id}/plan`, { planId: plan.body.plan._id });
    const avatar = (await adopt(user, "Caller")).body.avatar;
    await setBalance(user, 5);
    assert.equal((await call(user, avatar)).status, 402);

    // The plan now gives 50 a month; this month's top-up is the difference.
    await admin.patch(`/api/admin/plans/${plan.body.plan._id}`, { monthlyCredits: 50 });
    const { body } = await admin.get(`/api/admin/users/${user.user.id}/credits`);
    assert.equal(body.balance, 50);

    const started = await call(user, avatar);
    assert.equal(started.status, 201);
    await user.del(`/api/rooms/${started.body.conversationId}`);
  });

  test("an unlimited plan is never refused for credits", async () => {
    const user = await signUp(app.baseUrl);
    const plan = await createPlan({ unlimitedCredits: true });
    await admin.put(`/api/admin/users/${user.user.id}/plan`, { planId: plan.body.plan._id });
    const avatar = (await adopt(user, "Caller")).body.avatar;

    await setBalance(user, 0);
    const started = await call(user, avatar);
    assert.equal(started.status, 201);
    await user.del(`/api/rooms/${started.body.conversationId}`);
  });
});
