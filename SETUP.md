# MECFS — local dev setup

This is the runbook to get the voice loop working end-to-end. It assumes the code scaffold is already in place.

## TL;DR — once everything is set up

```sh
# first time only — builds the iOS dev client
npm run ios:rebuild

# every other day — starts Convex + agent worker + Expo metro in one terminal
npm run dev
```

Then open the iOS app on your device/simulator and tap **Start**.

The full runbook below walks through the one-time setup that has to happen before `npm run dev` works.

## 1. LiveKit Cloud project

1. Create an account at <https://cloud.livekit.io>, create a project in an **EU region** (Frankfurt).
2. From the project's **Settings → Keys** page, copy:
   - `LIVEKIT_URL` (e.g. `wss://your-project.livekit.cloud`)
   - `LIVEKIT_API_KEY`
   - `LIVEKIT_API_SECRET`

## 2. Convex env vars

Generate a strong random shared secret for agent ↔ Convex auth:

```sh
openssl rand -hex 32
```

Set the env vars on your Convex dev deployment (`tidy-blackbird-755` per `.env.local`):

```sh
npx convex env set LIVEKIT_URL wss://your-project.livekit.cloud
npx convex env set LIVEKIT_API_KEY <key>
npx convex env set LIVEKIT_API_SECRET <secret>
npx convex env set AGENT_SHARED_SECRET <random-hex>
```

Your Convex HTTP endpoint base is your deployment's `.convex.site` URL. For an EU deployment this is e.g. `https://tidy-blackbird-755.eu-west-1.convex.site` — check your `.env.local` for the actual region segment in `EXPO_PUBLIC_CONVEX_SITE_URL`. You'll pass this to the agent below.

The Convex dev process pushes function changes as you edit. It's normally launched as part of `npm run dev` (see TL;DR), but you can also run it on its own:

```sh
npx convex dev
```

## 3. iOS dev build

The LiveKit RN SDK needs a custom dev client; Expo Go won't work. Build it once:

```sh
npm run ios:rebuild
```

This runs `expo prebuild --platform ios --clean && expo run:ios`. Takes ~5 min on first run. After that, JS changes hot-reload via `npm run dev`. You only need to re-run `ios:rebuild` when you add a native module or change `app.json` plugins.

## 4. LiveKit CLI

Install the LiveKit CLI:

```sh
brew install livekit-cli
lk cloud auth
```

`lk cloud auth` opens a browser for OAuth login to your LiveKit project.

## 5. Agent worker — one-time prep

```sh
cd agent
npm install

# fill in agent/.env from .env.example
cp .env.example .env
# edit: LIVEKIT_* (same values), OPENAI_API_KEY, CONVEX_HTTP_URL, AGENT_SHARED_SECRET
```

Once `.env` is filled in, the worker launches as part of the root `npm run dev` (the `dev:agent` sub-script does `npm --prefix agent run dev`). You should see logs like `registered worker` and `connected to LiveKit server` in the `agent` colored output.

## 6. Try the loop

1. Run `npm run dev` from the repo root — starts Convex + agent + Expo metro concurrently with labeled colored logs.
2. Open the app on your phone/simulator.
3. Tap **Start**. Within ~3 seconds you should hear "Hi. I'm here. How are you doing right now?"
4. Have a 30–60 s conversation. Mention a symptom ("brain fog") and an activity ("walked to the kitchen").
5. Tap **End** or let the agent close naturally.
6. Open the Convex dashboard → tables `sessions`, `transcriptMessages`, `symptoms`, `activities`. You should see new rows.

## 7. Deploy the agent to LiveKit Cloud

```sh
cd agent
# Create the agent record on LiveKit Cloud (first time only).
# Pass the same secrets your local .env has.
lk agent create --secrets-file .env

# Subsequent deploys just push a new image:
lk agent deploy
```

LiveKit Cloud auto-injects `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` for the deployed agent — you do NOT need to set those, but `OPENAI_API_KEY`, `CONVEX_HTTP_URL`, and `AGENT_SHARED_SECRET` must be in `--secrets-file` or `--secrets`.

After deploy, stop your local `npm run dev`. Test the loop again from the app — dispatch now goes to the cloud-hosted agent automatically. Tail logs with `lk agent logs`.

## Troubleshooting

- **Agent never joins the room** — confirm the worker is running (look at the `agent` colored output from `npm run dev`, or `lk agent logs` if you deployed). Check the worker logs. Confirm `LIVEKIT_URL` matches across Convex and the agent.
- **App connects but no audio either direction** — confirm microphone permission was granted on the iOS device. In simulator, mic input doesn't always work; test on a real device.
- **Convex action throws "LiveKit env vars missing"** — re-run `npx convex env set …` and re-run `npx convex dev`.
- **Agent tones too peppy** — try `voice: "sage"` or `"shimmer"` in `agent/src/index.ts`, or lower `temperature` to 0.6.
- **Brain-fog pauses get cut off** — bump `silence_duration_ms` to 1800–2000 in `agent/src/index.ts`.

## Out of scope for this scaffold

- Real HealthKit (currently `get_health_context` returns stubbed data)
- Today view / energy envelope UI
- Auth (single anonymous deviceId is the user)
- Doctor PDF export
- EU data residency for OpenAI (acceptable for prototype; required before production)
- Android
