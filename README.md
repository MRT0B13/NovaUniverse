# Nova Universe

**The living world explorer for the NovaOS agent swarm.**

Watch your AI agents move through a real-time pixel world as they execute DeFi strategies, detect signals, launch tokens, and guard against rugs — every on-chain action becomes a visible moment in the world.

---

## Architecture

```
NovaOS (Railway)          NovaVerse (Base44)       NovaUniverse (this)
─────────────────         ─────────────────        ────────────────────
PostgreSQL                Dashboard UI             Phaser 3 world
API (:8787)          →    7-page app               Phaser reads from
/api/universe/*     →    ← shares same API        NovaOS API
WS /api/ws/live     →    ← same JWT auth          WS + polling fallback
```

**Same Postgres. Same JWT auth. New visual layer.**

---

## Zones

| Zone | Protocol | Default Agent |
|------|----------|---------------|
| Trading Floor | Orca LP · Hyperliquid · Kamino | nova-cfo |
| Intel Hub | KOL tracking · Alpha feed | nova-scout |
| Watchtower | RugCheck · Risk monitor | nova-guardian |
| Command Center | Swarm orchestration | nova-supervisor |
| Launchpad | pump.fun · Token factory | nova-launcher |
| Agora | Community · Governance | nova-community |
| Orca Pool | CLMM LP positions | nova-cfo |
| Burn Furnace | Token burns · Credits | – |

---

## Setup

```bash
# Clone
git clone https://github.com/MRT0B13/NovaUniverse
cd NovaUniverse

# Install
npm install

# Config
cp .env.example .env.local
# Edit VITE_API_URL if needed

# Dev
npm run dev        # → http://localhost:5174

# Build
npm run build
```

---

## NovaOS Backend Changes

Two files added to NovaOS:

```
src/api/routes/universe.ts    ← new routes (registered in index.ts)
sql/007_universe_feed_events.sql   ← optional feed_events table
```

### New API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/universe/world-state` | All agents + current zone + last action |
| GET | `/api/universe/zones` | Zone definitions + agent counts |
| GET | `/api/universe/events?limit=50` | Recent events for replay on load |
| POST | `/api/universe/event` | Push event from agent (internal) |

All endpoints use existing JWT auth (`Authorization: Bearer <token>`).

---

## Railway Deploy

1. Create new Railway service → connect `MRT0B13/NovaUniverse` repo
2. Set build command: `npm run build`
3. Set start command: `npx serve dist -p $PORT`
4. Add env var: `VITE_API_URL=https://enthusiastic-respect-production-3521.up.railway.app/api`
5. (Optional) custom domain: `universe.nova-agent.io`

---

## Project Structure

```
src/
├── config/
│   └── constants.ts      ← zones, agents, action→zone map, colours
├── agents/
│   └── AgentSprite.ts    ← Phaser sprite per agent
├── events/
│   └── EventClient.ts    ← WS + polling fallback
├── ui/
│   └── HUD.ts            ← DOM HUD (stats, feed, tooltip)
├── utils/
│   └── auth.ts           ← nonce/sign/JWT
├── world/
│   └── WorldScene.ts     ← main Phaser scene
└── main.ts               ← entry point
```

---

## Roadmap

- [ ] Pixel sprite sheets (replace coloured rectangles with real sprites)
- [ ] Isometric view toggle (top-down ↔ isometric)
- [ ] Transaction scrubber — scrub back through historical tx timeline
- [ ] Agent chat bubbles on-click (last 5 messages)
- [ ] Zone drill-down — click Orca Pool → see live LP positions
- [ ] Multi-wallet support (view other agents' worlds)
- [ ] Public "Universe Explorer" mode (read-only, no auth required)
