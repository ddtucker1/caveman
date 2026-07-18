/**
 * Headless smoke test for the living ecosystem.
 * Run: node test/ecosystem-smoke.js
 */
const path = require('path');
const fs = require('fs');

// Load modules in dependency order (same as index.html)
const root = path.join(__dirname, '..');
const files = [
  'src/config.js',
  'src/rng.js',
  'src/world.js',
  'src/spatial.js',
  'src/plant.js',
  'src/animal.js',
  'src/ecosystem.js',
];

for (const f of files) {
  const code = fs.readFileSync(path.join(root, f), 'utf8');
  // eslint-disable-next-line no-eval
  eval(code);
}

const { createRng } = Wildborn.rng;
const { createWorld, TILE_SIZE } = Wildborn.world;
const { createEcosystem, INITIAL_PLANT_COUNT } = Wildborn.ecosystem;
const { AI_STATE, HERBIVORE_SPECIES, PREDATOR_SPECIES } = Wildborn.animal;
const { consumePlant, createPlant, updatePlant } = Wildborn.plant;
const { createSpatialGrid } = Wildborn.spatial;

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed++;
    console.error('FAIL:', msg);
  } else {
    console.log('OK  ', msg);
  }
}

// --- Unit: spatial grid ---
{
  const grid = createSpatialGrid(64);
  grid.insert({ id: 1, x: 10, y: 10 });
  grid.insert({ id: 2, x: 200, y: 200 });
  const near = grid.queryRadius(10, 10, 50);
  assert(near.length === 1 && near[0].id === 1, 'spatial queryRadius finds nearby only');
  const nearest = grid.findNearest(0, 0, 500, (e) => e.id === 2);
  assert(nearest && nearest.id === 2, 'spatial findNearest with predicate');
}

// --- Unit: plant consume / respawn ---
{
  const p = createPlant('grass', 0, 0);
  assert(p.calories === 10, 'plant starts with 10 calories');
  const taken = consumePlant(p, 100);
  assert(taken === 10 && !p.alive, 'consumePlant depletes and kills plant');
  // Fast-forward respawn
  p.respawnTimer = 1;
  updatePlant(p, () => ({ x: 50, y: 50 }));
  assert(p.alive && p.x === 50 && p.calories === 10, 'plant respawns after delay');
}

// --- Unit: animal factory ---
{
  const rabbit = Wildborn.animal.createAnimal('rabbit', 0, 0);
  assert(rabbit.diet === 'herbivore' && rabbit.maxCalories === 60, 'rabbit herbivore stats');
  const wolf = Wildborn.animal.createAnimal('wolf', 0, 0);
  assert(wolf.diet === 'predator' && wolf.special === 'howl', 'wolf predator stats');
  const cub = Wildborn.animal.createAnimal('deer', 0, 0, { isOffspring: true });
  assert(!cub.isAdult && cub.calories === cub.maxCalories * 0.2, 'offspring start at 20% calories');
}

// --- Integration: ecosystem spawn counts ---
{
  const rng = createRng('ecosystem-test-42');
  const world = createWorld('ecosystem-test-42');
  world.ensureChunksInBounds(-2000, -2000, 2000, 2000);

  const eco = createEcosystem({
    world,
    rng,
    config: {
      ecosystemEnabled: true,
      ecosystemTickSeconds: 0.5,
      ecosystemSpawnRadius: 40 * TILE_SIZE,
      spatialCellSize: 96,
    },
    origin: { x: 0, y: 0 },
  });

  assert(eco.plants.length === INITIAL_PLANT_COUNT, 'spawns 200 plants');

  const herbExpected = { rabbit: 10, deer: 8, cow: 6, raccoon: 5, bison: 4, chicken: 15, ostrich: 3, turtle: 5, lizard: 8 };
  const predExpected = { wolf: 4, lion: 3, panther: 2, bear: 2, alligator: 3 };

  const counts = {};
  for (const a of eco.animals) {
    counts[a.species] = (counts[a.species] || 0) + 1;
  }
  for (const id in herbExpected) {
    assert(counts[id] === herbExpected[id], `spawn ${id}: ${counts[id]} === ${herbExpected[id]}`);
  }
  for (const id in predExpected) {
    assert(counts[id] === predExpected[id], `spawn ${id}: ${counts[id]} === ${predExpected[id]}`);
  }

  // Simulate ~60 seconds (120 ticks at 0.5s)
  const dt = 1 / 30;
  for (let i = 0; i < 30 * 60; i++) {
    eco.update(dt);
  }

  const stats = eco.getDebugStats();
  assert(stats.tick >= 100, 'ecosystem advanced many ticks (' + stats.tick + ')');
  assert(stats.plantsAlive > 0, 'plants still alive after simulation (' + stats.plantsAlive + ')');
  assert(stats.herbTotal + stats.predTotal > 0, 'animals still alive (' + (stats.herbTotal + stats.predTotal) + ')');

  // Some eating / hunger should have changed averages from spawn defaults
  assert(typeof stats.avgCalories.rabbit === 'number', 'avg calories tracked for rabbit');

  // Breeding unit path: breed() directly produces 1–3 offspring
  const deerA = Wildborn.animal.createAnimal('deer', 100, 100);
  const deerB = Wildborn.animal.createAnimal('deer', 110, 100);
  deerA.calories = deerA.maxCalories;
  deerB.calories = deerB.maxCalories;
  const kids = Wildborn.animal.breed(deerA, deerB, rng);
  assert(kids.length >= 1 && kids.length <= 3, 'breed() yields 1–3 offspring (' + kids.length + ')');
  assert(kids.every((k) => !k.isAdult && k.species === 'deer'), 'offspring are juvenile deer');
  assert(deerA.breedingCooldown === Wildborn.animal.BREED_COOLDOWN, 'breeding cooldown applied');

  // Natural breeding should have grown some populations during the sim
  const naturalGrowth =
    stats.herbivores.rabbit > 10 ||
    stats.herbivores.chicken > 15 ||
    stats.herbivores.lizard > 8 ||
    stats.predators.wolf > 4;
  assert(naturalGrowth, 'natural breeding grew at least one population during sim');

  console.log('\nFinal stats:', JSON.stringify(stats, null, 2));
}

if (failed) {
  console.error('\n' + failed + ' assertion(s) failed');
  process.exit(1);
}
console.log('\nAll smoke tests passed.');
