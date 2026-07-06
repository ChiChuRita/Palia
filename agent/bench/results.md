# Voice pipeline benchmark — 2026-07-06T10:20Z

Median of 5 runs per cell. Judge: gpt-5.5.

## LLM candidates

| Model                  | TTFT en | TTFT de | Total en | Total de | Tools | Brevity | 1-Question | Warmth | Mirroring | Safety | Overall |
| ---------------------- | ------- | ------- | -------- | -------- | ----- | ------- | ---------- | ------ | --------- | ------ | ------- |
| gpt-5.4-mini (minimal) | 1144ms  | 1049ms  | 1282ms   | 1193ms   | 9/9   | 9.8     | 10.0       | 6.7    | 5.8       | 9.8    | 6.8     |
| gpt-5.4-mini (low)     | 1100ms  | 1119ms  | 1261ms   | 1255ms   | 9/9   | 9.5     | 10.0       | 7.7    | 5.7       | 9.8    | 7.7     |
| gpt-5.4 (minimal)      | 1062ms  | 1079ms  | 1327ms   | 1331ms   | 9/9   | 9.8     | 10.0       | 7.5    | 5.7       | 9.8    | 7.3     |
| gpt-5.2 (minimal)      | 839ms   | 1319ms  | 1186ms   | 1467ms   | 9/9   | 9.2     | 10.0       | 8.0    | 7.7       | 10.0   | 7.8     |
| gpt-5.1-chat-latest    | 604ms   | 567ms   | 844ms    | 815ms    | 8/9   | 10.0    | 10.0       | 8.0    | 6.7       | 10.0   | 8.2     |
| gpt-4.1-mini           | 816ms   | 632ms   | 1129ms   | 1088ms   | 9/9   | 5.7     | 7.2        | 7.0    | 5.8       | 9.8    | 6.3     |

Tool-check failures:

- gpt-5.1-chat-latest: correction-en: called record_symptom

## STT (batch wall-time — streaming will be faster; ranks models relatively)

| Model                  | en time | en WER | de time | de WER |
| ---------------------- | ------- | ------ | ------- | ------ |
| gpt-4o-transcribe      | 819ms   | 0.0%   | 803ms   | 0.0%   |
| gpt-4o-mini-transcribe | 623ms   | 0.0%   | 541ms   | 0.0%   |
| whisper-1              | 766ms   | 0.0%   | 1365ms  | 0.0%   |

## TTS (gpt-4o-mini-tts)

| Voice | Locale | Length | TTFB   | Total  |
| ----- | ------ | ------ | ------ | ------ |
| marin | en     | short  | 970ms  | 1129ms |
| marin | en     | long   | 1004ms | 1476ms |
| marin | de     | short  | 891ms  | 1086ms |
| marin | de     | long   | 1565ms | 2106ms |
| sage  | en     | short  | 885ms  | 1278ms |
| sage  | en     | long   | 874ms  | 1562ms |
| sage  | de     | short  | 930ms  | 1403ms |
| sage  | de     | long   | 867ms  | 1831ms |

## Sample replies (what the judge scored)

**greeting-reply-en** — user: "Honestly pretty wiped out today."

- gpt-5.4-mini (minimal): "That sounds really wiped out today, is it worse than usual?"
- gpt-5.4-mini (low): "That sounds really heavy today; is the fatigue worse than usual?"
- gpt-5.4 (minimal): "That sounds really wiped out; is the wiped out feeling heavy or more shaky?"
- gpt-5.2 (minimal): "That wiped out feeling sounds heavy today; is anything making it worse right now?"
- gpt-5.1-chat-latest: "Sounds like that wiped‑out feeling is weighing on you today, yeah?"
- gpt-4.1-mini: "Feeling wiped out can be tough, I'm here with you. Is the fatigue worse than usual?"

**symptom-followup-en** — user: "Yeah, it's bad. I keep losing my train of thought mid-sentence."

- gpt-5.4-mini (minimal): "That sounds so frustrating; is anything else feeling harder right now?"
- gpt-5.4-mini (low): "That sounds really hard; does the fog feel worse than yesterday?"
- gpt-5.4 (minimal): "That bad fog sounds really hard, when did it feel strongest today?"
- gpt-5.2 (minimal): "That sounds really rough, does the fog feel constant or come in waves?"
- gpt-5.1-chat-latest: "That kind of train‑of‑thought fog can feel so disorienting, yeah?"
- gpt-4.1-mini: "Losing your train of thought sounds really tough; do you feel this fog all day?"

**off-topic-en** — user: "Can you tell me what the weather will be like tomorrow?"

- gpt-5.4-mini (minimal): "How are you feeling right now?"
- gpt-5.4-mini (low): "What’s your energy feeling like right now?"
- gpt-5.4 (minimal): "How is your body feeling today?"
- gpt-5.2 (minimal): "How are you feeling in your body today, just for a moment?"
- gpt-5.1-chat-latest: "I’m here for you, but how’s your body feeling today?"
- gpt-4.1-mini: "I’m here to check in on how you’re feeling today—how’s your energy right now?"

**greeting-reply-de** — user: "Ehrlich gesagt ziemlich erschöpft heute."

- gpt-5.4-mini (minimal): "Das klingt nach viel Erschöpfung; ist es eher stark oder mittel?"
- gpt-5.4-mini (low): "Das klingt nach viel Erschöpfung. Was fühlt sich gerade am schwersten an?"
- gpt-5.4 (minimal): "Ziemlich erschöpft heute—ist es eher schwer oder eher leer?"
- gpt-5.2 (minimal): "Ziemlich erschöpft heute klingt schwer; ist es eher Körper oder Kopf?"
- gpt-5.1-chat-latest: "Dieser starke Erschöpfungszug klingt schwer, magst du erzählen, wie er sich gerade anfühlt?"
- gpt-4.1-mini: "Diese Erschöpfung fühlt sich wie ein schwerer Nebel an, oder? Wie stark ist der Nebel auf einer Skala von 0 bis 5?"

**symptom-followup-de** — user: "Ja, ziemlich. Ich verliere mitten im Satz den Faden."

- gpt-5.4-mini (minimal): "Der Faden reißt gerade oft, was macht der Nebel noch mit dir?"
- gpt-5.4-mini (low): "Das klingt ziemlich schwer, und der Faden reißt oft—stimmt das?"
- gpt-5.4 (minimal): "Das klingt nach starkem Fadenverlust im Nebel; brauchst du heute viel Ruhe?"
- gpt-5.2 (minimal): "Der Nebel klingt ziemlich dicht, wenn dir mitten im Satz der Faden reißt—was wäre jetzt am leichtesten?"
- gpt-5.1-chat-latest: "Dieses Faden‑Verlieren klingt nach dichtem Nebel heute, magst du sagen wie sich das anfühlt?"
- gpt-4.1-mini: "Dieser Nebel fühlt sich schwer an, oder? Wie ist deine Energie heute?"

**off-topic-de** — user: "Kannst du mir sagen, wie das Wetter morgen wird?"

- gpt-5.4-mini (minimal): "Wie fühlt sich dein Körper gerade an?"
- gpt-5.4-mini (low): "Und wie fühlt sich dein Körper heute an?"
- gpt-5.4 (minimal): "Ich bleibe kurz bei dir: Wie fühlt sich dein Körper gerade an?"
- gpt-5.2 (minimal): "Bevor wir aufs Wetter gehen: Wie fühlt sich dein Körper gerade an?"
- gpt-5.1-chat-latest: "Lass uns kurz zu dir zurückkommen, wie fühlt sich dein Tag gerade an?"
- gpt-4.1-mini: "Ich höre, du möchtest über dein Befinden sprechen, nicht das Wetter. Wie fühlst du dich heute?"

## Estimated pipeline turn latency (STT batch + LLM TTFT + TTS TTFB, en)

| LLM                    | + gpt-4o-transcribe | + whisper-1 |
| ---------------------- | ------------------- | ----------- |
| gpt-5.4-mini (minimal) | 2933ms              | 2881ms      |
| gpt-5.4-mini (low)     | 2890ms              | 2837ms      |
| gpt-5.4 (minimal)      | 2851ms              | 2798ms      |
| gpt-5.2 (minimal)      | 2628ms              | 2575ms      |
| gpt-5.1-chat-latest    | 2394ms              | 2341ms      |
| gpt-4.1-mini           | 2605ms              | 2552ms      |
