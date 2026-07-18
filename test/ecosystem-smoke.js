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
  'src/shapes.js',
  'src/renderShapes.js',
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

// --- Unit: plant grass growth / off-grass wither ---
{
  const p = createPlant('grass', 0, 0);
  p.calories = 20;
  updatePlant(p, null, () => true);
  assert(p.calories > 20, 'plant grows on grass');
  const before = p.calories;
  updatePlant(p, null, () => false);
  assert(p.calories === before - Wildborn.plant.WITHER_PER_TICK, 'plant withers off grass by 0.1');
}

// --- Unit: animal factory ---
{
  const rabbit = Wildborn.animal.createAnimal('rabbit', 0, 0);
  assert(rabbit.diet === 'herbivore' && rabbit.maxCalories === 60, 'rabbit herbivore stats');
  const wolf = Wildborn.animal.createAnimal('wolf', 0, 0);
  assert(wolf.diet === 'predator' && wolf.special === 'howl', 'wolf predator stats');
  assert(wolf.state === 'ROAM', 'predators spawn in ROAM state');
  assert(wolf.spawnX === 0 && wolf.spawnY === 0, 'predator records spawn territory point');
  const cub = Wildborn.animal.createAnimal('deer', 0, 0, { isOffspring: true });
  assert(!cub.isAdult && cub.calories === cub.maxCalories * 0.2, 'offspring start at 20% calories');
}

// --- Unit: calorie burn ÷10 and speed halve ---
{
  const wolf = Wildborn.animal.createAnimal('wolf', 0, 0);
  const burn = Wildborn.animal.calorieBurnPerTick(wolf);
  const original = 100 / 120; // caloriesNeededPerDay / DAY_TICKS
  assert(burn < original * 0.2, 'wolf burn is much slower than original (' + burn + ' vs ' + original + ')');
  assert(burn >= 0.05, 'burn stays positive');
  assert(Wildborn.animal.SPEED.fast === 52.5, 'fast speed halved to 52.5');
  assert(Wildborn.animal.SPEED.very_slow === 14, 'very_slow speed halved to 14');
  assert(wolf.baseSpeed === 52.5, 'wolf baseSpeed uses halved fast');
}

// --- Unit: chicken egg timer 10× rarer ---
{
  const chicken = Wildborn.animal.createAnimal('chicken', 0, 0);
  assert(chicken.eggTimer >= 500, 'chicken egg timer base ≥ 500 (was ~50)');
  assert(Wildborn.animal.EGG_TIMER_BASE === 500, 'EGG_TIMER_BASE is 500');
}

// --- Unit: predator hunt threshold / satiation ---
{
  const wolf = Wildborn.animal.createAnimal('wolf', 100, 100);
  const eggs = [];
  const ctx = {
    rng: createRng('hunt-test'),
    tickSeconds: 0.5,
    isWater: () => false,
    findNearestPlant: () => null,
    findNearestAnimal: () => null,
    findNearestEgg: () => null,
    hasEggFromChicken: () => false,
    queryAnimals: () => [],
    spawnPoop: () => {},
    spawnSplash: () => {},
  };
  // Well-fed: stay roaming
  wolf.calories = wolf.maxCalories * 0.9;
  Wildborn.animal.updateAnimal(wolf, 0.1, ctx);
  assert(wolf.state === 'ROAM', 'predator stays ROAM above 30% calories');

  // Drop to hunt threshold
  wolf.calories = wolf.maxCalories * 0.3;
  Wildborn.animal.updateAnimal(wolf, 0.1, ctx);
  assert(wolf.state === 'SEEK_PREY' && wolf._hunting, 'predator enters SEEK_PREY at ≤30%');

  // Satiate to 80%
  wolf.calories = wolf.maxCalories * 0.85;
  wolf.state = 'SEEK_PREY';
  wolf._hunting = true;
  Wildborn.animal.updateAnimal(wolf, 0.1, ctx);
  assert(wolf.state === 'ROAM' && !wolf._hunting, 'predator returns to ROAM at ≥80%');
}

// --- Unit: shape defs cover every species + renderShape is callable ---
{
  const herbIds = Object.keys(Wildborn.animal.HERBIVORE_SPECIES);
  const predIds = Object.keys(Wildborn.animal.PREDATOR_SPECIES);
  const plantIds = Object.keys(Wildborn.plant.PLANT_SPECIES);
  for (const id of herbIds) {
    assert(!!Wildborn.shapes.getSpeciesDef(id), 'shape def for herbivore ' + id);
  }
  for (const id of predIds) {
    assert(!!Wildborn.shapes.getSpeciesDef(id), 'shape def for predator ' + id);
  }
  for (const id of plantIds) {
    assert(!!Wildborn.shapes.getSpeciesDef(id), 'shape def for plant ' + id);
  }

  // Minimal canvas mock — ensures renderShape stays under a small draw budget
  let calls = 0;
  const ctx = {
    save() { calls++; },
    restore() { calls++; },
    translate() { calls++; },
    scale() { calls++; },
    rotate() { calls++; },
    beginPath() { calls++; },
    closePath() { calls++; },
    moveTo() { calls++; },
    lineTo() { calls++; },
    quadraticCurveTo() { calls++; },
    arc() { calls++; },
    ellipse() { calls++; },
    arcTo() { calls++; },
    fill() { calls++; },
    stroke() { calls++; },
    fillRect() { calls++; },
    strokeRect() { calls++; },
    fillText() { calls++; },
    createLinearGradient() {
      calls++;
      return { addColorStop() { calls++; } };
    },
    set fillStyle(v) { calls++; },
    set strokeStyle(v) { calls++; },
    set lineWidth(v) { calls++; },
    set globalAlpha(v) { calls++; },
    get globalAlpha() { return 1; },
    set globalCompositeOperation(v) { calls++; },
    set shadowColor(v) { calls++; },
    set shadowBlur(v) { calls++; },
    set font(v) { calls++; },
    set textAlign(v) { calls++; },
    setLineDash() { calls++; },
  };

  const all = herbIds.concat(predIds, plantIds);
  for (const id of all) {
    calls = 0;
    Wildborn.renderShapes.renderShape(ctx, id, 0, 0, 1, true, {
      time: 1.5,
      state: 'IDLE',
      calories: 40,
      maxCalories: 50,
      sex: 'male',
      isAdult: true,
      id: 1,
    });
    assert(calls > 0 && calls < 80, 'renderShape(' + id + ') draw ops=' + calls + ' (<80)');
  }

  // JSON file stays in sync with inline defs for key fields
  const json = JSON.parse(fs.readFileSync(path.join(root, 'src/shapes.json'), 'utf8'));
  assert(json.herbivores.rabbit && json.predators.wolf && json.plants.grass, 'shapes.json has core species');
  assert(
    json.herbivores.rabbit.bodyColor === Wildborn.shapes.getSpeciesDef('rabbit').bodyColor,
    'shapes.json mirrors shapes.js for rabbit bodyColor'
  );
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

  // Plants should be on grass tiles
  let plantsOnGrass = 0;
  for (const p of eco.plants) {
    if (world.isGrass(world.getTileAtPixel(p.x, p.y))) plantsOnGrass++;
  }
  assert(plantsOnGrass === eco.plants.length, 'all plants spawned on grass (' + plantsOnGrass + '/' + eco.plants.length + ')');

  // Predators start roaming (not hunting) when well-fed
  const wolves = eco.animals.filter((a) => a.species === 'wolf');
  assert(wolves.every((w) => w.state === 'ROAM'), 'well-fed wolves start in ROAM');

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
