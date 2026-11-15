import { Stack, useLocalSearchParams } from "expo-router";
import { describeAudit, type AuditEntry } from "@/lib/audit";
import { ListScreen, Line } from "@/lib/ListScreen";

/** A user's audit trail: who changed what in their books and account. */
export default function AuditTrail() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  return (
    <>
      <Stack.Screen options={{ title: `${name ?? "User"} · audit trail` }} />
      <ListScreen<AuditEntry> path={`/admin/users/${encodeURIComponent(id)}/audit`} listKey="entries" search={false}
        empty="No changes recorded yet." href={() => null}
        renderItem={(e) => <Line title={describeAudit(e)} sub={`${e.actorEmail} · ${new Date(e.createdAt).toLocaleString("en-IN")}`} />} />
    </>
  );
}
