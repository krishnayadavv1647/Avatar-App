import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminSystemApi } from "@/services/admin.system.api";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import { Label } from "@/components/forms/controls";
import { toast } from "@/components/feedback/Toast";
import { Glyph, QueryState, TabHeader } from "../system/parts";

const INPUT =
  "h-10 w-full rounded border border-border bg-bg px-3 text-ui text-text outline-none transition-colors placeholder:text-text-faint focus:border-border-strong disabled:opacity-40";

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/svg+xml", "image/x-icon", "image/vnd.microsoft.icon"];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const PWA_SIZES = [32, 64, 192, 512];

const INPUT_TYPE = { url: "url", email: "email", youtube: "url", text: "text", media: "url" };

/**
 * App Config: the app's name, support contact, welcome videos and branding,
 * saved together with one button. Which settings exist - their labels, help
 * text and how they are checked - comes from the server, so this screen draws
 * whatever the catalog lists.
 */
export default function AppConfigTab() {
  const queryClient = useQueryClient();
  const { data, error, isLoading, refetch } = useQuery({ queryKey: ["admin-config"], queryFn: adminSystemApi.config });
  const [draft, setDraft] = useState(null);

  // Take the server's values once, then keep edits until they are saved.
  useEffect(() => {
    if (data && draft === null) setDraft(data.settings);
  }, [data, draft]);

  const save = useMutation({
    mutationFn: () => adminSystemApi.saveConfig(draft),
    onSuccess: (result) => {
      // The server normalises (trims, turns YouTube links into embeds); show what it kept.
      setDraft(result.settings);
      queryClient.setQueryData(["admin-config"], result);
      queryClient.invalidateQueries({ queryKey: ["site-config"] });
      toast.success("Settings saved successfully!");
    },
    onError: (err) => toast.error("Failed to save settings.", { description: err.message }),
  });

  if (!data || draft === null) return <QueryState isLoading={isLoading || (data && draft === null)} error={error} onRetry={refetch} />;

  const set = (key) => (value) => setDraft((d) => ({ ...d, [key]: value }));
  const fieldsOf = (section) => data.definitions.filter((d) => d.section === section);

  return (
    <div className="space-y-6">
      <TabHeader title="System Configuration" description="Configure global settings for your application" />

      <Card>
        <h3 className="text-h3">{data.sections.app.title}</h3>
        <p className="mt-1 text-ui text-text-muted">{data.sections.app.description}</p>
        <div className="mt-5 space-y-5">
          {fieldsOf("app").map((def) => (
            <div key={def.key}>
              <Label htmlFor={def.key}>{def.label}</Label>
              <input
                id={def.key}
                type={INPUT_TYPE[def.type]}
                value={draft[def.key] ?? ""}
                onChange={(e) => set(def.key)(e.target.value)}
                placeholder={def.placeholder}
                maxLength={def.max}
                className={INPUT}
              />
              <p className="mt-1.5 text-label text-text-faint">{def.description}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <h3 className="text-h3">{data.sections.branding.title}</h3>
        <p className="mt-1 text-ui text-text-muted">{data.sections.branding.description}</p>
        <div className="mt-5 grid gap-6 md:grid-cols-2">
          <ImageSetting
            def={fieldsOf("branding").find((d) => d.key === "logo_url")}
            kind="Logo"
            value={draft.logo_url}
            onChange={set("logo_url")}
            hint="Recommended: transparent PNG, max 200px height, max 10MB."
          />
          <ImageSetting
            def={fieldsOf("branding").find((d) => d.key === "favicon_url")}
            kind="Favicon"
            value={draft.favicon_url}
            onChange={set("favicon_url")}
            checkSize
            hint="PWA compatible sizes: 32x32px, 64x64px, 192x192px, or 512x512px. ICO or PNG format recommended, max 10MB."
            warning='Non-standard sizes may cause "Resource size is not correct" errors in a PWA manifest.'
          />
        </div>
      </Card>

      <Card>
        <h3 className="text-h3">Developer &amp; Integration Settings</h3>
        <p className="mt-1 text-ui text-text-muted">Addresses for connecting external tools to this app.</p>
        <div className="mt-5">
          <Label htmlFor="mcp-url">MCP Server Address</Label>
          <div className="flex gap-2">
            <input id="mcp-url" readOnly value={data.mcpUrl} className={`${INPUT} flex-1 font-mono text-label`} />
            <Button
              variant="secondary"
              onClick={() => {
                navigator.clipboard.writeText(data.mcpUrl).then(
                  () => toast.success("MCP address copied to clipboard!"),
                  () => toast.error("Could not copy. Select the address and copy it by hand."),
                );
              }}
            >
              <Glyph name="copy" size={14} />
              Copy
            </Button>
          </div>
          <p className="mt-1.5 text-label text-text-faint">
            Connect Claude, ChatGPT and other AI tools to your avatars here. It is built from App Public Domain when that
            is set. Each person connects with their own API key, created on the AI tools page.
          </p>
          <Button as={Link} to="/connect" variant="secondary" size="sm" className="mt-3">
            <Glyph name="external" size={14} />
            Open AI tools
          </Button>
        </div>
      </Card>

      {/* Stays in view while scrolling a long form. */}
      <div className="sticky bottom-0 -mx-1 border-t border-border bg-bg px-1 py-4">
        <Button onClick={() => save.mutate()} disabled={save.isPending} className="w-full md:w-auto">
          <Glyph name="save" size={14} />
          {save.isPending ? "Saving..." : "Save All Settings"}
        </Button>
      </div>
    </div>
  );
}

/**
 * A logo or favicon: a preview, an address field and an upload button. An
 * uploaded file only fills the field; nothing is stored until Save All Settings.
 */
function ImageSetting({ def, kind, value, onChange, hint, warning, checkSize = false }) {
  const [uploading, setUploading] = useState(false);
  const input = useRef(null);

  const upload = async (file) => {
    if (!file) return;
    if (file.size > MAX_IMAGE_BYTES) return toast.error("File is too large. Maximum size is 10MB.");
    if (!IMAGE_TYPES.includes(file.type)) {
      return toast.error(`Invalid file type: ${file.type || "unknown"}. Please upload PNG, JPG, SVG, or ICO files.`);
    }

    if (checkSize && file.type !== "image/svg+xml") await warnIfOddSize(file);

    setUploading(true);
    try {
      onChange(await adminSystemApi.uploadImage(file));
      toast.success(`${kind} uploaded successfully! Remember to save changes.`);
    } catch (err) {
      toast.error(`Failed to upload ${kind.toLowerCase()}: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <Label htmlFor={def.key}>{def.label}</Label>
      <div className="flex items-start gap-4">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-bg">
          {value ? (
            <img src={value} alt={`${kind} preview`} className="max-h-full max-w-full object-contain" />
          ) : (
            <span className="px-2 text-center text-label text-text-faint">Default</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <input
            id={def.key}
            type="url"
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value)}
            placeholder="https://example.com/image.png"
            className={INPUT}
          />
          <input
            ref={input}
            type="file"
            accept={IMAGE_TYPES.join(",")}
            className="hidden"
            onChange={(e) => {
              upload(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => input.current?.click()} disabled={uploading}>
              <Glyph name="upload" size={14} />
              {uploading ? "Uploading…" : `Upload ${kind}`}
            </Button>
            {value && (
              <Button size="sm" variant="ghost" onClick={() => onChange("")}>
                Use default
              </Button>
            )}
          </div>
        </div>
      </div>
      <p className="mt-2 text-label text-text-faint">{def.description}</p>
      <p className="mt-1 text-label text-text-faint">{hint}</p>
      {warning && <p className="mt-1 text-label text-yellow">{warning}</p>}
    </div>
  );
}

/** Favicons off the usual sizes still work, but may be rejected in a PWA manifest. */
async function warnIfOddSize(file) {
  const url = URL.createObjectURL(file);
  try {
    const { width, height } = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.width, height: img.height });
      img.onerror = reject;
      img.src = url;
    });
    if (width !== height || !PWA_SIZES.includes(width)) {
      toast.error(
        `Favicon dimensions (${width}x${height}) may not be PWA compatible. Recommended sizes: 32x32, 64x64, 192x192, or 512x512 pixels.`,
        { duration: 6000 },
      );
    }
  } catch {
    // An .ico some browsers cannot decode: upload anyway, as the size is only advice.
  } finally {
    URL.revokeObjectURL(url);
  }
}
