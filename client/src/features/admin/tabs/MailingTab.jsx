import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { commsApi } from "@/services/admin.comms.api";
import Segmented from "@/components/forms/Segmented";
import { Stat } from "../parts";
import { compact } from "../format";
import Icon from "../icons";
import BulkComposer from "../comms/mailing/BulkComposer";
import ListsPanel from "../comms/mailing/ListsPanel";
import ScheduledPanel from "../comms/mailing/ScheduledPanel";
import TemplatesPanel from "../comms/mailing/TemplatesPanel";
import { MAIL_OFF } from "../comms/shared";

const SECTIONS = [
  { value: "bulk", label: "Bulk Email" },
  { value: "lists", label: "Email Lists" },
  { value: "scheduled", label: "Scheduled" },
  { value: "templates", label: "Templates" },
];

/**
 * Email marketing: send to an audience now, keep lists, schedule for later,
 * and manage the templates the app's own emails are built from.
 *
 * Drip campaigns and delivery analytics, which the product this follows also
 * had, are not part of this app.
 */
export default function MailingTab() {
  const queryClient = useQueryClient();
  const [section, setSection] = useState("bulk");
  const { data: stats } = useQuery({ queryKey: ["admin-mail-stats"], queryFn: commsApi.mailStats });
  const figure = (key) => (stats ? compact(stats[key]) : "—");

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Email Lists" value={figure("emailLists")} />
        <Stat label="Templates" value={figure("emailTemplates")} />
        <Stat label="Scheduled Emails" value={figure("scheduledPending")} detail="Pending" />
        <Stat label="Sent Emails" value={figure("sentEmails")} detail="Scheduled sends completed" />
      </div>

      {stats && !stats.mailConfigured && (
        <p role="status" className="rounded-lg border border-yellow bg-surface-2 px-4 py-3 text-ui">
          <strong className="text-yellow">{MAIL_OFF}.</strong> <span className="text-text-muted">Lists, templates and scheduling still work; sending will not until RESEND_API_KEY and MAIL_FROM_EMAIL are set.</span>
        </p>
      )}

      <section>
        <h2 className="mb-4 flex items-center gap-2 text-h3 font-semibold">
          <Icon name="mail" size={18} className="text-text-muted" />
          Email Marketing &amp; Automation
        </h2>
        <Segmented value={section} onChange={setSection} options={SECTIONS} />
        <div className="mt-6">
          {section === "bulk" && <BulkComposer onSent={() => queryClient.invalidateQueries({ queryKey: ["admin-mail-stats"] })} />}
          {section === "lists" && <ListsPanel />}
          {section === "scheduled" && <ScheduledPanel />}
          {section === "templates" && <TemplatesPanel />}
        </div>
      </section>
    </div>
  );
}
