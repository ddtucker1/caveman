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
  'src/player.js',
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
const {
  createEcosystem,
  INITIAL_PLANT_COUNT,
  EXTINCTION_REPOPULATE_COUNT,
  EXTINCTION_REPOPULATE_DELAY_SECONDS,
  EXTINCTION_REPOPULATE_DELAY_TICKS,
} = Wildborn.ecosystem;
const { AI_STATE, HERBIVORE_SPECIES, PREDATOR_SPECIES } = Wildborn.animal;
const { consumePlant, createPlant, updatePlant, RESPAWN_DELAY_TICKS } =
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

// --- Unit: large rock sections (~50% fewer, ~2× longer) ---
{
  const TILE = Wildborn.world.TILE;
  const world = createWorld('rock-dim-test');
  const N = MAP_TILES;
  const grid = Array.from({ length: N }, () => Array(N).fill(0));
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (world.getTile(x, y) === TILE.CLIFF) grid[y][x] = 1;
    }
  }
  const seen = Array.from({ length: N }, () => Array(N).fill(false));
  let large = 0;
  let lenSum = 0;
  let widthSum = 0;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (!grid[y][x] || seen[y][x]) continue;
      const q = [[x, y]];
      let minx = x;
      let maxx = x;
      let miny = y;
      let maxy = y;
      let size = 0;
      seen[y][x] = true;
      while (q.length) {
        const [cx, cy] = q.pop();
        size++;
        minx = Math.min(minx, cx);
        maxx = Math.max(maxx, cx);
        miny = Math.min(miny, cy);
        maxy = Math.max(maxy, cy);
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= N || ny >= N || seen[ny][nx] || !grid[ny][nx]) continue;
          seen[ny][nx] = true;
          q.push([nx, ny]);
        }
      }
      if (size >= 40) {
        large++;
        const w = maxx - minx + 1;
        const h = maxy - miny + 1;
        lenSum += Math.max(w, h);
        widthSum += Math.min(w, h);
      }
    }
  }
  const avgLen = lenSum / large;
  const avgWidth = widthSum / large;
  assert(large >= 8 && large <= 18, 'large rock sections are fewer (~half prior density)');
  assert(avgLen >= 35, 'large rock sections are longer (~2× prior length)');
  assert(avgLen / avgWidth >= 2, 'large rock sections are elongated');
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
  assert(p.calories === p.maxCalories, 'plant starts fully grown at max calories');
  assert(p.size === 12, 'grass visual size is doubled (12)');
  const taken = consumePlant(p, 200);
  assert(taken === 150 && !p.alive, 'consumePlant depletes and kills plant (stays in memory)');
  assert(p.respawnTimer === RESPAWN_DELAY_TICKS, 'respawn timer starts at 2765s (5530 ticks)');
  assert(RESPAWN_DELAY_TICKS === 5530, 'RESPAWN_DELAY_TICKS is 5530');
  assert(Wildborn.plant.RESPAWN_DELAY_SECONDS === 2765, 'RESPAWN_DELAY_SECONDS is 2765');
  // Fast-forward respawn
  p.respawnTimer = 1;
  updatePlant(p, () => ({ x: 50, y: 50 }));
  assert(p.alive && p.x === 50, 'plant teleports on respawn');
  assert(
    p.calories === p.maxCalories,
    'plant respawns at full max calories (' + p.calories + ')'
  );
}

// --- Unit: plants do not grow ---
{
  const p = createPlant('grass', 0, 0);
  p.calories = 20;
  updatePlant(p, null);
  assert(p.calories === 20, 'alive plant does not grow (' + p.calories + ')');
  assert(!Wildborn.plant.pauseGrowth, 'growth pause API removed');
  assert(p.growthPerTick == null, 'growthPerTick removed from plants');
  assert(p.growthPaused == null, 'growthPaused removed from plants');
}

// --- Unit: plant max calories / doubled sizes ---
{
  const p = createPlant('grass', 0, 0);
  assert(p.maxCalories === 150, 'grass max calories is 150');
  assert(p.calories === 150, 'grass spawns at full calories');
  const bush = createPlant('berry_bush', 0, 0);
  assert(bush.maxCalories === 250 && bush.size === 20, 'berry bush max 250, size 20');
  const tree = createPlant('fruit_tree', 0, 0);
  assert(tree.maxCalories === 2000 && tree.size === 28, 'fruit tree max 2000, size 28');
  const mush = createPlant('mushroom', 0, 0);
  assert(mush.maxCalories === 200 && mush.size === 14, 'mushroom max 200, size 14');
  const cactus = createPlant('cactus', 0, 0);
  assert(cactus.maxCalories === 175 && cactus.size === 18, 'cactus max 175, size 18');
}

// --- Unit: eat rate / sight / water speed / metabolism ---
{
  assert(Wildborn.animal.EAT_RATE_PER_SEC === 5, 'plant eat rate is 5 cal/sec/animal');
  assert(
    Wildborn.animal.HERBIVORE_CALORIE_BURN_INTERVAL_SEC === 12,
    'herbivores burn 1 calorie every 12 seconds'
  );
  assert(
    Wildborn.animal.PREDATOR_CALORIE_BURN_INTERVAL_SEC === 8,
    'predators burn 1 calorie every 8 seconds'
  );
  assert(Wildborn.animal.EAT_RANGE === 20, 'eat range is 20px');
  assert(Wildborn.animal.PLANT_SIGHT_TILES === 25, 'herbivore plant sight is 25 tiles');
  assert(Wildborn.animal.PLANT_SIGHT_RANGE === 800, 'plant sight is 25 tiles (800px)');
  assert(Wildborn.animal.PREDATOR_SIGHT_TILES === 20, 'predator sight is 20 tiles');
  assert(Wildborn.animal.PREDATOR_SIGHT_RANGE === 640, 'predator sight is 20 tiles (640px)');
  assert(Wildborn.animal.PREDATOR_HUNT_RATIO === 0.5, 'predators hunt at ≤50% calories');
  assert(Wildborn.animal.PREDATOR_RIVAL_HUNT_RATIO === 0.25, 'predators attack rivals at ≤25%');
  assert(Wildborn.animal.HUNGER_RETURN_RATIO === 0.7, 'leave search at ≥70% calories');
  assert(Wildborn.animal.HERBIVORE_LAND_SPEED === 30, 'herbivore land speed is 30');
  assert(Wildborn.animal.PREDATOR_LAND_SPEED === 36, 'predator land speed is 36');
  assert(
    Math.abs(Wildborn.animal.HERBIVORE_WATER_SPEED_MULT - 16 / 30) < 1e-9,
    'herbivore water speed is 16/30 of land'
  );
  assert(
    Math.abs(Wildborn.animal.PREDATOR_WATER_SPEED_MULT - 18 / 36) < 1e-9,
    'predator water speed is 18/36 of land'
  );
  assert(
    Math.abs(Wildborn.animal.AQUATIC_WATER_SPEED_MULT - 24 / 30) < 1e-9,
    'default aquatic (turtle) water speed is 24/30 of land'
  );
  assert(Wildborn.animal.CORPSE_DECAY_TICKS === 120, 'corpses last 120 ticks (1 minute)');
}

// --- Unit: caveman hitbox (visual is 2×; collision stays 15) ---
{
  assert(Wildborn.player.PLAYER_SIZE === 15, 'caveman hitbox is 15');
  const p = Wildborn.player.createPlayer({ x: 0, y: 0 });
  assert(p.w === 15 && p.h === 15, 'player spawn uses 15×15 hitbox');
}

// --- Unit: animal factory ---
{
  const rabbit = Wildborn.animal.createAnimal('rabbit', 0, 0);
  assert(rabbit.diet === 'herbivore' && rabbit.maxCalories === 60, 'rabbit herbivore stats');
  assert(rabbit.stamina == null && rabbit.maxStamina == null, 'animals have no stamina');
  assert(rabbit.baseSpeed === Wildborn.animal.HERBIVORE_LAND_SPEED, 'herbivores use land speed 30');
  assert(rabbit.caloriesNeededPerDay == null, 'need/day removed');
  assert(rabbit.maxGroupSize == null && rabbit.groupId == null, 'group stats removed');
  assert(rabbit.defense == null, 'defense stat removed');
  const wolf = Wildborn.animal.createAnimal('wolf', 0, 0);
  assert(wolf.diet === 'predator' && wolf.attackPower === 22, 'wolf predator stats');
  assert(wolf.special == null, 'animals have no special abilities');
  const bear = Wildborn.animal.createAnimal('bear', 0, 0);
  assert(bear.diet === 'predator', 'bear is strictly a carnivore predator');
  assert(bear.baseSpeed === Wildborn.animal.PREDATOR_LAND_SPEED, 'bear uses predator land speed 36');
  assert(bear.attackStyle === 'swipe', 'bear keeps attack style');
  assert(Wildborn.animal.PREDATOR_BREED_COOLDOWN === Wildborn.animal.BREED_COOLDOWN * 2, 'predator breed cooldown is 20 min');
  assert(wolf.state === 'ROAM', 'predators spawn in ROAM state');
  assert(wolf.spawnX === 0 && wolf.spawnY === 0, 'predator records spawn territory point');
  const cub = Wildborn.animal.createAnimal('deer', 0, 0, { isOffspring: true });
  assert(cub.isAdult && cub.health === cub.maxHealth, 'offspring born as full-health adults');
  assert(cub.size === cub.baseSize, 'offspring spawn at full adult size');
  assert(cub.breedingCooldown === Wildborn.animal.BREED_COOLDOWN, 'offspring start on breed cooldown');
  const bearCub = Wildborn.animal.createAnimal('bear', 0, 0, { isOffspring: true });
  assert(
    bearCub.breedingCooldown === Wildborn.animal.PREDATOR_BREED_COOLDOWN,
    'predator offspring start on 20 min breed cooldown'
  );
  assert(!HERBIVORE_SPECIES.cow && !HERBIVORE_SPECIES.raccoon, 'cow and raccoon removed');
  assert(!PREDATOR_SPECIES.lion && !PREDATOR_SPECIES.panther, 'lion and panther removed');
  assert(HERBIVORE_SPECIES.rabbit && HERBIVORE_SPECIES.deer && HERBIVORE_SPECIES.bison, 'kept herbivores present');
  assert(HERBIVORE_SPECIES.ostrich && HERBIVORE_SPECIES.turtle, 'ostrich and turtle present');
  assert(PREDATOR_SPECIES.wolf && PREDATOR_SPECIES.bear && PREDATOR_SPECIES.alligator, 'kept predators present');
  assert(!Wildborn.animal.AI_STATE.SEEK_MATE && !Wildborn.animal.AI_STATE.BREEDING, 'mate-seeking states removed');
}

// --- Unit: metabolism — herbivores 1/12s, predators 1/8s ---
{
  const tickSec = Wildborn.config.ecosystemTickSeconds || 0.5;
  const expectedPred = tickSec / Wildborn.animal.PREDATOR_CALORIE_BURN_INTERVAL_SEC;
  const expectedHerb = tickSec / Wildborn.animal.HERBIVORE_CALORIE_BURN_INTERVAL_SEC;
  const predIds = Object.keys(PREDATOR_SPECIES);
  for (let i = 0; i < predIds.length; i++) {
    const a = Wildborn.animal.createAnimal(predIds[i], 0, 0);
    const burn = Wildborn.animal.calorieBurnPerTick(a);
    assert(
      Math.abs(burn - expectedPred) < 0.0001,
      predIds[i] + ' predator burn is 1/8 cal/s (' + burn + ' /tick, expect ' + expectedPred + ')'
    );
  }
  const rabbit = Wildborn.animal.createAnimal('rabbit', 0, 0);
  const herbBurn = Wildborn.animal.calorieBurnPerTick(rabbit);
  assert(
    Math.abs(herbBurn - expectedHerb) < 0.0001,
    'herbivore burn is 1/12 cal/s (' + herbBurn + ', expect ' + expectedHerb + ')'
  );
  assert(
    !PREDATOR_SPECIES[rabbit.species],
    'rabbit is not on the predator burn path'
  );
  const bear = Wildborn.animal.createAnimal('bear', 0, 0);
  const bearBurn = Wildborn.animal.calorieBurnPerTick(bear);
  assert(
    Math.abs(bearBurn - expectedPred) < 0.0001,
    'bear predator burn matches 1/8 cal/s (' + bearBurn + ', expect ' + expectedPred + ')'
  );
  const wolf = Wildborn.animal.createAnimal('wolf', 0, 0);
  assert(Wildborn.animal.SPEED.predator === 36, 'predator SPEED alias is 36');
  assert(Wildborn.animal.SPEED.herbivore === 30, 'herbivore SPEED alias is 30');
  assert(wolf.baseSpeed === 36, 'wolf baseSpeed is predator land speed 36');
}

// --- Unit: real-time plant eating (5 cal/sec, stacks) ---
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
    Math.abs(plant.calories - 45) < 0.01,
    '1 animal eats 5 cal/sec (plant now ' + plant.calories + ')'
  );
  assert(Math.abs(rabbit.calories - 15) < 0.01, 'animal gained 5 calories');

  // 3 animals → 15 cal/sec
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
    Math.abs(plant.calories - 35) < 0.05,
    '3 animals eat 15 cal/sec (plant now ' + plant.calories + ')'
  );
}

// --- Unit: stubborn plant eating (commit until full / depleted / predator) ---
{
  assert(
    Wildborn.animal.EAT_PREDATOR_INTERRUPT_RANGE === 50,
    'predator interrupt range while eating is 50px'
  );

  function eatCtx(extras) {
    return Object.assign(
      {
        rng: createRng('stubborn-eat'),
        tickSeconds: 0.5,
        world: createWorld('stubborn-eat-world'),
        isWater: () => false,
        findNearestPlant: () => null,
        findNearestAnimal: () => null,
        queryAnimals: () => [],
      },
      extras || {}
    );
  }

  // Does not stop at 60% hunger-return mid-meal
  {
    const rabbit = Wildborn.animal.createAnimal('rabbit', 100, 100);
    const plant = createPlant('grass', 100, 100);
    plant.calories = 80;
    rabbit.state = 'EATING';
    rabbit.target = plant;
    rabbit._hungerSearch = true;
    rabbit.calories = rabbit.maxCalories * 0.55;
    const before = rabbit.calories;
    Wildborn.animal.updateAnimal(rabbit, 1.0, eatCtx({ findNearestPlant: () => plant }));
    assert(rabbit.state === 'EATING', 'keeps EATING past 55% (no 60% bailout)');
    assert(rabbit.target === plant, 'stays locked on plant past hunger-return band');
    assert(rabbit.calories > before, 'continues transferring calories while locked in');
    assert(rabbit.eatLocked === true, 'sets eatLocked visual while consuming plant');
  }

  // Stops only at 100% full
  {
    const rabbit = Wildborn.animal.createAnimal('rabbit', 100, 100);
    const plant = createPlant('grass', 100, 100);
    plant.calories = 200;
    rabbit.state = 'EATING';
    rabbit.target = plant;
    rabbit._hungerSearch = true;
    rabbit.calories = rabbit.maxCalories - 0.5;
    Wildborn.animal.updateAnimal(rabbit, 1.0, eatCtx({ findNearestPlant: () => plant }));
    assert(rabbit.calories >= rabbit.maxCalories, 'fills to 100% calories');
    assert(rabbit.state !== 'EATING', 'leaves EATING once fully full');
    assert(rabbit.target == null, 'abandons plant once full');
    assert(rabbit.eatLocked === false, 'clears eatLocked when finished');
  }

  // Plant depletes before full → SEARCHING_FOR_FOOD at 50% rule
  {
    const rabbit = Wildborn.animal.createAnimal('rabbit', 100, 100);
    const plant = createPlant('grass', 100, 100);
    plant.calories = 0.5;
    rabbit.state = 'EATING';
    rabbit.target = plant;
    rabbit.calories = rabbit.maxCalories * 0.4;
    Wildborn.animal.updateAnimal(rabbit, 1.0, eatCtx());
    assert(!plant.alive || plant.calories <= 0, 'plant is depleted');
    assert(
      rabbit.state === 'SEEK_FOOD' && rabbit._hungerSearch,
      'plant deplete while hungry → SEEK_FOOD hunger-search'
    );
  }

  // Predator within 50px actively targeting → immediate FLEE
  {
    const rabbit = Wildborn.animal.createAnimal('rabbit', 100, 100);
    const plant = createPlant('grass', 100, 100);
    plant.calories = 80;
    const wolf = Wildborn.animal.createAnimal('wolf', 120, 100);
    wolf.target = rabbit;
    wolf._hunting = true;
    wolf.state = 'SEEK_PREY';
    rabbit.state = 'EATING';
    rabbit.target = plant;
    rabbit.calories = 20;
    const ctx = eatCtx({
      findNearestAnimal: (x, y, radius, pred) => {
        if (pred && pred(wolf) && Math.hypot(wolf.x - x, wolf.y - y) <= radius) return wolf;
        return null;
      },
      queryAnimals: () => [wolf],
    });
    Wildborn.animal.updateAnimal(rabbit, 0.1, ctx);
    assert(rabbit.state === 'FLEE', 'predator targeting within 50px interrupts eating → FLEE');
    assert(rabbit.target == null, 'abandons plant on predator interrupt');
    assert(rabbit.fleeFrom === wolf, 'flees from the targeting predator');
    assert(rabbit.eatLocked === false, 'clears locked-in indicator on flee');
  }

  // Nearby predator NOT targeting this animal does not interrupt
  {
    const rabbit = Wildborn.animal.createAnimal('rabbit', 100, 100);
    const plant = createPlant('grass', 100, 100);
    plant.calories = 80;
    const wolf = Wildborn.animal.createAnimal('wolf', 120, 100);
    wolf.target = null;
    wolf.state = 'ROAM';
    rabbit.state = 'EATING';
    rabbit.target = plant;
    rabbit.calories = 20;
    const ctx = eatCtx({
      findNearestAnimal: (x, y, radius, pred) => {
        if (pred && pred(wolf) && Math.hypot(wolf.x - x, wolf.y - y) <= radius) return wolf;
        return null;
      },
      queryAnimals: () => [wolf],
    });
    Wildborn.animal.updateAnimal(rabbit, 0.5, ctx);
    assert(rabbit.state === 'EATING', 'non-targeting nearby predator does not interrupt');
    assert(rabbit.target === plant, 'stays on plant when predator is not targeting');
  }
}

// --- Unit: predators never flee — keep attacking prey ---
{
  const wolf = Wildborn.animal.createAnimal('wolf', 100, 100);
  const bison = Wildborn.animal.createAnimal('bison', 110, 100);
  wolf.state = 'SEEK_PREY';
  wolf.target = bison;
  wolf._hunting = true;
  wolf.calories = wolf.maxCalories * 0.2;

  // Counter-damage from fighting prey must not scare the predator away
  Wildborn.animal.applyDamage(wolf, 10, bison);
  assert(wolf.state === 'SEEK_PREY', 'predator stays in SEEK_PREY after taking damage');
  assert(wolf.target === bison, 'predator keeps prey as target after taking damage');
  assert(wolf.fleeFrom == null, 'predator does not set fleeFrom when hit');
  assert(wolf._hunting === true, 'predator remains in hunt mode after taking damage');

  // Even if somehow put into FLEE, updateFlee immediately resumes the attack
  wolf.state = 'FLEE';
  wolf.fleeFrom = bison;
  wolf.stateTimer = 2.5;
  Wildborn.animal.updateAnimal(wolf, 0.1, {
    rng: createRng(1),
    isWater: () => false,
    findNearestAnimal: () => null,
    findNearestPlant: () => null,
    queryAnimals: () => [bison],
    tickSeconds: 0.5,
  });
  assert(wolf.state === 'SEEK_PREY', 'predator leaves FLEE and resumes SEEK_PREY');
  assert(wolf.target === bison, 'predator retargets prey after aborted flee');
  assert(wolf.fleeFrom == null, 'predator clears fleeFrom on resume');
}

// --- Unit: corpse yield 100% + predators eat to full ---
{
  function corpseEatCtx(extras) {
    return Object.assign(
      {
        rng: createRng('corpse-eat'),
        tickSeconds: 0.5,
        world: createWorld('corpse-eat-world'),
        isWater: () => false,
        findNearestPlant: () => null,
        findNearestAnimal: () => null,
        queryAnimals: () => [],
      },
      extras || {}
    );
  }

  // Herbivore killed by predator → corpse offers calories held at death
  {
    const rabbit = Wildborn.animal.createAnimal('rabbit', 100, 100);
    const wolf = Wildborn.animal.createAnimal('wolf', 100, 100);
    rabbit.calories = 12;
    Wildborn.animal.killAnimal(rabbit, wolf);
    assert(rabbit.state === 'DEAD' && !rabbit.alive, 'killed herbivore becomes a corpse');
    assert(
      rabbit.corpseCalories === 12,
      'corpse offers calories at death (' + rabbit.corpseCalories + ')'
    );
    assert(wolf.state === 'EATING' && wolf.target === rabbit, 'killer starts eating the corpse');
  }

  // Predator keeps eating corpse past 70% until 100% full
  {
    const corpse = Wildborn.animal.createAnimal('deer', 100, 100);
    corpse.calories = corpse.maxCalories;
    const wolf = Wildborn.animal.createAnimal('wolf', 100, 100);
    Wildborn.animal.killAnimal(corpse, null);
    assert(corpse.corpseCalories === corpse.maxCalories, 'deer corpse yields calories at death');
    wolf.state = 'EATING';
    wolf.target = corpse;
    wolf._hungerSearch = true;
    wolf._hunting = false;
    wolf.calories = wolf.maxCalories * 0.55;
    const before = wolf.calories;
    Wildborn.animal.updateAnimal(wolf, 1.0, corpseEatCtx());
    assert(wolf.state === 'EATING', 'keeps EATING corpse past 55% (no mid-meal bailout)');
    assert(wolf.target === corpse, 'stays locked on corpse past hunger-return band');
    assert(wolf.calories > before, 'continues transferring corpse calories while locked in');
  }

  // Stops at 100% full even if corpse remains
  {
    const corpse = Wildborn.animal.createAnimal('deer', 100, 100);
    corpse.calories = corpse.maxCalories;
    const wolf = Wildborn.animal.createAnimal('wolf', 100, 100);
    Wildborn.animal.killAnimal(corpse, null);
    wolf.state = 'EATING';
    wolf.target = corpse;
    wolf.calories = wolf.maxCalories - 0.5;
    Wildborn.animal.updateAnimal(wolf, 1.0, corpseEatCtx());
    assert(wolf.calories >= wolf.maxCalories, 'fills to 100% calories from corpse');
    assert(wolf.state !== 'EATING', 'leaves EATING once fully full');
    assert(wolf.target == null, 'abandons corpse once full');
    assert(corpse.corpseCalories > 0, 'leftover corpse calories remain when eater is full');
  }

  // Stops when corpse food runs out before full
  {
    const corpse = Wildborn.animal.createAnimal('rabbit', 100, 100);
    corpse.calories = corpse.maxCalories;
    const wolf = Wildborn.animal.createAnimal('wolf', 100, 100);
    Wildborn.animal.killAnimal(corpse, null);
    corpse.corpseCalories = 1;
    wolf.state = 'EATING';
    wolf.target = corpse;
    wolf._hunting = true;
    wolf.calories = 10;
    Wildborn.animal.updateAnimal(wolf, 1.0, corpseEatCtx());
    assert(corpse.corpseCalories <= 0, 'corpse calories depleted');
    assert(wolf.state !== 'EATING', 'leaves EATING when corpse food runs out');
    assert(wolf.calories < wolf.maxCalories, 'wolf not yet full when food ran out');
  }

  // Bear (carnivore) also eats corpse to 100%
  {
    const corpse = Wildborn.animal.createAnimal('bison', 100, 100);
    corpse.calories = corpse.maxCalories;
    const bear = Wildborn.animal.createAnimal('bear', 100, 100);
    Wildborn.animal.killAnimal(corpse, null);
    bear.state = 'EATING';
    bear.target = corpse;
    bear.calories = bear.maxCalories - 0.5;
    Wildborn.animal.updateAnimal(bear, 1.0, corpseEatCtx());
    assert(bear.calories >= bear.maxCalories, 'bear fills to 100% from corpse');
    assert(bear.state !== 'EATING', 'bear leaves EATING once fully full');
  }

  // Herbivores never eat corpses — plants only
  {
    const corpse = Wildborn.animal.createAnimal('deer', 100, 100);
    const rabbit = Wildborn.animal.createAnimal('rabbit', 100, 100);
    Wildborn.animal.killAnimal(corpse, null);
    rabbit.calories = rabbit.maxCalories * 0.3;
    rabbit.state = 'SEEK_FOOD';
    rabbit._hungerSearch = true;
    rabbit.target = null;
    const plant = createPlant('grass', 5000, 5000);
    plant.calories = 40;
    Wildborn.animal.updateAnimal(
      rabbit,
      0.2,
      corpseEatCtx({
        findNearestAnimal: (x, y, radius, pred) => {
          if (pred && pred(corpse) && Math.hypot(corpse.x - x, corpse.y - y) <= radius) {
            return corpse;
          }
          return null;
        },
        findNearestPlant: () => plant,
        queryAnimals: () => [corpse],
      })
    );
    assert(rabbit.target !== corpse, 'hungry herbivore does not target corpses');
    assert(
      rabbit.target === plant || rabbit.state === 'SEEK_FOOD',
      'hungry herbivore seeks plants (or keeps exploring), never dead animals'
    );
    assert(corpse.corpseCalories > 0, 'corpse untouched by herbivore');
  }

  // Even if already locked on a corpse, herbivores abandon it
  {
    const corpse = Wildborn.animal.createAnimal('rabbit', 100, 100);
    const deer = Wildborn.animal.createAnimal('deer', 100, 100);
    Wildborn.animal.killAnimal(corpse, null);
    const before = corpse.corpseCalories;
    deer.state = 'EATING';
    deer.target = corpse;
    deer.calories = deer.maxCalories * 0.4;
    Wildborn.animal.updateAnimal(deer, 1.0, corpseEatCtx());
    assert(deer.state !== 'EATING', 'herbivore leaves EATING when target is a corpse');
    assert(deer.target !== corpse, 'herbivore drops corpse target');
    assert(corpse.corpseCalories === before, 'herbivore does not consume corpse calories');
  }
}

// --- Unit: herbivores flee from bears on sight ---
{
  const deer = Wildborn.animal.createAnimal('deer', 100, 100);
  const bear = Wildborn.animal.createAnimal('bear', 140, 100);
  deer.state = 'IDLE';
  deer.calories = deer.maxCalories * 0.8;
  const fleeCtx = {
    rng: createRng('flee-bear'),
    tickSeconds: 0.5,
    isWater: () => false,
    findNearestAnimal: (x, y, radius, pred) => {
      if (pred && pred(bear) && Math.hypot(bear.x - x, bear.y - y) <= radius) return bear;
      return null;
    },
    findNearestPlant: () => null,
    queryAnimals: () => [bear],
  };
  Wildborn.animal.updateAnimal(deer, 0.1, fleeCtx);
  assert(deer.state === 'FLEE', 'idle herbivore flees when it sees a bear');
  assert(deer.fleeFrom === bear, 'flee target is the bear');

  // Also flee while hunger-searching for plants
  const rabbit = Wildborn.animal.createAnimal('rabbit', 100, 100);
  rabbit.state = 'SEEK_FOOD';
  rabbit._hungerSearch = true;
  rabbit.calories = rabbit.maxCalories * 0.4;
  rabbit._exploreGoal = { x: 5000, y: 100 };
  rabbit._exploreTimer = 30;
  Wildborn.animal.updateAnimal(rabbit, 0.1, fleeCtx);
  assert(rabbit.state === 'FLEE', 'hunger-searching herbivore flees from bear on sight');
  assert(rabbit.fleeFrom === bear, 'seek-food flee target is the bear');
}

// --- Unit: diet land speeds / no stamina ---
{
  const herbIds = Object.keys(HERBIVORE_SPECIES);
  for (let i = 0; i < herbIds.length; i++) {
    const a = Wildborn.animal.createAnimal(herbIds[i], 0, 0);
    assert(
      a.baseSpeed === Wildborn.animal.HERBIVORE_LAND_SPEED,
      herbIds[i] + ' herbivore land speed is 30'
    );
    assert(a.stamina == null, herbIds[i] + ' has no stamina');
  }
  const predIds = Object.keys(PREDATOR_SPECIES);
  for (let i = 0; i < predIds.length; i++) {
    const a = Wildborn.animal.createAnimal(predIds[i], 0, 0);
    assert(
      a.baseSpeed === Wildborn.animal.PREDATOR_LAND_SPEED,
      predIds[i] + ' predator land speed is 36'
    );
  }
  const bear = Wildborn.animal.createAnimal('bear', 0, 0);
  assert(bear.baseSpeed === Wildborn.animal.PREDATOR_LAND_SPEED, 'bear predator land speed is 36');
  assert(Wildborn.animal.STAMINA_MAX == null, 'stamina constants removed');
}

// --- Unit: sleep enter / wake ---
{
  assert(Wildborn.animal.SLEEP_ENTER_RATIO === 0.9, 'sleep enter threshold is 90%');

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

  // Below 90% should not nap even after long idle
  deer.state = 'IDLE';
  deer.calories = deer.maxCalories * 0.85;
  deer.idleAccum = 5;
  Wildborn.animal.updateAnimal(deer, 0.1, ctx);
  assert(deer.state !== 'SLEEP', 'does not enter SLEEP below 90% calories');
}

// --- Unit: hunger search at ≤50% ---
{
  assert(Wildborn.animal.HUNGER_SEEK_RATIO === 0.5, 'hunger search trigger is 50%');
  assert(Wildborn.animal.HUNGER_RETURN_RATIO === 0.7, 'hunger search returns at 70%');
  assert(
    Wildborn.animal.HUNGER_EXPLORE_GOAL_MIN >= 20,
    'hunger explore commits to one direction for longer periods'
  );
  assert(
    Wildborn.animal.HUNGER_EXPLORE_GOAL_MAX > Wildborn.animal.HUNGER_EXPLORE_GOAL_MIN,
    'hunger explore goal max exceeds min'
  );

  const rabbit = Wildborn.animal.createAnimal('rabbit', 0, 0);
  rabbit.calories = rabbit.maxCalories * 0.5;
  rabbit.state = 'IDLE';
  const ctx = {
    rng: createRng('hunger-search'),
    tickSeconds: 0.5,
    isWater: () => false,
    mapPixelSize: 12800,
    findNearestPlant: () => null,
    findNearestAnimal: () => null,
    queryAnimals: () => [],
  };
  Wildborn.animal.updateAnimal(rabbit, 0.1, ctx);
  assert(
    rabbit.state === 'SEEK_FOOD' && rabbit._hungerSearch,
    'herbivore enters SEEK_FOOD hunger-search at ≤50%'
  );

  const wolfSearch = Wildborn.animal.createAnimal('wolf', 100, 100);
  wolfSearch.calories = wolfSearch.maxCalories * 0.45;
  wolfSearch.state = 'ROAM';
  Wildborn.animal.updateAnimal(wolfSearch, 0.1, ctx);
  assert(
    wolfSearch.state === 'SEEK_PREY' && wolfSearch._hunting,
    'predator hunts at ≤50% calories'
  );

  // Distant map exploration at normal base speed
  rabbit.x = 100;
  rabbit.y = 100;
  Wildborn.animal.updateAnimal(rabbit, 0.5, ctx);
  assert(!!rabbit._exploreGoal, 'hunger-search picks a distant explore goal');
  const exploreDist = Math.hypot(rabbit._exploreGoal.x - 100, rabbit._exploreGoal.y - 100);
  assert(
    exploreDist >= 12800 * 0.35,
    'explore goal is in a completely different part of the map (' + Math.round(exploreDist) + 'px)'
  );
  assert(
    rabbit._exploreTimer >= Wildborn.animal.HUNGER_EXPLORE_GOAL_MIN,
    'explore run lasts longer (' + rabbit._exploreTimer.toFixed(1) + 's)'
  );
  const speed = Math.hypot(rabbit.vx, rabbit.vy);
  assert(
    speed >= rabbit.baseSpeed * 0.95,
    'hunger-search uses base speed (' + speed.toFixed(1) + ' vs base ' + rabbit.baseSpeed + ')'
  );
}

// --- Unit: turtle 30/24; alligator 36/54; herbivore water 16; predator water 18 ---
{
  const turtle = Wildborn.animal.createAnimal('turtle', 100, 100);
  const gator = Wildborn.animal.createAnimal('alligator', 100, 100);
  const deer = Wildborn.animal.createAnimal('deer', 100, 100);
  assert(turtle.aquatic === true, 'turtle is aquatic');
  assert(turtle.baseSpeed === 30, 'turtle land speed is 30');
  assert(
    Math.abs(turtle.waterSpeedMult - 24 / 30) < 1e-9,
    'turtle waterSpeedMult targets 24 px/s'
  );
  assert(gator.aquatic === true, 'alligator is aquatic');
  assert(gator.speedKey === 'predator', 'alligator land speed key is predator (36)');
  assert(gator.baseSpeed === 36, 'alligator land speed is 36');
  assert(
    Math.abs(gator.waterSpeedMult - 54 / 36) < 1e-9,
    'alligator waterSpeedMult targets 54 px/s'
  );
  assert(Wildborn.animal.canCrossWater(turtle, {}), 'turtle may cross water');
  assert(Wildborn.animal.canCrossWater(gator, {}), 'alligator may cross water');

  const landCtx = {
    rng: createRng('aquatic-land'),
    tickSeconds: 0.5,
    isWater: () => false,
    mapPixelSize: 12800,
    findNearestPlant: () => null,
    findNearestAnimal: () => null,
    queryAnimals: () => [],
    spawnSplash: () => {},
  };
  // Keep calories in the hunger-search band so AI stays on explore movement
  turtle.calories = turtle.maxCalories * 0.4;
  turtle.state = 'SEEK_FOOD';
  turtle._hungerSearch = true;
  turtle._exploreGoal = { x: 5000, y: 100 };
  turtle._exploreTimer = 30;
  Wildborn.animal.updateAnimal(turtle, 0.2, landCtx);
  const landSpeed = Math.hypot(turtle.vx, turtle.vy);

  const waterCtx = Object.assign({}, landCtx, {
    rng: createRng('aquatic-water'),
    isWater: () => true,
    spawnSplash: () => {},
  });
  turtle.x = 100;
  turtle.y = 100;
  turtle.calories = turtle.maxCalories * 0.4;
  turtle.state = 'SEEK_FOOD';
  turtle._hungerSearch = true;
  turtle._exploreGoal = { x: 5000, y: 100 };
  turtle._exploreTimer = 30;
  Wildborn.animal.updateAnimal(turtle, 0.2, waterCtx);
  const waterSpeed = Math.hypot(turtle.vx, turtle.vy);
  assert(
    waterSpeed >= landSpeed * (24 / 30) * 0.95,
    'turtle water speed ~24 with land ~30 (' + waterSpeed.toFixed(1) + ' vs ' + landSpeed.toFixed(1) + ')'
  );

  gator.calories = gator.maxCalories * 0.25;
  gator.state = 'SEEK_PREY';
  gator._hunting = true;
  gator._exploreGoal = { x: 5000, y: 100 };
  gator._exploreTimer = 30;
  gator.x = 100;
  gator.y = 100;
  Wildborn.animal.updateAnimal(gator, 0.2, landCtx);
  const gatorLand = Math.hypot(gator.vx, gator.vy);
  gator.x = 100;
  gator.y = 100;
  gator.calories = gator.maxCalories * 0.25;
  gator.state = 'SEEK_PREY';
  gator._hunting = true;
  gator._exploreGoal = { x: 5000, y: 100 };
  gator._exploreTimer = 30;
  Wildborn.animal.updateAnimal(gator, 0.2, waterCtx);
  const gatorWater = Math.hypot(gator.vx, gator.vy);
  assert(
    gatorWater >= gatorLand * (54 / 36) * 0.95,
    'alligator water speed ~54 with land ~36 (' +
      gatorWater.toFixed(1) +
      ' vs ' +
      gatorLand.toFixed(1) +
      ')'
  );

  deer.calories = deer.maxCalories * 0.4;
  deer.state = 'SEEK_FOOD';
  deer._hungerSearch = true;
  deer._exploreGoal = { x: 5000, y: 100 };
  deer._exploreTimer = 30;
  deer.x = 100;
  deer.y = 100;
  Wildborn.animal.updateAnimal(deer, 0.2, landCtx);
  const deerLand = Math.hypot(deer.vx, deer.vy);
  deer.x = 100;
  deer.y = 100;
  deer.calories = deer.maxCalories * 0.4;
  deer.state = 'SEEK_FOOD';
  deer._hungerSearch = true;
  deer._exploreGoal = { x: 5000, y: 100 };
  deer._exploreTimer = 30;
  // Allow water crossing so movement is not blocked at the shoreline
  deer._waterStuckTimer = Wildborn.animal.WATER_STUCK_CROSS_SECONDS;
  Wildborn.animal.updateAnimal(deer, 0.2, waterCtx);
  const deerWater = Math.hypot(deer.vx, deer.vy);
  const herbWaterRatio = Wildborn.animal.HERBIVORE_WATER_SPEED_MULT;
  assert(
    deerWater <= deerLand * (herbWaterRatio + 0.1) + 0.5 &&
      deerWater >= deerLand * (herbWaterRatio - 0.1) - 0.5,
    'non-aquatic herbivore water speed ~16/30 land (' +
      deerWater.toFixed(1) +
      ' vs ' +
      deerLand.toFixed(1) +
      ')'
  );
}

// --- Unit: corpse persists for 1 minute ---
{
  const rabbit = Wildborn.animal.createAnimal('rabbit', 0, 0);
  Wildborn.animal.killAnimal(rabbit, null);
  assert(rabbit.state === 'DEAD', 'killed animal is DEAD');
  assert(
    rabbit.corpseDecay === Wildborn.animal.CORPSE_DECAY_TICKS,
    'corpseDecay starts at 120 ticks (1 minute)'
  );
}

// --- Unit: shoreline stuck recovery ---
{
  const deer = Wildborn.animal.createAnimal('deer', 100, 100);
  deer.state = 'SEEK_FOOD';
  deer._hungerSearch = true;
  deer._waterStuckTimer = Wildborn.animal.WATER_STUCK_CROSS_SECONDS;
  assert(
    Wildborn.animal.canCrossWater(deer, {}),
    'hunger-searching animal stuck at water may cross after timeout'
  );
  // Idle / roam animals must also unstick — otherwise they freeze in coves forever
  const idleDeer = Wildborn.animal.createAnimal('deer', 100, 100);
  idleDeer.state = 'IDLE';
  idleDeer._hungerSearch = false;
  idleDeer._waterStuckTimer = Wildborn.animal.WATER_STUCK_CROSS_SECONDS;
  assert(
    Wildborn.animal.canCrossWater(idleDeer, {}),
    'idle animal stuck at water may cross after timeout'
  );
  // Starvation no longer requires a locked target
  const rabbit = Wildborn.animal.createAnimal('rabbit', 100, 100);
  rabbit.calories = rabbit.maxCalories * 0.1;
  rabbit.target = null;
  assert(
    Wildborn.animal.canCrossWater(rabbit, {}),
    'starving animal may cross water without a food target'
  );
}

// --- Unit: animals escape water / tree cul-de-sacs instead of freezing ---
{
  const world = createWorld('edge-unstuck-test');
  world.ensureMapLoaded();

  function makeEdgeCtx(seed) {
    return {
      rng: createRng(seed),
      tickSeconds: 0.5,
      world,
      mapPixelSize: MAP_PIXEL_SIZE,
      pathBudget: 200,
      isWater: (x, y) => world.isSlow(world.getTileAtPixel(x, y)),
      isSolid: (x, y) => world.isSolid(world.getTileAtPixel(x, y)),
      findNearestPlant: () => null,
      findNearestAnimal: () => null,
      queryAnimals: () => [],
      spawnSplash: () => {},
    };
  }

  // Land tiles with ≤1 land neighbor (dead-ends against water and/or trees)
  const traps = [];
  for (let ty = 2; ty < MAP_TILES - 2 && traps.length < 36; ty++) {
    for (let tx = 2; tx < MAP_TILES - 2 && traps.length < 36; tx++) {
      if (!world.isLand(world.getTile(tx, ty))) continue;
      let landN = 0;
      let blockN = 0;
      const dirs = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ];
      for (let i = 0; i < dirs.length; i++) {
        const t = world.getTile(tx + dirs[i][0], ty + dirs[i][1]);
        if (world.isLand(t)) landN++;
        else if (world.isSlow(t) || world.isSolid(t)) blockN++;
      }
      if (landN <= 1 && blockN >= 3) {
        traps.push({
          tx,
          ty,
          x: tx * TILE_SIZE + TILE_SIZE / 2,
          y: ty * TILE_SIZE + TILE_SIZE / 2,
        });
      }
    }
  }
  assert(traps.length >= 8, 'found cul-de-sac tiles for unstuck test (' + traps.length + ')');

  let escaped = 0;
  let stuck = 0;
  let enteredSolid = 0;
  for (let i = 0; i < traps.length; i++) {
    const spot = traps[i];
    const deer = Wildborn.animal.createAnimal('deer', spot.x, spot.y);
    deer.state = 'IDLE';
    deer.calories = deer.maxCalories * 0.8;
    const ctx = makeEdgeCtx('unstuck-' + i);
    const start = { x: deer.x, y: deer.y };
    for (let f = 0; f < 220; f++) {
      Wildborn.animal.updateAnimal(deer, 0.1, ctx);
      Wildborn.animal.clampToMap(deer, MAP_PIXEL_SIZE);
      if (world.isSolid(world.getTileAtPixel(deer.x, deer.y))) enteredSolid++;
    }
    const moved = Math.hypot(deer.x - start.x, deer.y - start.y);
    if (moved >= 28) escaped++;
    else stuck++;
  }
  assert(enteredSolid === 0, 'unstuck recovery never walks into trees/mountains');
  assert(
    escaped >= Math.ceil(traps.length * 0.7),
    'most idle animals escape water/tree cul-de-sacs (' +
      escaped +
      '/' +
      traps.length +
      ', stuck ' +
      stuck +
      ')'
  );

  // Water-edge roamers must also leave shoreline pins
  const waterEdges = [];
  for (let ty = 2; ty < MAP_TILES - 2 && waterEdges.length < 20; ty++) {
    for (let tx = 2; tx < MAP_TILES - 2 && waterEdges.length < 20; tx++) {
      if (!world.isLand(world.getTile(tx, ty))) continue;
      let waterN = 0;
      let landN = 0;
      const dirs = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ];
      for (let i = 0; i < dirs.length; i++) {
        const t = world.getTile(tx + dirs[i][0], ty + dirs[i][1]);
        if (world.isSlow(t)) waterN++;
        else if (world.isLand(t)) landN++;
      }
      if (waterN >= 2 && landN <= 1) {
        waterEdges.push({
          x: tx * TILE_SIZE + TILE_SIZE / 2,
          y: ty * TILE_SIZE + TILE_SIZE / 2,
        });
      }
    }
  }
  assert(waterEdges.length >= 5, 'found water-edge traps for roam unstuck test');
  let roamEscaped = 0;
  for (let i = 0; i < waterEdges.length; i++) {
    const spot = waterEdges[i];
    const wolf = Wildborn.animal.createAnimal('wolf', spot.x, spot.y);
    wolf.state = 'ROAM';
    wolf.calories = wolf.maxCalories * 0.7;
    wolf.spawnX = spot.x;
    wolf.spawnY = spot.y;
    const ctx = makeEdgeCtx('roam-water-' + i);
    const start = { x: wolf.x, y: wolf.y };
    for (let f = 0; f < 250; f++) {
      Wildborn.animal.updateAnimal(wolf, 0.1, ctx);
      Wildborn.animal.clampToMap(wolf, MAP_PIXEL_SIZE);
    }
    if (Math.hypot(wolf.x - start.x, wolf.y - start.y) >= 28) roamEscaped++;
  }
  assert(
    roamEscaped >= Math.ceil(waterEdges.length * 0.65),
    'most roaming predators escape water-edge pins (' +
      roamEscaped +
      '/' +
      waterEdges.length +
      ')'
  );

  // Animals at edges must walk, not vibrate in place (long thrash, tiny net move)
  let vibrating = 0;
  const vibrateSamples = Math.min(12, traps.length);
  for (let i = 0; i < vibrateSamples; i++) {
    const spot = traps[i];
    const deer = Wildborn.animal.createAnimal('deer', spot.x, spot.y);
    deer.state = 'IDLE';
    deer.calories = deer.maxCalories * 0.75;
    const ctx = makeEdgeCtx('no-vibrate-' + i);
    let prevX = deer.x;
    let prevY = deer.y;
    let prevDx = 0;
    let prevDy = 0;
    let reversals = 0;
    let steps = 0;
    let pathLen = 0;
    for (let f = 0; f < 120; f++) {
      Wildborn.animal.updateAnimal(deer, 0.05, ctx);
      Wildborn.animal.clampToMap(deer, MAP_PIXEL_SIZE);
      const dx = deer.x - prevX;
      const dy = deer.y - prevY;
      const moved = Math.hypot(dx, dy);
      if (moved > 0.15 && Math.hypot(prevDx, prevDy) > 0.15) {
        steps++;
        pathLen += moved;
        if (dx * prevDx + dy * prevDy < 0) reversals++;
      }
      if (moved > 0.05) {
        prevDx = dx;
        prevDy = dy;
      }
      prevX = deer.x;
      prevY = deer.y;
    }
    const net = Math.hypot(deer.x - spot.x, deer.y - spot.y);
    const efficiency = pathLen > 1 ? net / pathLen : 1;
    // Thrashing: lots of direction flips AND almost no net travel
    if (steps >= 20 && reversals / steps > 0.4 && efficiency < 0.2) vibrating++;
  }
  assert(
    vibrating === 0,
    'edge animals do not vibrate in place via rapid reversals (' +
      vibrating +
      '/' +
      vibrateSamples +
      ')'
  );

  // Tree corridors / cul-de-sacs used to re-pick opposite escape goals every
  // frame when the next step was blocked — animals stayed in ROAM/IDLE while
  // thrashing in place. Stress the densest solid traps, not only water edges.
  const treeCorridors = [];
  for (let ty = 2; ty < MAP_TILES - 2 && treeCorridors.length < 40; ty++) {
    for (let tx = 2; tx < MAP_TILES - 2 && treeCorridors.length < 40; tx++) {
      if (!world.isLand(world.getTile(tx, ty))) continue;
      if (world.isSolid(world.getTile(tx, ty))) continue;
      let waterN = 0;
      let landN = 0;
      let solidN = 0;
      const dirs = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ];
      for (let i = 0; i < dirs.length; i++) {
        const t = world.getTile(tx + dirs[i][0], ty + dirs[i][1]);
        if (world.isSlow(t)) waterN++;
        else if (world.isSolid(t)) solidN++;
        else if (world.isLand(t)) landN++;
      }
      if (solidN >= 2 && landN <= 1 && waterN === 0) {
        treeCorridors.push({
          x: tx * TILE_SIZE + TILE_SIZE / 2,
          y: ty * TILE_SIZE + TILE_SIZE / 2,
        });
      }
    }
  }
  assert(
    treeCorridors.length >= 8,
    'found tree-corridor traps for roam vibrate test (' + treeCorridors.length + ')'
  );
  let treeVibrating = 0;
  let treeEscapeThrash = 0;
  const treeSamples = Math.min(24, treeCorridors.length);
  for (let i = 0; i < treeSamples; i++) {
    const spot = treeCorridors[i];
    const wolf = Wildborn.animal.createAnimal('wolf', spot.x, spot.y);
    wolf.state = 'ROAM';
    wolf.calories = wolf.maxCalories * 0.75;
    wolf.spawnX = spot.x;
    wolf.spawnY = spot.y;
    const ctx = makeEdgeCtx('tree-novib-' + i);
    let prevX = wolf.x;
    let prevY = wolf.y;
    let prevDx = 0;
    let prevDy = 0;
    let reversals = 0;
    let steps = 0;
    let pathLen = 0;
    let prevEscDx = 0;
    let prevEscDy = 0;
    let escReversals = 0;
    let escSamples = 0;
    for (let f = 0; f < 200; f++) {
      Wildborn.animal.updateAnimal(wolf, 0.05, ctx);
      Wildborn.animal.clampToMap(wolf, MAP_PIXEL_SIZE);
      const esc = wolf._escapeGoal;
      if (esc) {
        const edx = esc.x - wolf.x;
        const edy = esc.y - wolf.y;
        const elen = Math.hypot(edx, edy);
        if (elen > TILE_SIZE * 0.5) {
          if (
            escSamples > 0 &&
            Math.hypot(prevEscDx, prevEscDy) > 0.5 &&
            edx * prevEscDx + edy * prevEscDy < 0
          ) {
            escReversals++;
          }
          prevEscDx = edx;
          prevEscDy = edy;
          escSamples++;
        }
      }
      const dx = wolf.x - prevX;
      const dy = wolf.y - prevY;
      const moved = Math.hypot(dx, dy);
      if (moved > 0.15 && Math.hypot(prevDx, prevDy) > 0.15) {
        steps++;
        pathLen += moved;
        if (dx * prevDx + dy * prevDy < 0) reversals++;
      }
      if (moved > 0.05) {
        prevDx = dx;
        prevDy = dy;
      }
      prevX = wolf.x;
      prevY = wolf.y;
    }
    const net = Math.hypot(wolf.x - spot.x, wolf.y - spot.y);
    const efficiency = pathLen > 1 ? net / pathLen : 1;
    if (steps >= 20 && reversals / steps > 0.4 && efficiency < 0.2) treeVibrating++;
    // Opposite escape headings more than a few times => sticky goal thrash
    if (escSamples >= 8 && escReversals > 6) treeEscapeThrash++;
  }
  assert(
    treeVibrating === 0,
    'tree-corridor roamers do not vibrate via rapid reversals (' +
      treeVibrating +
      '/' +
      treeSamples +
      ')'
  );
  assert(
    treeEscapeThrash === 0,
    'tree-corridor escape goals do not reverse thrash (' +
      treeEscapeThrash +
      '/' +
      treeSamples +
      ')'
  );

  // Territory rim: without return hysteresis, ROAM ↔ walk-home flipped every
  // frame near TERRITORY_RADIUS and read as vibration against tree lines.
  {
    const radius = Wildborn.animal.TERRITORY_RADIUS;
    let terrVib = 0;
    let terrSamples = 0;
    for (let i = 0; i < 16 && terrSamples < 10; i++) {
      let spot = null;
      for (let n = 0; n < 80 && !spot; n++) {
        const tx = 4 + ((i * 41 + n * 17) % (MAP_TILES - 8));
        const ty = 4 + ((i * 19 + n * 23) % (MAP_TILES - 8));
        const tile = world.getTile(tx, ty);
        if (!world.isLand(tile) || world.isSolid(tile) || world.isSlow(tile)) continue;
        const edgeX = tx * TILE_SIZE + TILE_SIZE / 2 + radius - 4;
        const edgeY = ty * TILE_SIZE + TILE_SIZE / 2;
        if (edgeX >= MAP_PIXEL_SIZE - TILE_SIZE) continue;
        const edgeTile = world.getTileAtPixel(edgeX, edgeY);
        if (!world.isLand(edgeTile) || world.isSolid(edgeTile) || world.isSlow(edgeTile)) {
          continue;
        }
        spot = {
          spawnX: tx * TILE_SIZE + TILE_SIZE / 2,
          spawnY: ty * TILE_SIZE + TILE_SIZE / 2,
          x: edgeX,
          y: edgeY,
        };
      }
      if (!spot) continue;
      terrSamples++;
      const wolf = Wildborn.animal.createAnimal('wolf', spot.x, spot.y);
      wolf.state = 'ROAM';
      wolf.calories = wolf.maxCalories * 0.8;
      wolf.spawnX = spot.spawnX;
      wolf.spawnY = spot.spawnY;
      const ctx = makeEdgeCtx('territory-novib-' + i);
      let prevX = wolf.x;
      let prevY = wolf.y;
      let prevDx = 0;
      let prevDy = 0;
      let reversals = 0;
      let steps = 0;
      let pathLen = 0;
      for (let f = 0; f < 180; f++) {
        Wildborn.animal.updateAnimal(wolf, 0.05, ctx);
        Wildborn.animal.clampToMap(wolf, MAP_PIXEL_SIZE);
        const dx = wolf.x - prevX;
        const dy = wolf.y - prevY;
        const moved = Math.hypot(dx, dy);
        if (moved > 0.15 && Math.hypot(prevDx, prevDy) > 0.15) {
          steps++;
          pathLen += moved;
          if (dx * prevDx + dy * prevDy < 0) reversals++;
        }
        if (moved > 0.05) {
          prevDx = dx;
          prevDy = dy;
        }
        prevX = wolf.x;
        prevY = wolf.y;
      }
      const net = Math.hypot(wolf.x - spot.x, wolf.y - spot.y);
      const efficiency = pathLen > 1 ? net / pathLen : 1;
      if (steps >= 20 && reversals / steps > 0.4 && efficiency < 0.2) terrVib++;
    }
    assert(terrSamples >= 4, 'found territory-rim samples (' + terrSamples + ')');
    assert(
      terrVib === 0,
      'territory-rim roamers do not vibrate via rapid reversals (' +
        terrVib +
        '/' +
        terrSamples +
        ')'
    );
  }

  // Tree+water pockets used to accumulate only obstacle time (water timer stayed
  // 0), so canCrossWater never flipped and animals froze on the shoreline.
  const waterTreeTraps = [];
  for (let ty = 2; ty < MAP_TILES - 2 && waterTreeTraps.length < 24; ty++) {
    for (let tx = 2; tx < MAP_TILES - 2 && waterTreeTraps.length < 24; tx++) {
      if (!world.isLand(world.getTile(tx, ty))) continue;
      let waterN = 0;
      let landN = 0;
      let solidN = 0;
      const dirs = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ];
      for (let i = 0; i < dirs.length; i++) {
        const t = world.getTile(tx + dirs[i][0], ty + dirs[i][1]);
        if (world.isSlow(t)) waterN++;
        else if (world.isLand(t)) landN++;
        else if (world.isSolid(t)) solidN++;
      }
      if (waterN >= 1 && solidN >= 1 && landN <= 1) {
        waterTreeTraps.push({
          x: tx * TILE_SIZE + TILE_SIZE / 2,
          y: ty * TILE_SIZE + TILE_SIZE / 2,
        });
      }
    }
  }
  assert(
    waterTreeTraps.length >= 6,
    'found tree+water shoreline traps (' + waterTreeTraps.length + ')'
  );
  let waterTimerBuilt = 0;
  let waterTreeEscaped = 0;
  for (let i = 0; i < waterTreeTraps.length; i++) {
    const spot = waterTreeTraps[i];
    const deer = Wildborn.animal.createAnimal('deer', spot.x, spot.y);
    deer.state = 'IDLE';
    deer.calories = deer.maxCalories * 0.8;
    const ctx = makeEdgeCtx('water-tree-' + i);
    let maxWater = 0;
    for (let f = 0; f < 80; f++) {
      Wildborn.animal.updateAnimal(deer, 0.1, ctx);
      Wildborn.animal.clampToMap(deer, MAP_PIXEL_SIZE);
      maxWater = Math.max(maxWater, deer._waterStuckTimer || 0);
    }
    if (maxWater >= Wildborn.animal.WATER_STUCK_CROSS_SECONDS * 0.8) {
      waterTimerBuilt++;
    }
    for (let f = 0; f < 200; f++) {
      Wildborn.animal.updateAnimal(deer, 0.1, ctx);
      Wildborn.animal.clampToMap(deer, MAP_PIXEL_SIZE);
    }
    if (Math.hypot(deer.x - spot.x, deer.y - spot.y) >= 28) waterTreeEscaped++;
  }
  assert(
    waterTimerBuilt >= Math.ceil(waterTreeTraps.length * 0.7),
    'tree+water pins build shoreline water-stuck time (' +
      waterTimerBuilt +
      '/' +
      waterTreeTraps.length +
      ')'
  );
  assert(
    waterTreeEscaped >= Math.ceil(waterTreeTraps.length * 0.75),
    'most animals escape tree+water shoreline pins (' +
      waterTreeEscaped +
      '/' +
      waterTreeTraps.length +
      ')'
  );
}

// --- Unit: animals cannot enter trees / mountains (like the caveman) ---
{
  const world = createWorld('solid-block-test');
  world.ensureMapLoaded();
  let solid = null;
  let land = null;
  for (let ty = 0; ty < MAP_TILES && !(solid && land); ty++) {
    for (let tx = 0; tx < MAP_TILES; tx++) {
      const tile = world.getTile(tx, ty);
      if (!solid && world.isSolid(tile)) {
        // Prefer a solid tile with land neighbor so we can place an animal beside it
        const neighbors = [
          [tx - 1, ty],
          [tx + 1, ty],
          [tx, ty - 1],
          [tx, ty + 1],
        ];
        for (let i = 0; i < neighbors.length; i++) {
          const ntx = neighbors[i][0];
          const nty = neighbors[i][1];
          if (ntx < 0 || nty < 0 || ntx >= MAP_TILES || nty >= MAP_TILES) continue;
          const nt = world.getTile(ntx, nty);
          if (world.isLand(nt)) {
            solid = { tx, ty, x: tx * TILE_SIZE + TILE_SIZE / 2, y: ty * TILE_SIZE + TILE_SIZE / 2 };
            land = {
              tx: ntx,
              ty: nty,
              x: ntx * TILE_SIZE + TILE_SIZE / 2,
              y: nty * TILE_SIZE + TILE_SIZE / 2,
            };
            break;
          }
        }
      }
    }
  }
  assert(solid && land, 'found solid tile with adjacent land for collision test');
  assert(Wildborn.animal.isSolidAt({ world }, solid.x, solid.y), 'isSolidAt detects tree/mountain pixels');
  assert(!Wildborn.animal.isSolidAt({ world }, land.x, land.y), 'isSolidAt allows land pixels');

  const deer = Wildborn.animal.createAnimal('deer', land.x, land.y);
  deer.calories = deer.maxCalories * 0.4;
  deer.state = 'SEEK_FOOD';
  deer._hungerSearch = true;
  deer._exploreGoal = { x: solid.x, y: solid.y };
  deer._exploreTimer = 30;
  const ctx = {
    rng: createRng('solid-block'),
    tickSeconds: 0.5,
    world,
    mapPixelSize: MAP_PIXEL_SIZE,
    pathBudget: 100,
    isWater: (x, y) => world.isSlow(world.getTileAtPixel(x, y)),
    isSolid: (x, y) => world.isSolid(world.getTileAtPixel(x, y)),
    findNearestPlant: () => null,
    findNearestAnimal: () => null,
    queryAnimals: () => [],
    spawnSplash: () => {},
  };
  let enteredSolid = false;
  for (let i = 0; i < 90; i++) {
    Wildborn.animal.updateAnimal(deer, 0.1, ctx);
    Wildborn.animal.clampToMap(deer, MAP_PIXEL_SIZE);
    if (world.isSolid(world.getTileAtPixel(deer.x, deer.y))) {
      enteredSolid = true;
      break;
    }
  }
  assert(!enteredSolid, 'animal never enters tree/mountain tiles while pathing toward them');
  assert(
    world.isLand(world.getTileAtPixel(deer.x, deer.y)) ||
      world.isSlow(world.getTileAtPixel(deer.x, deer.y)),
    'animal remains on non-solid terrain after blocked approach'
  );
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
    spawnSplash: () => {},
  };
  // Well-fed: stay roaming
  wolf.calories = wolf.maxCalories * 0.9;
  Wildborn.animal.updateAnimal(wolf, 0.1, ctx);
  assert(wolf.state === 'ROAM', 'predator stays ROAM above 50% calories');

  // Drop to hunt threshold
  wolf.calories = wolf.maxCalories * 0.5;
  Wildborn.animal.updateAnimal(wolf, 0.1, ctx);
  assert(wolf.state === 'SEEK_PREY' && wolf._hunting, 'predator enters SEEK_PREY at ≤50%');

  // Satiate to 70%
  wolf.calories = wolf.maxCalories * 0.75;
  wolf.state = 'SEEK_PREY';
  wolf._hunting = true;
  Wildborn.animal.updateAnimal(wolf, 0.1, ctx);
  assert(wolf.state === 'ROAM' && !wolf._hunting, 'predator returns to ROAM at ≥70%');

  // Bear (carnivore) also hunts at ≤50% with 20-tile sight
  const bear = Wildborn.animal.createAnimal('bear', 100, 100);
  bear.calories = bear.maxCalories * 0.5;
  bear.state = 'ROAM';
  Wildborn.animal.updateAnimal(bear, 0.1, ctx);
  assert(bear.state === 'SEEK_PREY' && bear._hunting, 'bear enters SEEK_PREY at ≤50%');
  assert(
    bear._searchRadius >= Wildborn.animal.PREDATOR_SIGHT_RANGE,
    'predator starts hunt search at 20-tile sight range'
  );
  const prevRadius = bear._searchRadius;
  Wildborn.animal.updateAnimal(bear, 1, ctx);
  assert(bear._searchRadius > prevRadius, 'predator expands prey search across the map');
}

// --- Unit: predators attack other predators at ≤25% calories ---
{
  const bear = Wildborn.animal.createAnimal('bear', 100, 100);
  const otherBear = Wildborn.animal.createAnimal('bear', 130, 100);
  const wolf = Wildborn.animal.createAnimal('wolf', 160, 100);

  function makeCtx(candidates) {
    return {
      rng: createRng('predator-rival'),
      tickSeconds: 0.5,
      isWater: () => false,
      findNearestPlant: () => null,
      findNearestAnimal(x, y, r, pred) {
        let best = null;
        let bestD2 = Infinity;
        for (const a of candidates) {
          if (!pred(a)) continue;
          const d2 = (a.x - x) * (a.x - x) + (a.y - y) * (a.y - y);
          if (d2 <= r * r && d2 < bestD2) {
            best = a;
            bestD2 = d2;
          }
        }
        return best;
      },
      queryAnimals: () => candidates,
      spawnSplash: () => {},
    };
  }

  // At 30%: hunting herbivores only — not other predators yet
  bear.calories = bear.maxCalories * 0.3;
  bear.state = 'SEEK_PREY';
  bear._hunting = true;
  bear.target = null;
  Wildborn.animal.updateAnimal(bear, 0.1, makeCtx([otherBear, wolf]));
  assert(
    bear.target !== otherBear && bear.target !== wolf,
    'predator above 25% does not target other predators'
  );

  // At 25%: attack other predators (any species, including own)
  bear.calories = bear.maxCalories * 0.25;
  bear.target = null;
  Wildborn.animal.updateAnimal(bear, 0.1, makeCtx([otherBear, wolf]));
  assert(
    bear.target === otherBear || bear.target === wolf,
    'predator at ≤25% targets another predator'
  );

  // Own species alone at 25% is also valid
  bear.target = null;
  Wildborn.animal.updateAnimal(bear, 0.1, makeCtx([otherBear]));
  assert(bear.target === otherBear, 'predator at ≤25% targets own species');

  // Close-range attack actually lands on own-species rival at 25%
  otherBear.x = bear.x + 10;
  otherBear.y = bear.y;
  const hpBefore = otherBear.health;
  bear.calories = bear.maxCalories * 0.25;
  bear.target = null;
  bear.attackCooldown = 0;
  Wildborn.animal.updateAnimal(bear, 0.1, makeCtx([otherBear]));
  assert(bear.target === otherBear, 'starving predator locks onto nearby own-species rival');
  assert(otherBear.health < hpBefore, 'predator at ≤25% attacks own species');
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
      sex: 'male',
      isAdult: true,
      id: 1,
    });
    assert(calls > 0 && calls < 120, 'renderShape(' + id + ') draw ops=' + calls + ' (<120)');
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

  const herbExpected = { rabbit: 10, deer: 8, bison: 4, ostrich: 3, turtle: 5 };
  const predExpected = { wolf: 4, bear: 2, alligator: 3 };

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
  let animalsOnSolid = 0;
  for (const a of eco.animals) {
    if (!a.alive) continue;
    if (a.x < 0 || a.y < 0 || a.x > MAP_PIXEL_SIZE || a.y > MAP_PIXEL_SIZE) animalsOut++;
    if (world.isSolid(world.getTileAtPixel(a.x, a.y))) animalsOnSolid++;
  }
  assert(animalsOut === 0, 'no living animals outside map after 60s');
  assert(animalsOnSolid === 0, 'no living animals on trees/mountains after 60s');

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
  assert(Wildborn.animal.canBreed(deerA), 'well-fed animal with cooldown 0 can breed');
  assert(Wildborn.animal.BREED_COOLDOWN === 1200, 'breed cooldown is 600s / 10 min (1200 ticks)');
  assert(Wildborn.animal.BREED_CALORIE_RATIO === 0.8, 'breed requires ≥80% calories');
  const kids = Wildborn.animal.breed(deerA);
  assert(kids.length === 1, 'breed() yields exactly 1 offspring (' + kids.length + ')');
  assert(kids[0].species === 'deer' && kids[0].isAdult, 'offspring is an adult deer');
  assert(kids[0].health === kids[0].maxHealth, 'offspring born at full health');
  assert(kids[0].x === deerA.x && kids[0].y === deerA.y, 'offspring spawns at parent location');
  assert(kids[0].size === kids[0].baseSize, 'offspring starts at full size');
  assert(deerA.breedingCooldown === Wildborn.animal.BREED_COOLDOWN, 'breeding cooldown applied');
  assert(!Wildborn.animal.canBreed(deerA), 'parent cannot breed again until cooldown ends');

  // Omnivores use a doubled reproduction cooldown
  const bearA = Wildborn.animal.createAnimal('bear', 120, 120);
  bearA.calories = bearA.maxCalories;
  bearA.breedingCooldown = 0;
  assert(Wildborn.animal.canBreed(bearA), 'well-fed predator with cooldown 0 can breed');
  const bearKids = Wildborn.animal.breed(bearA);
  assert(bearKids.length === 1, 'predator breed() yields exactly 1 offspring');
  assert(
    bearA.breedingCooldown === Wildborn.animal.PREDATOR_BREED_COOLDOWN,
    'predator parent gets 20 min breeding cooldown'
  );
  assert(
    bearKids[0].breedingCooldown === Wildborn.animal.PREDATOR_BREED_COOLDOWN,
    'predator offspring starts on 20 min breed cooldown'
  );

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
  assert(Wildborn.config.maxAnimals === undefined, 'no maxAnimals population cap');

  console.log('\nFinal stats:', JSON.stringify(afterStats, null, 2));
}

// --- Unit: extinction repopulation — 25 min delay then 4 of the species ---
{
  assert(EXTINCTION_REPOPULATE_COUNT === 4, 'extinction repopulates with 4 animals');
  assert(EXTINCTION_REPOPULATE_DELAY_SECONDS === 1500, 'extinction delay is 1500s (25 min)');
  assert(EXTINCTION_REPOPULATE_DELAY_TICKS === 3000, 'extinction delay is 3000 ticks');

  const world = createWorld('extinction-repop');
  world.ensureMapLoaded();
  const eco = createEcosystem({
    world: world,
    rng: createRng('extinction-repop'),
    config: Object.assign({}, Wildborn.config, { ecosystemTickSeconds: 0.5 }),
    origin: { x: MAP_PIXEL_SIZE / 2, y: MAP_PIXEL_SIZE / 2 },
  });

  // Wipe wolves (leave corpses out of the array so ticks stay cheap)
  for (let i = eco.animals.length - 1; i >= 0; i--) {
    if (eco.animals[i].species === 'wolf') eco.animals.splice(i, 1);
  }
  assert(
    eco.animals.every((a) => a.species !== 'wolf'),
    'wolves removed to simulate extinction'
  );

  // Also drop every other animal so the 25-minute wait is a cheap empty tick loop
  eco.animals.length = 0;

  for (let i = 0; i < EXTINCTION_REPOPULATE_DELAY_TICKS - 1; i++) {
    eco.update(0.5);
  }
  let wolves = eco.animals.filter((a) => a.species === 'wolf' && a.alive);
  assert(wolves.length === 0, 'no wolf respawn before 25 minutes');

  eco.update(0.5);
  wolves = eco.animals.filter((a) => a.species === 'wolf' && a.alive);
  assert(
    wolves.length === EXTINCTION_REPOPULATE_COUNT,
    'exactly 4 wolves spawn after 25 minutes (' + wolves.length + ')'
  );

  // Spot-check another wiped species also recovered
  const rabbits = eco.animals.filter((a) => a.species === 'rabbit' && a.alive);
  assert(
    rabbits.length === EXTINCTION_REPOPULATE_COUNT,
    'other extinct species also repopulate with 4 (' + rabbits.length + ' rabbits)'
  );

  // Positions should not all be identical (random locations)
  const unique = {};
  for (let i = 0; i < wolves.length; i++) {
    unique[Math.round(wolves[i].x) + ',' + Math.round(wolves[i].y)] = true;
  }
  assert(Object.keys(unique).length > 1, 'repopulated animals spawn at varied locations');
}

// --- Unit: population is uncapped — breeding accepts offspring past prior soft-cap ---
{
  const world = createWorld('pop-uncapped');
  world.ensureMapLoaded();
  const eco = createEcosystem({
    world: world,
    rng: createRng('pop-uncapped'),
    config: Object.assign({}, Wildborn.config),
    origin: { x: MAP_PIXEL_SIZE / 2, y: MAP_PIXEL_SIZE / 2 },
  });
  for (let i = 0; i < eco.animals.length; i++) {
    const a = eco.animals[i];
    if (!a.alive || a.state === AI_STATE.DEAD) continue;
    a.calories = a.maxCalories;
    a.breedingCooldown = 0;
  }
  const before = eco.animals.length;
  for (let i = 0; i < 30; i++) {
    eco.update(1 / 30, { x: MAP_PIXEL_SIZE / 2, y: MAP_PIXEL_SIZE / 2 });
  }
  assert(
    eco.animals.length > before,
    'uncapped population allows breeding past prior soft-cap (' + before + ' → ' + eco.animals.length + ')'
  );
  assert(eco.getDebugStats().maxAnimals === undefined, 'debug stats omit maxAnimals');
}

// --- Unit: pathfinder heap still finds short land paths ---
{
  const world = createWorld('path-heap');
  world.ensureMapLoaded();
  let a = null;
  let b = null;
  for (let ty = 0; ty < MAP_TILES && !b; ty++) {
    for (let tx = 0; tx < MAP_TILES; tx++) {
      const tile = world.getTile(tx, ty);
      if (!world.isLand(tile)) continue;
      if (!a) a = { tx, ty };
      else if (Math.abs(tx - a.tx) + Math.abs(ty - a.ty) > 4) {
        b = { tx, ty };
        break;
      }
    }
  }
  assert(a && b, 'found land tiles for heap path test');
  const path = Wildborn.pathfind.findPath(world, a.tx, a.ty, b.tx, b.ty, {
    allowWater: false,
    maxNodes: 2000,
  });
  assert(path && path.length >= 1, 'heap A* finds short path (' + (path && path.length) + ')');
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
