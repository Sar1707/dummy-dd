import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";

import { userQuery } from "@/api/users";

export const Route = createFileRoute("/users/$userId")({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(userQuery(params.userId)),
  pendingComponent: () => <p className="text-slate-500">Loading user…</p>,
  errorComponent: ({ error }) => (
    <p className="text-red-600">Failed to load user: {error instanceof Error ? error.message : String(error)}</p>
  ),
  component: UserDetailPage,
});

function UserDetailPage() {
  const { userId } = Route.useParams();
  const { data: user } = useSuspenseQuery(userQuery(userId));

  return (
    <section>
      <Link to="/" className="text-sm text-indigo-600 hover:underline">
        ← All users
      </Link>
      <h1 className="mt-2 text-xl font-semibold">{user.name}</h1>
      <p className="text-slate-500">@{user.username}</p>
      <dl className="mt-4 grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2">
        <Field label="Email" value={user.email} />
        <Field label="Phone" value={user.phone} />
        <Field label="Website" value={user.website} />
        <Field label="Company" value={user.company.name} />
        <Field label="City" value={user.address.city} />
        <Field label="Street" value={user.address.street} />
      </dl>
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
