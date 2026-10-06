import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { commsApi } from "@/services/admin.comms.api";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import { Badge } from "@/components/forms/controls";
import { toast } from "@/components/feedback/Toast";
import { SearchBox, Skeletons, errorText } from "../shared";
import TemplateDialog from "./TemplateDialog";
import TestEmailDialog from "./TestEmailDialog";

const typeLabel = (type) => (type || "").replace(/_/g, " ");

/** The Templates inner tab: every email template, with the system/custom switch, Test and Edit. */
export default function TemplatesPanel() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [testing, setTesting] = useState(null);
  const [lastTestEmail, setLastTestEmail] = useState("");

  const { data: templates = [], isLoading } = useQuery({ queryKey: ["admin-templates"], queryFn: commsApi.templates });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin-templates"] });

  const toggleSystem = useMutation({
    mutationFn: (t) => commsApi.updateTemplate(t._id, { isSystemTemplate: !t.isSystemTemplate }),
    onSuccess: (_, t) => {
      toast.success(t.isSystemTemplate ? "Template marked as Custom Template" : "Template marked as System Template");
      refresh();
    },
    onError: (err) => toast.error(errorText(err, "Failed to update template.")),
  });

  const test = useMutation({
    mutationFn: ({ template, to }) => commsApi.testTemplate(template._id, to),
    onSuccess: (res, { template, to }) => {
      toast.success(`Test email sent to ${to}!`, { description: `Template: "${template.name}"\nEmail ID: ${res.id || "N/A"}`, duration: 6000 });
      setTesting(null);
    },
    onError: (err) => toast.error(`Failed to send test email: ${err.message}`, { duration: 8000 }),
  });

  const open = (template = null) => {
    setEditing(template);
    setDialogOpen(true);
  };

  const q = search.toLowerCase();
  const shown = templates.filter((t) => t.name.toLowerCase().includes(q) || (t.templateType || "").toLowerCase().includes(q));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-h3 font-semibold">Email Templates</h3>
        <Button onClick={() => open()}>+ Create Template</Button>
      </div>

      <SearchBox value={search} onChange={setSearch} placeholder="Search templates..." />

      {isLoading ? (
        <Skeletons count={4} className="h-20" />
      ) : (
        <div className="space-y-3">
          {shown.map((t) => (
            <Card key={t._id}>
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <h4 className="text-body font-semibold">{t.name}</h4>
                    <Badge tone="outline" className="capitalize">
                      {typeLabel(t.templateType)}
                    </Badge>
                    {t.isSystemTemplate ? <Badge tone="purple">System Template</Badge> : <Badge tone="blue">Custom Template</Badge>}
                    {!t.isActive && <Badge tone="red">Inactive</Badge>}
                  </div>
                  <p className="truncate text-ui text-text-muted">Subject: {t.subject}</p>
                  {t.placeholdersGuide && <p className="mt-1 line-clamp-1 text-label text-text-faint">Placeholders: {t.placeholdersGuide}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => toggleSystem.mutate(t)}
                    disabled={toggleSystem.isPending}
                    title={t.isSystemTemplate ? "Convert to Custom Template" : "Convert to System Template"}
                  >
                    {t.isSystemTemplate ? "Make Custom" : "Make System"}
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setTesting(t)} disabled={test.isPending}>
                    Test
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => open(t)} aria-label={`Edit ${t.name}`}>
                    Edit
                  </Button>
                </div>
              </div>
            </Card>
          ))}
          {shown.length === 0 && <p className="py-8 text-center text-ui text-text-muted">No templates found matching your search.</p>}
        </div>
      )}

      <TemplateDialog open={dialogOpen} template={editing} onClose={() => setDialogOpen(false)} />

      <TestEmailDialog
        open={Boolean(testing)}
        title="Send Test Email"
        description={testing ? `Sends "${testing.name}" with example values filled in.` : undefined}
        initialEmail={lastTestEmail}
        busy={test.isPending}
        onClose={() => setTesting(null)}
        onSend={(to) => {
          if (!to) return toast.error("Please enter a test email address");
          setLastTestEmail(to);
          test.mutate({ template: testing, to });
        }}
      />
    </div>
  );
}
