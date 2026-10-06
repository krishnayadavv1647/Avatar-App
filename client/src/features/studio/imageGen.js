import { useCallback, useEffect, useRef, useState } from "react";
import { studioApi } from "@/services/studio.api";

/**
 * Making a picture with the image service: start it, ask how it is going every
 * few seconds, then fetch the finished picture as a File - the same thing an
 * uploaded photo is, so it flows into the creator exactly like one.
 */
const POLL_MS = 2500;
const GIVE_UP_MS = 5 * 60 * 1000;

const aborted = () => Object.assign(new Error("Cancelled"), { name: "AbortError" });

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(aborted());
    const id = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(id);
        reject(aborted());
      },
      { once: true },
    );
  });

/**
 * @param {() => Promise<{ taskId: string }>} start  begins the picture
 * @returns {Promise<File>}
 */
export async function makePicture(start, { signal } = {}) {
  const { taskId } = await start();
  const began = Date.now();

  for (;;) {
    await sleep(POLL_MS, signal);
    const { status, error } = await studioApi.image.task(taskId);

    if (status === "success") {
      const blob = await studioApi.image.file(taskId);
      return new File([blob], `generated-${Date.now()}.jpg`, { type: blob.type || "image/jpeg" });
    }
    if (status === "failed") throw new Error(error || "The picture could not be made.");
    if (Date.now() - began > GIVE_UP_MS) throw new Error("The picture took too long. Try again.");
  }
}

/**
 * State for a dialog that makes pictures: whether one is in progress, what went
 * wrong, and `run(start)` to make one (resolving to the File, or null if it
 * failed or was cancelled). Closing the dialog should call `cancel`, which
 * stops the polling; unmounting does it too.
 */
export function usePictureMaker() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const controller = useRef(null);

  const cancel = useCallback(() => controller.current?.abort(), []);
  useEffect(() => cancel, [cancel]);

  const run = useCallback(async (start) => {
    controller.current?.abort();
    const mine = new AbortController();
    controller.current = mine;
    setBusy(true);
    setError(null);
    try {
      return await makePicture(start, { signal: mine.signal });
    } catch (err) {
      if (err.name !== "AbortError") setError(err.message);
      return null;
    } finally {
      if (controller.current === mine) setBusy(false);
    }
  }, []);

  return { busy, error, run, cancel, clearError: () => setError(null) };
}
