import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";

import { usersQuery } from "@/api/users";

export const Route = createFileRoute("/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(usersQuery),
  pendingComponent: () => <p className="text-slate-500">Loading users…</p>,
  errorComponent: ({ error }) => (
    <p className="text-red-600">Failed to load users: {error instanceof Error ? error.message : String(error)}</p>
  ),
  component: UsersPage,
});

function UsersPage() {
  const { data: users } = useSuspenseQuery(usersQuery);

  return (
    <section>
      <h1 className="mb-4 text-xl font-semibold">Users</h1>
      <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
        {users.map((user) => (
          <li key={user.id}>
            <Link
              to="/users/$userId"
              params={{ userId: String(user.id) }}
              className="flex items-center justify-between px-4 py-3 hover:bg-slate-50"
            >
              <span className="font-medium">{user.name}</span>
              <span className="text-sm text-slate-500">{user.email}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
