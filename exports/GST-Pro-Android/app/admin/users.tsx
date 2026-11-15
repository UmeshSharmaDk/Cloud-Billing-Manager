import { Stack } from "expo-router";
import { ListScreen, Line } from "@/lib/ListScreen";
import type { User } from "@/lib/types";
import { StatusPill } from "@/lib/ui";

export default function AdminUsers() {
  return (
    <>
      <Stack.Screen options={{ title: "Users" }} />
      <ListScreen<User> path="/users" listKey="users" search="Search by name or email" empty="No users yet."
        href={(u) => `/admin/user/${u.id}`} newHref="/admin/new-user"
        renderItem={(u) => (
          <Line title={u.name} sub={u.email} right={<StatusPill status={u.isActive ? "active" : "inactive"} />} />
        )} />
    </>
  );
}
