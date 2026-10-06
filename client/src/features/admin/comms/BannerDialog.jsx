import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { commsApi } from "@/services/admin.comms.api";
import Modal from "@/components/common/Modal";
import Button from "@/components/common/Button";
import Field from "@/components/forms/Field";
import { Label, SwitchRow, TextArea } from "@/components/forms/controls";
import { toast } from "@/components/feedback/Toast";
import MediaField from "./MediaField";
import { errorText } from "./shared";

const EMPTY = {
  title: "",
  titleLine1: "",
  titleLine2: "",
  subtitle: "",
  imageUrl: "",
  backgroundImageUrl: "",
  backgroundVideoUrl: "",
  ctaText: "Try Now",
  ctaLink: "",
  walkthroughVideoUrl: "",
  displayOrder: 0,
  isActive: true,
};

const fromRecord = (b) => ({
  title: b.title || "",
  titleLine1: b.titleLine1 || "",
  titleLine2: b.titleLine2 || "",
  subtitle: b.subtitle || "",
  imageUrl: b.imageUrl || "",
  backgroundImageUrl: b.backgroundImageUrl || "",
  backgroundVideoUrl: b.backgroundVideoUrl || "",
  ctaText: b.ctaText || "Try Now",
  ctaLink: b.ctaLink || "",
  walkthroughVideoUrl: b.walkthroughVideoUrl || "",
  displayOrder: b.displayOrder || 0,
  isActive: b.isActive ?? true,
});

const Section = ({ title, children }) => (
  <section className="space-y-4 border-t border-border pt-5 first:border-0 first:pt-0">
    {title && <h3 className="text-body font-semibold">{title}</h3>}
    {children}
  </section>
);

/** Create or edit a hero banner. `banner` is null when creating. */
export default function BannerDialog({ open, banner, onClose }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(EMPTY);
  const [uploading, setUploading] = useState(false);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  useEffect(() => {
    if (open) setForm(banner ? fromRecord(banner) : EMPTY);
  }, [open, banner]);

  const save = useMutation({
    mutationFn: () => (banner ? commsApi.updateBanner(banner._id, form) : commsApi.createBanner(form)),
    onSuccess: () => {
      toast.success(banner ? "Hero banner updated successfully!" : "Hero banner created successfully!");
      queryClient.invalidateQueries({ queryKey: ["admin-banners"] });
      // The dashboard cover is read through this key.
      queryClient.invalidateQueries({ queryKey: ["site-banners"] });
      onClose();
    },
    onError: (err) => toast.error(errorText(err, "Failed to save hero banner.")),
  });

  const submit = (e) => {
    e.preventDefault();
    if (!form.title.trim() || !form.subtitle.trim()) {
      toast.error("Title and subtitle are required.");
      return;
    }
    save.mutate();
  };

  const busy = save.isPending || uploading;

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title={banner ? "Edit Hero Banner" : "Create Hero Banner"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="banner-form" disabled={busy}>
            {save.isPending ? "Saving..." : banner ? "Update Banner" : "Create Banner"}
          </Button>
        </>
      }
    >
      <form id="banner-form" onSubmit={submit} className="space-y-6">
        <Section>
          <Field
            label="Title *"
            id="banner-title"
            value={form.title}
            onChange={(v) => set({ title: v })}
            placeholder="e.g., Avatar Studio is Live"
            hint='The banner&apos;s name in the admin list. The dashboard cover shows the two title lines below.'
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Field label="Cover Title Line 1 (bold)" id="banner-line1" value={form.titleLine1} onChange={(v) => set({ titleLine1: v })} placeholder="e.g., Avatar" />
            </div>
            <div>
              <Field label="Cover Title Line 2 (light)" id="banner-line2" value={form.titleLine2} onChange={(v) => set({ titleLine2: v })} placeholder="e.g., Studio" />
            </div>
          </div>
          <div>
            <Label htmlFor="banner-subtitle">Subtitle *</Label>
            <TextArea id="banner-subtitle" value={form.subtitle} onChange={(v) => set({ subtitle: v })} rows={3} placeholder="e.g., Create talking AI avatars and have real conversations with them." />
          </div>
        </Section>

        <Section title="Images">
          <MediaField folder="hero-banners" label="Left Side Image" value={form.imageUrl} onChange={(v) => set({ imageUrl: v })} onBusy={setUploading} />
          <MediaField
            kind="video"
            folder="hero-banners"
            label="Background Video (optional)"
            value={form.backgroundVideoUrl}
            onChange={(v) => set({ backgroundVideoUrl: v })}
            onBusy={setUploading}
            removable
            help="When set, the dashboard cover plays this video as an autoplaying, muted, looping background instead of the static image."
          />
          <MediaField folder="hero-banners" label="Background Image" value={form.backgroundImageUrl} onChange={(v) => set({ backgroundImageUrl: v })} onBusy={setUploading} />
        </Section>

        <Section title="Call to Action Buttons">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Field label="Primary Button Text" id="banner-cta" value={form.ctaText} onChange={(v) => set({ ctaText: v })} placeholder="Try Now" />
            </div>
            <div>
              <Field label="Primary Button Link" id="banner-cta-link" value={form.ctaLink} onChange={(v) => set({ ctaLink: v })} placeholder="/studio or a full URL" />
            </div>
          </div>
          <Field
            label="Walkthrough Video URL (optional)"
            id="banner-walkthrough"
            value={form.walkthroughVideoUrl}
            onChange={(v) => set({ walkthroughVideoUrl: v })}
            placeholder="https://www.youtube.com/watch?v=... or https://youtu.be/..."
            hint='Paste any YouTube URL (it is converted to embed format automatically). A "Watch Walkthrough" button appears on the banner.'
          />
        </Section>

        <Section title="Display Settings">
          <div className="grid items-end gap-4 sm:grid-cols-2">
            <div>
              <Field label="Display Order" id="banner-order" type="number" value={form.displayOrder} onChange={(v) => set({ displayOrder: parseInt(v, 10) || 0 })} hint="Lower numbers come first." />
            </div>
            <SwitchRow title="Active" description="Inactive banners are not shown on the dashboard." checked={form.isActive} onChange={(isActive) => set({ isActive })} />
          </div>
        </Section>
      </form>
    </Modal>
  );
}
