import { useState } from "react";
import { FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { downloadXlsx, type Sheet } from "@/lib/download";

/** "Download Excel" for any page: `sheets` is called on click, so it can fetch everything first. */
export function ExportButton({ filename, sheets, label = "Download Excel" }: { filename: string; sheets: () => Sheet[] | Promise<Sheet[]>; label?: string }) {
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  return (
    <Button variant="outline" size="sm" className="gap-2" loading={busy} onClick={async () => {
      setBusy(true);
      try {
        await downloadXlsx(filename, await sheets());
      } catch (e) {
        toast({ title: "Export failed", description: (e as Error).message, variant: "destructive" });
      } finally {
        setBusy(false);
      }
    }}>
      <FileDown className="w-4 h-4" /> {label}
    </Button>
  );
}
