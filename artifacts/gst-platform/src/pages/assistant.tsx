import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { ai } from "@/lib/ai";
import { currentLang } from "@/lib/i18n";
import { Sparkles } from "lucide-react";

type Turn = { role: "user" | "model"; text: string };

const EXAMPLES = {
  en: ["Who owes me the most?", "Sales this month vs last month", "Which items are low on stock?", "What GST rate applies to cement?"],
  hi: ["सबसे ज़्यादा पैसा किसका बाकी है?", "इस महीने की बिक्री पिछले महीने से कितनी है?", "किन चीज़ों का स्टॉक कम है?", "सीमेंट पर कितना GST लगता है?"],
};

/** Ask your books: questions about this business's own figures, and general GST help. */
export default function AssistantPage() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  const ask = async (q = question) => {
    const text = q.trim();
    if (!text || asking) return;
    setAsking(true);
    setError("");
    setTurns((t) => [...t, { role: "user", text }]);
    setQuestion("");
    try {
      const { answer } = await ai<{ answer: string }>("ask", { question: text, history: turns.slice(-10) });
      setTurns((t) => [...t, { role: "model", text: answer }]);
    } catch (e) {
      setError((e as Error).message);
      setTurns((t) => t.slice(0, -1));
      setQuestion(text);
    } finally {
      setAsking(false);
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold">Ask your books</h1>
        <p className="text-muted-foreground text-sm">Ask about your sales, dues, stock and GST in English or Hindi. The AI only reads your records and can make mistakes, so check important figures in Reports.</p>
      </div>

      {turns.length === 0 && (
        <div className="flex flex-wrap gap-2">
          {EXAMPLES[currentLang()].map((q) => (
            <Button key={q} type="button" variant="outline" size="sm" translate="no" onClick={() => ask(q)} disabled={asking}>{q}</Button>
          ))}
        </div>
      )}

      <div className="space-y-3">
        {turns.map((t, i) => (
          <Card key={i} className={t.role === "user" ? "bg-accent/40" : ""}>
            <CardContent className="p-3 text-sm whitespace-pre-line" translate="no">
              {t.role === "model" && <Sparkles className="w-4 h-4 inline mr-1 text-primary" aria-hidden />}
              {t.text}
            </CardContent>
          </Card>
        ))}
        <div ref={endRef} />
      </div>

      {error && <p className="text-sm text-danger" role="alert">{error}</p>}

      <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); ask(); }}>
        <Textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(); } }}
          placeholder={currentLang() === "hi" ? "अपना सवाल लिखें..." : "Type your question..."}
          aria-label="Your question"
          maxLength={1000}
          rows={2}
        />
        <div className="flex justify-between items-start gap-2">
          {turns.length > 0
            ? <Button type="button" variant="ghost" onClick={() => { setTurns([]); setError(""); }} disabled={asking}>Start a new chat</Button>
            : <span />}
          <Button type="submit" loading={asking} disabledReason={question.trim() ? undefined : "Type a question first."}>Ask</Button>
        </div>
      </form>
    </div>
  );
}
