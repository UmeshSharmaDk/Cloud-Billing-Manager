import { Stack } from "expo-router";
import { useRef, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { ai } from "@/lib/ai";
import { isHindi } from "@/lib/i18n";
import { Button, colors, s } from "@/lib/ui";

type Turn = { role: "user" | "model"; text: string };

const EXAMPLES = isHindi
  ? ["सबसे ज़्यादा पैसा किसका बाकी है?", "इस महीने की बिक्री पिछले महीने से कितनी है?", "किन चीज़ों का स्टॉक कम है?"]
  : ["Who owes me the most?", "Sales this month vs last month", "Which items are low on stock?"];

/** Ask your books: questions about the business's own figures, and general GST help, in English or Hindi. */
export default function Assistant() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState("");
  const scroll = useRef<ScrollView>(null);

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
      setError(e instanceof Error ? e.message : String(e));
      setTurns((t) => t.slice(0, -1));
      setQuestion(text);
    } finally {
      setAsking(false);
      setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50);
    }
  };

  return (
    <View style={s.screen}>
      <Stack.Screen options={{ title: "Ask your books" }} />
      <ScrollView ref={scroll} contentContainerStyle={{ padding: 16, gap: 10 }} keyboardShouldPersistTaps="handled">
        <Text style={s.muted}>Ask about your sales, dues, stock and GST in English or Hindi. The AI only reads your records and can make mistakes, so check important figures in GST reports.</Text>
        {turns.length === 0 && EXAMPLES.map((q) => <Button key={q} title={q} variant="outline" onPress={() => ask(q)} />)}
        {turns.map((t, i) => (
          <View key={i} style={[s.card, t.role === "user" && { backgroundColor: colors.bg }]}>
            <Text style={{ color: colors.text, fontSize: 15 }}>{t.text}</Text>
          </View>
        ))}
        {!!error && <Text style={{ color: colors.danger }}>{error}</Text>}
      </ScrollView>
      <View style={{ padding: 16, gap: 8, borderTopWidth: 1, borderColor: colors.border }}>
        <TextInput style={[s.input, { minHeight: 60, textAlignVertical: "top" }]} multiline maxLength={1000} value={question} onChangeText={setQuestion}
          placeholder="Type your question..." placeholderTextColor={colors.muted} accessibilityLabel="Your question" />
        <Button title="Ask" busy={asking} onPress={() => ask()} disabledReason={question.trim() ? undefined : "Type a question first."} />
        {turns.length > 0 && <Button title="Start a new chat" variant="outline" onPress={() => { setTurns([]); setError(""); }} />}
      </View>
    </View>
  );
}
