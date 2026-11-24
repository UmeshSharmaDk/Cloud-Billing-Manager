import { useState } from "react";
import { Alert, Linking, Modal, ScrollView, Text, TextInput } from "react-native";
import { ai } from "./ai";
import { isHindi } from "./i18n";
import { Button, colors, ModalFrame, s, Select } from "./ui";
import { waNumber } from "./whatsapp";

/** The AI writes a payment reminder; the person edits it and sends it from their own WhatsApp. */
export function AiReminder({ invoiceId, phone }: { invoiceId: number; phone?: string | null }) {
  const [open, setOpen] = useState(false);
  const [lang, setLang] = useState(isHindi ? "hi" : "en");
  const [tone, setTone] = useState("polite");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const write = async () => {
    setBusy(true);
    try {
      setText((await ai<{ message: string }>("reminder", { invoiceId, lang, tone })).message);
    } catch (e) {
      Alert.alert("The AI could not write the reminder", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button title="Write reminder with AI" variant="outline" onPress={() => setOpen(true)} />
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <ModalFrame backgroundColor={colors.bg}>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
            <Text style={s.title}>Payment reminder</Text>
            <Text style={s.muted}>The AI writes it from this invoice. Read and edit it before you send it.</Text>
            <Select label="Language" value={lang} onChange={setLang} options={[{ value: "en", label: "English" }, { value: "hi", label: "हिंदी" }]} />
            <Select label="Tone" value={tone} onChange={setTone} options={[{ value: "polite", label: "Polite" }, { value: "firm", label: "Firm" }]} />
            <Button title={text ? "Write it again" : "Write reminder"} variant="outline" busy={busy} onPress={write} />
            {!!text && <TextInput style={[s.input, { minHeight: 140, textAlignVertical: "top" }]} multiline value={text} onChangeText={setText} accessibilityLabel="Reminder text" />}
            <Button title="Open in WhatsApp" disabledReason={text ? undefined : "Write the reminder first."}
              onPress={() => Linking.openURL(`https://wa.me/${waNumber(phone) ?? ""}?text=${encodeURIComponent(text)}`).catch(() => Alert.alert("WhatsApp is not installed"))} />
            <Button title="Cancel" variant="outline" onPress={() => setOpen(false)} />
          </ScrollView>
        </ModalFrame>
      </Modal>
    </>
  );
}
