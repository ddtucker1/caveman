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
  assert(p.respawnTimer === RESPAWN_DELAY_TICKS, 'respawn timer starts at 1200s (2400 ticks)');
  assert(RESPAWN_DELAY_TICKS === 2400, 'RESPAWN_DELAY_TICKS is 2400');
  assert(Wildborn.plant.RESPAWN_DELAY_SECONDS === 1200, 'RESPAWN_DELAY_SECONDS is 1200');
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
  assert(Wildborn.animal.EAT_RATE_PER_SEC === 5, 'plant eat rate is 5 cal/sec/animal');
  assert(
    Wildborn.animal.PREDATOR_CALORIE_BURN_PER_SEC === 0.1,
    'predators burn 0.1 cal/sec (1 every 10s)'
  );
  assert(Wildborn.animal.EAT_RANGE === 20, 'eat range is 20px');
  assert(Wildborn.animal.PLANT_SIGHT_RANGE === 256, 'plant sight is 8 tiles (256px)');
  assert(Wildborn.animal.FOOD_DETECT_RANGE === 256, 'food detect matches plant sight');
  assert(Wildborn.animal.WATER_SPEED_MULT === 0.5, 'water speed is 50% of normal');
  assert(Wildborn.animal.AQUATIC_WATER_SPEED_MULT === 2, 'aquatic predator water speed is 2× land');
  assert(Wildborn.animal.TURTLE_WATER_SPEED_MULT === 1, 'turtles keep land speed in water');
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
  assert(rabbit.stamina === 100 && rabbit.maxStamina === 100, 'animals spawn with full stamina');
  const wolf = Wildborn.animal.createAnimal('wolf', 0, 0);
  assert(wolf.diet === 'predator' && wolf.attackPower === 22, 'wolf predator stats');
  assert(wolf.defense === 'none', 'predators default to no flee defense');
  assert(wolf.special == null, 'animals have no special abilities');
  const bear = Wildborn.animal.createAnimal('bear', 0, 0);
  assert(bear.diet === 'omnivore', 'bear is omnivore');
  assert(bear.defense === 'none', 'omnivore predators also never flee by default');
  assert(Wildborn.animal.OMNIVORE_HUNT_RATIO === 0.5, 'omnivores hunt at 50% calories');
  assert(wolf.state === 'ROAM', 'predators spawn in ROAM state');
  assert(wolf.spawnX === 0 && wolf.spawnY === 0, 'predator records spawn territory point');
  const cub = Wildborn.animal.createAnimal('deer', 0, 0, { isOffspring: true });
  assert(cub.isAdult && cub.health === cub.maxHealth, 'offspring born as full-health adults');
  assert(cub.growth === 1 && cub.size === cub.baseSize, 'offspring spawn at full adult size');
  assert(cub.breedingCooldown === Wildborn.animal.BREED_COOLDOWN, 'offspring start on breed cooldown');
  assert(!HERBIVORE_SPECIES.chicken, 'chicken species removed');
  assert(!Wildborn.animal.AI_STATE.SEEK_MATE && !Wildborn.animal.AI_STATE.BREEDING, 'mate-seeking states removed');
}

// --- Unit: predator flat burn / herbivore ÷10 / speed halve ---
{
  const tickSec = Wildborn.config.ecosystemTickSeconds || 0.5;
  const expectedPred = Wildborn.animal.PREDATOR_CALORIE_BURN_PER_SEC * tickSec;
  const predIds = Object.keys(PREDATOR_SPECIES);
  for (let i = 0; i < predIds.length; i++) {
    const a = Wildborn.animal.createAnimal(predIds[i], 0, 0);
    const burn = Wildborn.animal.calorieBurnPerTick(a);
    assert(
      Math.abs(burn - expectedPred) < 0.0001,
      predIds[i] + ' burn is flat 0.1 cal/s (' + burn + ' /tick, expect ' + expectedPred + ')'
    );
  }
  const rabbit = Wildborn.animal.createAnimal('rabbit', 0, 0);
  const herbBurn = Wildborn.animal.calorieBurnPerTick(rabbit);
  // Rabbit: 30/120/10 = 0.025 → floored to 0.1 (still the reduced herbivore path)
  assert(
    Math.abs(herbBurn - 0.1) < 0.0001,
    'herbivore burn stays at reduced rate (' + herbBurn + ')'
  );
  assert(
    !PREDATOR_SPECIES[rabbit.species],
    'rabbit is not on the flat predator burn path'
  );
  const wolf = Wildborn.animal.createAnimal('wolf', 0, 0);
  assert(Wildborn.animal.SPEED.fast === 52.5, 'fast speed halved to 52.5');
  assert(Wildborn.animal.SPEED.very_slow === 14, 'very_slow speed halved to 14');
  assert(wolf.baseSpeed === 52.5, 'wolf baseSpeed uses halved fast');
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

  // Herbivore killed by predator → corpse offers 100% of full calorie level
  {
    const rabbit = Wildborn.animal.createAnimal('rabbit', 100, 100);
    const wolf = Wildborn.animal.createAnimal('wolf', 100, 100);
    rabbit.calories = 12; // current calories ignored — yield is full capacity
    Wildborn.animal.killAnimal(rabbit, wolf);
    assert(rabbit.state === 'DEAD' && !rabbit.alive, 'killed herbivore becomes a corpse');
    assert(
      rabbit.corpseCalories === rabbit.maxCalories,
      'corpse offers 100% of maxCalories (' + rabbit.corpseCalories + '/' + rabbit.maxCalories + ')'
    );
    assert(wolf.state === 'EATING' && wolf.target === rabbit, 'killer starts eating the corpse');
    assert(
      Wildborn.animal.HERBIVORE_SPECIES.rabbit.corpseYield === 1,
      'rabbit corpseYield is 1'
    );
    assert(
      Wildborn.animal.HERBIVORE_SPECIES.bison.corpseYield === 1,
      'bison corpseYield is 1'
    );
    assert(
      Wildborn.animal.HERBIVORE_SPECIES.turtle.corpseYield === 1,
      'turtle corpseYield is 1'
    );
  }

  // Predator keeps eating corpse past 60% / 95% until 100% full
  {
    const corpse = Wildborn.animal.createAnimal('deer', 100, 100);
    const wolf = Wildborn.animal.createAnimal('wolf', 100, 100);
    Wildborn.animal.killAnimal(corpse, null);
    assert(corpse.corpseCalories === corpse.maxCalories, 'deer corpse is full calorie yield');
    wolf.state = 'EATING';
    wolf.target = corpse;
    wolf._hungerSearch = true;
    wolf._hunting = false;
    wolf.calories = wolf.maxCalories * 0.55;
    const before = wolf.calories;
    Wildborn.animal.updateAnimal(wolf, 1.0, corpseEatCtx());
    assert(wolf.state === 'EATING', 'keeps EATING corpse past 55% (no 60% bailout)');
    assert(wolf.target === corpse, 'stays locked on corpse past hunger-return band');
    assert(wolf.calories > before, 'continues transferring corpse calories while locked in');
  }

  // Stops at 100% full even if corpse remains
  {
    const corpse = Wildborn.animal.createAnimal('deer', 100, 100);
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

  // Omnivore (bear) also eats corpse to 100%
  {
    const corpse = Wildborn.animal.createAnimal('cow', 100, 100);
    const bear = Wildborn.animal.createAnimal('bear', 100, 100);
    Wildborn.animal.killAnimal(corpse, null);
    bear.state = 'EATING';
    bear.target = corpse;
    bear.calories = bear.maxCalories - 0.5;
    Wildborn.animal.updateAnimal(bear, 1.0, corpseEatCtx());
    assert(bear.calories >= bear.maxCalories, 'omnivore fills to 100% from corpse');
    assert(bear.state !== 'EATING', 'omnivore leaves EATING once fully full');
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
    assert(corpse.corpseCalories === corpse.maxCalories, 'corpse untouched by herbivore');
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

// --- Unit: herbivores flee from omnivores on sight ---
{
  const deer = Wildborn.animal.createAnimal('deer', 100, 100);
  const bear = Wildborn.animal.createAnimal('bear', 140, 100);
  deer.state = 'IDLE';
  deer.calories = deer.maxCalories * 0.8;
  const fleeCtx = {
    rng: createRng('flee-omnivore'),
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
  assert(deer.state === 'FLEE', 'idle herbivore flees when it sees an omnivore');
  assert(deer.fleeFrom === bear, 'flee target is the omnivore');

  // Also flee while hunger-searching for plants
  const rabbit = Wildborn.animal.createAnimal('rabbit', 100, 100);
  rabbit.state = 'SEEK_FOOD';
  rabbit._hungerSearch = true;
  rabbit.calories = rabbit.maxCalories * 0.4;
  rabbit._exploreGoal = { x: 5000, y: 100 };
  rabbit._exploreTimer = 30;
  Wildborn.animal.updateAnimal(rabbit, 0.1, fleeCtx);
  assert(rabbit.state === 'FLEE', 'hunger-searching herbivore flees from omnivore on sight');
  assert(rabbit.fleeFrom === bear, 'seek-food flee target is the omnivore');
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
  assert(Wildborn.animal.HUNGER_RETURN_RATIO === 0.6, 'hunger search returns at 60%');
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
    wolfSearch.state === 'SEEK_FOOD' && wolfSearch._hungerSearch && !wolfSearch._hunting,
    'predator hunger-searches at ≤50% before hunt mode'
  );

  // Distant map exploration + max speed when stamina is full
  rabbit.stamina = rabbit.maxStamina;
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
    'full stamina hunger-search uses max speed (' + speed.toFixed(1) + ' vs base ' + rabbit.baseSpeed + ')'
  );
}

// --- Unit: turtles equal land/water; alligators double speed in water ---
{
  const turtle = Wildborn.animal.createAnimal('turtle', 100, 100);
  const gator = Wildborn.animal.createAnimal('alligator', 100, 100);
  assert(turtle.aquatic === true, 'turtle is aquatic');
  assert(turtle.waterSpeedMult === 1, 'turtle waterSpeedMult matches land');
  assert(gator.aquatic === true, 'alligator is aquatic');
  assert(gator.waterSpeedMult === 2, 'alligator keeps 2× water speed');
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
  turtle.stamina = turtle.maxStamina;
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
  turtle.stamina = turtle.maxStamina;
  turtle._exploreGoal = { x: 5000, y: 100 };
  turtle._exploreTimer = 30;
  Wildborn.animal.updateAnimal(turtle, 0.2, waterCtx);
  const waterSpeed = Math.hypot(turtle.vx, turtle.vy);
  assert(
    Math.abs(waterSpeed - landSpeed) < landSpeed * 0.15 + 0.5,
    'turtle water speed ≈ land (' + waterSpeed.toFixed(1) + ' vs ' + landSpeed.toFixed(1) + ')'
  );

  gator.calories = gator.maxCalories * 0.25;
  gator.state = 'SEEK_PREY';
  gator._hunting = true;
  gator.stamina = gator.maxStamina;
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
  gator.stamina = gator.maxStamina;
  gator._exploreGoal = { x: 5000, y: 100 };
  gator._exploreTimer = 30;
  Wildborn.animal.updateAnimal(gator, 0.2, waterCtx);
  const gatorWater = Math.hypot(gator.vx, gator.vy);
  assert(
    gatorWater >= gatorLand * 1.9,
    'alligator water speed ~2× land (' + gatorWater.toFixed(1) + ' vs ' + gatorLand.toFixed(1) + ')'
  );
}

// --- Unit: shoreline stuck recovery ---
{
  const deer = Wildborn.animal.createAnimal('deer', 100, 100);
  deer.state = 'SEEK_FOOD';
  deer._hungerSearch = true;
  deer.stamina = deer.maxStamina;
  deer._waterStuckTimer = Wildborn.animal.WATER_STUCK_CROSS_SECONDS;
  assert(
    Wildborn.animal.canCrossWater(deer, {}),
    'hunger-searching animal stuck at water may cross after timeout'
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

  // Omnivores: no 30% hunt gate — hunt prey at ≤50% with expanded search
  const bear = Wildborn.animal.createAnimal('bear', 100, 100);
  bear.calories = bear.maxCalories * 0.5;
  bear.state = 'ROAM';
  Wildborn.animal.updateAnimal(bear, 0.1, ctx);
  assert(bear.state === 'SEEK_PREY' && bear._hunting, 'omnivore enters SEEK_PREY at ≤50%');
  assert(
    bear._searchRadius >= Wildborn.animal.FOOD_DETECT_RANGE * 2,
    'omnivore starts with wider map search radius'
  );
  const prevRadius = bear._searchRadius;
  Wildborn.animal.updateAnimal(bear, 1, ctx);
  assert(bear._searchRadius > prevRadius, 'omnivore expands prey search across the map');
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
  assert(Wildborn.animal.canBreed(deerA), 'well-fed animal with cooldown 0 can breed');
  assert(Wildborn.animal.BREED_COOLDOWN === 1200, 'breed cooldown is 600s / 10 min (1200 ticks)');
  assert(Wildborn.animal.BREED_CALORIE_RATIO === 0.8, 'breed requires ≥80% calories');
  const kids = Wildborn.animal.breed(deerA);
  assert(kids.length === 1, 'breed() yields exactly 1 offspring (' + kids.length + ')');
  assert(kids[0].species === 'deer' && kids[0].isAdult, 'offspring is an adult deer');
  assert(kids[0].health === kids[0].maxHealth, 'offspring born at full health');
  assert(kids[0].x === deerA.x && kids[0].y === deerA.y, 'offspring spawns at parent location');
  assert(kids[0].growth === 1 && kids[0].size === kids[0].baseSize, 'offspring starts at full size');
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
  assert(Wildborn.config.maxAnimals === undefined, 'no maxAnimals population cap');

  console.log('\nFinal stats:', JSON.stringify(afterStats, null, 2));
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
