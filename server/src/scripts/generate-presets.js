import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { configured, imageStatus, startImage } from "../integrations/imagegen/kie.js";

/**
 * Makes the template faces: one picture per preset in the client's list, made by
 * Kie.ai from the preset's `imagePrompt` and saved as client/public/presets/<id>.jpg.
 *
 *   npm run presets                 makes the ones that are missing
 *   npm run presets -- --only boss,manager
 *   npm run presets -- --force      remakes everything
 *   npm run presets -- --pro        the cheaper model (default is the best one)
 *
 * Run it once with KIE_API_KEY set (server/.env is read), look at the pictures,
 * remake any you do not like with --only <id> --force, then commit the folder.
 * The app then serves them as plain files; nothing is generated at runtime.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, "../../../client/public/presets");
const presetsFile = path.resolve(here, "../../../client/src/features/studio/presets.js");

const CONCURRENCY = 3; // the image service limits how many a key may have pending
const POLL_MS = 4000;
const GIVE_UP_MS = 8 * 60 * 1000;

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const only = (args[args.indexOf("--only") + 1] || "").split(",").filter(Boolean);
const model = flag("pro") ? "flux-kontext-pro" : "flux-kontext-max";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const exists = (file) => fs.access(file).then(() => true, () => false);

async function render(preset) {
  const taskId = await startImage({ prompt: preset.imagePrompt, aspectRatio: "3:4", model });
  const started = Date.now();
  for (;;) {
    await sleep(POLL_MS);
    const result = await imageStatus(taskId);
    if (result.state === "success") return result.url;
    if (result.state === "failed") throw new Error(result.error);
    if (Date.now() - started > GIVE_UP_MS) throw new Error("took too long");
  }
}

async function download(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  const type = res.headers.get("content-type") || "";
  if (!res.ok || !type.startsWith("image/")) throw new Error(`could not download the picture (${res.status} ${type})`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length < 10_000) throw new Error("the picture is suspiciously small");
  return buffer;
}

async function make(preset) {
  const file = path.join(outDir, `${preset.id}.jpg`);
  // A refused or failed picture is tried once more; the service is not deterministic.
  for (let attempt = 1; ; attempt += 1) {
    try {
      await fs.writeFile(file, await download(await render(preset)));
      console.log(`  made   ${preset.id}`);
      return true;
    } catch (err) {
      if (attempt >= 2 || err.statusCode === 503) {
        console.log(`  FAILED ${preset.id}: ${err.message}`);
        return false;
      }
      console.log(`  retry  ${preset.id}: ${err.message}`);
    }
  }
}

async function main() {
  if (!configured()) {
    console.error("KIE_API_KEY is not set. Add it to server/.env and run again.");
    process.exit(1);
  }
  const { PRESETS } = await import(pathToFileURL(presetsFile).href);
  const unknown = only.filter((id) => !PRESETS.some((p) => p.id === id));
  if (unknown.length) {
    console.error(`No such preset: ${unknown.join(", ")}`);
    process.exit(1);
  }

  await fs.mkdir(outDir, { recursive: true });
  const queue = [];
  for (const preset of PRESETS) {
    if (only.length && !only.includes(preset.id)) continue;
    if (!flag("force") && (await exists(path.join(outDir, `${preset.id}.jpg`)))) continue;
    queue.push(preset);
  }
  console.log(`${queue.length} of ${PRESETS.length} to make with ${model}.`);

  let failed = 0;
  const worker = async () => {
    while (queue.length) {
      if (!(await make(queue.shift()))) failed += 1;
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log(failed ? `Done, ${failed} failed. Run it again to retry those.` : "Done.");
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
