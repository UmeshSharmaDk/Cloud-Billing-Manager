import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Alert } from "react-native";
import { api } from "./api";
import { useSave } from "./save";
import { STATES, stateOptions } from "./states";
import { Button, ErrorView, Field, Form, Loading, Select, type Option } from "./ui";

export type FieldSpec = {
  key: string;
  label: string;
  kind?: "text" | "number" | "email" | "phone" | "multiline" | "upper" | "date" | "state" | "select" | "password";
  options?: Option[];
  /** A select whose values are numbers on the wire. */
  numeric?: boolean;
  required?: boolean;
  placeholder?: string;
};

type Values = Record<string, string>;

export function FormFields({ fields, value, set }: { fields: FieldSpec[]; value: Values; set: (k: string, v: string) => void }) {
  return (
    <>
      {fields.map((f) => {
        const label = f.label + (f.required ? " *" : "");
        if (f.kind === "state") {
          return <Select key={f.key} label={label} value={value.stateCode ?? ""} options={stateOptions}
            onChange={(code) => { set("stateCode", code); set(f.key, STATES.find((s) => s.code === code)?.name ?? ""); }} />;
        }
        if (f.kind === "select") {
          return <Select key={f.key} label={label} value={value[f.key] ?? ""} options={f.options ?? []} onChange={(v) => set(f.key, v)} />;
        }
        return (
          <Field key={f.key} label={label} value={value[f.key] ?? ""} placeholder={f.placeholder ?? (f.kind === "date" ? "YYYY-MM-DD" : undefined)}
            onChangeText={(v) => set(f.key, f.kind === "upper" ? v.toUpperCase() : v)}
            keyboardType={f.kind === "number" ? "decimal-pad" : f.kind === "email" ? "email-address" : f.kind === "phone" ? "phone-pad" : "default"}
            autoCapitalize={f.kind === "email" || f.kind === "password" ? "none" : f.kind === "upper" ? "characters" : "sentences"}
            secureTextEntry={f.kind === "password"} multiline={f.kind === "multiline"} />
        );
      })}
    </>
  );
}

/** Turns the form's strings back into the API's types: numbers, and null for blanks. */
export function toBody(fields: FieldSpec[], v: Values) {
  const body: Record<string, unknown> = {};
  for (const f of fields) {
    const raw = (v[f.key] ?? "").trim();
    body[f.key] = raw === "" ? null : f.kind === "number" || f.numeric ? Number(raw) : raw;
    if (f.kind === "state") body.stateCode = v.stateCode || null;
  }
  return body;
}

export const missing = (fields: FieldSpec[], v: Values) => fields.find((f) => f.required && !(v[f.key] ?? "").trim());

const asStrings = (o: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(o).map(([k, x]) => [k, x == null ? "" : String(x)]));

/**
 * Create or edit form for one record. `load` prefills it; the save goes to
 * `target` with `method`, then the screen closes.
 */
export function EntityForm({ fields, load, target, method, defaults, submitLabel = "Save", onSaved }: {
  fields: FieldSpec[]; load?: string; target: string; method: "POST" | "PATCH";
  defaults?: Values; submitLabel?: string; onSaved?: (r: any) => void;
}) {
  const q = useQuery({ queryKey: [load], queryFn: () => api<Record<string, unknown>>(load!), enabled: !!load });
  const [v, setV] = useState<Values>(defaults ?? {});
  useEffect(() => { if (q.data) setV(asStrings(q.data)); }, [q.data]);
  const { busy, run } = useSave();
  const set = (k: string, x: string) => setV((p) => ({ ...p, [k]: x }));

  if (load && q.isLoading) return <Loading />;
  if (q.error) return <ErrorView error={q.error} onRetry={q.refetch} />;

  const submit = () => {
    const gap = missing(fields, v);
    if (gap) return Alert.alert("Missing field", `${gap.label} is required.`);
    run(() => api(target, { method, body: toBody(fields, v) }), onSaved ?? (() => router.back()));
  };

  return (
    <Form>
      <FormFields fields={fields} value={v} set={set} />
      <Button title={submitLabel} busy={busy} onPress={submit} />
    </Form>
  );
}

export const partyFields: FieldSpec[] = [
  { key: "name", label: "Name", required: true },
  { key: "gstin", label: "GSTIN", kind: "upper" },
  { key: "phone", label: "Phone", kind: "phone" },
  { key: "email", label: "Email", kind: "email" },
  { key: "address", label: "Address" },
  { key: "city", label: "City" },
  { key: "state", label: "State", kind: "state" },
  { key: "pincode", label: "Pincode", kind: "phone" },
];
