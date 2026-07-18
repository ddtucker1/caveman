/**
 * Ecosystem animals — herbivores & predators with a shared state machine,
 * hunger, combat, grouping, and asexual reproduction.
 *
 * States: IDLE → SEEK_FOOD → EATING → FLEE → ROAM → SLEEP → DEAD
 */
(function (global) {
  const Wildborn = (global.Wildborn = global.Wildborn || {});

  const AI_STATE = {
    IDLE: 'IDLE',
    SEEK_FOOD: 'SEEK_FOOD',
    SEEK_PREY: 'SEEK_PREY',
    EATING: 'EATING',
    FLEE: 'FLEE',
    ROAM: 'ROAM',
    SLEEP: 'SLEEP',
    DEAD: 'DEAD',
  };

  /** Speed multipliers → pixels per second (halved for observability; min 0.5). */
  const SPEED = {
    very_slow: 14,
    slow: 22.5,
    medium: 35,
    fast: 52.5,
    very_fast: 72.5,
  };
  const MIN_SPEED = 0.5;
  /** Non-aquatic animals on water move at 50% of normal speed. */
  const WATER_SPEED_MULT = 0.5;
  /** Alligators and turtles move at 2× land speed while in water. */
  const AQUATIC_WATER_SPEED_MULT = 2;
  const TILE_SIZE = 32;
  /** Herbivores "see" plants within this many tiles (8 × 32 = 256px). */
  const PLANT_SIGHT_TILES = 8;
  const PLANT_SIGHT_RANGE = PLANT_SIGHT_TILES * TILE_SIZE;

  // ---------------------------------------------------------------------------
  // Species definitions
  // ---------------------------------------------------------------------------

  /** @type {Record<string, object>} */
  const HERBIVORE_SPECIES = {
    rabbit: {
      id: 'rabbit',
      label: 'Rabbit',
      diet: 'herbivore',
      maxGroupSize: 2,
      speed: 'medium',
      caloriesNeededPerDay: 30,
      maxCalories: 60,
      maxHealth: 30,
      defense: 'flee',
      attackPower: 2,
      color: '#c8c0b0',
      size: 8,
      corpseYield: 1,
    },
    deer: {
      id: 'deer',
      label: 'Deer',
      diet: 'herbivore',
      maxGroupSize: 8,
      speed: 'medium',
      caloriesNeededPerDay: 80,
      maxCalories: 160,
      maxHealth: 70,
      defense: 'flee',
      attackPower: 4,
      color: '#8a6238',
      size: 14,
      corpseYield: 1,
    },
    cow: {
      id: 'cow',
      label: 'Cow',
      diet: 'herbivore',
      maxGroupSize: 12,
      speed: 'medium',
      caloriesNeededPerDay: 150,
      maxCalories: 300,
      maxHealth: 120,
      defense: 'none',
      attackPower: 3,
      color: '#d8d0c0',
      accent: '#333',
      size: 18,
      corpseYield: 1,
    },
    raccoon: {
      id: 'raccoon',
      label: 'Raccoon',
      diet: 'herbivore',
      maxGroupSize: 1,
      speed: 'medium',
      caloriesNeededPerDay: 50,
      maxCalories: 100,
      maxHealth: 40,
      defense: 'fight',
      attackPower: 8,
      color: '#6a6a6a',
      size: 10,
      corpseYield: 1,
    },
    bison: {
      id: 'bison',
      label: 'Bison',
      diet: 'herbivore',
      maxGroupSize: 15,
      speed: 'medium',
      caloriesNeededPerDay: 200,
      maxCalories: 400,
      maxHealth: 200,
      defense: 'charge',
      attackPower: 25,
      color: '#5a4030',
      size: 20,
      corpseYield: 1,
    },
    ostrich: {
      id: 'ostrich',
      label: 'Ostrich',
      diet: 'herbivore',
      maxGroupSize: 4,
      speed: 'medium',
      caloriesNeededPerDay: 70,
      maxCalories: 140,
      maxHealth: 80,
      defense: 'kick',
      attackPower: 18,
      color: '#b09060',
      size: 16,
      corpseYield: 1,
    },
    turtle: {
      id: 'turtle',
      label: 'Turtle',
      diet: 'herbivore',
      maxGroupSize: 1,
      speed: 'medium',
      aquatic: true,
      caloriesNeededPerDay: 40,
      maxCalories: 80,
      maxHealth: 150,
      defense: 'flee',
      attackPower: 2,
      color: '#3a6a3a',
      accent: '#2a4a2a',
      size: 11,
      corpseYield: 1,
    },
    lizard: {
      id: 'lizard',
      label: 'Lizard',
      diet: 'herbivore',
      maxGroupSize: 1,
      speed: 'medium',
      caloriesNeededPerDay: 20,
      maxCalories: 40,
      maxHealth: 25,
      defense: 'flee',
      attackPower: 3,
      color: '#5a9a4a',
      size: 7,
      corpseYield: 1,
    },
  };

  /** @type {Record<string, object>} */
  const PREDATOR_SPECIES = {
    wolf: {
      id: 'wolf',
      label: 'Wolf',
      diet: 'predator',
      maxGroupSize: 6,
      speed: 'fast',
      caloriesNeededPerDay: 100,
      maxCalories: 200,
      maxHealth: 90,
      attackStyle: 'bite',
      attackPower: 22,
      color: '#7a7a88',
      size: 13,
      corpseYield: 1,
    },
    lion: {
      id: 'lion',
      label: 'Lion',
      diet: 'predator',
      maxGroupSize: 5,
      speed: 'medium',
      caloriesNeededPerDay: 150,
      maxCalories: 300,
      maxHealth: 140,
      attackStyle: 'claw',
      attackPower: 30,
      color: '#c9a045',
      size: 17,
      corpseYield: 1,
    },
    panther: {
      id: 'panther',
      label: 'Panther',
      diet: 'predator',
      maxGroupSize: 1,
      speed: 'very_fast',
      caloriesNeededPerDay: 90,
      maxCalories: 180,
      maxHealth: 100,
      attackStyle: 'pounce',
      attackPower: 28,
      color: '#1a1a22',
      size: 14,
      corpseYield: 1,
    },
    bear: {
      id: 'bear',
      label: 'Bear',
      diet: 'omnivore',
      maxGroupSize: 2,
      speed: 'fast',
      caloriesNeededPerDay: 250,
      maxCalories: 500,
      maxHealth: 220,
      attackStyle: 'swipe',
      attackPower: 40,
      color: '#4a3020',
      size: 20,
      corpseYield: 1,
    },
    alligator: {
      id: 'alligator',
      label: 'Alligator',
      diet: 'predator',
      maxGroupSize: 1,
      speed: 'slow',
      aquatic: true,
      caloriesNeededPerDay: 180,
      maxCalories: 360,
      maxHealth: 180,
      attackStyle: 'death_roll',
      attackPower: 35,
      color: '#2a5a2a',
      size: 18,
      corpseYield: 1,
    },
  };

  const ALL_SPECIES = Object.assign({}, HERBIVORE_SPECIES, PREDATOR_SPECIES);

  // Timing / thresholds
  /** 600s (10 min) reproduction cooldown at 0.5s/tick → 1200 ticks. */
  const BREED_COOLDOWN = 1200;
  /** Calories must be ≥ 80% of max to reproduce. */
  const BREED_CALORIE_RATIO = 0.8;
  /** Enter SEARCHING_FOR_FOOD at ≤50% calories. */
  const HUNGER_SEEK_RATIO = 0.5;
  /** Leave hunger-search and resume normal behavior at ≥60%. */
  const HUNGER_RETURN_RATIO = 0.6;
  /** Ticks in one "day" for calorie drain (120 × 0.5s ≈ 60s real time). */
  const DAY_TICKS = 120;
  /** Global calorie burn scale — animals previously burned ~10× too fast. */
  const CALORIE_BURN_DIVISOR = 10;
  /** Minimum calories burned per ecosystem tick. */
  const MIN_CALORIE_BURN = 0.5;
  /** Animals must be within 20px of a plant to eat it. */
  const EAT_RANGE = 20;
  const ATTACK_RANGE = 22;
  const FLEE_DETECT_RANGE = 160;
  /** Herbivores enter FLEE when a predator is within this range. */
  const FLEE_ENTER_RANGE = 100;
  /** Herbivores stop fleeing once the predator is this far away. */
  const FLEE_SAFE_RANGE = 200;
  /**
   * While eating a plant, interrupt only if a predator within this range is
   * actively targeting this animal (stubborn eating).
   */
  const EAT_PREDATOR_INTERRUPT_RANGE = 50;
  /** Plant sight / food detect: 8 tiles = 256px. Prey detect uses the same base. */
  const FOOD_DETECT_RANGE = PLANT_SIGHT_RANGE;
  /** Plant eating: 5 calories per second per animal (real-time in updateEating). Stacks. */
  const EAT_RATE_PER_SEC = 5;
  /** Predators burn 1 calorie every 10 seconds (flat rate for all predator species). */
  const PREDATOR_CALORIE_BURN_PER_SEC = 0.1;
  /** Corpse transfer rate (calories per ecosystem tick). */
  const EAT_RATE = 6;
  const ATTACK_COOLDOWN_TICKS = 2;
  const IDLE_WANDER_CHANCE = 0.35;
  /** Recompute grid path at most this often (seconds). */
  const PATH_REPATH_SECONDS = 0.45;

  /** Predators hunt at ≤30% calories; return to roaming at ≥80%. */
  const PREDATOR_HUNT_RATIO = 0.3;
  /** Omnivores skip the 30% hunt gate — actively hunt prey at ≤50% calories. */
  const OMNIVORE_HUNT_RATIO = 0.5;
  const PREDATOR_SATIATED_RATIO = 0.8;
  /** Omnivore prey search expands faster than herbivore plant search (tiles/sec). */
  const OMNIVORE_SEARCH_EXPAND_TILES_PER_SEC = 5;
  /** Omnivores start hunger/hunt search at 2× base detect range. */
  const OMNIVORE_INITIAL_SEARCH_MULT = 2;
  /** Roam within this radius of spawn while not hunting. */
  const TERRITORY_RADIUS = 200;
  /** Flee desperation: cross water if predator within this distance. */
  const WATER_DESPERATION_FLEE_DIST = 100;
  /** Starvation desperation: cross water below this calorie ratio. */
  const WATER_DESPERATION_STARVE_RATIO = 0.2;
  /** Seconds pinned at a water edge before allowing a temporary water crossing. */
  const WATER_STUCK_CROSS_SECONDS = 1.25;
  /** Minimum map fraction to travel when hunger-searching distant areas. */
  const HUNGER_EXPLORE_MIN_MAP_FRAC = 0.35;
  /**
   * At ≤50% calories, commit to running one direction longer so animals
   * observe new parts of the map before picking another heading.
   */
  const HUNGER_EXPLORE_GOAL_MIN = 22;
  const HUNGER_EXPLORE_GOAL_MAX = 40;
  /** Poop while roaming: every 5–10s, fade after 30s. */
  const POOP_INTERVAL_MIN = 5;
  const POOP_INTERVAL_MAX = 10;
  const POOP_FADE_SECONDS = 30;

  /** Sleep / nap. */
  const SLEEP_ENTER_RATIO = 0.9;
  const SLEEP_WAKE_RATIO = 0.7;
  const SLEEP_IDLE_SECONDS = 5;
  const SLEEP_MIN_SECONDS = 10;
  const SLEEP_MAX_SECONDS = 60;
  const SLEEP_WAKE_PREDATOR_RANGE = 150;
  const SLEEP_WAKE_FOOD_RANGE = 100;
  const SLEEP_RANDOM_WAKE_CHANCE = 0.02;
  const SLEEP_TILT_SECONDS = 1;

  let nextAnimalId = 1;

  // ---------------------------------------------------------------------------
  // Factory
  // ---------------------------------------------------------------------------

  /**
   * @param {string} speciesId
   * @param {number} x
   * @param {number} y
   * @param {{ isOffspring?: boolean, groupId?: number, sex?: string }} [opts]
   */
  function createAnimal(speciesId, x, y, opts) {
    opts = opts || {};
    const def = ALL_SPECIES[speciesId];
    if (!def) throw new Error('Unknown animal species: ' + speciesId);

    const isOffspring = !!opts.isOffspring;
    const maxCal = def.maxCalories;
    // Spawn well-fed so the ecosystem stabilizes before the first hunt.
    // Animals have no age — born as full-health adults.
    const startCal = maxCal * 0.85 + Math.random() * maxCal * 0.1;

    const baseSpeed = Math.max(MIN_SPEED, SPEED[def.speed] || SPEED.medium);
    const isPred = def.diet === 'predator' || def.diet === 'omnivore';

    return {
      kind: 'animal',
      id: nextAnimalId++,
      species: speciesId,
      diet: def.diet,
      label: def.label,
      x: x,
      y: y,
      vx: 0,
      vy: 0,
      /** Home point for predator territory roaming. */
      spawnX: x,
      spawnY: y,

      calories: startCal,
      maxCalories: maxCal,
      caloriesNeededPerDay: def.caloriesNeededPerDay,
      health: def.maxHealth,
      maxHealth: def.maxHealth,

      /** Per-animal reproduction cooldown in ticks (persists with animal state). */
      breedingCooldown: isOffspring
        ? BREED_COOLDOWN
        : Math.floor(Math.random() * BREED_COOLDOWN),
      growth: 1,
      isAdult: true,

      state: isPred ? AI_STATE.ROAM : AI_STATE.IDLE,
      stateTimer: 0,
      target: null,
      fleeFrom: null,
      /** Accumulated seconds in IDLE/ROAM toward nap. */
      idleAccum: 0,
      /** Seconds spent in current nap. */
      sleepTimer: 0,
      /** Visual lie-down tilt 0 → π/2. */
      sleepTilt: 0,
      /** Zzz particle list for sleep visuals. */
      zzzParticles: [],
      _zzzSpawn: 0,
      /** True while in hunger-search (≤50% calories, orange eyes). */
      _hungerSearch: false,
      /** Expanding plant detect radius while hunger-searching (herbivores). */
      _searchRadius: PLANT_SIGHT_RANGE,
      /** Spiral-search state for predators in hunger-search. */
      _spiralAngle: 0,
      _spiralRadius: 0,
      _spiralOriginX: null,
      _spiralOriginY: null,
      /** Distant map waypoint while hunger-/hunt-searching. */
      _exploreGoal: null,
      _exploreTimer: 0,
      /** Seconds spent soft-rejected at a water shoreline. */
      _waterStuckTimer: 0,

      groupId: opts.groupId != null ? opts.groupId : 0,
      maxGroupSize: def.maxGroupSize,
      sex: opts.sex || (Math.random() < 0.5 ? 'male' : 'female'),

      speedKey: def.speed,
      baseSpeed: baseSpeed,
      /** Aquatic species cross water freely; waterSpeedMult controls swim vs land pace. */
      aquatic: !!(def.aquatic || def.waterSpeed),
      waterSpeedKey: def.waterSpeed || null,
      /** Relative water speed (alligator/turtle default to 2× land). */
      waterSpeedMult:
        def.waterSpeedMult != null
          ? def.waterSpeedMult
          : def.aquatic || def.waterSpeed
            ? AQUATIC_WATER_SPEED_MULT
            : 1,
      attackPower: def.attackPower || 5,
      // Predators never flee; herbivores default to fleeing when hit.
      defense: def.defense || (isPred ? 'none' : 'flee'),
      attackStyle: def.attackStyle || null,
      corpseYield: def.corpseYield != null ? def.corpseYield : 1,

      color: def.color,
      accent: def.accent || null,
      baseSize: def.size,
      size: def.size,

      attackCooldown: 0,
      /** Seconds until next visual poop while roaming (predators). */
      poopTimer: isPred ? 5 + Math.random() * 5 : 0,

      // Corpse fields (set on death)
      corpseCalories: 0,
      corpseDecay: 0,
      alive: true,
    };
  }

  /**
   * Per-tick calorie drain.
   * Predators (wolf/lion/panther/bear/alligator): flat 0.1 cal/sec
   *   → PREDATOR_CALORIE_BURN_PER_SEC × ecosystemTickSeconds per tick.
   * Herbivores: (daily need / DAY_TICKS) / 10, rounded to 1 decimal.
   * Floor at MIN_CALORIE_BURN (0.5). Species whose scaled rate is below the floor
   * keep a 2-decimal scaled value so small animals are not forced to burn faster.
   */
  function calorieBurnPerTick(animal) {
    // Flat predator burn — all PREDATOR_SPECIES (includes omnivore bear)
    if (PREDATOR_SPECIES[animal.species]) {
      const tickSec =
        (Wildborn.config && Wildborn.config.ecosystemTickSeconds) || 0.5;
      return PREDATOR_CALORIE_BURN_PER_SEC * tickSec;
    }
    const raw = animal.caloriesNeededPerDay / DAY_TICKS / CALORIE_BURN_DIVISOR;
    const rounded = Math.round(raw * 10) / 10;
    if (rounded >= MIN_CALORIE_BURN) return rounded;
    // Preserve relative differences for sub-0.5 scaled rates (still ~10× slower)
    return Math.max(0.1, Math.round(raw * 100) / 100);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function isHerbivore(a) {
    return a.diet === 'herbivore' || a.diet === 'omnivore';
  }

  function isPredator(a) {
    return a.diet === 'predator' || a.diet === 'omnivore';
  }

  /** Ready to reproduce asexually: calories ≥ 80%, cooldown expired. */
  function canBreed(a) {
    return (
      a.alive &&
      a.state !== AI_STATE.DEAD &&
      a.breedingCooldown <= 0 &&
      a.calories >= a.maxCalories * BREED_CALORIE_RATIO
    );
  }

  function defaultRestState(animal) {
    return isPredator(animal) && animal.diet !== 'herbivore'
      ? AI_STATE.ROAM
      : AI_STATE.IDLE;
  }

  function enterSleep(animal) {
    animal.state = AI_STATE.SLEEP;
    animal.vx = 0;
    animal.vy = 0;
    animal.target = null;
    animal.fleeFrom = null;
    animal.idleAccum = 0;
    animal.sleepTimer = 0;
    animal.sleepTilt = 0;
    animal._zzzSpawn = 0;
    animal.zzzParticles = [];
    clearHungerSearch(animal);
  }

  function wakeAnimal(animal) {
    animal.state = defaultRestState(animal);
    animal.sleepTimer = 0;
    animal.sleepTilt = 0;
    animal.zzzParticles = [];
    animal._zzzSpawn = 0;
    animal.idleAccum = 0;
  }

  function hungerRatio(a) {
    return a.calories / a.maxCalories;
  }

  function isHungry(a) {
    return hungerRatio(a) <= HUNGER_SEEK_RATIO;
  }

  /** Calories ratio at which an animal enters active prey hunting. */
  function huntThreshold(animal) {
    if (animal.diet === 'omnivore') return OMNIVORE_HUNT_RATIO;
    return PREDATOR_HUNT_RATIO;
  }

  function initialSearchRadius(animal) {
    if (animal.diet === 'omnivore') {
      return FOOD_DETECT_RANGE * OMNIVORE_INITIAL_SEARCH_MULT;
    }
    return FOOD_DETECT_RANGE;
  }

  /** Begin map-wide prey hunt (omnivores at ≤50%, predators at ≤30%). */
  function enterPreyHunt(animal) {
    animal._hunting = true;
    animal._hungerSearch = false;
    animal.idleAccum = 0;
    animal.target = null;
    animal._searchRadius = initialSearchRadius(animal);
    animal._spiralAngle = 0;
    animal._spiralRadius = TILE_SIZE * 2;
    animal._spiralOriginX = animal.x;
    animal._spiralOriginY = animal.y;
    animal._exploreGoal = null;
    animal._exploreTimer = 0;
    animal._waterStuckTimer = 0;
    if (animal.state !== AI_STATE.EATING) {
      animal.state = AI_STATE.SEEK_PREY;
    }
    clearPath(animal);
  }

  function enterHungerSearch(animal) {
    animal._hungerSearch = true;
    animal.idleAccum = 0;
    animal.target = null;
    animal._searchRadius = initialSearchRadius(animal);
    animal._spiralAngle = 0;
    animal._spiralRadius = TILE_SIZE * 2;
    animal._spiralOriginX = animal.x;
    animal._spiralOriginY = animal.y;
    animal._exploreGoal = null;
    animal._exploreTimer = 0;
    animal._waterStuckTimer = 0;
    animal.state = AI_STATE.SEEK_FOOD;
    clearPath(animal);
  }

  function clearHungerSearch(animal) {
    animal._hungerSearch = false;
    animal._searchRadius = FOOD_DETECT_RANGE;
    animal._spiralAngle = 0;
    animal._spiralRadius = 0;
    animal._spiralOriginX = null;
    animal._spiralOriginY = null;
    animal._exploreGoal = null;
    animal._exploreTimer = 0;
    animal._waterStuckTimer = 0;
  }

  /** Max search radius that covers the full map from any point. */
  function mapSearchCap(ctx) {
    const mapPx = (ctx && ctx.mapPixelSize) || 12800;
    return mapPx * 1.5;
  }

  function dist2(ax, ay, bx, by) {
    const dx = ax - bx;
    const dy = ay - by;
    return dx * dx + dy * dy;
  }

  function aquaticWaterSpeedMult(animal) {
    if (animal.waterSpeedMult != null) return animal.waterSpeedMult;
    return AQUATIC_WATER_SPEED_MULT;
  }

  function effectiveSpeed(animal, speedMult) {
    speedMult = speedMult == null ? 1 : speedMult;
    let speed = Math.max(MIN_SPEED, animal.baseSpeed * speedMult);
    if (animal._inWater) {
      // Aquatic (alligator/turtle): 2× land pace; everyone else: half speed
      if (animal.aquatic) {
        speed = Math.max(
          MIN_SPEED,
          animal.baseSpeed * aquaticWaterSpeedMult(animal) * speedMult
        );
      } else {
        speed *= WATER_SPEED_MULT;
      }
    }
    return Math.max(MIN_SPEED, speed);
  }

  /**
   * True when the animal may enter water: aquatic species, fleeing a nearby
   * predator, starving, or stuck on a shoreline while hunger-searching.
   */
  function canCrossWater(animal, ctx) {
    if (animal.aquatic || animal.waterSpeedKey) return true;
    if (animal.state === AI_STATE.FLEE && animal.fleeFrom && animal.fleeFrom.alive) {
      const d = Math.hypot(animal.x - animal.fleeFrom.x, animal.y - animal.fleeFrom.y);
      if (d <= WATER_DESPERATION_FLEE_DIST) return true;
    }
    // Starving animals may cross even before a food target is locked
    if (hungerRatio(animal) < WATER_DESPERATION_STARVE_RATIO) {
      return true;
    }
    // Shoreline pin: allow a temporary crossing so hunger-search can continue
    if (
      (animal._hungerSearch || animal._hunting) &&
      (animal._waterStuckTimer || 0) >= WATER_STUCK_CROSS_SECONDS
    ) {
      return true;
    }
    return false;
  }

  /**
   * Pick a dry (when possible) waypoint in a completely different part of the map.
   */
  function pickDistantExploreGoal(animal, ctx) {
    const mapPx = (ctx && ctx.mapPixelSize) || 12800;
    const pad = TILE_SIZE * 2;
    const minDist = mapPx * HUNGER_EXPLORE_MIN_MAP_FRAC;
    const rng = (ctx && ctx.rng) || { float: function () { return Math.random(); } };
    let fallback = null;
    for (let i = 0; i < 12; i++) {
      const x = pad + rng.float() * (mapPx - pad * 2);
      const y = pad + rng.float() * (mapPx - pad * 2);
      const d = Math.hypot(x - animal.x, y - animal.y);
      if (d < minDist) continue;
      if (!fallback) fallback = { x: x, y: y };
      if (ctx && ctx.isWater && ctx.isWater(x, y) && !canCrossWater(animal, ctx)) continue;
      return { x: x, y: y };
    }
    if (fallback) return fallback;
    // Opposite corner of the map from the animal's current position
    return {
      x: Math.max(pad, Math.min(mapPx - pad, mapPx - animal.x)),
      y: Math.max(pad, Math.min(mapPx - pad, mapPx - animal.y)),
    };
  }

  /**
   * Try stepping along the shoreline toward a blocked goal instead of freezing.
   * Returns true if a dry step was applied.
   */
  function tryShoreSlide(animal, tx, ty, dt, speedMult, ctx) {
    const dx = tx - animal.x;
    const dy = ty - animal.y;
    const len = Math.hypot(dx, dy) || 1;
    const fx = dx / len;
    const fy = dy / len;
    // Perpendicular shore directions + slight forward bias
    const candidates = [
      { x: -fy, y: fx },
      { x: fy, y: -fx },
      { x: -fy * 0.7 + fx * 0.3, y: fx * 0.7 + fy * 0.3 },
      { x: fy * 0.7 + fx * 0.3, y: -fx * 0.7 + fy * 0.3 },
      { x: -fx, y: -fy },
    ];
    const speed = effectiveSpeed(animal, speedMult);
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const cl = Math.hypot(c.x, c.y) || 1;
      const nx = animal.x + (c.x / cl) * speed * dt;
      const ny = animal.y + (c.y / cl) * speed * dt;
      if (ctx.isWater && ctx.isWater(nx, ny)) continue;
      animal.vx = (c.x / cl) * speed;
      animal.vy = (c.y / cl) * speed;
      animal.x = nx;
      animal.y = ny;
      return true;
    }
    return false;
  }

  /**
   * Ensure animal has a fresh grid path toward (tx, ty).
   * Uses A* on the 400×400 map; water only when desperate / alligator.
   * Honors per-frame pathfinding budget from the ecosystem context.
   */
  function ensurePath(animal, tx, ty, ctx) {
    if (!ctx || !ctx.world || !Wildborn.pathfind) return null;
    animal._pathTimer = (animal._pathTimer || 0) - (ctx._frameDt || 0.016);
    const goalChanged =
      !animal._pathGoal ||
      Math.hypot(animal._pathGoal.x - tx, animal._pathGoal.y - ty) > TILE_SIZE * 0.75;
    const allowWater = canCrossWater(animal, ctx);
    const allowChanged = !!animal._pathAllowWater !== !!allowWater;
    if (!goalChanged && !allowChanged && animal._pathTimer > 0) {
      if (animal._path && animal._pathIndex < animal._path.length) return animal._path;
      // Cache empty (already there) and null (failed) until repath timer expires
      if (animal._path && animal._path.length === 0) return animal._path;
      if (animal._pathFailureCached) return null;
    }

    // Keep the old path when the frame path budget is spent (smooth FPS under load).
    if (ctx.pathBudget != null && ctx.pathBudget <= 0) {
      if (animal._path && animal._pathIndex < animal._path.length) return animal._path;
      return animal._pathFailureCached ? null : animal._path;
    }
    if (ctx.pathBudget != null) ctx.pathBudget -= 1;

    const maxNodes =
      (Wildborn.config && Wildborn.config.pathfindMaxNodes) || undefined;
    const path = Wildborn.pathfind.pathToPixel(
      ctx.world,
      animal.x,
      animal.y,
      tx,
      ty,
      { allowWater: allowWater, maxNodes: maxNodes }
    );
    // Keep null on failure so callers do not walk a straight line into water
    animal._path = path;
    animal._pathFailureCached = path == null;
    animal._pathIndex = 0;
    animal._pathGoal = { x: tx, y: ty };
    animal._pathTimer = PATH_REPATH_SECONDS;
    animal._pathAllowWater = allowWater;
    return animal._path;
  }

  function clearPath(animal) {
    animal._path = null;
    animal._pathIndex = 0;
    animal._pathGoal = null;
    animal._pathTimer = 0;
    animal._pathFailureCached = false;
  }

  function moveToward(animal, tx, ty, dt, speedMult, ctx) {
    if (ctx) ctx._frameDt = dt;

    let waypoint = { x: tx, y: ty };
    if (ctx && ctx.world && Wildborn.pathfind) {
      const path = ensurePath(animal, tx, ty, ctx);
      if (path && path.length) {
        // Advance along waypoints
        while (
          animal._pathIndex < path.length &&
          Math.hypot(path[animal._pathIndex].x - animal.x, path[animal._pathIndex].y - animal.y) < 10
        ) {
          animal._pathIndex++;
        }
        if (animal._pathIndex < path.length) {
          waypoint = path[animal._pathIndex];
        } else {
          waypoint = { x: tx, y: ty };
        }
      } else if (path && path.length === 0) {
        // Already on the goal tile — step directly to the pixel target
        waypoint = { x: tx, y: ty };
      } else {
        // path == null → A* failed (usually water blocking a dry-only search)
        if (!canCrossWater(animal, ctx) && ctx.isWater && ctx.isWater(tx, ty)) {
          // Goal is in water — slide along shore instead of freezing
          animal._waterStuckTimer = (animal._waterStuckTimer || 0) + dt;
          if (tryShoreSlide(animal, tx, ty, dt, speedMult, ctx)) return;
          animal.vx = 0;
          animal.vy = 0;
          return;
        }
        if (!canCrossWater(animal, ctx)) {
          // No dry path across water — slide shoreward rather than bee-line into the edge
          animal._waterStuckTimer = (animal._waterStuckTimer || 0) + dt;
          if (tryShoreSlide(animal, tx, ty, dt, speedMult, ctx)) return;
          // Replan with water allowed once stuck long enough (canCrossWater flips)
          if ((animal._waterStuckTimer || 0) >= WATER_STUCK_CROSS_SECONDS) {
            clearPath(animal);
            const wetPath = ensurePath(animal, tx, ty, ctx);
            if (wetPath && wetPath.length) {
              waypoint = wetPath[animal._pathIndex] || { x: tx, y: ty };
            } else {
              waypoint = { x: tx, y: ty };
            }
          } else {
            animal.vx = 0;
            animal.vy = 0;
            return;
          }
        }
        // Allowed to cross (or no water issue) — fall through to direct move
      }
    }

    const dx = waypoint.x - animal.x;
    const dy = waypoint.y - animal.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.5) {
      animal.vx = 0;
      animal.vy = 0;
      animal._waterStuckTimer = 0;
      return;
    }
    const speed = effectiveSpeed(animal, speedMult);

    animal.vx = (dx / len) * speed;
    animal.vy = (dy / len) * speed;
    const prevX = animal.x;
    const prevY = animal.y;
    animal.x += animal.vx * dt;
    animal.y += animal.vy * dt;

    // Soft reject illegal water entry when not allowed
    if (
      ctx &&
      ctx.isWater &&
      ctx.isWater(animal.x, animal.y) &&
      !canCrossWater(animal, ctx)
    ) {
      animal.x = prevX;
      animal.y = prevY;
      animal._waterStuckTimer = (animal._waterStuckTimer || 0) + dt;
      clearPath(animal);
      if (tryShoreSlide(animal, tx, ty, dt, speedMult, ctx)) return;
      animal.vx = 0;
      animal.vy = 0;
      return;
    }

    // Made progress on dry land / allowed water
    if (Math.hypot(animal.x - prevX, animal.y - prevY) > 0.2) {
      animal._waterStuckTimer = Math.max(0, (animal._waterStuckTimer || 0) - dt * 2);
    }

    // Splash particles when moving through water
    if (animal._inWater && ctx && ctx.spawnSplash) {
      const moved = Math.hypot(animal.x - prevX, animal.y - prevY);
      if (moved > 0.5) ctx.spawnSplash(animal.x, animal.y);
    }
  }

  function wander(animal, dt, rng, ctx) {
    if (animal.stateTimer <= 0 || (animal.vx === 0 && animal.vy === 0)) {
      const angle = rng.float() * Math.PI * 2;
      let speed = Math.max(MIN_SPEED, animal.baseSpeed * 0.4);
      if (animal._inWater) {
        speed = animal.aquatic
          ? Math.max(MIN_SPEED, animal.baseSpeed * aquaticWaterSpeedMult(animal) * 0.4)
          : speed * WATER_SPEED_MULT;
      }
      animal.vx = Math.cos(angle) * speed;
      animal.vy = Math.sin(angle) * speed;
      animal.stateTimer = 1 + rng.float() * 2;
    }

    // Soft water avoidance while wandering (unless desperate / aquatic)
    let nx = animal.x + animal.vx * dt;
    let ny = animal.y + animal.vy * dt;
    if (ctx && ctx.isWater && ctx.isWater(nx, ny) && !canCrossWater(animal, ctx)) {
      // Sample several dry escape headings instead of a reverse bounce-lock
      let found = false;
      const baseAng = Math.atan2(animal.vy, animal.vx);
      const tryAngles = [
        baseAng + Math.PI,
        baseAng + Math.PI * 0.5,
        baseAng - Math.PI * 0.5,
        baseAng + Math.PI * 0.75,
        baseAng - Math.PI * 0.75,
        rng.float() * Math.PI * 2,
        rng.float() * Math.PI * 2,
      ];
      const speed = Math.hypot(animal.vx, animal.vy) || Math.max(MIN_SPEED, animal.baseSpeed * 0.4);
      for (let i = 0; i < tryAngles.length; i++) {
        const ax = Math.cos(tryAngles[i]) * speed;
        const ay = Math.sin(tryAngles[i]) * speed;
        const tx = animal.x + ax * dt;
        const ty = animal.y + ay * dt;
        if (ctx.isWater(tx, ty)) continue;
        animal.vx = ax;
        animal.vy = ay;
        nx = tx;
        ny = ty;
        found = true;
        break;
      }
      animal.stateTimer = 0.4 + rng.float() * 0.6;
      if (!found) {
        // Fully boxed by water — mark stuck so canCrossWater can eventually free them
        animal._waterStuckTimer = (animal._waterStuckTimer || 0) + dt;
        animal.vx = 0;
        animal.vy = 0;
        animal.stateTimer = 0;
        return;
      }
    }

    const prevX = animal.x;
    const prevY = animal.y;
    animal.x = nx;
    animal.y = ny;
    animal.stateTimer -= dt;

    if (animal._inWater && ctx && ctx.spawnSplash) {
      const moved = Math.hypot(animal.x - prevX, animal.y - prevY);
      if (moved > 0.5) ctx.spawnSplash(animal.x, animal.y);
    }
  }

  function applyDamage(target, amount, attacker) {
    if (!target.alive || target.state === AI_STATE.DEAD) return 0;
    const dmg = amount;
    target.health -= dmg;
    if (target.health <= 0) {
      killAnimal(target, attacker);
      return dmg;
    }
    // Predators never get scared of prey — keep attacking until the target is dead.
    if (isPredator(target) && target.diet !== 'herbivore') {
      target.fleeFrom = null;
      target._counterAttack = false;
      if (attacker && attacker.alive && attacker.state !== AI_STATE.DEAD) {
        target.target = attacker;
        if (target.state !== AI_STATE.EATING) {
          target.state = AI_STATE.SEEK_PREY;
          target._hunting = true;
        }
      }
      return dmg;
    }
    // Defensive reactions (herbivores / prey)
    if (target.defense === 'flee') {
      target.state = AI_STATE.FLEE;
      target.fleeFrom = attacker;
      target.stateTimer = 2.5;
    } else if (target.defense === 'fight' || target.defense === 'charge' || target.defense === 'kick') {
      target.state = AI_STATE.FLEE; // reuse flee state as "combat engage"
      target.fleeFrom = attacker;
      target.target = attacker;
      target.stateTimer = 3;
      target._counterAttack = true;
    }
    return dmg;
  }

  function killAnimal(animal, killer) {
    animal.alive = false;
    animal.state = AI_STATE.DEAD;
    animal.health = 0;
    animal.vx = 0;
    animal.vy = 0;
    // Dead bodies offer 100% of the animal's full calorie capacity to scavengers.
    animal.corpseCalories = animal.maxCalories * animal.corpseYield;
    animal.corpseDecay = 80; // ticks until corpse vanishes
    animal.deadAt = null; // render sets wall-clock time on first draw
    animal.target = null;
    if (killer && killer.alive) {
      // Killer may immediately start eating
      killer.target = animal;
      killer.state = AI_STATE.EATING;
    }
  }

  /**
   * Asexual reproduction: spawn 1 offspring at the parent's location.
   * @returns {object[]}
   */
  function breed(parent) {
    const kid = createAnimal(parent.species, parent.x, parent.y, {
      isOffspring: true,
      groupId: parent.groupId,
    });
    parent.breedingCooldown = BREED_COOLDOWN;
    return [kid];
  }

  // ---------------------------------------------------------------------------
  // Per-frame movement / AI (dt in seconds)
  // ---------------------------------------------------------------------------

  /**
   * Continuous update (movement & timed effects). Discrete hunger/reproduction happen in tickAnimal.
   * @param {object} animal
   * @param {number} dt
   * @param {object} ctx  ecosystem context (grids, rng, world helpers)
   */
  function updateAnimal(animal, dt, ctx) {
    if (animal.state === AI_STATE.DEAD) return;

    if (animal.attackCooldown > 0) animal.attackCooldown -= dt;

    // Water flag for aquatic / water-crossing movement
    if (ctx.isWater) {
      animal._inWater = ctx.isWater(animal.x, animal.y);
    }

    // Predator/omnivore hunger gate: predators hunt ≤30%; omnivores hunt prey ≤50%
    if (isPredator(animal) && animal.diet !== 'herbivore' && animal.state !== AI_STATE.SLEEP) {
      updatePredatorHungerGate(animal);
    }

    // Hunger search at ≤50%: ignore territory, seek food map-wide
    maybeUpdateHungerSearch(animal, dt);

    switch (animal.state) {
      case AI_STATE.IDLE:
        updateIdle(animal, dt, ctx);
        break;
      case AI_STATE.ROAM:
        updateRoam(animal, dt, ctx);
        break;
      case AI_STATE.SEEK_FOOD:
      case AI_STATE.SEEK_PREY:
        animal.idleAccum = 0;
        updateSeekFood(animal, dt, ctx);
        break;
      case AI_STATE.EATING:
        animal.idleAccum = 0;
        updateEating(animal, dt, ctx);
        break;
      case AI_STATE.FLEE:
        animal.idleAccum = 0;
        updateFlee(animal, dt, ctx);
        break;
      case AI_STATE.SLEEP:
        updateSleep(animal, dt, ctx);
        break;
      default:
        wander(animal, dt, ctx.rng, ctx);
    }
  }

  /**
   * Predators: ROAM while calories > 50%; hunger-search at ≤50%;
   * enter SEEK_PREY hunt at ≤30%; stay hunting until calories ≥ 80%, then ROAM.
   * Omnivores: no 30% hunt gate — enter active prey hunt at ≤50% calories.
   * Hunger-search (not full hunt) returns to ROAM at ≥60%.
   */
  function updatePredatorHungerGate(animal) {
    const ratio = hungerRatio(animal);
    if (animal.state === AI_STATE.DEAD || animal.state === AI_STATE.FLEE || animal.state === AI_STATE.SLEEP) return;

    const threshold = huntThreshold(animal);

    // Omnivores: at ≤50% immediately hunt prey map-wide (no intermediate hunger-search)
    if (animal.diet === 'omnivore' && ratio <= threshold) {
      if (!animal._hunting) enterPreyHunt(animal);
      else if (animal.state !== AI_STATE.EATING) animal.state = AI_STATE.SEEK_PREY;
      return;
    }

    // Pure predators: full hunt mode at ≤30%
    if (animal.diet !== 'omnivore' && ratio <= threshold) {
      if (!animal._hunting) enterPreyHunt(animal);
      else if (animal.state !== AI_STATE.EATING) animal.state = AI_STATE.SEEK_PREY;
      return;
    }

    if (animal._hunting) {
      if (ratio >= PREDATOR_SATIATED_RATIO) {
        animal.state = AI_STATE.ROAM;
        animal.target = null;
        animal._hunting = false;
        clearHungerSearch(animal);
      } else if (animal.state !== AI_STATE.EATING) {
        animal.state = AI_STATE.SEEK_PREY;
      }
      return;
    }

    // Predator hunger-search band (30%–50%]: seek food, return at ≥60%
    // Omnivores never use this band — they hunt at 50%.
    if (animal.diet === 'omnivore') {
      if (animal.state === AI_STATE.IDLE) animal.state = AI_STATE.ROAM;
      return;
    }

    if (animal._hungerSearch || animal.state === AI_STATE.SEEK_FOOD || animal.state === AI_STATE.EATING) {
      if (animal._hungerSearch && ratio >= HUNGER_RETURN_RATIO && animal.state !== AI_STATE.EATING) {
        clearHungerSearch(animal);
        animal.state = AI_STATE.ROAM;
        animal.target = null;
      }
      return;
    }

    if (ratio <= HUNGER_SEEK_RATIO) {
      enterHungerSearch(animal);
    } else if (animal.state === AI_STATE.IDLE) {
      animal.state = AI_STATE.ROAM;
    }
  }

  /**
   * Shared hunger-search entry/exit for herbivores (and any non-hunt path).
   * Predators are primarily handled by updatePredatorHungerGate.
   */
  function maybeUpdateHungerSearch(animal, dt) {
    if (
      animal.state === AI_STATE.DEAD ||
      animal.state === AI_STATE.FLEE ||
      animal.state === AI_STATE.SLEEP
    ) {
      return;
    }
    // Predators in hunt mode skip the shared 50% search helper
    if (isPredator(animal) && animal.diet !== 'herbivore' && animal._hunting) {
      return;
    }
    // Predators already gated above
    if (isPredator(animal) && animal.diet !== 'herbivore') {
      return;
    }

    const ratio = hungerRatio(animal);
    if (ratio <= HUNGER_SEEK_RATIO) {
      if (
        animal.state !== AI_STATE.EATING &&
        animal.state !== AI_STATE.SEEK_FOOD &&
        !animal._hungerSearch
      ) {
        enterHungerSearch(animal);
      } else if (animal.state === AI_STATE.SEEK_FOOD) {
        animal._hungerSearch = true;
      }
    } else if (animal._hungerSearch && ratio >= HUNGER_RETURN_RATIO && animal.state !== AI_STATE.EATING) {
      clearHungerSearch(animal);
      animal.state = defaultRestState(animal);
      animal.target = null;
    }
  }

  function updateRoam(animal, dt, ctx) {
    // Drop into hunt immediately if calories crossed the threshold mid-frame
    if (hungerRatio(animal) <= huntThreshold(animal)) {
      enterPreyHunt(animal);
      return;
    }

    // Predators: hunger-search at ≤50% — leave territory roaming
    // Omnivores already hunt at 50%, so they skip this band.
    if (
      animal.diet !== 'omnivore' &&
      hungerRatio(animal) <= HUNGER_SEEK_RATIO &&
      !animal._hunting
    ) {
      enterHungerSearch(animal);
      return;
    }

    // Nap when satiated and roaming long enough (predator idle equivalent)
    animal.idleAccum = (animal.idleAccum || 0) + dt;
    if (
      hungerRatio(animal) >= SLEEP_ENTER_RATIO &&
      animal.idleAccum >= SLEEP_IDLE_SECONDS
    ) {
      enterSleep(animal);
      return;
    }

    // Stay inside territory radius around spawn (skipped while hunger-searching)
    const dx = animal.x - animal.spawnX;
    const dy = animal.y - animal.spawnY;
    const dist = Math.hypot(dx, dy);
    if (dist > TERRITORY_RADIUS) {
      moveToward(animal, animal.spawnX, animal.spawnY, dt, 0.5, ctx);
    } else {
      wander(animal, dt, ctx.rng, ctx);
    }

    // Visual poop every 5–10 seconds while roaming
    animal.poopTimer -= dt;
    if (animal.poopTimer <= 0) {
      if (ctx.spawnPoop) ctx.spawnPoop(animal.x, animal.y);
      animal.poopTimer =
        POOP_INTERVAL_MIN + ctx.rng.float() * (POOP_INTERVAL_MAX - POOP_INTERVAL_MIN);
    }
  }

  /**
   * Nearest living predator or omnivore within range.
   * Herbivores flee from both on sight.
   */
  function findPredatorThreat(animal, ctx, range) {
    if (!ctx || !ctx.findNearestAnimal) return null;
    return ctx.findNearestAnimal(animal.x, animal.y, range, function (o) {
      return (
        o.alive &&
        isPredator(o) &&
        o.diet !== 'herbivore' &&
        o.id !== animal.id
      );
    });
  }

  /** Enter FLEE from a seen predator/omnivore. */
  function beginFleeFromThreat(animal, threat) {
    animal.idleAccum = 0;
    animal.target = null;
    clearEatingVisuals(animal);
    clearPath(animal);
    animal.state = AI_STATE.FLEE;
    animal.fleeFrom = threat;
    animal.stateTimer = 2.5;
  }

  function updateIdle(animal, dt, ctx) {
    // Predators use ROAM instead of IDLE
    if (isPredator(animal) && animal.diet !== 'herbivore') {
      animal.state = AI_STATE.ROAM;
      return;
    }

    // Threat scan — herbivores run from predators and omnivores on sight
    if (animal.diet === 'herbivore') {
      const threat = findPredatorThreat(animal, ctx, FLEE_ENTER_RANGE);
      if (threat) {
        beginFleeFromThreat(animal, threat);
        return;
      }
    }

    if (isHungry(animal)) {
      enterHungerSearch(animal);
      return;
    }

    // Nap when full and idle long enough (≥90% calories)
    animal.idleAccum = (animal.idleAccum || 0) + dt;
    if (
      hungerRatio(animal) >= SLEEP_ENTER_RATIO &&
      animal.idleAccum >= SLEEP_IDLE_SECONDS
    ) {
      enterSleep(animal);
      return;
    }

    wander(animal, dt, ctx.rng, ctx);
  }

  function updateSleep(animal, dt, ctx) {
    animal.vx = 0;
    animal.vy = 0;
    animal.sleepTimer = (animal.sleepTimer || 0) + dt;

    // Lie on side over 1 second
    animal.sleepTilt = Math.min(
      Math.PI / 2,
      (animal.sleepTilt || 0) + (Math.PI / 2) * (dt / SLEEP_TILT_SECONDS)
    );

    // Zzz particles: 1 per second, fade after 2 seconds
    animal._zzzSpawn = (animal._zzzSpawn || 0) - dt;
    if (!animal.zzzParticles) animal.zzzParticles = [];
    if (animal._zzzSpawn <= 0) {
      animal._zzzSpawn = 1;
      animal.zzzParticles.push({
        x: 4 + Math.random() * 6,
        y: -animal.size * 0.5,
        life: 2,
        maxLife: 2,
      });
    }
    for (let i = animal.zzzParticles.length - 1; i >= 0; i--) {
      const z = animal.zzzParticles[i];
      z.life -= dt;
      z.y -= 10 * dt;
      z.x += 4 * dt;
      if (z.life <= 0) animal.zzzParticles.splice(i, 1);
    }

    // Forced max nap
    if (animal.sleepTimer >= SLEEP_MAX_SECONDS) {
      wakeAnimal(animal);
      return;
    }

    // Wake checks only after minimum nap
    if (animal.sleepTimer < SLEEP_MIN_SECONDS) return;

    if (hungerRatio(animal) < SLEEP_WAKE_RATIO) {
      wakeAnimal(animal);
      return;
    }

    const threat = findPredatorThreat(animal, ctx, SLEEP_WAKE_PREDATOR_RANGE);
    if (threat) {
      wakeAnimal(animal);
      if (animal.diet === 'herbivore') {
        beginFleeFromThreat(animal, threat);
      }
      return;
    }

    // Food wake: prey/plants within 100px. Plants are dense after the overhaul,
    // so herbivores only react once below satiation; predators always notice prey.
    const food = findNearbyWakeFood(animal, ctx);
    if (food) {
      wakeAnimal(animal);
      animal.target = food;
      if (isPredator(animal) && food.kind === 'animal' && food.alive) {
        animal.state = AI_STATE.SEEK_PREY;
        animal._hunting = true;
      } else {
        animal.state = AI_STATE.SEEK_FOOD;
      }
      return;
    }

    // Random wake chance checked on discrete ticks (see tickAnimal)
  }

  function findNearbyWakeFood(animal, ctx) {
    if (isPredator(animal) && animal.diet !== 'herbivore') {
      const prey = ctx.findNearestAnimal(
        animal.x,
        animal.y,
        SLEEP_WAKE_FOOD_RANGE,
        function (o) {
          return o.alive && o.diet === 'herbivore' && o.id !== animal.id;
        }
      );
      if (prey) return prey;
    }
    // Herbivores: only wake for plants once no longer fully satiated
    if (
      (animal.diet === 'herbivore' || animal.diet === 'omnivore') &&
      hungerRatio(animal) < SLEEP_ENTER_RATIO
    ) {
      const plant = ctx.findNearestPlant(
        animal.x,
        animal.y,
        SLEEP_WAKE_FOOD_RANGE,
        function (p) {
          return p.alive && p.calories > 0;
        }
      );
      if (plant) return plant;
    }
    return null;
  }

  function updateSeekFood(animal, dt, ctx) {
    // Herbivores abandon food search and flee when they see a predator/omnivore
    if (animal.diet === 'herbivore') {
      const threat = findPredatorThreat(animal, ctx, FLEE_ENTER_RANGE);
      if (threat) {
        beginFleeFromThreat(animal, threat);
        return;
      }
    }

    // Expand detect radius while hunger-searching or hunting map-wide
    if (animal._hungerSearch || animal._hunting) {
      updateHungerSearchMovement(animal, dt, ctx);
    }

    // Predators seek herbivores (or corpses); herbivores seek plants only; omnivores do both
    if (!animal.target || !isValidFoodTarget(animal, animal.target)) {
      animal.target = findFoodTarget(animal, ctx);
    }

    if (!animal.target) {
      if (animal._hungerSearch || animal._hunting) {
        // No food in range — travel to a completely different part of the map
        updateMapExploreSearch(animal, dt, ctx);
        return;
      }
      wander(animal, dt, ctx.rng, ctx);
      if (!isHungry(animal) && hungerRatio(animal) >= HUNGER_RETURN_RATIO) {
        clearHungerSearch(animal);
        animal.state = defaultRestState(animal);
      }
      return;
    }

    // Have a food target — drop the distant explore waypoint
    animal._exploreGoal = null;

    const t = animal.target;
    const range = t.kind === 'plant' || t.state === AI_STATE.DEAD ? EAT_RANGE : ATTACK_RANGE;
    const d2 = dist2(animal.x, animal.y, t.x, t.y);

    if (d2 <= range * range) {
      if (t.kind === 'animal' && t.alive && t.state !== AI_STATE.DEAD) {
        tryAttack(animal, t, ctx);
      } else {
        animal.state = AI_STATE.EATING;
      }
      return;
    }

    // Pathfind with no max range — hunger/hunt search may cross the whole map.
    moveToward(animal, t.x, t.y, dt, 1, ctx);
  }

  /**
   * Herbivores: grow search radius +2 tiles/sec when nothing in sight.
   * Omnivores / hunting predators: grow faster while searching map-wide.
   */
  function updateHungerSearchMovement(animal, dt, ctx) {
    const cap = mapSearchCap(ctx);
    const prev = animal._searchRadius || initialSearchRadius(animal);
    let tilesPerSec = 2;
    if (animal.diet === 'omnivore') tilesPerSec = OMNIVORE_SEARCH_EXPAND_TILES_PER_SEC;
    else if (animal._hunting) tilesPerSec = 3;
    animal._searchRadius = Math.min(cap, prev + tilesPerSec * TILE_SIZE * dt);
  }

  /**
   * Travel to distant map waypoints while hunger-/hunt-searching.
   * Goals stay far from the current position.
   */
  function updateMapExploreSearch(animal, dt, ctx) {
    const goal = animal._exploreGoal;
    const arrived =
      goal && Math.hypot(goal.x - animal.x, goal.y - animal.y) < TILE_SIZE * 2.5;
    animal._exploreTimer = (animal._exploreTimer || 0) - dt;
    if (!goal || arrived || animal._exploreTimer <= 0) {
      animal._exploreGoal = pickDistantExploreGoal(animal, ctx);
      const span = HUNGER_EXPLORE_GOAL_MAX - HUNGER_EXPLORE_GOAL_MIN;
      animal._exploreTimer =
        HUNGER_EXPLORE_GOAL_MIN + (ctx.rng ? ctx.rng.float() * span : span * 0.5);
      clearPath(animal);
    }
    const g = animal._exploreGoal;
    moveToward(animal, g.x, g.y, dt, 1, ctx);
  }

  /** @deprecated Kept for callers/tests — redirects to map-wide explore. */
  function updateSpiralSearch(animal, dt, ctx) {
    updateMapExploreSearch(animal, dt, ctx);
  }

  function isValidFoodTarget(animal, t) {
    if (!t) return false;
    if (t.kind === 'plant') return t.alive && t.calories > 0;
    if (t.kind === 'animal') {
      // Herbivores never eat animals (living or dead) — plants only.
      if (animal.diet === 'herbivore') return false;
      if (t.state === AI_STATE.DEAD) return t.corpseCalories > 0;
      if (!t.alive) return false;
      // Live prey
      if (isPredator(animal) && t.diet === 'herbivore') return true;
      // Desperate predators fight other predators
      if (isPredator(animal) && isPredator(t) && isHungry(animal) && t.id !== animal.id) return true;
      return false;
    }
    return false;
  }

  function foodDetectRange(animal) {
    // Expanding map-wide detect radius while hunger-searching or hunting
    if (animal._hungerSearch || animal._hunting) {
      return animal._searchRadius || initialSearchRadius(animal);
    }
    return FOOD_DETECT_RANGE;
  }

  function findFoodTarget(animal, ctx) {
    const detect = foodDetectRange(animal);

    // Predators / omnivores prefer corpses; herbivores never eat dead animals.
    if (isPredator(animal)) {
      const corpse = ctx.findNearestAnimal(
        animal.x,
        animal.y,
        detect,
        function (o) {
          return o.state === AI_STATE.DEAD && o.corpseCalories > 0;
        }
      );
      if (corpse) return corpse;
    }

    if (
      animal.diet === 'predator' ||
      animal.state === AI_STATE.SEEK_PREY ||
      animal._hunting ||
      (animal.diet === 'omnivore' && (animal._hunting || animal._hungerSearch || isHungry(animal))) ||
      (animal._hungerSearch && isPredator(animal))
    ) {
      const prey = ctx.findNearestAnimal(
        animal.x,
        animal.y,
        detect,
        function (o) {
          return o.alive && o.diet === 'herbivore' && o.id !== animal.id;
        }
      );
      if (prey) return prey;

      // Desperate: other predators (only when critically starved)
      if (hungerRatio(animal) < 0.15) {
        const rival = ctx.findNearestAnimal(
          animal.x,
          animal.y,
          detect * 0.45,
          function (o) {
            return o.alive && isPredator(o) && o.id !== animal.id;
          }
        );
        if (rival) return rival;
      }
    }

    if (animal.diet === 'herbivore' || animal.diet === 'omnivore') {
      const plant = ctx.findNearestPlant(
        animal.x,
        animal.y,
        detect,
        function (p) {
          return p.alive && p.calories > 0;
        }
      );
      if (plant) return plant;
    }

    return null;
  }

  function tryAttack(attacker, prey, ctx) {
    if (attacker.attackCooldown > 0) return;

    applyDamage(prey, attacker.attackPower, attacker);
    attacker.attackCooldown = ATTACK_COOLDOWN_TICKS * (ctx.tickSeconds || 0.5);

    // Counter-attack
    if (prey.alive && prey._counterAttack) {
      applyDamage(attacker, prey.attackPower * 0.8, prey);
      prey._counterAttack = false;
    }

    if (!prey.alive || prey.state === AI_STATE.DEAD) {
      attacker.state = AI_STATE.EATING;
      attacker.target = prey;
    }
  }

  /**
   * Predator within interrupt range that is actively targeting this animal.
   * Used only while stubbornly eating a plant.
   */
  function findEatingPredatorThreat(animal, ctx) {
    if (!ctx || !ctx.findNearestAnimal) return null;
    return ctx.findNearestAnimal(
      animal.x,
      animal.y,
      EAT_PREDATOR_INTERRUPT_RANGE,
      function (o) {
        return (
          o.alive &&
          isPredator(o) &&
          o.diet !== 'herbivore' &&
          o.id !== animal.id &&
          o.target === animal
        );
      }
    );
  }

  function clearEatingVisuals(animal) {
    animal._eatBobTimer = 0;
    animal._eatLockShake = 0;
    animal.eatBobPhase = 0;
    animal.eatLockPhase = 0;
    animal.eatLocked = false;
  }

  /** Plant depleted before full → SEEK_FOOD when the 50% hunger rule still applies. */
  function afterPlantDepleted(animal) {
    animal.target = null;
    clearEatingVisuals(animal);
    clearPath(animal);
    if (isPredator(animal) && animal._hunting && hungerRatio(animal) < PREDATOR_SATIATED_RATIO) {
      animal.state = AI_STATE.SEEK_PREY;
      return;
    }
    if (isHungry(animal) || animal._hungerSearch) {
      if (!animal._hungerSearch) enterHungerSearch(animal);
      else animal.state = AI_STATE.SEEK_FOOD;
      return;
    }
    clearHungerSearch(animal);
    animal.state = defaultRestState(animal);
  }

  function interruptEatingFlee(animal, threat) {
    animal.target = null;
    clearEatingVisuals(animal);
    clearPath(animal);
    animal.state = AI_STATE.FLEE;
    animal.fleeFrom = threat;
    animal.stateTimer = 2.5;
  }

  function updateEating(animal, dt, ctx) {
    const t = animal.target;
    const eatingPlant = !!(t && t.kind === 'plant');

    if (!isValidFoodTarget(animal, t)) {
      // Depleted plant / invalid food — plant path uses 50% hunger-search rule
      if (eatingPlant) {
        afterPlantDepleted(animal);
        return;
      }
      animal.target = null;
      clearEatingVisuals(animal);
      clearPath(animal);
      if (isPredator(animal) && animal._hunting && hungerRatio(animal) < PREDATOR_SATIATED_RATIO) {
        animal.state = AI_STATE.SEEK_PREY;
      } else if (isHungry(animal) || animal._hungerSearch) {
        if (!animal._hungerSearch) enterHungerSearch(animal);
        else animal.state = AI_STATE.SEEK_FOOD;
      } else {
        clearHungerSearch(animal);
        animal.state = defaultRestState(animal);
      }
      return;
    }

    // Stubborn eating: commit until 100% full, food depleted, or (plants) predator interrupt.
    // Do NOT bail at the 60% hunger-return threshold mid-meal — corpses and plants alike.
    if (eatingPlant) {
      const threat = findEatingPredatorThreat(animal, ctx);
      if (threat) {
        interruptEatingFlee(animal, threat);
        return;
      }
    }

    // Stay near food (must be within 20px to eat plants)
    const range = t.kind === 'plant' ? EAT_RANGE : EAT_RANGE + 8;
    const d2 = dist2(animal.x, animal.y, t.x, t.y);
    if (d2 > range * range) {
      animal.eatLocked = false;
      animal._eatBobTimer = 0;
      moveToward(animal, t.x, t.y, dt, 0.8, ctx);
      return;
    }

    // Stop moving — eating animation (head bob once per second toward plant)
    animal.vx = 0;
    animal.vy = 0;
    clearPath(animal);
    animal._eatBobTimer = (animal._eatBobTimer || 0) + dt;
    if (animal._eatBobTimer >= 1) animal._eatBobTimer -= 1;
    animal.eatBobPhase = animal._eatBobTimer;

    // Face the food
    if (t.x >= animal.x) animal._facingRight = true;
    else animal._facingRight = false;

    // Plants: continuous 5 cal/sec — stubborn commit until full / depleted / predator.
    // Multiple eaters stack (3 animals → 15 cal/sec from the plant).
    // Growth stops immediately once eating starts (until depleted + respawn).
    if (t.kind === 'plant' && t.alive) {
      if (Wildborn.plant.pauseGrowth) Wildborn.plant.pauseGrowth(t);
      animal.eatLocked = true;
      // Locked-in head shake every 3 seconds
      animal._eatLockShake = (animal._eatLockShake || 0) + dt;
      if (animal._eatLockShake >= 3) animal._eatLockShake -= 3;
      animal.eatLockPhase = animal._eatLockShake;

      const room = animal.maxCalories - animal.calories;
      if (room <= 0) {
        animal.target = null;
        clearEatingVisuals(animal);
        animal.state = postEatState(animal);
        return;
      }
      const eaten = Wildborn.plant.consumePlant(t, Math.min(EAT_RATE_PER_SEC * dt, room));
      animal.calories += eaten;
      if (!t.alive || t.calories <= 0) {
        afterPlantDepleted(animal);
        return;
      }
      // Full stomach only — no mid-meal re-evaluate / bite-size bailout
      if (animal.calories >= animal.maxCalories) {
        animal.target = null;
        clearEatingVisuals(animal);
        animal.state = postEatState(animal);
      }
      return;
    }

    // Corpses: continuous transfer until food runs out or eater reaches 100% calories.
    if (t.kind === 'animal' && t.state === AI_STATE.DEAD) {
      animal.eatLocked = false;
      const room = animal.maxCalories - animal.calories;
      if (room <= 0) {
        animal.target = null;
        clearEatingVisuals(animal);
        animal.state = postEatState(animal);
        return;
      }
      const eaten = Math.min(EAT_RATE_PER_SEC * 1.5 * dt, t.corpseCalories, room);
      t.corpseCalories -= eaten;
      animal.calories += eaten;
      if (t.corpseCalories <= 0 || animal.calories >= animal.maxCalories) {
        animal.target = null;
        clearEatingVisuals(animal);
        animal.state = postEatState(animal);
      }
    }
  }

  function updateFlee(animal, dt, ctx) {
    animal.stateTimer -= dt;

    // Predators never flee — resume attacking the threat until it is dead.
    if (isPredator(animal) && animal.diet !== 'herbivore') {
      const threat = animal.fleeFrom || animal.target;
      animal.fleeFrom = null;
      animal._counterAttack = false;
      if (threat && threat.alive && threat.state !== AI_STATE.DEAD) {
        animal.target = threat;
        animal.state = AI_STATE.SEEK_PREY;
        animal._hunting = true;
      } else {
        animal.state = defaultRestState(animal);
      }
      return;
    }

    // Counter-attack styles engage instead of pure flee
    if (animal._counterAttack && animal.target && animal.target.alive) {
      const t = animal.target;
      const d2 = dist2(animal.x, animal.y, t.x, t.y);
      if (d2 <= ATTACK_RANGE * ATTACK_RANGE) {
        tryAttack(animal, t, ctx);
      } else {
        moveToward(animal, t.x, t.y, dt, 1.1, ctx);
      }
      if (animal.stateTimer <= 0) {
        animal._counterAttack = false;
        animal.state = defaultRestState(animal);
      }
      return;
    }

    const threat = animal.fleeFrom;
    if (!threat || !threat.alive) {
      animal.fleeFrom = null;
      animal.state = defaultRestState(animal);
      return;
    }

    const dist = Math.hypot(animal.x - threat.x, animal.y - threat.y);

    // Herbivores: keep fleeing until predator is 200px+ away (normal speed)
    if (animal.diet === 'herbivore') {
      if (dist >= FLEE_SAFE_RANGE) {
        animal.fleeFrom = null;
        animal.state = AI_STATE.IDLE;
        return;
      }

      const dx = animal.x - threat.x;
      const dy = animal.y - threat.y;
      const len = Math.hypot(dx, dy) || 1;
      const tx = animal.x + (dx / len) * 80;
      const ty = animal.y + (dy / len) * 80;
      moveToward(animal, tx, ty, dt, 1, ctx);
      return;
    }

    // Non-herbivore flee (timer-based) — omnivore/other edge cases only
    if (animal.stateTimer <= 0) {
      animal.fleeFrom = null;
      animal.state = defaultRestState(animal);
      return;
    }

    const dx = animal.x - threat.x;
    const dy = animal.y - threat.y;
    const len = Math.hypot(dx, dy) || 1;
    const tx = animal.x + (dx / len) * 80;
    const ty = animal.y + (dy / len) * 80;
    moveToward(animal, tx, ty, dt, 1, ctx);
  }

  // ---------------------------------------------------------------------------
  // Discrete tick (hunger, eating calories, asexual reproduction)
  // ---------------------------------------------------------------------------

  /**
   * @param {object} animal
   * @param {object} ctx
   * @returns {{ offspring?: object[], remove?: boolean }}
   */
  function tickAnimal(animal, ctx) {
    const result = {};

    // Corpse decay
    if (animal.state === AI_STATE.DEAD) {
      animal.corpseDecay -= 1;
      if (animal.corpseDecay <= 0 || animal.corpseCalories <= 0) {
        result.remove = true;
      }
      return result;
    }

    // Hunger drain: predators flat 0.1 cal/s; herbivores daily need / DAY_TICKS ÷10
    // Sleeping: conservation mode — half burn
    let drain = calorieBurnPerTick(animal);
    if (animal.state === AI_STATE.SLEEP) drain *= 0.5;
    animal.calories -= drain;

    if (animal.breedingCooldown > 0) animal.breedingCooldown -= 1;

    // Sleep: random wake chance after minimum nap
    if (
      animal.state === AI_STATE.SLEEP &&
      animal.sleepTimer >= SLEEP_MIN_SECONDS &&
      ctx.rng.chance(SLEEP_RANDOM_WAKE_CHANCE)
    ) {
      wakeAnimal(animal);
    }

    // Plant / corpse calorie transfer runs in real time via updateEating.
    // Tick only clears a full stomach if the continuous path somehow stalled.
    if (animal.state === AI_STATE.EATING && animal.target) {
      const room = animal.maxCalories - animal.calories;
      if (room <= 0) {
        animal.state = postEatState(animal);
        animal.target = null;
      }
    }

    // Starvation
    if (animal.calories <= 0) {
      animal.calories = 0;
      killAnimal(animal, null);
      return result;
    }

    // Asexual reproduction: calorie ≥ 80% and cooldown expired → spawn 1 offspring
    if (canBreed(animal)) {
      result.offspring = breed(animal);
    }

    return result;
  }

  /** After eating: predators keep hunting until 80%, else roam/idle. */
  function postEatState(animal) {
    if (isPredator(animal) && animal.diet !== 'herbivore') {
      if (animal._hunting) {
        if (hungerRatio(animal) >= PREDATOR_SATIATED_RATIO) {
          animal._hunting = false;
          clearHungerSearch(animal);
          return AI_STATE.ROAM;
        }
        return AI_STATE.SEEK_PREY;
      }
      if (animal._hungerSearch) {
        if (hungerRatio(animal) >= HUNGER_RETURN_RATIO) {
          clearHungerSearch(animal);
          return AI_STATE.ROAM;
        }
        return AI_STATE.SEEK_FOOD;
      }
      return AI_STATE.ROAM;
    }
    if (animal._hungerSearch) {
      if (hungerRatio(animal) >= HUNGER_RETURN_RATIO) {
        clearHungerSearch(animal);
        return AI_STATE.IDLE;
      }
      return AI_STATE.SEEK_FOOD;
    }
    return AI_STATE.IDLE;
  }

  /** Soft clamp animals inside spawn/play region so they don't wander forever. */
  function clampToRegion(animal, cx, cy, radius) {
    const dx = animal.x - cx;
    const dy = animal.y - cy;
    const d = Math.hypot(dx, dy);
    if (d > radius) {
      const s = (radius - 8) / d;
      animal.x = cx + dx * s;
      animal.y = cy + dy * s;
    }
  }

  /** Hard clamp animals inside the fixed 400×400 map. */
  function clampToMap(animal, mapPixelSize) {
    mapPixelSize = mapPixelSize == null ? 12800 : mapPixelSize;
    const pad = Math.max(4, (animal.size || 8) * 0.5);
    animal.x = Math.max(pad, Math.min(mapPixelSize - pad, animal.x));
    animal.y = Math.max(pad, Math.min(mapPixelSize - pad, animal.y));
  }

  Wildborn.animal = {
    AI_STATE,
    SPEED,
    HERBIVORE_SPECIES,
    PREDATOR_SPECIES,
    ALL_SPECIES,
    BREED_COOLDOWN,
    BREED_CALORIE_RATIO,
    HUNGER_SEEK_RATIO,
    HUNGER_RETURN_RATIO,
    DAY_TICKS,
    CALORIE_BURN_DIVISOR,
    MIN_CALORIE_BURN,
    PREDATOR_CALORIE_BURN_PER_SEC,
    PREDATOR_HUNT_RATIO,
    OMNIVORE_HUNT_RATIO,
    PREDATOR_SATIATED_RATIO,
    TERRITORY_RADIUS,
    FLEE_ENTER_RANGE,
    FLEE_SAFE_RANGE,
    EAT_PREDATOR_INTERRUPT_RANGE,
    FOOD_DETECT_RANGE,
    PLANT_SIGHT_RANGE,
    PLANT_SIGHT_TILES,
    EAT_RANGE,
    EAT_RATE_PER_SEC,
    WATER_SPEED_MULT,
    AQUATIC_WATER_SPEED_MULT,
    WATER_STUCK_CROSS_SECONDS,
    HUNGER_EXPLORE_GOAL_MIN,
    HUNGER_EXPLORE_GOAL_MAX,
    HUNGER_EXPLORE_MIN_MAP_FRAC,
    SLEEP_ENTER_RATIO,
    SLEEP_WAKE_RATIO,
    SLEEP_IDLE_SECONDS,
    SLEEP_MIN_SECONDS,
    SLEEP_MAX_SECONDS,
    SLEEP_WAKE_PREDATOR_RANGE,
    createAnimal,
    updateAnimal,
    tickAnimal,
    killAnimal,
    breed,
    canBreed,
    isHerbivore,
    isPredator,
    clampToRegion,
    clampToMap,
    applyDamage,
    calorieBurnPerTick,
    enterSleep,
    wakeAnimal,
    canCrossWater,
  };
})(typeof window !== 'undefined' ? window : globalThis);
