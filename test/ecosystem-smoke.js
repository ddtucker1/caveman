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
  'src/pathfind.js',
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
const { createWorld, TILE_SIZE, MAP_TILES, MAP_PIXEL_SIZE } = Wildborn.world;
const { createEcosystem, INITIAL_PLANT_COUNT } = Wildborn.ecosystem;
const { AI_STATE, HERBIVORE_SPECIES, PREDATOR_SPECIES } = Wildborn.animal;
const { consumePlant, createPlant, updatePlant, RESPAWN_DELAY_TICKS, RESPAWN_CALORIE_RATIO } =
  Wildborn.plant;
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

// --- Unit: map size ---
{
  assert(MAP_TILES === 400, 'map is 400×400 tiles');
  assert(TILE_SIZE === 32, 'tile size is 32px');
  assert(MAP_PIXEL_SIZE === 12800, 'map is 12800×12800 pixels');
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

// --- Unit: pathfinding ---
{
  const world = createWorld('path-test');
  world.ensureMapLoaded();
  // Find two land tiles
  let a = null;
  let b = null;
  for (let ty = 0; ty < MAP_TILES && !b; ty++) {
    for (let tx = 0; tx < MAP_TILES; tx++) {
      const tile = world.getTile(tx, ty);
      if (!world.isLand(tile)) continue;
      if (!a) a = { tx, ty };
      else if (Math.abs(tx - a.tx) + Math.abs(ty - a.ty) > 8) {
        b = { tx, ty };
        break;
      }
    }
  }
  assert(a && b, 'found two land tiles for pathfinding');
  const path = Wildborn.pathfind.findPath(world, a.tx, a.ty, b.tx, b.ty, { allowWater: false });
  assert(path && path.length >= 1, 'A* returns a path between land tiles (' + (path && path.length) + ')');
}

// --- Unit: plant consume / respawn ---
{
  const p = createPlant('grass', 0, 0);
  assert(p.calories === 10, 'plant starts with 10 calories');
  const taken = consumePlant(p, 100);
  assert(taken === 10 && !p.alive, 'consumePlant depletes and kills plant (stays in memory)');
  assert(p.growthPaused === true, 'eating pauses plant growth');
  assert(p.respawnTimer === RESPAWN_DELAY_TICKS, 'respawn timer starts at 300s (600 ticks)');
  assert(RESPAWN_DELAY_TICKS === 600, 'RESPAWN_DELAY_TICKS is 600');
  assert(Wildborn.plant.RESPAWN_DELAY_SECONDS === 300, 'RESPAWN_DELAY_SECONDS is 300');
  // Fast-forward respawn
  p.respawnTimer = 1;
  updatePlant(p, () => ({ x: 50, y: 50 }));
  assert(p.alive && p.x === 50, 'plant teleports on respawn');
  assert(p.growthPaused === false, 'growth resumes after respawn');
  assert(
    p.calories === p.maxCalories * RESPAWN_CALORIE_RATIO,
    'plant respawns at 50% max calories (' + p.calories + ')'
  );
}

// --- Unit: growth pauses once eating starts ---
{
  const p = createPlant('grass', 0, 0);
  p.calories = 20;
  Wildborn.plant.pauseGrowth(p);
  updatePlant(p, null);
  assert(p.calories === 20, 'paused plant does not grow (' + p.calories + ')');
  // Without pause, same plant would grow
  p.growthPaused = false;
  updatePlant(p, null);
  assert(p.calories === 22.5, 'unpaused plant grows normally');
}

// --- Unit: plant growth / calorie density ---
{
  const p = createPlant('grass', 0, 0);
  assert(p.maxCalories === 150, 'grass max calories is 150');
  assert(p.growthPerTick === 2.5, 'grass grows 5× faster (2.5/tick)');
  p.calories = 20;
  updatePlant(p, null);
  assert(p.calories === 22.5, 'plant grows on land without grass restriction');
  const bush = createPlant('berry_bush', 0, 0);
  assert(bush.maxCalories === 250, 'berry bush max is 250');
  const tree = createPlant('fruit_tree', 0, 0);
  assert(tree.maxCalories === 500, 'fruit tree max is 500');
  const mush = createPlant('mushroom', 0, 0);
  assert(mush.maxCalories === 200, 'mushroom max is 200');
  const cactus = createPlant('cactus', 0, 0);
  assert(cactus.maxCalories === 175, 'cactus max is 175');
}

// --- Unit: eat rate / sight / water speed ---
{
  assert(Wildborn.animal.EAT_RATE_PER_SEC === 1, 'plant eat rate is 1 cal/sec/animal');
  assert(Wildborn.animal.EAT_RANGE === 20, 'eat range is 20px');
  assert(Wildborn.animal.PLANT_SIGHT_RANGE === 256, 'plant sight is 8 tiles (256px)');
  assert(Wildborn.animal.FOOD_DETECT_RANGE === 256, 'food detect matches plant sight');
  assert(Wildborn.animal.WATER_SPEED_MULT === 0.25, 'water speed is 25% of normal');
}

// --- Unit: animal factory ---
{
  const rabbit = Wildborn.animal.createAnimal('rabbit', 0, 0);
  assert(rabbit.diet === 'herbivore' && rabbit.maxCalories === 60, 'rabbit herbivore stats');
  assert(rabbit.stamina === 100 && rabbit.maxStamina === 100, 'animals spawn with full stamina');
  const wolf = Wildborn.animal.createAnimal('wolf', 0, 0);
  assert(wolf.diet === 'predator' && wolf.special === 'howl', 'wolf predator stats');
  assert(wolf.state === 'ROAM', 'predators spawn in ROAM state');
  assert(wolf.spawnX === 0 && wolf.spawnY === 0, 'predator records spawn territory point');
  const cub = Wildborn.animal.createAnimal('deer', 0, 0, { isOffspring: true });
  assert(!cub.isAdult && cub.calories === cub.maxCalories * 0.2, 'offspring start at 20% calories');
  assert(cub.growth === 0.2 && cub.size === cub.baseSize * 0.2, 'offspring start at 20% adult size');
  assert(!HERBIVORE_SPECIES.chicken, 'chicken species removed');
  assert(!Wildborn.animal.AI_STATE.SEEK_MATE && !Wildborn.animal.AI_STATE.BREEDING, 'mate-seeking states removed');
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

// --- Unit: real-time plant eating (1 cal/sec) ---
{
  const rabbit = Wildborn.animal.createAnimal('rabbit', 100, 100);
  const plant = createPlant('grass', 100, 100);
  plant.calories = 50;
  rabbit.state = 'EATING';
  rabbit.target = plant;
  rabbit.calories = 10;
  const ctx = {
    rng: createRng('eat-test'),
    tickSeconds: 0.5,
    world: createWorld('eat-world'),
    isWater: () => false,
    findNearestPlant: () => plant,
    findNearestAnimal: () => null,
    queryAnimals: () => [],
  };
  ctx.world.ensureMapLoaded();
  Wildborn.animal.updateAnimal(rabbit, 1.0, ctx); // 1 second
  assert(
    Math.abs(plant.calories - 49) < 0.01,
    '1 animal eats 1 cal/sec (plant now ' + plant.calories + ')'
  );
  assert(Math.abs(rabbit.calories - 11) < 0.01, 'animal gained 1 calorie');

  // 3 animals → 3 cal/sec
  plant.calories = 50;
  const eaters = [];
  for (let i = 0; i < 3; i++) {
    const a = Wildborn.animal.createAnimal('rabbit', 100, 100);
    a.state = 'EATING';
    a.target = plant;
    a.calories = 10;
    eaters.push(a);
  }
  for (let i = 0; i < eaters.length; i++) {
    Wildborn.animal.updateAnimal(eaters[i], 1.0, ctx);
  }
  assert(
    Math.abs(plant.calories - 47) < 0.05,
    '3 animals eat 3 cal/sec (plant now ' + plant.calories + ')'
  );
}

// --- Unit: stamina drain / regen ---
{
  const rabbit = Wildborn.animal.createAnimal('rabbit', 0, 0);
  rabbit.state = 'IDLE';
  rabbit.vx = 0;
  rabbit.vy = 0;
  rabbit.stamina = 50;
  Wildborn.animal.tickAnimal(rabbit, {
    rng: createRng('stam'),
    tickSeconds: 0.5,
    isWater: () => false,
    findNearestPlant: () => null,
    findNearestAnimal: () => null,
    queryAnimals: () => [],
  });
  assert(rabbit.stamina === 52, 'idle regenerates +2 stamina/tick');

  rabbit.state = 'FLEE';
  rabbit._fleeExhausted = false;
  rabbit.stamina = 10;
  rabbit.diet = 'herbivore';
  Wildborn.animal.tickAnimal(rabbit, {
    rng: createRng('stam2'),
    tickSeconds: 0.5,
    isWater: () => false,
    findNearestPlant: () => null,
    findNearestAnimal: () => null,
    queryAnimals: () => [],
  });
  assert(rabbit.stamina === 7, 'flee drains -3 stamina/tick');
  assert(rabbit._fleeExhausted === false, 'not exhausted above 0');

  rabbit.stamina = 0;
  Wildborn.animal.tickAnimal(rabbit, {
    rng: createRng('stam3'),
    tickSeconds: 0.5,
    isWater: () => false,
    findNearestPlant: () => null,
    findNearestAnimal: () => null,
    queryAnimals: () => [],
  });
  assert(rabbit._fleeExhausted === true, 'stamina 0 marks flee exhausted');
}

// --- Unit: sleep enter / wake ---
{
  const deer = Wildborn.animal.createAnimal('deer', 0, 0);
  deer.calories = deer.maxCalories;
  deer.state = 'IDLE';
  deer.idleAccum = 5;
  const ctx = {
    rng: createRng('sleep-test'),
    tickSeconds: 0.5,
    isWater: () => false,
    findNearestPlant: () => null,
    findNearestAnimal: () => null,
    queryAnimals: () => [],
  };
  Wildborn.animal.updateAnimal(deer, 0.1, ctx);
  assert(deer.state === 'SLEEP', 'full animal enters SLEEP after 5s idle');

  deer.sleepTimer = 10;
  deer.calories = deer.maxCalories * 0.65;
  Wildborn.animal.updateAnimal(deer, 0.1, ctx);
  assert(deer.state === 'IDLE', 'wakes when calories drop below 70%');
}

// --- Unit: predator hunt threshold / satiation ---
{
  const wolf = Wildborn.animal.createAnimal('wolf', 100, 100);
  const ctx = {
    rng: createRng('hunt-test'),
    tickSeconds: 0.5,
    isWater: () => false,
    findNearestPlant: () => null,
    findNearestAnimal: () => null,
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
  assert(!Wildborn.shapes.getSpeciesDef('chicken'), 'no chicken shape def');

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
      stamina: 80,
      maxStamina: 100,
      sex: 'male',
      isAdult: true,
      id: 1,
    });
    assert(calls > 0 && calls < 80, 'renderShape(' + id + ') draw ops=' + calls + ' (<80)');
  }

  // JSON file stays in sync with inline defs for key fields
  const json = JSON.parse(fs.readFileSync(path.join(root, 'src/shapes.json'), 'utf8'));
  assert(json.herbivores.rabbit && json.predators.wolf && json.plants.grass, 'shapes.json has core species');
  assert(!json.herbivores.chicken, 'shapes.json has no chicken');
  assert(
    json.herbivores.rabbit.bodyColor === Wildborn.shapes.getSpeciesDef('rabbit').bodyColor,
    'shapes.json mirrors shapes.js for rabbit bodyColor'
  );
}

// --- Integration: ecosystem spawn counts ---
{
  const rng = createRng('ecosystem-test-42');
  const world = createWorld('ecosystem-test-42');
  world.ensureMapLoaded();

  const eco = createEcosystem({
    world,
    rng,
    config: {
      ecosystemEnabled: true,
      ecosystemTickSeconds: 0.5,
      mapTiles: 400,
      ecosystemSpawnRadius: 200 * TILE_SIZE,
      spatialCellSize: 64,
    },
    origin: { x: MAP_PIXEL_SIZE / 2, y: MAP_PIXEL_SIZE / 2 },
  });

  assert(eco.plants.length === INITIAL_PLANT_COUNT, 'spawns 150 plants');
  assert(INITIAL_PLANT_COUNT === 150, 'INITIAL_PLANT_COUNT is 150');
  assert(eco.mapTiles === 400, 'ecosystem mapTiles is 400');
  assert(eco.mapPixelSize === 12800, 'ecosystem mapPixelSize is 12800');

  // Plants should be on land (not water) and within map
  let plantsOnLand = 0;
  let plantsOnWater = 0;
  let plantsInBounds = 0;
  for (const p of eco.plants) {
    const tile = world.getTileAtPixel(p.x, p.y);
    if (world.isSlow(tile)) plantsOnWater++;
    else if (!world.isSolid(tile)) plantsOnLand++;
    if (p.x >= 0 && p.y >= 0 && p.x < MAP_PIXEL_SIZE && p.y < MAP_PIXEL_SIZE) {
      plantsInBounds++;
    }
  }
  assert(plantsOnWater === 0, 'no plants spawned on water');
  assert(plantsOnLand === eco.plants.length, 'all plants spawned on land (' + plantsOnLand + '/' + eco.plants.length + ')');
  assert(plantsInBounds === eco.plants.length, 'all plants inside 400×400 map');

  // Predators start roaming (not hunting) when well-fed
  const wolves = eco.animals.filter((a) => a.species === 'wolf');
  assert(wolves.every((w) => w.state === 'ROAM'), 'well-fed wolves start in ROAM');

  const herbExpected = { rabbit: 10, deer: 8, cow: 6, raccoon: 5, bison: 4, ostrich: 3, turtle: 5, lizard: 8 };
  const predExpected = { wolf: 4, lion: 3, panther: 2, bear: 2, alligator: 3 };

  const counts = {};
  for (const a of eco.animals) {
    counts[a.species] = (counts[a.species] || 0) + 1;
  }
  assert(!counts.chicken, 'no chickens spawned');
  for (const id in herbExpected) {
    assert(counts[id] === herbExpected[id], `spawn ${id}: ${counts[id]} === ${herbExpected[id]}`);
  }
  for (const id in predExpected) {
    assert(counts[id] === predExpected[id], `spawn ${id}: ${counts[id]} === ${predExpected[id]}`);
  }

  // Animals stay in map bounds after simulation
  const dt = 1 / 30;
  for (let i = 0; i < 30 * 60; i++) {
    eco.update(dt);
  }

  let animalsOut = 0;
  for (const a of eco.animals) {
    if (!a.alive) continue;
    if (a.x < 0 || a.y < 0 || a.x > MAP_PIXEL_SIZE || a.y > MAP_PIXEL_SIZE) animalsOut++;
  }
  assert(animalsOut === 0, 'no living animals outside map after 60s');

  const stats = eco.getDebugStats();
  assert(stats.tick >= 100, 'ecosystem advanced many ticks (' + stats.tick + ')');
  assert(stats.plantsAlive + stats.plantsSprouting === 150, 'plant entities preserved (alive+sprouts=150)');
  assert(stats.plantsMax === 150, 'debug stats expose plant max 150');
  assert(stats.herbTotal + stats.predTotal > 0, 'animals still alive (' + (stats.herbTotal + stats.predTotal) + ')');
  assert(stats.eggs == null, 'eggs removed from stats');

  // Some eating / hunger should have changed averages from spawn defaults
  assert(typeof stats.avgCalories.rabbit === 'number', 'avg calories tracked for rabbit');

  // Asexual reproduction unit path: breed() produces exactly 1 offspring at parent
  const deerA = Wildborn.animal.createAnimal('deer', 100, 100);
  deerA.calories = deerA.maxCalories;
  deerA.breedingCooldown = 0;
  assert(Wildborn.animal.canBreed(deerA), 'well-fed adult with cooldown 0 can breed');
  assert(Wildborn.animal.BREED_COOLDOWN === 2400, 'breed cooldown is 1200s (2400 ticks)');
  assert(Wildborn.animal.BREED_CALORIE_RATIO === 0.8, 'breed requires ≥80% calories');
  const kids = Wildborn.animal.breed(deerA);
  assert(kids.length === 1, 'breed() yields exactly 1 offspring (' + kids.length + ')');
  assert(kids[0].species === 'deer' && !kids[0].isAdult, 'offspring is a juvenile deer');
  assert(kids[0].x === deerA.x && kids[0].y === deerA.y, 'offspring spawns at parent location');
  assert(kids[0].growth === 0.2 && kids[0].size === kids[0].baseSize * 0.2, 'offspring starts at 20% size');
  assert(deerA.breedingCooldown === Wildborn.animal.BREED_COOLDOWN, 'breeding cooldown applied');
  assert(!Wildborn.animal.canBreed(deerA), 'parent cannot breed again until cooldown ends');

  // Ecosystem asexual path: one fertile adult reproduces on the next tick without a mate
  const beforeCount = eco.animals.length;
  const parent = Wildborn.animal.createAnimal('deer', 200, 200);
  parent.calories = parent.maxCalories;
  parent.breedingCooldown = 0;
  eco.animals.push(parent);
  // Need ≥0.5s accumulated for one ecosystem tick (dt = 1/30)
  for (let i = 0; i < 30; i++) {
    eco.update(dt);
  }
  const afterStats = eco.getDebugStats();
  assert(
    eco.animals.length > beforeCount + 1 || afterStats.herbivores.deer > 8,
    'ecosystem asexual path produces offspring (' + eco.animals.length + ' animals, deer=' + afterStats.herbivores.deer + ')'
  );
  assert(parent.breedingCooldown > 0, 'parent cooldown set after ecosystem reproduction');

  console.log('\nFinal stats:', JSON.stringify(afterStats, null, 2));
}

// --- Ensure no chicken/egg references remain in source ---
{
  const srcFiles = [
    'src/animal.js',
    'src/ecosystem.js',
    'src/plant.js',
    'src/render.js',
    'src/renderShapes.js',
    'src/shapes.js',
    'src/shapes.json',
  ];
  for (const f of srcFiles) {
    const text = fs.readFileSync(path.join(root, f), 'utf8');
    assert(!/chicken/i.test(text), f + ' has no chicken references');
    // Allow "egg" only if somehow needed — should be gone
    assert(!/\begg\b/i.test(text), f + ' has no egg references');
  }
}

if (failed) {
  console.error('\n' + failed + ' assertion(s) failed');
  process.exit(1);
}
console.log('\nAll smoke tests passed.');
