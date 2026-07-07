# Analyst benchmark — 2026-07-07T19:07:38.647Z

## clean-green — PASS

**run 1** (15.2s): score=4.8 level=green risk=low
- drivers: "slept 7.6 hours", "heart recovery 4% above your usual", "resting heart rate 1 beat below your usual", "3,200 steps recorded"
- summary: Your signals look steady today, with good sleep and no strain flags showing. This is a good time to stay inside your usual envelope rather than spend the extra steadiness all at once.
- recommendation: This looks like a stable day. Keep the same gentle rhythm: pace the day in blocks, pause before you feel depleted, and treat breaks as part of staying well.
- tags: hrv_pacing, rhr_strain, sleep_quality, energy_envelope, pacing_general · rationale: no flags and steady check-in; anchored at 4.8
**run 2** (14.4s): score=4.8 level=green risk=low
- drivers: "slept 7.6 hours", "heart recovery (HRV) close to usual at 52 ms", "resting heart rate 1 beat below your usual", "activity stayed moderate at 3,200 steps"
- summary: Your signals look stable today: sleep was solid, heart recovery is close to your usual, and your check-in sounds steady. This is a green-light-for-consistency day, not a day to spend all your energy at once.
- recommendation: This looks like a good steady day. Keep the pace even, add small rests before you feel drained, and avoid using the whole envelope just because the signals look calm.
- tags: hrv_pacing, rhr_strain, sleep_quality, energy_envelope, pacing_general · rationale: no wearable strain flags and check-in feels steady; anchored at 4.8.

## mild-hrv-dip — PASS

**run 1** (13.9s): score=3.8 level=yellow risk=medium
- drivers: "heart recovery 17% below your usual", "fatigue felt a bit heavier, 2 out of 5", "slept 7.1 hours", "resting heart rate matched your usual at 62 bpm"
- summary: Your body looks mostly stable, with one caution signal from lower heart recovery and a little extra heaviness. This is not a failure signal — it is a useful cue to pace gently and protect your baseline.
- recommendation: Keep this as a steady but cautious day: choose the essentials, build in rests before fatigue climbs, and aim to stay well within your energy envelope.
- tags: hrv_pacing, energy_envelope, pacing_general · rationale: one mild HRV flag with mild fatigue confirming; anchored at 4.0 and nudged to 3.8.
**run 2** (13.8s): score=3.8 level=yellow risk=medium
- drivers: "heart recovery (HRV) 17% below your usual", "resting heart rate right at your usual 62 beats per minute", "slept 7.1 hours", "fatigue rated 2 out of 5"
- summary: Your stability looks fairly good, with one gentle caution signal: heart recovery is below your usual and you’re feeling a bit heavier than normal. This is a good day to pace conservatively so the mild strain does not build into payback.
- recommendation: Keep a little extra margin today: choose the smaller version of tasks, pause before you feel worn out, and treat rest as part of staying stable rather than falling behind.
- tags: hrv_pacing, energy_envelope, pem_avoidance, pacing_general · rationale: one mild HRV flag with mild fatigue confirmation; anchored at 4 and nudged slightly lower.

## crash-day-red — PASS

**run 1** (15.0s): score=1 level=red risk=high
- drivers: "heart recovery (HRV) 25% below your usual", "5.5 hours of unrefreshing sleep", "you reported a crash today", "kitchen cleaning rated 4 out of 5 effort"
- summary: Your stability is low today. Your body is showing clear strain, and the crash feeling makes this a day to stay well inside your energy envelope rather than testing your limits.
- recommendation: Make this a recovery-protection day: essentials only, with long rests before symptoms build. If something cannot wait, do it in very small pieces and stop well before you feel spent; rest is part of healing, not a setback.
- topTrigger: cleaning the kitchen
- tags: hrv_pacing, sleep_quality, energy_envelope, pem_avoidance, pacing_general · rationale: Strong HRV and sleep flags plus reported PEM and high-effort kitchen cleaning; anchored at 1.0.
**run 2** (13.6s): score=1 level=red risk=high
- drivers: "crash symptoms rated 4 out of 5", "heart recovery 25% below your usual", "5.5 hours of unrefreshing sleep", "cleaned the kitchen at 4 out of 5 effort"
- summary: Your body is showing clear strain today, with a crash reported, low heart recovery, and unrefreshing sleep. A lower score is information, not a failure — it is a cue to stay well inside your energy envelope.
- recommendation: Treat this as a recovery-protection day: keep tasks tiny, add rest before you feel spent, and let anything non-urgent wait. Rest is part of healing, not a failure.
- topTrigger: cleaned the kitchen
- tags: hrv_pacing, sleep_quality, energy_envelope, pem_avoidance, pacing_general · rationale: Strong HRV and sleep flags plus reported PEM; anchored at 1.0.

## rhr-strong — PASS

**run 1** (15.3s): score=3.2 level=yellow risk=medium
- drivers: "body strain: resting heart rate 10 beats above your usual", "steady sleep: slept 7.2 hours", "heart recovery (HRV) within 2% of your usual"
- summary: Your stability looks moderate today. The main caution is your resting heart rate running 10 beats above your usual, while sleep and heart recovery look steady; use this as a go-gentle cue, not a setback.
- recommendation: Keep plans simple and leave extra recovery space. Aim for the easier version of each task, pause before you feel drained, and treat rest as part of staying steady.
- tags: rhr_strain, energy_envelope, pacing_general · rationale: one strong resting heart rate flag with otherwise steady sleep and HRV; anchored at 3.2
**run 2** (23.6s): score=3.2 level=yellow risk=medium
- drivers: "body strain: resting heart rate 10 beats above your usual", "slept 7.2 hours, which adds some buffer", "energy check-in was 3 out of 5"
- summary: This is a go-gentle read, not a failure. Your resting heart rate is clearly above your usual, so your body may have less room for strain today even though sleep looked supportive.
- recommendation: Keep today light and predictable: choose the essentials, build in rests before and after tasks, and stop while you still have some energy in reserve.
- topTrigger: elevated resting heart rate
- tags: rhr_strain, energy_envelope, pem_avoidance, pacing_general · rationale: one strong resting heart rate flag with otherwise steady sleep and HRV; anchored at 3.2

## conflict-optimist — PASS

**run 1** (17.7s): score=1.8 level=red risk=high
- drivers: "heart recovery (HRV) 22% below your usual", "slept only 4.5 hours", "no fatigue or brain fog reported today"
- summary: Your check-in feels encouraging, but your body signals are asking for care today. A low score is not a failure — it is useful information to help you stay well inside your limits.
- recommendation: Even though you feel clear and full of plans, treat this as a small-envelope day: choose the essentials, build in quiet rests before you feel tired, and leave extra space so today does not cost you later.
- topTrigger: short sleep and low recovery
- tags: hrv_pacing, sleep_quality, energy_envelope, pem_avoidance, pacing_general · rationale: two strong wearable flags; symptoms are reassuring but anchor remains low at 1.6 with only a small nudge
**run 2** (14.6s): score=1.8 level=red risk=high
- drivers: "heart recovery (HRV) 22% below your usual", "slept only 4.5 hours", "fatigue rated 0 out of 5 today"
- summary: You feel well and clear-headed, which is a real positive. At the same time, your overnight signals suggest your system may have less buffer today, so this low score is a pacing cue — not a failure.
- recommendation: Keep plans very small and build in rest before you feel tired. If you still feel good, use that as a chance to bank energy rather than spend it all today.
- topTrigger: short sleep plus low recovery
- tags: hrv_pacing, sleep_quality, energy_envelope, pem_avoidance, pacing_general · rationale: Two strong flags anchor at 1.6; symptom check-in is good but wearables keep this a low-envelope day.

## conflict-pessimist — PASS

**run 1** (24.4s): score=2.3 level=red risk=high
- drivers: "energy check-in was 1 out of 5", "fatigue rated 5 out of 5", "aching all over rated 4 out of 5", "brain fog rated 4 out of 5"
- summary: Your overnight signals look steady, but your check-in says your body is under heavy load: completely drained, aching, and foggy. This lower score is information to help protect your baseline, not a failure.
- recommendation: Make this a low-capacity day: keep only the essentials, break anything necessary into very small pieces, and rest before you feel worse. Rest is protective today, not a setback.
- tags: energy_envelope, pem_avoidance, pacing_general · rationale: No wearable flags, but severe fatigue, pain, brain fog and energy 1/5 justify lowering from the 4.8 anchor to 2.3.
**run 2** (15.1s): score=2.4 level=red risk=high
- drivers: "fatigue rated 5 out of 5", "aching pain rated 4 out of 5", "brain fog rated 4 out of 5", "sleep was 7.4 hours"
- summary: Your overnight signals look steady, but your check-in says your body feels heavily loaded right now. This score is a gentle cue to shrink the day and stay well inside your energy envelope.
- recommendation: Treat this as a very low-demand day. Keep tasks small, build in rest before you feel worse, and choose the version of the day that protects your baseline. Rest today is a pacing tool, not a setback.
- tags: energy_envelope, pem_avoidance, pacing_general · rationale: wearables are stable at 4.8, but severe fatigue, pain, brain fog, and energy 1 justify a conservative lower score.

## severity-zero-day — PASS

**run 1** (14.8s): score=4.8 level=green risk=low
- drivers: "slept 7.9 hours", "heart recovery (HRV) 53 ms, close to your usual 50 ms", "resting heart rate 2 beats below your usual", "fatigue, brain fog, and pain not present today"
- summary: Your signals look stable today, with solid sleep, steady heart data, and no tracked symptoms reported. A higher score is a green light for normal pacing — not a cue to overfill the day.
- recommendation: This looks like a steadier day. Keep a gentle rhythm anyway: take breaks before you feel drained, and avoid using the good signal to spend tomorrow’s energy today.
- tags: hrv_pacing, rhr_strain, sleep_quality, energy_envelope, pacing_general · rationale: no wearable flags and symptoms absent; anchored at 4.8
**run 2** (14.7s): score=4.8 level=green risk=low
- drivers: "slept 7.9 hours", "resting heart rate 2 bpm below your usual", "heart recovery near your usual", "no fatigue, brain fog, or pain reported"
- summary: Your signals look stable today. Sleep was solid, resting heart rate is not showing strain, and your check-in did not report fatigue, brain fog, or pain — a good sign, not a test to do more.
- recommendation: Use this steadier signal to keep things gentle and consistent, not to spend extra energy. Aim for planned rests and stop before you feel depleted so today supports your baseline.
- tags: hrv_pacing, rhr_strain, sleep_quality, energy_envelope, pacing_general · rationale: No wearable flags and symptoms absent; anchored at 4.8.

## sparse-no-wearables — PASS

**run 1** (14.7s): score=3.1 level=yellow risk=medium
- drivers: "fatigue rated 3 out of 5", "energy check-in was 2 out of 5"
- summary: Your read is based mostly on how you felt today because the wearable signals were not available. Feeling pretty tired with low energy suggests a smaller energy envelope, so a gentler pace is the safest choice.
- recommendation: Make this a gentle pacing day: keep tasks small, rest before you feel drained, and treat breaks as part of protecting your baseline.
- tags: energy_envelope, pacing_general · rationale: No wearable anchor available; moderate fatigue and low energy check-in support a conservative 3.1.
**run 2** (16.0s): score=3 level=yellow risk=medium
- drivers: "fatigue rated 3 out of 5", "energy check-in was 2 out of 5", "no heart or sleep recovery data today"
- summary: You’re showing a cautious stability read today: the main signal is that you felt pretty tired, with low energy reported. With no wearable recovery data to balance that, it makes sense to keep your day well inside your energy envelope.
- recommendation: Treat this as a lighter-capacity day. Choose the essentials, build in quiet breaks before you feel drained, and let rest count as useful care rather than lost time.
- tags: energy_envelope, pacing_general · rationale: No wearable anchor available; moderate fatigue and low energy check-in support a cautious score around 3.0.

## cumulative-load — PASS

**run 1** (24.5s): score=4 level=green risk=low
- drivers: "heart recovery (HRV) 51 ms, near your 50 ms usual", "resting heart rate 1 bpm below your usual", "slept a steady 7.3 hours", "two above-usual activity days in a row"
- summary: Your body signals look fairly steady today: sleep, heart recovery, and resting heart rate are all in your usual range. The main caution is the recent run of higher activity, so this is a stable day with a good reason to pace gently.
- recommendation: Treat this as a steady but protective day. Keep plans comfortably inside your envelope, add breaks before you feel drained, and let the two recent higher-activity days settle before taking on more.
- topTrigger: two higher-activity days
- tags: hrv_pacing, rhr_strain, sleep_quality, energy_envelope, pem_avoidance, pacing_general · rationale: Cumulative load flag only, with heart signals and sleep in range; anchored at 4.0.
**run 2** (12.1s): score=4 level=green risk=low
- drivers: "recent higher activity: 5,200 then 4,900 steps", "slept 7.3 hours", "heart recovery (HRV) 2% above your usual", "resting pulse 1 beat below your usual"
- summary: Your score looks fairly stable today. The main caution is recent activity load, not your overnight body signals, so this is a good day to stay comfortably inside your envelope.
- recommendation: Keep today steady rather than adding more. Your overnight signals look stable, so the main pacing move is to leave a cushion after two higher-activity days and take rest before you feel drained.
- topTrigger: recent higher activity
- tags: energy_envelope, pem_avoidance, pacing_general · rationale: cumulative activity load flag only; wearables steady and no PEM reported, anchored at 4.0

## crash-day-de — PASS

**run 1** (19.4s): score=1 level=red risk=high
- drivers: "Herzerholung 24 % unter deinem Üblichen", "Ruhepuls 6 Schläge über deinem Üblichen", "nur 5,2 Stunden unerholsamer Schlaf", "Crash heute gemeldet"
- summary: Dein Stabilitätswert liegt heute bei 1,0. Das passt zu einem klaren Go-ganz-sanft-Tag: Der Küchenputz von gestern scheint dich eingeholt zu haben, und die Körpersignale zeigen wenig Reserve. Es ist außerdem der dritte Tag in Folge unter 3 — nimm das als Hinweis zum Schützen deiner Energie, nicht als Fehler.
- recommendation: Heute zählt Stabilisieren: plane nur das Nötigste, mit Pausen bevor du müde wirst, und halte alles so reiz- und kraftsparend wie möglich. Wenn etwas warten kann, darf es warten — Ruhe ist hier aktive Erholung, kein Rückschritt.
- topTrigger: Küche geputzt
- tags: hrv_pacing, rhr_strain, sleep_quality, pem_avoidance, energy_envelope, pacing_general · rationale: fallback score 1.0 from strong HRV and sleep flags plus mild RHR and reported PEM after household exertion.
**run 2** (14.9s): score=1 level=red risk=high
- drivers: "Herzerholung 24 % unter deinem Üblichen", "Ruhepuls 6 Schläge über deinem Üblichen", "nur 5,2 Stunden, nicht erholsam geschlafen", "Crash heute gemeldet"
- summary: Dein Stabilitätswert ist heute sehr niedrig. Die Signale zeigen klare Belastung: niedrige Herzerholung, erhöhter Ruhepuls, eine kurze nicht erholsame Nacht und ein Crash nach dem Küchenputzen. Das ist jetzt der dritte Tag in Folge unter 3 — ein guter Moment, den Energie-Rahmen bewusst klein zu halten.
- recommendation: Halte den Tag so reizarm und klein wie möglich: nur das Nötigste, früh Pausen einbauen und Aufgaben verschieben, die nicht dringend sind. Ruhe ist heute aktive Stabilisierung, nicht Rückschritt.
- topTrigger: Küche geputzt
- tags: hrv_pacing, rhr_strain, sleep_quality, energy_envelope, pem_avoidance, pacing_general · rationale: Two strong wearable flags plus mild elevated RHR and reported PEM; anchored at fallback score 1.0.
