# Wildborn

A procedurally evolving 2D survival game (HTML5 Canvas + vanilla JS).

Open `index.html` in a browser — no build step, no frameworks.

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
- `ecosystemDebugOverlay` — start with F3 panel open
- `showLegend` — start with L legend open
- `showCensus` — start with Ecosystem Census open

### Visual tweaks

Edit `src/shapes.json` (mirrored in `src/shapes.js` for sync script loading) to
change colors, sizes, and calorie thresholds without touching render code.
All sprites draw through `Wildborn.renderShapes.renderShape(ctx, entityType, x, y, scale, facingRight, opts)`.

### Modules

| File | Role |
|------|------|
| `src/plant.js` | Plant species, growth, consume/respawn |
| `src/animal.js` | Herbivores & predators, AI state machine, breeding |
| `src/spatial.js` | Grid spatial hash for nearby queries |
| `src/ecosystem.js` | Spawn populations, tick loop, debug stats |
| `src/shapes.js` / `shapes.json` | Data-driven silhouette colors & sizes |
| `src/renderShapes.js` | `renderShape()` geometric sprite drawer |
| `src/render.js` | World tiles, ecosystem draw, legend, tooltips |
