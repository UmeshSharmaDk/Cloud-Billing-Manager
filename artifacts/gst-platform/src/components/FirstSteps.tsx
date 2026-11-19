import { Link } from "wouter";
import { CheckCircle2, Circle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** A short getting-started list, shown until every step is done. */
export function FirstSteps({ steps }: { steps: { label: string; href: string; done: boolean }[] }) {
  const left = steps.filter((s) => !s.done).length;
  if (left === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">Get started · {steps.length - left} of {steps.length} done</CardTitle></CardHeader>
      <CardContent className="p-0 divide-y divide-border">
        {steps.map((s) => (
          <Link key={s.label} href={s.href} className="flex min-h-11 items-center gap-3 px-4 py-2 text-sm hover:bg-accent/40">
            {s.done ? <CheckCircle2 className="w-4 h-4 text-success" /> : <Circle className="w-4 h-4 text-muted-foreground" />}
            <span className={s.done ? "text-muted-foreground line-through" : "font-medium"}>{s.label}</span>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
