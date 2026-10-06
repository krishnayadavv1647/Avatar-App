import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { adminApi } from "@/services/admin.api";
import { adminUsersApi } from "@/services/admin.users.api";
import Modal from "@/components/common/Modal";
import Button from "@/components/common/Button";
import Field from "@/components/forms/Field";
import { Label, Select, SwitchRow, TextArea } from "@/components/forms/controls";
import { toast } from "@/components/feedback/Toast";
import { creditsBuy } from "../users/userUi";

const THUMBNAIL_TYPES = ["image/jpeg", "image/png", "image/webp"];
const THUMBNAIL_MAX_BYTES = 5 * 1024 * 1024;

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);

const EMPTY = {
  name: "",
  key: "",
  description: "",
  price: "0",
  monthlyCredits: "0",
  unlimitedCredits: false,
  displayOrder: "0",
  durationType: "monthly",
  conditionBoxDescription: "",
  active: true,
  visible: true,
  isDefault: false,
  concurrencyLimit: "3",
  maxAvatars: "0",
  purchaseUrl: "",
  thumbnailUrl: "",
};

const fromPlan = (plan) => ({
  name: plan.name,
  key: plan.key,
  description: plan.description || "",
  price: String((plan.priceCents || 0) / 100),
  monthlyCredits: String(plan.monthlyCredits ?? 0),
  unlimitedCredits: Boolean(plan.unlimitedCredits),
  displayOrder: String(plan.displayOrder ?? 0),
  durationType: plan.durationType || "monthly",
  conditionBoxDescription: plan.conditionBoxDescription || "",
  active: plan.active !== false,
  visible: plan.visible !== false,
  isDefault: Boolean(plan.isDefault),
  concurrencyLimit: String(plan.concurrencyLimit ?? 3),
  maxAvatars: String(plan.maxAvatars ?? 0),
  purchaseUrl: plan.purchaseUrl || "",
  thumbnailUrl: plan.thumbnailUrl || "",
});

/**
 * "Create New Plan" / "Edit Plan". Limits apply to everyone on the plan from
 * their next call, so saving needs no follow-up step. The key is chosen once,
 * on create - it defaults to the name, slugged.
 */
export default function PlanEditDialog({ plan, onClose, onSaved }) {
  const creating = !plan;
  const [form, setForm] = useState(() => (plan ? fromPlan(plan) : EMPTY));
  const [keyTouched, setKeyTouched] = useState(false);
  const fileInput = useRef(null);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const { data: rates } = useQuery({ queryKey: ["admin-credit-rates"], queryFn: adminUsersApi.creditRates });

  const upload = useMutation({
    mutationFn: adminUsersApi.uploadPlanThumbnail,
    onSuccess: (thumbnailUrl) => {
      set({ thumbnailUrl });
      toast.success("Thumbnail uploaded successfully!");
    },
    onError: (error) => toast.error(`Failed to upload thumbnail: ${error.message}`),
  });

  const pickThumbnail = (file) => {
    if (fileInput.current) fileInput.current.value = "";
    if (!file) return;
    if (!THUMBNAIL_TYPES.includes(file.type)) return toast.error("Use a JPG, PNG or WebP image.");
    if (file.size > THUMBNAIL_MAX_BYTES) return toast.error("Image must be 5 MB or smaller.");
    upload.mutate(file);
  };

  const save = useMutation({
    mutationFn: (fields) => (creating ? adminApi.createPlan({ key: form.key.trim(), ...fields }) : adminApi.updatePlan(plan._id, fields)),
    onSuccess: () => {
      toast.success(creating ? "Plan created successfully!" : "Plan updated successfully!");
      onSaved();
    },
    onError: (error) => toast.error(`Error saving plan: ${error.message}`),
  });

  const submit = (e) => {
    e.preventDefault();
    const price = Number(form.price);
    const credits = Number(form.monthlyCredits);
    const concurrency = Number(form.concurrencyLimit);
    const avatars = Number(form.maxAvatars);

    if (!form.name.trim()) return toast.error("Plan name is required");
    if (creating && !/^[a-z0-9][a-z0-9-]{1,31}$/.test(form.key.trim())) {
      return toast.error("Use 2-32 lowercase letters, numbers or dashes for the plan key");
    }
    if (!Number.isFinite(price) || price < 0) return toast.error("Please enter a valid price");
    if (!Number.isInteger(credits) || credits < 0) return toast.error("Please enter a valid credits amount");
    if (!Number.isInteger(concurrency) || concurrency < 1) return toast.error("Please enter a valid concurrency limit");
    if (!Number.isInteger(avatars) || avatars < 0) return toast.error("Please enter a valid max avatars limit");

    save.mutate({
      name: form.name.trim(),
      description: form.description.trim(),
      priceCents: Math.round(price * 100),
      monthlyCredits: credits,
      unlimitedCredits: form.unlimitedCredits,
      displayOrder: Number(form.displayOrder) || 0,
      durationType: form.durationType,
      conditionBoxDescription: form.conditionBoxDescription.trim(),
      active: form.active,
      visible: form.visible,
      isDefault: form.isDefault,
      concurrencyLimit: concurrency,
      maxAvatars: avatars,
      purchaseUrl: form.purchaseUrl.trim(),
      thumbnailUrl: form.thumbnailUrl,
    });
  };

  const busy = save.isPending || upload.isPending;

  return (
    <Modal
      open
      onClose={() => !busy && onClose()}
      title={creating ? "Create New Plan" : "Edit Plan"}
      description={
        creating
          ? "Zero max avatars means no limit."
          : `Changes apply to everyone on this plan from their next call${plan.users ? ` (${plan.users} now)` : ""}.`
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="plan-form" disabled={busy}>
            {save.isPending ? (creating ? "Creating..." : "Updating...") : creating ? "Create Plan" : "Update Plan"}
          </Button>
        </>
      }
    >
      <form id="plan-form" onSubmit={submit} noValidate className="space-y-8">
        <Section title="Basic Information">
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <Field
                label="Plan Name *"
                id="plan-name"
                value={form.name}
                maxLength={60}
                placeholder="e.g., Pro Plan"
                onChange={(name) => set({ name, ...(creating && !keyTouched && { key: slug(name) }) })}
              />
            </div>
            <div>
              <Field
                label="Plan Key *"
                id="plan-key"
                value={form.key}
                maxLength={32}
                placeholder="pro"
                disabled={!creating}
                hint={creating ? "Lowercase, fixed once created." : "Fixed once created."}
                onChange={(key) => {
                  setKeyTouched(true);
                  set({ key: key.toLowerCase() });
                }}
              />
            </div>
          </div>

          <Field
            label="Description"
            id="plan-description"
            value={form.description}
            maxLength={200}
            placeholder="For growing teams"
            onChange={(description) => set({ description })}
          />

          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <Field label="Price (USD) *" id="plan-price" type="number" min="0" step="0.01" value={form.price} onChange={(price) => set({ price })} />
            </div>
            <div>
              <Field
                label="Monthly credits *"
                id="plan-credits"
                type="number"
                min="0"
                step="1"
                value={form.unlimitedCredits ? "" : form.monthlyCredits}
                placeholder={form.unlimitedCredits ? "Unlimited" : undefined}
                disabled={form.unlimitedCredits}
                hint={
                  form.unlimitedCredits
                    ? "Calls on this plan never use credits."
                    : (creditsBuy(Number(form.monthlyCredits), rates) ?? "Added to the account each month.")
                }
                onChange={(monthlyCredits) => set({ monthlyCredits })}
              />
            </div>
            <div>
              <Field
                label="Display Order"
                id="plan-order"
                type="number"
                min="0"
                step="1"
                value={form.displayOrder}
                hint="Lower numbers appear first"
                onChange={(displayOrder) => set({ displayOrder })}
              />
            </div>
            <div>
              <Label
                htmlFor="plan-duration"
                hint={`Shown as "${form.durationType === "lifetime" ? "one time" : "/month"}". A label only: credits are still added monthly.`}
              >
                Duration Type
              </Label>
              <Select id="plan-duration" value={form.durationType} onChange={(durationType) => set({ durationType })}>
                <option value="monthly">Monthly</option>
                <option value="lifetime">Lifetime</option>
              </Select>
            </div>
          </div>

          <div>
            <Label htmlFor="plan-condition">Condition Box Description</Label>
            <TextArea
              id="plan-condition"
              rows={3}
              maxLength={300}
              value={form.conditionBoxDescription}
              onChange={(conditionBoxDescription) => set({ conditionBoxDescription })}
              placeholder="Optional: Add conditions or special notes for this plan"
            />
          </div>
        </Section>

        <Section title="Advanced Options">
          <SwitchRow title="Plan is Active" description="Users can be assigned to this plan" checked={form.active} onChange={(active) => set({ active })} />
          <SwitchRow
            title="Visible to Users"
            description="Show this plan to regular users (admins always see it)"
            checked={form.visible}
            onChange={(visible) => set({ visible })}
          />
          <SwitchRow
            title="Unlimited credits"
            description="Calls on this plan are never limited or charged by credits"
            checked={form.unlimitedCredits}
            onChange={(unlimitedCredits) => set({ unlimitedCredits })}
          />
          <SwitchRow
            title="Default plan"
            description="New sign-ups start on this plan. Only one plan can be the default."
            checked={form.isDefault}
            onChange={(isDefault) => set({ isDefault })}
          />
        </Section>

        <Section title="Admin Only Fields" note="These fields are not shown to regular users">
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <Field
                label="Concurrency Limit *"
                id="plan-concurrency"
                type="number"
                min="1"
                max="100"
                step="1"
                value={form.concurrencyLimit}
                hint="Calls running at once"
                onChange={(concurrencyLimit) => set({ concurrencyLimit })}
              />
            </div>
            <div>
              <Field
                label="Max Avatars *"
                id="plan-avatars"
                type="number"
                min="0"
                step="1"
                value={form.maxAvatars}
                hint="0 = unlimited"
                onChange={(maxAvatars) => set({ maxAvatars })}
              />
            </div>
          </div>
          <Field
            label="Purchase URL"
            id="plan-purchase"
            value={form.purchaseUrl}
            maxLength={500}
            placeholder="Optional: External purchase link (https://…)"
            onChange={(purchaseUrl) => set({ purchaseUrl })}
          />
        </Section>

        <Section title="Plan Thumbnail">
          {form.thumbnailUrl && (
            <div className="relative aspect-video overflow-hidden rounded-lg border border-border bg-surface-3">
              <img src={form.thumbnailUrl} alt="Plan thumbnail" className="h-full w-full object-cover" />
              <Button
                type="button"
                variant="danger"
                size="sm"
                className="absolute right-2 top-2"
                aria-label="Remove thumbnail"
                onClick={() => set({ thumbnailUrl: "" })}
              >
                Remove
              </Button>
            </div>
          )}
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => pickThumbnail(e.target.files?.[0])}
            disabled={upload.isPending}
          />
          <div>
            <Button type="button" variant="secondary" onClick={() => fileInput.current?.click()} disabled={upload.isPending}>
              {upload.isPending ? "Uploading..." : "Upload Thumbnail"}
            </Button>
            <p className="mt-1.5 text-label text-text-faint">JPG, PNG or WebP, up to 5 MB.</p>
          </div>
        </Section>
      </form>
    </Modal>
  );
}

function Section({ title, note, children }) {
  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-ui font-semibold">{title}</h3>
        {note && <p className="mt-0.5 text-label text-text-faint">{note}</p>}
      </div>
      {children}
    </section>
  );
}
