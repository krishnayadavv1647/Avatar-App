import { useRef, useState } from "react";
import { commsApi } from "@/services/admin.comms.api";
import Button from "@/components/common/Button";
import { Label } from "@/components/forms/controls";
import { toast } from "@/components/feedback/Toast";

const LIMITS = { image: 10, video: 50 };

/**
 * A picture or clip: upload a file, or paste a URL. Uploads go to the app's
 * storage through the admin API, which checks type and size again.
 *
 * @param {{ kind?: "image"|"video", folder: "hero-banners"|"dashboard-cards", label: string,
 *           value: string, onChange: (url: string) => void, help?: string, removable?: boolean,
 *           onBusy?: (busy: boolean) => void }} props
 */
export default function MediaField({ kind = "image", folder, label, value, onChange, help, removable = false, onBusy }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const noun = kind === "video" ? "video" : "image";

  const upload = async (file) => {
    if (!file) return;
    if (!file.type.startsWith(`${kind}/`)) {
      toast.error(`Failed to upload ${noun}: that is not ${kind === "video" ? "a video" : "an image"} file`);
      return;
    }
    if (file.size > LIMITS[kind] * 1024 * 1024) {
      toast.error(`Failed to upload ${noun}: ${noun === "video" ? "videos" : "images"} can be up to ${LIMITS[kind]} MB`);
      return;
    }

    setBusy(true);
    onBusy?.(true);
    try {
      const { url } = await commsApi.upload(file, folder);
      onChange(url);
      toast.success(kind === "video" ? "Background video uploaded successfully!" : "Image uploaded successfully!");
    } catch (err) {
      toast.error(`Failed to upload ${noun}: ${err.message}`);
    } finally {
      setBusy(false);
      onBusy?.(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div>
      <Label>{label}</Label>
      <div className="flex flex-wrap items-center gap-3">
        {value &&
          (kind === "video" ? (
            <div className="relative h-16 w-20 shrink-0 overflow-hidden rounded border border-border bg-black">
              <video src={value} muted playsInline className="h-full w-full object-cover" />
              <span className="absolute bottom-0.5 right-0.5 rounded bg-black/70 px-1 text-[9px] text-white">VIDEO</span>
            </div>
          ) : (
            <img src={value} alt="" className="h-16 w-20 shrink-0 rounded border border-border bg-surface-2 object-cover" />
          ))}
        <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? "Uploading..." : kind === "video" ? "Upload Video" : "Upload"}
        </Button>
        {removable && value && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange("")}>
            Remove
          </Button>
        )}
        <input ref={input} type="file" accept={`${kind}/*`} hidden onChange={(e) => upload(e.target.files?.[0])} />
      </div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`Or paste ${noun} URL directly`}
        aria-label={`${label} URL`}
        disabled={busy}
        className="mt-3 h-10 w-full rounded border border-border bg-bg px-3 text-ui text-text outline-none transition-colors placeholder:text-text-faint focus:border-border-strong disabled:opacity-40"
      />
      {help && <p className="mt-2 text-label text-text-faint">{help}</p>}
    </div>
  );
}
