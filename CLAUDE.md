# NovaUniverse

## What this is
Phaser→Three.js 3D world explorer for a DeFi AI agent swarm.
Live backend at https://enthusiastic-respect-production-3521.up.railway.app/api

## Stack
- Three.js (3D world)
- Vite + TypeScript
- Kenney CC0 GLB assets in public/kenney/models/
- Custom Blender assets in public/kenney/models/custom/

## Commands
- `npm run dev` — dev server port 5174
- `npm run build` — production build (must pass zero TS errors)
- `npm run build:assets` — regenerate Blender GLBs

## Key files
- src/world/World3D.ts — Three.js scene, camera, all 3D objects
- src/world/WeatherSystem.ts — day/night cycle, rain, lightning
- src/world/CollisionWorld.ts — AABB collision
- src/world/ZoneLayout.ts — building placement grid
- src/agents/AgentObject3D.ts — NPC characters
- src/config/constants.ts — zones, agents, action mappings
- src/ui/HUD.ts — DOM overlay

## Zones
8 zones on a 2400×1800 grid, each with a distinct identity colour.
Zone coords convert to Three.js: worldX = (px/2400)*24-12

## Current issues
- WeatherSystem goes black at night — ambient floor not working
- Buildings still escaping zone boundaries in some cases