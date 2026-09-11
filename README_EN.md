# @zaofan/dsh-qqbot

An **enhanced fork** of the QQ Bot IM plugin for [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) (dsh): it drives the dsh agent loop with the QQ messaging platform as the frontend protocol, adding a local sticker library, rich media send/recall, scheduled tasks, multi-instance personas, and a visual settings panel.

📦 Repo: [gcry13067381632-jpg/dsh-qqbot](https://github.com/gcry13067381632-jpg/dsh-qqbot) (forked from [tencent-connect/dsh-qqbot](https://github.com/tencent-connect/dsh-qqbot))

[中文文档](./README.md) | English

## 🐋 This fork (enhanced edition)

**In one line**: bring your dsh-powered QQ bot to life — it auto-collects stickers from group chats, picks and sends the right one when the mood hits, speaks up on schedule, and lets you run several bots with different personalities from one computer.

This repo is an enhanced fork of [@tencent-connect/dsh-qqbot](https://github.com/tencent-connect/dsh-qqbot) (changes live outside the upstream source — reinstalling/upgrading upstream will wipe them).

### What she does for you

**🤳 Group images become her sticker library automatically** — saved locally with dedup ("to-sort / favorite / trash"). Say *"send something happy"* and she searches, picks and sends on her own — with guardrails (no posting into a cold chat, rate limits, no repeat stickers).

**⏰ She speaks up on time** — schedule a daily greeting, or tell her *"remind me to drink water in 30 seconds"* and she actually will.

**🧑‍🤝‍🧑 Many bots, many personalities, one computer** — each with its own AppID, persona and working directory (stickers / timers / gates fully isolated). Adding one is a QR scan away in the Web panel.

**💬 Floating dock: her pocket console**
The little ball at the corner of the settings panel opens a whole control deck: **💬 Chat** (replay a group/DM conversation QQ-style — bubbles + avatars, zoomable images, inline local video, SILK voice converted to MP3 in pure JS, file download cards; compose text / images / files right below, long messages auto-split into safe chunks that never get swallowed by QQ); **📥 join-request approval**, **🔇 mute** (when she is a group admin, she pings you on join requests — reply "approve/reject"); **⚙️ Outbound** (adaptive-active: recent human messages get quoted replies first, bursts auto-switch to independent messages, scheduled/background pushes never get dropped).

**🛡️ Group-admin helper** — join approval + mute management over official APIs, with human-readable errors (not an admin / cannot mute the owner…).

**🖥️ No config-file surgery** — reply pacing, sticker gates, scheduled wake-ups, outbound mode and per-bot personas are all in the panel; saving applies live (only adding/removing bots needs a restart). There is even a ✏️ persona editor to tweak her "personality file" right in the browser.

**📦 Clean & lean** — drive image sending / recall from plain text (`[MEDIA:image|path]` / `[RECALL]`); the repo contains no bot credentials or private data.

### 📸 Showcase

Left: the dsh runtime backend — reasoning, tool calls and token usage are fully visible (paired with the `reply_gate` gate tool, the bot decides on its own whether to speak or stay silently idle);
Middle: real QQ group conversation — hide-and-seek role-play, replying when it should and staying quiet when it shouldn't;
Right: sticker-battle in action — the bot answers with stickers from its own library, image and text sent as separate messages.

![Runtime backend log (reasoning & tool calls visible)](docs/showcase-1-log.png)

![QQ group conversation (role-play / self-decided silence)](docs/showcase-2-chat.png)

![Sticker battle (replying with own sticker library)](docs/showcase-3-doutu.png)

### For developers
- Standard tools available inside QQ sessions: `send_media` / `recall_message` / `list_stickers` / `sticker_tag` / `sticker_untagged` / `schedule_timer` / `schedule_cancel` …, routed per bot account.
- **Group admin tools** (`group_join_requests` / `group_approve_join` / `group_mute_state` / `group_mute_member` …): join-request approval and mute management — requires the bot to be a group admin; inside a group session the current group is used, elsewhere the configured `manageGroup` applies. **Never auto-approve: first run `group_join_requests`, report the applicant + verify text to the owner, then act on an explicit "approve/deny" instruction (`group_approve_join`).**
- **Plain text can send media or recall messages**: writing `[MEDIA:image|path-or-url]` in a reply turns it into a real image message (`voice`/`video`/`file` work the same); a lone `[RECALL]` line recalls the bot's own last message.
- **Cross-session messaging**: `session_list` lists all sessions (incl. latent groups); `session_wake(session_id or scope+peer_id, text, send_qq?, media?)` sends a message to a target session/group and wakes its LLM, optionally also delivering to the bound QQ group/private chat (for humans); `media` supports cross-group images.
- **Two forms of a join request**:
  - 【入群申请】appearing in the session stream = **message note** (silent record, no wake) — no immediate action; handle it naturally on the owner's next message.
  - 【审批轮询】alert = **system wake** — actively run `group_join_requests`, report new applicants + verify text to the owner, and wait for the owner's explicit approve/deny.
  - A message containing `@bot` means someone @-ed this bot (`@bot` is yourself).
- Host-level fixes (workspace session attachment, upstream PR #21) are included — idempotent and fully fail-soft.

**What's new in v1.1.4** (user-facing):
- **Join-request dual channel**: live QQ event = 【入群申请】 message note (silent, no wake); polling fallback = 【审批轮询】 system alert (wakes the AI to handle it). Notes land in the group-manager (hub) session; ordinary groups follow the dock switches.
- **Four independent group-admin switches (dock settings)**: 唤醒AI (wake hub-session AI) / 注入群管会话 (hub web note) / 通知普通群 (note the requesting group) / 唤醒普通群AI (wake the requesting group's AI) — effective on both the event and polling paths.
- **Inbound `@bot` long-id cleanup**: the bot's own openid in inbound mentions is shortened to `@bot` (saves tokens); outbound `<@other-openid>` mentions are untouched.
- **Web model changes persist** across restarts (QQ-side overrides take precedence); `/model` lists only the current provider's models.
- **Multi-instance isolation**: sticker stores / timers / gates / history buffers are isolated per instance (`settingsNs`).

> 🛡️ This repo contains **no** bot credentials, sticker data, logs or personal paths (cleaned before publishing). Inject AppID/AppSecret via env vars or the Web panel — **never commit them**.

### Build & deploy

```bash
npm install                 # install deps (peer deps resolved by the dsh host)
node node_modules/typescript/lib/tsc.js -p tsconfig.json   # or npm run build
# then copy dist/ over your dsh profile's
# node_modules/@tencent-connect/dsh-qqbot/dist/ and restart dsh
```

See the upstream "Installation" section below (`dsh plugin add` + QR onboarding both work).

---

## Architecture

```
QQ User → QQ WebSocket → dsh-im-qqbot → ctx.agents → dsh agent loop → LLM
                                 ↑                           │
                                 └── session/event ──────────┘
                                       (assistant reply → QQ sendMarkdown)
```

## Installation

> ⚠️ **Install into the `web` profile** (host of the `dsh web` settings panel); other profiles get a bare
> environment with no settings UI. Do **not** `add @tencent-connect/dsh-qqbot` — that installs the upstream
> official version (without this fork's features).
>
> ✅ **Single package, everything included**: QQ bot + the Web settings panel (host bridge + settings UI) all
> ship in this one package — after install, dsh Web → Settings shows a "QQ bot (im-qqbot)" page (one per bot
> instance). **No separate dsh-qqbot-settings install needed.**

### Method 1 (after npm release): one command

```powershell
npx @deepseek-ai/dsh plugin --profile web add @zaofan/dsh-qqbot
```

> Until it is published to npm, use Method 2 below.

### Method 2: from source (recommended for now)

**Windows (one-click script)**:

```powershell
git clone https://github.com/gcry13067381632-jpg/dsh-qqbot.git
cd dsh-qqbot
.\install.ps1          # npm install/build -> pack -> add tarball -> prints restart steps
```

> If script execution is blocked: `powershell -ExecutionPolicy Bypass -File .\install.ps1`

**macOS / Linux (manual)**:

```bash
git clone https://github.com/gcry13067381632-jpg/dsh-qqbot.git
cd dsh-qqbot
npm install && npm run build
pnpm pack --pack-destination /tmp
npx @deepseek-ai/dsh plugin --profile web add /tmp/zaofan-dsh-qqbot-0.4.0.tgz
```

> 💡 Why a tarball instead of `add <source dir>`? Lessons from real installs:
> ① a directory path containing spaces gets split at the spaces on Windows (pnpm reports `- isn't supported`);
> ② `add <dir>` becomes a pnpm link (junction), so the plugin can't locate the profile by its code location,
> and scanned credentials cannot be persisted (env-var-only fallback).

### Troubleshooting: npm install fails with ERESOLVE (backported from upstream PR #42)

A fresh `npm install` may fail with `ERESOLVE could not resolve`. Cause: peer deps like
`@deepseek-ai/dsh-tools` / `dsh-agent` are still on prerelease (-rc) version lines, and npm 7+
strict resolution rejects non-intersecting combinations. **This is an upstream version-line issue, not a plugin bug.** Two workarounds:

```bash
npm install --legacy-peer-deps     # install-time resolution only; runtime behavior unchanged
# or: install deps, then build & pack manually (peers are resolved by the dsh host)
```

> Tracked: once upstream #37 is fixed and version lines converge, this section can be removed.

### First launch & binding

Start `dsh web`. If credentials are missing, the **QR flow** starts automatically: a QR code is printed in the
terminal → scan it with the QQ mobile app → credentials are saved and survive restarts (you can also use
"QR bind" / edit accounts in the settings panel at any time).

![QR code scan example](./docs/assets/qrcode.png)

> **Note**: Use `0.4.0` or later for browser-link scanning, which avoids QR code misalignment in some terminals.

### Don't have a QQ bot yet? Register one (get AppID / AppSecret)

1. Open the [QQ Open Platform](https://q.qq.com) and sign in with your QQ account;
2. Go to "Bot" → "Create Bot" and fill in name, avatar and description;
3. After creation, copy the **AppID** and **AppSecret** from the bot detail page;
4. Enter them in dsh Web → Settings → "QQ bot" → "Accounts & presets" and save
   (or set env vars `QQBOT_APPID` / `QQBOT_SECRET`);
5. Enable the needed **single-chat / group-chat** message permissions on the platform
   (group chat usually requires a use-case review).

> 💡 Easier: once the bot exists, just use the **QR scan bind** on first launch — no need to type credentials.

### For developers: --patch dev mode

```bash
export QQBOT_APPID="yourAppID" QQBOT_SECRET="yourAppSecret"
npx @deepseek-ai/dsh web --patch /path/to/dsh-qqbot/cordis.dev.yml
```

## Remote approval over QQ (optional)

When an Agent tool needs access **outside the workspace**, dsh raises a permission request. With this
feature on, the bot forwards the request to the **QQ conversation of the task's initiator**, and you
allow/deny right from QQ:

> ⚠️ **DSH permission request**
> Tool: pwsh
> Reason: needs access outside the workspace
>
> Allow this operation: `/approve A1B2C3`
> Deny this operation: `/deny A1B2C3`
> One-time only; auto-denied after 120 s.

**Enable** (either way; takes effect for new requests right after saving, no restart needed):
- **Web settings panel**: Settings → "QQ bot" → ⑤ QQ remote approval → tick it on;
- or add two lines to the instance `config` in `cordis.patch.yml`, then restart:

```yaml
- id: im-qqbot
  config:
    enableApprovals: true          # default false
    approvalTimeoutMs: 120000      # wait window; auto-deny on timeout
```

**Security boundaries**: one-time code; only the **initiator in the same conversation** may decide
(others in a group chat cannot approve even if they see the code); grants only the current operation;
auto-cancelled when the agent is cancelled or dsh exits.

> Idea source: QQ-approval design of wang-22-code/dsh-qqbot-bridge (host dsh `approval/request`
> standard event — the same wiring used by official dsh-acp and the Web approval dialog).

## Configuration

| Config | Type | Default | Description |
|------|------|--------|------|
| `appId` | string | **required** | QQ Bot AppID (or via `QQBOT_APPID` env var) |
| `appSecret` | string | **required** | QQ Bot AppSecret (or via `QQBOT_SECRET` env var) |
| `provider` | string | `deepseek-official` | LLM provider name |
| `model` | string | `deepseek-chat` | Model name |
| `preset` | string | - | Agent preset id |
| `cwd` | string | `process.cwd()` | Agent working directory |
| `requireMention` | boolean | `true` | Whether group messages require @bot to trigger |
| `groupPrompt` | string | - | Extra system prompt for group chats |
| `directPrompt` | string | - | Extra system prompt for direct chats |
| `textChunkLimit` | number | `4500` | Max chars per message |
| `sessionIdleTimeout` | number | `1800000` | Session idle timeout (ms), default 30 min |
| `debug` | boolean | `false` | Debug mode |

## Built-in Commands

| Command | Description |
|------|------|
| `/bot-reset` | Reset the current session (clear context) |
| `/bot-model` | View or switch model |
| `/bot-status` | View current session status |
| `/bot-restart` | Self-restart the dsh host (~4s, auto relaunch) |
| `/botplay` | List assembled interactive events; `/botplay <name>` triggers a keyboard card |
| `/bot-help` | View all commands |

## User Extensions (custom slash commands / QQ tools) (v0.9.8+)

Extensions live under the **account workspace** (never inside the plugin package), so upgrading the plugin never overwrites them.

```
.qqbot-extensions/
├── commands/    # custom slash commands (take effect after /bot-restart)
└── tools/       # custom QQ tools callable by the AI (hot-reload via /tools-reload)
```

**Slash command** (`.qqbot-extensions/commands/hello.mjs`):
```js
export default {
  name: ['hello', '你好'],
  description: 'say hi',
  handler: (ctx) => `👋 hi ${ctx.command.raw || ''}`.trim(),
};
```

**QQ tool** (`.qqbot-extensions/tools/roll_dice.mjs`):
```js
export default {
  name: 'roll_dice',
  description: 'roll an N-sided die',
  inputSchema: { sides: { type: 'integer', description: 'sides, default 6' } }, // optional params: no `required` key
  run: async (args, env) => ({ ok: true, msg: `🎲 ${1 + Math.floor(Math.random() * 6)}` }),
};
```
Then run `/tools-reload` (or ask the AI to call the `tools_reload` tool). Commands need a host restart.

## Core Modules

```
src/
├── index.ts                    # Cordis plugin entry (async apply)
├── config.ts                   # Config schema
├── types.ts                    # Global types
├── setup.ts                    # Credential binding (QR)
├── transport/                  # Transport layer
│   ├── inbound.ts              # QQ inbound message → agent.followup()
│   ├── outbound.ts             # session/event → QQ sendMarkdown
│   ├── outbound-buffer.ts      # Streaming buffer
│   └── chunker.ts              # Markdown chunking
├── session/                    # Session management
│   ├── session-manager.ts      # QQ peer → Agent mapping
│   └── idle-evictor.ts         # Idle eviction
├── model/                      # Model routing
│   ├── model-resolver.ts       # Route resolution
│   ├── prefs-store.ts          # Per-peer preference persistence
│   └── settings-reader.ts      # settings.yaml read-only
├── shared/                     # Shared utilities
│   ├── utils.ts                # Common helpers
│   ├── scope.ts                # scope/peer extraction
│   └── send-helper.ts          # Chunked send
├── commands/                   # Slash commands
└── typings/                    # External module declarations
```

## Session Routing

sessionKey: `qqbot:${appId}:${scope}:${peerId}`, with the SessionId derived deterministically via SHA-256 so sessions survive restarts.

Resolution strategy: in-process reuse → persisted resume → fresh create.

## Design Principles

- **Pure Cordis plugin** — follows the dsh "Plugins, not loop changes" principle
- **Declarative dependencies** — `inject = ['agents']`, no direct coupling to other plugins
- **Session isolation** — one independent Agent per QQ direct user / group
- **Preset support** — mount presets (toolkits, prompts, etc.) via the `agent-presets` service
- **Idle eviction** — auto-dispose Agents on timeout to prevent memory leaks
- **Markdown output** — replies sent as Markdown with code-block/table-aware chunking

## Local Development

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Dev mode (watch)
pnpm dev

# Debug via --patch
export QQBOT_APPID="xxx" QQBOT_SECRET="xxx"
npx @deepseek-ai/dsh web --patch /path/to/dsh-qqbot/cordis.dev.yml
```

## License

[MIT](./LICENSE)
