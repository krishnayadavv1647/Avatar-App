import { Suspense, lazy } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { avatarApi } from "@/services/avatar.api";
import PageHeader from "@/components/layout/PageHeader";
import Card from "@/components/common/Card";
import Button from "@/components/common/Button";
import Segmented from "@/components/forms/Segmented";
import { useIsAdmin } from "@/features/admin/useIsAdmin";
import AvatarCard from "./AvatarCard";

// Only admins ever open it, so it stays out of everyone else's bundle.
const AllAvatars = lazy(() => import("@/features/admin/tabs/AvatarsTab"));

export default function AvatarList() {
  const { isAdmin } = useIsAdmin();
  const [search, setSearch] = useSearchParams();
  // Admins can switch to every user's avatars; everyone else only has their own.
  const showAll = isAdmin && search.get("view") === "all";
  const { data: avatars, isLoading, error } = useQuery({
    queryKey: ["avatars"],
    queryFn: avatarApi.list,
  });

  return (
    <>
      <PageHeader
        title="Avatars"
        description="Everything in this workspace that can take a call."
        action={
          <Button as={Link} to="/studio">
            Create avatar
          </Button>
        }
      />

      {isAdmin && (
        <div className="mb-6">
          <Segmented
            value={showAll ? "all" : "mine"}
            onChange={(v) => setSearch(v === "all" ? { view: "all" } : {}, { replace: true })}
            options={[
              { value: "mine", label: "My avatars" },
              { value: "all", label: "All users" },
            ]}
          />
        </div>
      )}

      {showAll && (
        <Suspense fallback={<p className="text-text-muted">Loading</p>}>
          <AllAvatars />
        </Suspense>
      )}

      {!showAll && isLoading && <p className="text-text-muted">Loading</p>}

      {!showAll && error && (
        <Card className="border-red-line">
          <p className="text-ui text-red">{error.message}</p>
        </Card>
      )}

      {!showAll && avatars?.length === 0 && (
        <Card className="py-12 text-center">
          <p className="text-text-muted">No avatars yet.</p>
          <div className="mt-4 flex justify-center">
            <Button as={Link} to="/studio">
              Create your first
            </Button>
          </div>
        </Card>
      )}

      {!showAll && avatars?.length > 0 && (
        <>
          <h2 className="mb-4 text-h3 font-semibold">My avatars</h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
            {avatars.map((avatar) => (
              <AvatarCard key={avatar._id} avatar={avatar} />
            ))}
          </div>
        </>
      )}
    </>
  );
}
