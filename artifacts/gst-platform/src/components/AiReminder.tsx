import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ai } from "@/lib/ai";
import { currentLang } from "@/lib/i18n";
import { waNumber } from "@/lib/whatsapp";
import { Sparkles } from "lucide-react";

/** The AI writes a payment reminder; the person edits it and sends it from their own WhatsApp. */
export function AiReminder({ invoiceId, phone }: { invoiceId: number; phone?: string | null }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [lang, setLang] = useState<"en" | "hi">(currentLang());
  const [tone, setTone] = useState<"polite" | "firm">("polite");
  const [text, setText] = useState("");
  const [writing, setWriting] = useState(false);

  const write = async () => {
    setWriting(true);
    try {
      setText((await ai<{ message: string }>("reminder", { invoiceId, lang, tone })).message);
    } catch (err) {
      toast({ title: "The AI could not write the reminder", description: (err as Error).message, variant: "destructive" });
    } finally {
      setWriting(false);
    }
  };
  const to = waNumber(phone);

  return (
    <>
      <Button variant="outline" size="sm" className="gap-1" onClick={() => setOpen(true)}>
        <Sparkles className="w-4 h-4" /> Write reminder with AI
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="no-print sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Payment reminder</DialogTitle>
            <DialogDescription>The AI writes it from this invoice. Read and edit it before you send it.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Language</Label>
              <Select value={lang} onValueChange={(v) => setLang(v as "en" | "hi")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="en">English</SelectItem><SelectItem value="hi">हिंदी</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Tone</Label>
              <Select value={tone} onValueChange={(v) => setTone(v as "polite" | "firm")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="polite">Polite</SelectItem><SelectItem value="firm">Firm</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
          <Button type="button" variant="outline" className="gap-2" onClick={write} loading={writing}>
            <Sparkles className="w-4 h-4" /> {text ? "Write it again" : "Write reminder"}
          </Button>
          {text && <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} aria-label="Reminder text" translate="no" />}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            {text
              ? <Button asChild><a href={`https://wa.me/${to ?? ""}?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer">Open in WhatsApp</a></Button>
              : <Button disabledReason="Write the reminder first.">Open in WhatsApp</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
