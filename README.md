# Wildborn

A procedurally evolving 2D survival game (HTML5 Canvas + vanilla JS).

Open `index.html` in a browser — no build step, no frameworks.

## Phase 1 + Living Ecosystem

Seeded world generation, chunked tilemap, movable player, camera follow, and a
living food web: plants, herbivores, and predators that grow, hunt, breed, and die.

### Controls

- **WASD / Arrows** — move
- **F3** — toggle ecosystem debug overlay (population & calorie stats)

### Config

In `src/config.js`:

- `ecosystemEnabled` — master toggle (default `true`)
- `ecosystemTickSeconds` — discrete hunger/growth tick rate
- `ecosystemDebugOverlay` — start with F3 panel open

### Modules

| File | Role |
|------|------|
| `src/plant.js` | Plant species, growth, consume/respawn |
| `src/animal.js` | Herbivores & predators, AI state machine, breeding |
| `src/spatial.js` | Grid spatial hash for nearby queries |
| `src/ecosystem.js` | Spawn populations, tick loop, debug stats |
