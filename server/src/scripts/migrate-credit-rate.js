/**
 * Multiplies every credit balance (and explicit plan / pack credits) so people
 * keep the same minutes after the rate change. Shows what it would do; changes
 * nothing without --apply.
 *
 *   node src/scripts/migrate-credit-rate.js              # dry run
 *   node src/scripts/migrate-credit-rate.js --apply      # do it (once; safe to repeat)
 *   node src/scripts/migrate-credit-rate.js --factor 2.5 --apply --force
 *
 * Run it right after the API with the new rates is deployed. See
 * modules/billing/rateMigration.js for exactly what it does.
 */
import mongoose from "mongoose";
import { connectDb } from "../config/db.js";
import { migrateCreditRate } from "../modules/billing/rateMigration.js";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const factorAt = args.indexOf("--factor");
const factor = factorAt >= 0 ? Number(args[factorAt + 1]) : 2.5;

if (!Number.isFinite(factor) || factor <= 0) {
  console.error("--factor must be a positive number");
  process.exit(2);
}

await connectDb();
const result = await migrateCreditRate({ factor, apply: flag("apply"), force: flag("force") });

if (!result.ok) {
  console.error("Not run:", result.reason);
  await mongoose.disconnect();
  process.exit(1);
}

console.log(result.applied ? `APPLIED (x${result.factor})` : `DRY RUN (x${result.factor}) - nothing was changed`);
console.log(`calls in progress: ${result.calls}`);
if (result.plans.length) {
  console.log("\nplans and packs scaled once:");
  for (const p of result.plans) console.log(`  ${p.name}: ${p.from} -> ${p.to}`);
} else if (result.alreadyScaled) {
  console.log("\nplans and packs: already scaled earlier");
}
console.log("\nbalances (credits):");
console.log("  workspace".padEnd(28), "before".padStart(10), "plan top-up".padStart(12), "adjust".padStart(10), "after".padStart(10));
for (const r of result.accounts) {
  console.log(
    `  ${r.workspaceId}`.padEnd(28),
    String(r.before).padStart(10),
    String(r.topup).padStart(12),
    String(r.delta).padStart(10),
    String(r.after).padStart(10),
  );
}
if (!result.applied) console.log("\nRun again with --apply to make these changes.");

await mongoose.disconnect();
