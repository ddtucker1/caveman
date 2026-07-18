# Wildborn

A procedurally evolving 2D survival game (HTML5 Canvas + vanilla JS), packaged as a
**standalone desktop app** via Electron.

## Performance note

Moving the game out of the browser into Electron **does not dramatically raise FPS by itself**.
Electron still runs the same JavaScript and Canvas 2D renderer (Chromium). The FPS drop
as animal counts grow comes from simulation cost (A\* pathfinding, per-animal AI) and
Canvas draw work — not from browser chrome.

This build therefore also includes gameplay/engine caps that *do* protect frame rate:

- Soft animal population cap (`maxAnimals`, default 120)
- Distance-based simulation LOD (far animals update less often)
- Per-frame A\* pathfinding budget + binary-heap pathfinder
- Cheaper spatial-grid rebuilds and throttled minimap entity dots

## Run as a desktop app

```bash
npm install
npm start
```

Optional packaged builds (AppImage / portable / dmg):

```bash
npm run dist
```

## Run in a browser (still supported)

Open `index.html` in a browser — no build step required for the game scripts themselves.

## Phase 1 + Living Ecosystem

Seeded world generation, chunked tilemap, movable player, camera follow, and a
living food web: plants, herbivores, and predators that grow, hunt, breed, and die.

Entities use **data-driven geometric silhouettes** (`src/shapes.json` /
`src/shapes.js`) so each species is recognizable at a glance without image assets.

### Controls

- **WASD / Arrows** — move
- **Tab** — toggle Ecosystem Census (also via top-right Census button)
- **L** — toggle species legend (icons, names, live population counts)
- **F3** — toggle ecosystem debug overlay (population & calorie stats)
- **Hover** — entity tooltip (species, calories, state)

### Config

In `src/config.js`:

- `mapTiles` — fixed playable map size (default `400` → 12800×12800 px)
- `ecosystemEnabled` — master toggle (default `true`)
- `ecosystemTickSeconds` — discrete hunger/growth tick rate
- `maxAnimals` — soft population cap (breeding stops at this living count)
- `simLodNearPx` / `simLodFarEveryN` — simulation LOD around the player
- `pathfindMaxNodes` / `pathfindBudgetPerFrame` — A\* cost controls
- `minimapEntityInterval` — how often minimap entity dots refresh
- `ecosystemDebugOverlay` — start with F3 panel open
- `showLegend` — start with L legend open
- `showCensus` — start with Ecosystem Census open

### Tests

```bash
npm test
```

### Visual tweaks

Edit `src/shapes.json` (mirrored in `src/shapes.js` for sync script loading) to
change colors, sizes, and calorie thresholds without touching render code.
All sprites draw through `Wildborn.renderShapes.renderShape(ctx, entityType, x, y, scale, facingRight, opts)`.

### Modules

| File | Role |
|------|------|
| `electron/main.js` | Desktop window shell (Electron) |
| `src/plant.js` | Plant species, growth, consume/respawn |
| `src/animal.js` | Herbivores & predators, AI state machine, breeding |
| `src/spatial.js` | Grid spatial hash for nearby queries |
| `src/ecosystem.js` | Spawn populations, tick loop, debug stats |
| `src/pathfind.js` | Grid A\* (binary heap, budget-aware) |
| `src/shapes.js` / `shapes.json` | Data-driven silhouette colors & sizes |
| `src/renderShapes.js` | `renderShape()` geometric sprite drawer |
| `src/render.js` | World tiles, ecosystem draw, legend, tooltips |
