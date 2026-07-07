import { useState } from "react";

import { FormCheckIn } from "@/components/form-check-in";
import { VoiceCheckIn } from "@/components/voice-check-in";

export default function HomeScreen() {
  const [form, setForm] = useState(false);
  return form ? (
    <FormCheckIn onDone={() => setForm(false)} onCancel={() => setForm(false)} />
  ) : (
    <VoiceCheckIn onSwitchToForm={() => setForm(true)} />
  );
}
