import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { leadsApi } from "@/services/leads.api";
import PageHeader from "@/components/layout/PageHeader";
import Card from "@/components/common/Card";
import Button from "@/components/common/Button";
import Segmented from "@/components/forms/Segmented";
import { formatWhen } from "@/features/conversations/format";

/**
 * What callers left with an avatar: contact details they agreed to share, and
 * requests to talk to a person. Both are written by the avatar during a call
 * when its owner switched the feature on in the avatar's settings.
 */
const LEAD_STATUSES = [
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "closed", label: "Closed" },
];

export default function LeadsPage() {
  const [tab, setTab] = useState("leads");

  return (
    <>
      <PageHeader title="Leads" description="People who shared their details with an avatar, and who asked for a person." />
      <div className="mb-6">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "leads", label: "Leads" },
            { value: "requests", label: "Requests for a person" },
          ]}
        />
      </div>
      {tab === "leads" ? <Leads /> : <Requests />}
    </>
  );
}

function Empty({ children }) {
  return (
    <Card className="py-12 text-center">
      <p className="mx-auto max-w-[460px] text-text-muted">{children}</p>
      <div className="mt-4 flex justify-center">
        <Button as={Link} to="/avatars">
          Go to avatars
        </Button>
      </div>
    </Card>
  );
}

function Leads() {
  const queryClient = useQueryClient();
  const { data: leads, isLoading, error } = useQuery({ queryKey: ["leads"], queryFn: () => leadsApi.list() });
  const setStatus = useMutation({
    mutationFn: ({ id, status }) => leadsApi.setStatus(id, status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["leads"] }),
  });
  const download = useMutation({
    mutationFn: leadsApi.exportCsv,
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "leads.csv";
      link.click();
      URL.revokeObjectURL(url);
    },
  });

  if (isLoading) return <p className="text-text-muted">Loading leads…</p>;
  if (error) return <p className="text-red">{error.message}</p>;
  if (!leads.length) {
    return (
      <Empty>
        No leads yet. Turn on <strong>Capture leads</strong> in an avatar&apos;s settings and it will save the details
        callers offer.
      </Empty>
    );
  }

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-ui text-text-muted">{leads.length} lead{leads.length === 1 ? "" : "s"}</p>
        <Button variant="secondary" onClick={() => download.mutate()} disabled={download.isPending}>
          {download.isPending ? "Preparing…" : "Download CSV"}
        </Button>
      </div>
      {download.isError && <p className="mb-3 text-ui text-red">{download.error.message}</p>}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[760px] text-left text-ui">
          <thead className="bg-surface-2 text-label uppercase tracking-wider text-text-faint">
            <tr>
              <th className="px-4 py-3 font-medium">Contact</th>
              <th className="px-4 py-3 font-medium">Needs</th>
              <th className="px-4 py-3 font-medium">Avatar</th>
              <th className="px-4 py-3 font-medium">Last seen</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {leads.map((lead) => (
              <tr key={lead._id} className="align-top">
                <td className="px-4 py-3">
                  <p className="font-medium">{lead.name || "Unnamed"}</p>
                  {lead.email && <p className="text-text-muted">{lead.email}</p>}
                  {lead.phone && <p className="text-text-muted">{lead.phone}</p>}
                </td>
                <td className="max-w-[300px] px-4 py-3 text-text-muted">{lead.requirement || "—"}</td>
                <td className="px-4 py-3 text-text-muted">
                  {lead.avatarName || "Deleted avatar"}
                  {lead.calls > 1 && <span className="block text-label text-text-faint">{lead.calls} calls</span>}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-text-muted">{formatWhen(lead.lastSeenAt)}</td>
                <td className="px-4 py-3">
                  <select
                    aria-label={`Status for ${lead.name || lead.email || "lead"}`}
                    value={lead.status}
                    onChange={(e) => setStatus.mutate({ id: lead._id, status: e.target.value })}
                    className="h-9 rounded-sm border border-border-strong bg-bg px-2 text-ui"
                  >
                    {LEAD_STATUSES.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Requests() {
  const queryClient = useQueryClient();
  const { data: requests, isLoading, error } = useQuery({ queryKey: ["handoffs"], queryFn: leadsApi.handoffs });
  const setStatus = useMutation({
    mutationFn: ({ id, status }) => leadsApi.setHandoffStatus(id, status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["handoffs"] }),
  });

  if (isLoading) return <p className="text-text-muted">Loading requests…</p>;
  if (error) return <p className="text-red">{error.message}</p>;
  if (!requests.length) {
    return (
      <Empty>
        No requests yet. Turn on <strong>Human handoff</strong> in an avatar&apos;s settings and a caller who asks for a
        person is recorded here, and you are emailed.
      </Empty>
    );
  }

  return (
    <ul className="space-y-3">
      {requests.map((r) => (
        <li key={r._id}>
          <Card className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="font-medium">
                {r.name || "A caller"} <span className="font-normal text-text-muted">asked {r.avatarName || "an avatar"}</span>
              </p>
              <p className="mt-1 text-text-muted">{r.reason}</p>
              <p className="mt-1 text-ui">
                Reach them on <span className="font-medium">{r.contact}</span>
                {r.preferredTime && <span className="text-text-muted"> · best time: {r.preferredTime}</span>}
              </p>
              <p className="mt-2 text-label text-text-faint">
                {formatWhen(r.createdAt)}
                {!r.notified && " · owner was not emailed"}
                {r.conversationId && (
                  <>
                    {" · "}
                    <Link to={`/conversations/${r.conversationId}`} className="text-pink hover:underline">
                      View the conversation
                    </Link>
                  </>
                )}
              </p>
            </div>
            <Button
              variant={r.status === "open" ? "primary" : "secondary"}
              onClick={() => setStatus.mutate({ id: r._id, status: r.status === "open" ? "done" : "open" })}
            >
              {r.status === "open" ? "Mark done" : "Reopen"}
            </Button>
          </Card>
        </li>
      ))}
    </ul>
  );
}
