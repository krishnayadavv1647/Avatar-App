import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { avatarApi } from "@/services/avatar.api";

/**
 * Saves an avatar's settings when the person presses Save.
 *
 * Edits are collected into one partial patch as they are made and sent together
 * by `save()`. A failed save keeps the patch, so Save can simply be pressed again.
 *
 * `status` is "idle" | "saving" | "saved" | "error"; `dirty` is true while there
 * are changes that have not been saved.
 */
export function useManualSave(avatarId) {
  const queryClient = useQueryClient();
  const pending = useRef({});
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState("idle");

  const mutation = useMutation({
    mutationFn: (patch) => avatarApi.update(avatarId, patch),
    onSuccess: (avatar) => {
      queryClient.setQueryData(["avatar", avatarId], avatar);
      queryClient.invalidateQueries({ queryKey: ["avatars"] });
      const more = Object.keys(pending.current).length > 0;
      setDirty(more);
      setStatus(more ? "idle" : "saved");
    },
    onError: (_err, patch) => {
      // Keep what failed, under anything edited since, so Save retries all of it.
      pending.current = mergePatch(patch, pending.current);
      setDirty(true);
      setStatus("error");
    },
  });

  /** Another avatar starts clean: its page never inherits this one's edits. */
  useEffect(() => {
    pending.current = {};
    setDirty(false);
    setStatus("idle");
  }, [avatarId]);

  /** Closing or reloading the tab with unsaved changes asks first. */
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  /** Collects a partial patch; nothing is sent until `save`. */
  const queue = useCallback((patch) => {
    pending.current = mergePatch(pending.current, patch);
    setDirty(true);
    setStatus((s) => (s === "saving" ? s : "idle"));
  }, []);

  const mutate = mutation.mutate;
  const save = useCallback(() => {
    const patch = pending.current;
    if (!Object.keys(patch).length) return;
    pending.current = {};
    setStatus("saving");
    mutate(patch);
  }, [mutate]);

  return { queue, save, dirty, status, error: mutation.error };
}

/** One level deep: `persona` and `render` are merged, not replaced. */
function mergePatch(a, b) {
  const out = { ...a };
  for (const [key, value] of Object.entries(b)) {
    out[key] =
      value && typeof value === "object" && !Array.isArray(value) ? { ...a[key], ...value } : value;
  }
  return out;
}
