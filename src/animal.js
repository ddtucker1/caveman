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
  /** Animals on water move at 25% of normal speed (stacks with other modifiers). */
  const WATER_SPEED_MULT = 0.25;
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
      speed: 'fast',
      caloriesNeededPerDay: 30,
      maxCalories: 60,
      maxHealth: 30,
      defense: 'flee',
      attackPower: 2,
      color: '#c8c0b0',
      size: 8,
      special: 'burrow',
      corpseYield: 0.5,
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
      special: 'alert',
      corpseYield: 0.5,
    },
    cow: {
      id: 'cow',
      label: 'Cow',
      diet: 'herbivore',
      maxGroupSize: 12,
      speed: 'slow',
      caloriesNeededPerDay: 150,
      maxCalories: 300,
      maxHealth: 120,
      defense: 'none',
      attackPower: 3,
      color: '#d8d0c0',
      accent: '#333',
      size: 18,
      special: 'high_yield',
      corpseYield: 0.7, // high calorie yield when eaten
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
      special: 'steal',
      corpseYield: 0.5,
    },
    bison: {
      id: 'bison',
      label: 'Bison',
      diet: 'herbivore',
      maxGroupSize: 15,
      speed: 'slow',
      caloriesNeededPerDay: 200,
      maxCalories: 400,
      maxHealth: 200,
      defense: 'charge',
      attackPower: 25,
      color: '#5a4030',
      size: 20,
      special: 'group_charge',
      corpseYield: 0.55,
    },
    ostrich: {
      id: 'ostrich',
      label: 'Ostrich',
      diet: 'herbivore',
      maxGroupSize: 4,
      speed: 'very_fast',
      caloriesNeededPerDay: 70,
      maxCalories: 140,
      maxHealth: 80,
      defense: 'kick',
      attackPower: 18,
      color: '#b09060',
      size: 16,
      special: 'runs_from_all',
      corpseYield: 0.5,
    },
    turtle: {
      id: 'turtle',
      label: 'Turtle',
      diet: 'herbivore',
      maxGroupSize: 1,
      speed: 'very_slow',
      caloriesNeededPerDay: 40,
      maxCalories: 80,
      maxHealth: 150,
      defense: 'shell',
      attackPower: 2,
      color: '#3a6a3a',
      accent: '#2a4a2a',
      size: 11,
      special: 'shell',
      corpseYield: 0.4,
      damageReduction: 0.7, // very hard to kill
    },
    lizard: {
      id: 'lizard',
      label: 'Lizard',
      diet: 'herbivore',
      maxGroupSize: 1,
      speed: 'fast',
      caloriesNeededPerDay: 20,
      maxCalories: 40,
      maxHealth: 25,
      defense: 'flee',
      attackPower: 3,
      color: '#5a9a4a',
      size: 7,
      special: 'regen',
      corpseYield: 0.5,
      regenPerTick: 0.4,
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
      special: 'howl',
      packCallSeconds: 3,
      corpseYield: 0.5,
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
      special: 'female_hunt',
      corpseYield: 0.5,
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
      attackStyle: 'stealth_pounce',
      attackPower: 28,
      color: '#1a1a22',
      size: 14,
      special: 'stealth',
      stealthRevealDist: 120,
      corpseYield: 0.5,
    },
    bear: {
      id: 'bear',
      label: 'Bear',
      diet: 'omnivore',
      maxGroupSize: 2,
      speed: 'medium',
      caloriesNeededPerDay: 250,
      maxCalories: 500,
      maxHealth: 220,
      attackStyle: 'swipe',
      attackPower: 40,
      color: '#4a3020',
      size: 20,
      special: 'omnivore',
      corpseYield: 0.5,
    },
    alligator: {
      id: 'alligator',
      label: 'Alligator',
      diet: 'predator',
      maxGroupSize: 1,
      speed: 'slow',
      waterSpeed: 'fast',
      caloriesNeededPerDay: 180,
      maxCalories: 360,
      maxHealth: 180,
      attackStyle: 'death_roll',
      attackPower: 35,
      color: '#2a5a2a',
      size: 18,
      special: 'ambush',
      corpseYield: 0.5,
    },
  };

  const ALL_SPECIES = Object.assign({}, HERBIVORE_SPECIES, PREDATOR_SPECIES);

  // Timing / thresholds
  /** Ticks for juvenile growth 20% → 100% at +1%/tick. */
  const ADULT_AGE = 80;
  /** 1200s reproduction cooldown at 0.5s/tick → 2400 ticks. */
  const BREED_COOLDOWN = 2400;
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
  /** Plant sight / food detect: 8 tiles = 256px. Prey detect uses the same base. */
  const FOOD_DETECT_RANGE = PLANT_SIGHT_RANGE;
  const PACK_JOIN_RANGE = 200;
  const STEAL_RANGE = 24;
  /** Plant eating: 1 calorie per second per animal (real-time in updateEating). */
  const EAT_RATE_PER_SEC = 1;
  /** Corpse / steal transfer rate (calories per ecosystem tick). */
  const EAT_RATE = 6;
  const ATTACK_COOLDOWN_TICKS = 2;
  const IDLE_WANDER_CHANCE = 0.35;
  /** Recompute grid path at most this often (seconds). */
  const PATH_REPATH_SECONDS = 0.45;

  /** Predators hunt at ≤30% calories; return to roaming at ≥80%. */
  const PREDATOR_HUNT_RATIO = 0.3;
  const PREDATOR_SATIATED_RATIO = 0.8;
  /** Roam within this radius of spawn while not hunting. */
  const TERRITORY_RADIUS = 200;
  /** Flee desperation: cross water if predator within this distance. */
  const WATER_DESPERATION_FLEE_DIST = 100;
  /** Starvation desperation: cross water below this calorie ratio. */
  const WATER_DESPERATION_STARVE_RATIO = 0.2;
  /** Poop while roaming: every 5–10s, fade after 30s. */
  const POOP_INTERVAL_MIN = 5;
  const POOP_INTERVAL_MAX = 10;
  const POOP_FADE_SECONDS = 30;

  /** Stamina — shared across all species. */
  const STAMINA_MAX = 100;
  const STAMINA_REGEN = 2;
  const STAMINA_DRAIN_WALK = 0.5;
  const STAMINA_DRAIN_FLEE = 3;
  const STAMINA_DRAIN_HUNT = 2;
  const STAMINA_PANT_THRESHOLD = 20;

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
    // Adults spawn well-fed so the ecosystem stabilizes before the first hunt.
    const startCal = isOffspring ? maxCal * 0.2 : maxCal * 0.85 + Math.random() * maxCal * 0.1;

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
      health: isOffspring ? def.maxHealth * 0.4 : def.maxHealth,
      maxHealth: def.maxHealth,
      stamina: STAMINA_MAX,
      maxStamina: STAMINA_MAX,

      age: isOffspring ? 0 : ADULT_AGE + Math.floor(Math.random() * 20),
      /** Per-animal reproduction cooldown in ticks (persists with animal state). */
      breedingCooldown: isOffspring
        ? BREED_COOLDOWN
        : Math.floor(Math.random() * BREED_COOLDOWN),
      growth: isOffspring ? 0.2 : 1, // 20% → 100% adult size
      isAdult: !isOffspring,

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
      /** Herbivore flee exhausted (walk instead of run). */
      _fleeExhausted: false,
      /** True while in hunger-search (≤50% calories, orange eyes). */
      _hungerSearch: false,
      /** Expanding plant detect radius while hunger-searching (herbivores). */
      _searchRadius: PLANT_SIGHT_RANGE,
      /** Spiral-search state for predators in hunger-search. */
      _spiralAngle: 0,
      _spiralRadius: 0,
      _spiralOriginX: null,
      _spiralOriginY: null,

      groupId: opts.groupId != null ? opts.groupId : 0,
      maxGroupSize: def.maxGroupSize,
      sex: opts.sex || (Math.random() < 0.5 ? 'male' : 'female'),

      speedKey: def.speed,
      baseSpeed: baseSpeed,
      waterSpeedKey: def.waterSpeed || null,
      attackPower: def.attackPower || 5,
      defense: def.defense || 'flee',
      attackStyle: def.attackStyle || null,
      special: def.special || null,
      corpseYield: def.corpseYield != null ? def.corpseYield : 0.5,
      damageReduction: def.damageReduction || 0,
      regenPerTick: def.regenPerTick || 0,
      stealthRevealDist: def.stealthRevealDist || 0,
      packCallSeconds: def.packCallSeconds || 0,

      color: def.color,
      accent: def.accent || null,
      baseSize: def.size,
      size: isOffspring ? def.size * 0.2 : def.size,

      attackCooldown: 0,
      packCallTimer: 0, // seconds remaining for pack to join
      burrowed: false,
      burrowTimer: 0,
      /** Seconds until next visual poop while roaming (predators). */
      poopTimer: isPred ? 5 + Math.random() * 5 : 0,

      // Corpse fields (set on death)
      corpseCalories: 0,
      corpseDecay: 0,
      alive: true,
    };
  }

  /**
   * Per-tick calorie drain: (daily need / DAY_TICKS) / 10, rounded to 1 decimal.
   * Floor at MIN_CALORIE_BURN (0.5). Species whose scaled rate is below the floor
   * keep a 2-decimal scaled value so small animals are not forced to burn faster.
   */
  function calorieBurnPerTick(animal) {
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

  /** Ready to reproduce asexually: adult, calories ≥ 80%, cooldown expired. */
  function canBreed(a) {
    return (
      a.alive &&
      a.isAdult &&
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
    animal._fleeExhausted = false;
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

  function enterHungerSearch(animal) {
    animal._hungerSearch = true;
    animal.idleAccum = 0;
    animal.target = null;
    animal._searchRadius = FOOD_DETECT_RANGE;
    animal._spiralAngle = 0;
    animal._spiralRadius = TILE_SIZE * 2;
    animal._spiralOriginX = animal.x;
    animal._spiralOriginY = animal.y;
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

  function effectiveSpeed(animal, speedMult) {
    speedMult = speedMult == null ? 1 : speedMult;
    let speed = Math.max(MIN_SPEED, animal.baseSpeed * speedMult);
    // Alligator: faster in water (still subject to the global water penalty below)
    if (animal.special === 'ambush' && animal._inWater) {
      speed = Math.max(MIN_SPEED, SPEED.fast);
    }
    // Offspring follow a bit slower
    if (!animal.isAdult) speed *= 0.7;
    // Growth scale slightly affects speed
    speed *= 0.7 + 0.3 * animal.growth;
    // Water: 25% of current speed (alligators still pay the water mult after land-equivalent)
    if (animal._inWater) {
      speed *= WATER_SPEED_MULT;
    }
    return Math.max(MIN_SPEED, speed);
  }

  /**
   * True when the animal may enter water: fleeing a nearby predator, or starving
   * with food across the water.
   */
  function canCrossWater(animal, ctx) {
    if (animal.special === 'ambush') return true;
    if (animal.state === AI_STATE.FLEE && animal.fleeFrom && animal.fleeFrom.alive) {
      const d = Math.hypot(animal.x - animal.fleeFrom.x, animal.y - animal.fleeFrom.y);
      if (d <= WATER_DESPERATION_FLEE_DIST) return true;
    }
    if (hungerRatio(animal) < WATER_DESPERATION_STARVE_RATIO && animal.target) {
      return true;
    }
    return false;
  }

  /**
   * Ensure animal has a fresh grid path toward (tx, ty).
   * Uses A* on the 400×400 map; water only when desperate / alligator.
   */
  function ensurePath(animal, tx, ty, ctx) {
    if (!ctx || !ctx.world || !Wildborn.pathfind) return null;
    animal._pathTimer = (animal._pathTimer || 0) - (ctx._frameDt || 0.016);
    const goalChanged =
      !animal._pathGoal ||
      Math.hypot(animal._pathGoal.x - tx, animal._pathGoal.y - ty) > TILE_SIZE * 0.75;
    if (
      animal._path &&
      animal._pathIndex < animal._path.length &&
      !goalChanged &&
      animal._pathTimer > 0
    ) {
      return animal._path;
    }

    const allowWater = canCrossWater(animal, ctx);
    const path = Wildborn.pathfind.pathToPixel(
      ctx.world,
      animal.x,
      animal.y,
      tx,
      ty,
      { allowWater: allowWater }
    );
    animal._path = path || [];
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
      } else if (!canCrossWater(animal, ctx) && ctx.isWater && ctx.isWater(tx, ty)) {
        // No dry path — hold rather than enter water
        animal.vx = 0;
        animal.vy = 0;
        return;
      }
    }

    const dx = waypoint.x - animal.x;
    const dy = waypoint.y - animal.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.5) {
      animal.vx = 0;
      animal.vy = 0;
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
      !canCrossWater(animal, ctx) &&
      animal.special !== 'ambush'
    ) {
      animal.x = prevX;
      animal.y = prevY;
      animal.vx = 0;
      animal.vy = 0;
      clearPath(animal);
      return;
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
      if (animal._inWater) speed *= WATER_SPEED_MULT;
      animal.vx = Math.cos(angle) * speed;
      animal.vy = Math.sin(angle) * speed;
      animal.stateTimer = 1 + rng.float() * 2;
    }

    // Soft water avoidance while wandering (unless desperate / alligator)
    let nx = animal.x + animal.vx * dt;
    let ny = animal.y + animal.vy * dt;
    if (ctx && ctx.isWater && ctx.isWater(nx, ny) && !canCrossWater(animal, ctx)) {
      // Turn away from water
      animal.vx = -animal.vx;
      animal.vy = -animal.vy;
      animal.stateTimer = 0.4 + rng.float() * 0.6;
      nx = animal.x + animal.vx * dt;
      ny = animal.y + animal.vy * dt;
      if (ctx.isWater(nx, ny)) {
        // Still wet — stay put this frame
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
    let dmg = amount;
    if (target.damageReduction) dmg *= 1 - target.damageReduction;
    if (target.burrowed) dmg *= 0.15;
    if (target.defense === 'shell' && target.state === AI_STATE.FLEE) dmg *= 0.25;
    target.health -= dmg;
    if (target.health <= 0) {
      killAnimal(target, attacker);
      return dmg;
    }
    // Defensive reactions
    if (target.defense === 'flee' || target.special === 'runs_from_all' || target.special === 'burrow') {
      target.state = AI_STATE.FLEE;
      target.fleeFrom = attacker;
      target.stateTimer = 2.5;
      target._fleeExhausted = target.stamina <= 0;
      if (target.special === 'burrow' && Math.random() < 0.4) {
        target.burrowed = true;
        target.burrowTimer = 3;
      }
      // Deer alert herd
      if (target.special === 'alert') target._alertPulse = true;
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
   * Continuous update (movement & timed effects). Discrete hunger/age happen in tickAnimal.
   * @param {object} animal
   * @param {number} dt
   * @param {object} ctx  ecosystem context (grids, rng, world helpers)
   */
  function updateAnimal(animal, dt, ctx) {
    if (animal.state === AI_STATE.DEAD) return;

    if (animal.burrowed) {
      animal.burrowTimer -= dt;
      if (animal.burrowTimer <= 0) animal.burrowed = false;
      return; // stay put while burrowed
    }

    if (animal.attackCooldown > 0) animal.attackCooldown -= dt;
    if (animal.packCallTimer > 0) animal.packCallTimer -= dt;

    // Water flag for alligator
    if (ctx.isWater) {
      animal._inWater = ctx.isWater(animal.x, animal.y);
    }

    // Offspring follow nearest adult of same species
    if (!animal.isAdult) {
      const adult = ctx.findNearestAnimal(
        animal.x,
        animal.y,
        220,
        function (o) {
          return o.alive && o.isAdult && o.species === animal.species && o.id !== animal.id;
        }
      );
      if (adult) {
        moveToward(animal, adult.x, adult.y, dt, 0.85, ctx);
        return;
      }
    }

    // Predator hunger gate: hunt only at ≤30%, roam above that until 80% after a hunt
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
   * Hunger-search (not full hunt) returns to ROAM at ≥60%.
   */
  function updatePredatorHungerGate(animal) {
    const ratio = hungerRatio(animal);
    if (animal.state === AI_STATE.DEAD || animal.state === AI_STATE.FLEE || animal.state === AI_STATE.SLEEP) return;

    // Full hunt mode at ≤30% — takes priority over hunger-search
    if (ratio <= PREDATOR_HUNT_RATIO) {
      animal._hunting = true;
      if (animal._hungerSearch) clearHungerSearch(animal);
      if (animal.state !== AI_STATE.EATING) {
        animal.state = AI_STATE.SEEK_PREY;
        if (!animal.target) animal.target = null;
      }
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

    // Hunger-search band (30%–50%]: seek food, return at ≥60%
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
    if (hungerRatio(animal) <= PREDATOR_HUNT_RATIO) {
      animal.idleAccum = 0;
      animal.state = AI_STATE.SEEK_PREY;
      animal.target = null;
      animal._hunting = true;
      clearHungerSearch(animal);
      return;
    }

    // Hunger-search at ≤50% — leave territory roaming
    if (hungerRatio(animal) <= HUNGER_SEEK_RATIO && !animal._hunting) {
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

  function updateIdle(animal, dt, ctx) {
    // Predators use ROAM instead of IDLE
    if (isPredator(animal) && animal.diet !== 'herbivore') {
      animal.state = AI_STATE.ROAM;
      return;
    }

    // Threat scan (herbivores / ostriches)
    if (isHerbivore(animal) || animal.special === 'runs_from_all') {
      const threat = ctx.findNearestAnimal(
        animal.x,
        animal.y,
        FLEE_ENTER_RANGE,
        function (o) {
          return o.alive && isPredator(o) && o.diet !== 'herbivore' && o.id !== animal.id;
        }
      );
      if (threat && animal.diet === 'herbivore') {
        animal.idleAccum = 0;
        animal.state = AI_STATE.FLEE;
        animal.fleeFrom = threat;
        animal.stateTimer = 2.5;
        animal._fleeExhausted = animal.stamina <= 0;
        if (animal.special === 'alert') animal._alertPulse = true;
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

    const threat = ctx.findNearestAnimal(
      animal.x,
      animal.y,
      SLEEP_WAKE_PREDATOR_RANGE,
      function (o) {
        return o.alive && isPredator(o) && o.diet !== 'herbivore' && o.id !== animal.id;
      }
    );
    if (threat) {
      wakeAnimal(animal);
      if (animal.diet === 'herbivore') {
        animal.state = AI_STATE.FLEE;
        animal.fleeFrom = threat;
        animal.stateTimer = 2.5;
        animal._fleeExhausted = animal.stamina <= 0;
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
    // Hunger-search: expand detect radius (herbivores) or spiral (predators)
    if (animal._hungerSearch && !animal._hunting) {
      updateHungerSearchMovement(animal, dt, ctx);
    }

    // Predators seek herbivores (or corpses); herbivores seek plants; bears do both
    if (!animal.target || !isValidFoodTarget(animal, animal.target)) {
      animal.target = findFoodTarget(animal, ctx);
    }

    if (!animal.target) {
      if (animal._hungerSearch && !animal._hunting) {
        // Herbivores keep expanding; predators spiral (handled above / below)
        if (isPredator(animal) && animal.diet !== 'herbivore') {
          updateSpiralSearch(animal, dt, ctx);
        } else {
          wander(animal, dt, ctx.rng, ctx);
        }
        return;
      }
      wander(animal, dt, ctx.rng, ctx);
      if (isPredator(animal) && animal._hunting) {
        // Keep hunting until satiated even if no prey nearby
        return;
      }
      if (!isHungry(animal) && hungerRatio(animal) >= HUNGER_RETURN_RATIO) {
        clearHungerSearch(animal);
        animal.state = defaultRestState(animal);
      }
      return;
    }

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

    // Pack call for wolves when chasing
    if (animal.special === 'howl' && animal.packCallTimer <= 0 && t.kind === 'animal' && t.alive) {
      animal.packCallTimer = animal.packCallSeconds || 3;
      animal._howlPulse = true;
    }
    // Lion roar cue when engaging prey (visual + brief pack awareness)
    if (
      animal.special === 'female_hunt' &&
      animal.packCallTimer <= 0 &&
      t.kind === 'animal' &&
      t.alive
    ) {
      animal.packCallTimer = 1.2;
    }

    // Pathfind with no max range — hunger-search may cross the whole map
    moveToward(animal, t.x, t.y, dt, 1, ctx);
  }

  /**
   * Herbivores: grow search radius +2 tiles/sec when nothing in sight.
   * Predators: spiral is applied when still targetless (see updateSeekFood).
   */
  function updateHungerSearchMovement(animal, dt, ctx) {
    if (animal.diet === 'herbivore' || animal.diet === 'omnivore') {
      const cap = mapSearchCap(ctx);
      const prev = animal._searchRadius || FOOD_DETECT_RANGE;
      // Expand by 2 tiles per second until map edge coverage
      animal._searchRadius = Math.min(cap, prev + 2 * TILE_SIZE * dt);
    }
  }

  /** Ever-widening spiral roam used by predators during hunger-search. */
  function updateSpiralSearch(animal, dt, ctx) {
    if (animal._spiralOriginX == null) {
      animal._spiralOriginX = animal.x;
      animal._spiralOriginY = animal.y;
    }
    animal._spiralAngle = (animal._spiralAngle || 0) + dt * 1.35;
    animal._spiralRadius = (animal._spiralRadius || TILE_SIZE * 2) + TILE_SIZE * 0.85 * dt;
    const cap = mapSearchCap(ctx);
    if (animal._spiralRadius > cap) {
      // Restart spiral from current position once it covers the map
      animal._spiralRadius = TILE_SIZE * 2;
      animal._spiralOriginX = animal.x;
      animal._spiralOriginY = animal.y;
    }
    const tx =
      animal._spiralOriginX + Math.cos(animal._spiralAngle) * animal._spiralRadius;
    const ty =
      animal._spiralOriginY + Math.sin(animal._spiralAngle) * animal._spiralRadius;
    moveToward(animal, tx, ty, dt, 0.75, ctx);
  }

  function isValidFoodTarget(animal, t) {
    if (!t) return false;
    if (t.kind === 'plant') return t.alive && t.calories > 0;
    if (t.kind === 'animal') {
      if (t.state === AI_STATE.DEAD) return t.corpseCalories > 0;
      if (!t.alive) return false;
      // Live prey
      if (isPredator(animal) && t.diet === 'herbivore') return true;
      // Desperate predators fight other predators
      if (isPredator(animal) && isPredator(t) && isHungry(animal) && t.id !== animal.id) return true;
      // Raccoon steals — target other animals with calories
      if (animal.special === 'steal' && t.id !== animal.id && t.calories > 5) return true;
      return false;
    }
    return false;
  }

  function foodDetectRange(animal) {
    if (animal._hungerSearch && !animal._hunting) {
      // Herbivores: expanding radius; predators: sight only (spiral explores)
      if (animal.diet === 'herbivore' || animal.diet === 'omnivore') {
        return animal._searchRadius || FOOD_DETECT_RANGE;
      }
      return FOOD_DETECT_RANGE;
    }
    return FOOD_DETECT_RANGE;
  }

  function findFoodTarget(animal, ctx) {
    const detect = foodDetectRange(animal);

    // Prefer corpses if very hungry
    if (isPredator(animal) || isHungry(animal)) {
      const corpse = ctx.findNearestAnimal(
        animal.x,
        animal.y,
        detect,
        function (o) {
          return o.state === AI_STATE.DEAD && o.corpseCalories > 0;
        }
      );
      if (corpse && (isPredator(animal) || isHungry(animal))) return corpse;
    }

    if (
      animal.diet === 'predator' ||
      animal.state === AI_STATE.SEEK_PREY ||
      animal._hunting ||
      (animal.diet === 'omnivore' && (animal._hunting || animal._hungerSearch || isHungry(animal))) ||
      (animal._hungerSearch && isPredator(animal))
    ) {
      // Lion females do most hunting (males only when hungrier), unless already in hunt/search
      if (
        animal.special === 'female_hunt' &&
        animal.sex === 'male' &&
        hungerRatio(animal) > 0.25 &&
        !animal._hunting &&
        !animal._hungerSearch
      ) {
        // Males hunt only when hungrier
      } else {
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
    }

    if (animal.diet === 'herbivore' || animal.diet === 'omnivore') {
      // Raccoon steal attempt
      if (animal.special === 'steal' && ctx.rng.chance(0.3)) {
        const victim = ctx.findNearestAnimal(
          animal.x,
          animal.y,
          detect * 0.5,
          function (o) {
            return o.alive && o.id !== animal.id && o.calories > 10;
          }
        );
        if (victim) return victim;
      }

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

    // Pack join: nearby packmates with same species join
    if (attacker._howlPulse || attacker.special === 'howl') {
      attacker._howlPulse = false;
      const pack = ctx.queryAnimals(attacker.x, attacker.y, PACK_JOIN_RANGE);
      for (let i = 0; i < pack.length; i++) {
        const m = pack[i];
        if (
          m.alive &&
          m.species === attacker.species &&
          m.id !== attacker.id &&
          m.state !== AI_STATE.DEAD
        ) {
          m.target = prey;
          m.state = AI_STATE.SEEK_PREY;
          m._hunting = true;
          m.packCallTimer = attacker.packCallSeconds || 3;
        }
      }
    }

    // Bison group charge
    if (prey._counterAttack && prey.special === 'group_charge') {
      const herd = ctx.queryAnimals(prey.x, prey.y, PACK_JOIN_RANGE);
      for (let i = 0; i < herd.length; i++) {
        const m = herd[i];
        if (m.alive && m.species === prey.species && m.id !== prey.id) {
          m.target = attacker;
          m.state = AI_STATE.FLEE;
          m._counterAttack = true;
          m.fleeFrom = attacker;
        }
      }
    }

    let power = attacker.attackPower;
    // Stealth pounce bonus
    if (attacker.special === 'stealth' || attacker.attackStyle === 'stealth_pounce') {
      power *= 1.35;
    }
    // Death roll bonus in water
    if (attacker.special === 'ambush' && attacker._inWater) {
      power *= 1.5;
    }

    applyDamage(prey, power, attacker);
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

  function updateEating(animal, dt, ctx) {
    const t = animal.target;
    if (!isValidFoodTarget(animal, t)) {
      animal.target = null;
      animal._eatBobTimer = 0;
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

    // Hunger-search satiation: resume normal behavior once ≥60%
    if (
      animal._hungerSearch &&
      !animal._hunting &&
      hungerRatio(animal) >= HUNGER_RETURN_RATIO
    ) {
      animal.target = null;
      animal._eatBobTimer = 0;
      clearPath(animal);
      clearHungerSearch(animal);
      animal.state = defaultRestState(animal);
      return;
    }

    // Stay near food (must be within 20px to eat plants)
    const range = t.kind === 'plant' ? EAT_RANGE : EAT_RANGE + 8;
    const d2 = dist2(animal.x, animal.y, t.x, t.y);
    if (d2 > range * range) {
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

    // Raccoon steal from live animal
    if (animal.special === 'steal' && t.kind === 'animal' && t.alive && t.state !== AI_STATE.DEAD) {
      const stolen = Math.min(
        EAT_RATE_PER_SEC * 2 * dt,
        t.calories * 0.05,
        animal.maxCalories - animal.calories
      );
      if (stolen > 0) {
        t.calories -= stolen;
        animal.calories += stolen;
      }
      if (animal.calories >= animal.maxCalories * 0.95 || t.calories < 5) {
        animal.state = defaultRestState(animal);
        animal.target = null;
      }
      return;
    }

    // Plants: 1 calorie/sec per animal eating (real-time calorie bar).
    // Growth stops immediately once eating starts (until depleted + respawn).
    if (t.kind === 'plant' && t.alive) {
      if (Wildborn.plant.pauseGrowth) Wildborn.plant.pauseGrowth(t);
      const room = animal.maxCalories - animal.calories;
      if (room <= 0) {
        animal.state = postEatState(animal);
        animal.target = null;
        animal._eatBobTimer = 0;
        return;
      }
      const eaten = Wildborn.plant.consumePlant(t, Math.min(EAT_RATE_PER_SEC * dt, room));
      animal.calories += eaten;
      if (!t.alive || animal.calories >= animal.maxCalories * 0.95) {
        animal.target = null;
        animal.state = postEatState(animal);
        animal._eatBobTimer = 0;
      }
      return;
    }

    // Corpses: continuous transfer at a modest rate
    if (t.kind === 'animal' && t.state === AI_STATE.DEAD) {
      const room = animal.maxCalories - animal.calories;
      const eaten = Math.min(EAT_RATE_PER_SEC * 1.5 * dt, t.corpseCalories, room);
      t.corpseCalories -= eaten;
      animal.calories += eaten;
      if (t.corpseCalories <= 0 || animal.calories >= animal.maxCalories * 0.95) {
        animal.target = null;
        animal.state = postEatState(animal);
        animal._eatBobTimer = 0;
      }
    }
  }

  function updateFlee(animal, dt, ctx) {
    animal.stateTimer -= dt;

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
      animal._fleeExhausted = false;
      animal.state = defaultRestState(animal);
      return;
    }

    const dist = Math.hypot(animal.x - threat.x, animal.y - threat.y);

    // Herbivores: keep fleeing until predator is 200px+ away (stamina-gated speed)
    if (animal.diet === 'herbivore') {
      if (dist >= FLEE_SAFE_RANGE) {
        animal.fleeFrom = null;
        animal._fleeExhausted = false;
        animal.state = AI_STATE.IDLE;
        return;
      }
      if (animal.stamina <= 0) animal._fleeExhausted = true;

      const dx = animal.x - threat.x;
      const dy = animal.y - threat.y;
      const len = Math.hypot(dx, dy) || 1;
      const runMult = animal.special === 'runs_from_all' ? 1.3 : 1.15;
      // Exhausted: walk at half max flee speed
      const speedMult = animal._fleeExhausted ? runMult * 0.5 : runMult;
      const tx = animal.x + (dx / len) * 80;
      const ty = animal.y + (dy / len) * 80;
      moveToward(animal, tx, ty, dt, speedMult, ctx);

      if (animal._alertPulse) {
        animal._alertPulse = false;
        const herd = ctx.queryAnimals(animal.x, animal.y, FLEE_DETECT_RANGE);
        for (let i = 0; i < herd.length; i++) {
          const m = herd[i];
          if (m.alive && m.species === animal.species && m.id !== animal.id) {
            m.state = AI_STATE.FLEE;
            m.fleeFrom = threat;
            m.stateTimer = 2.5;
            m._fleeExhausted = m.stamina <= 0;
          }
        }
      }
      return;
    }

    // Non-herbivore flee (timer-based)
    if (animal.stateTimer <= 0) {
      animal.fleeFrom = null;
      animal.state = defaultRestState(animal);
      return;
    }

    const dx = animal.x - threat.x;
    const dy = animal.y - threat.y;
    const len = Math.hypot(dx, dy) || 1;
    const fleeSpeed = animal.special === 'runs_from_all' ? 1.3 : 1.15;
    const tx = animal.x + (dx / len) * 80;
    const ty = animal.y + (dy / len) * 80;
    moveToward(animal, tx, ty, dt, fleeSpeed, ctx);
  }

  // ---------------------------------------------------------------------------
  // Discrete tick (hunger, growth, eating calories, asexual reproduction)
  // ---------------------------------------------------------------------------

  /**
   * Per-tick stamina drain/regen based on activity.
   * Walking/idle/eating/sleeping regenerate; flee/hunt drain.
   */
  function updateStamina(animal) {
    let drain = 0;
    let regen = 0;
    const state = animal.state;
    const speed = Math.hypot(animal.vx || 0, animal.vy || 0);
    const moving = speed > 2;

    if (state === AI_STATE.SLEEP || state === AI_STATE.EATING) {
      regen = STAMINA_REGEN;
      drain = 0;
    } else if (state === AI_STATE.FLEE && animal.diet === 'herbivore') {
      if (animal._fleeExhausted || animal.stamina <= 0) {
        // Exhausted walk-away: walk rates
        regen = STAMINA_REGEN;
        drain = STAMINA_DRAIN_WALK;
        animal._fleeExhausted = true;
      } else {
        // Full sprint flee — predators are exempt (herbivores only)
        regen = 0;
        drain = STAMINA_DRAIN_FLEE;
      }
    } else if (state === AI_STATE.SEEK_PREY || (state === AI_STATE.SEEK_FOOD && isPredator(animal) && animal._hunting)) {
      regen = 0;
      drain = STAMINA_DRAIN_HUNT;
    } else if (state === AI_STATE.IDLE || state === AI_STATE.ROAM) {
      regen = STAMINA_REGEN;
      drain = moving ? STAMINA_DRAIN_WALK : 0;
    } else if (state === AI_STATE.SEEK_FOOD) {
      regen = STAMINA_REGEN;
      drain = moving ? STAMINA_DRAIN_WALK : 0;
    } else {
      regen = STAMINA_REGEN;
    }

    animal.stamina = Math.max(
      0,
      Math.min(animal.maxStamina, animal.stamina + regen - drain)
    );
    if (animal.stamina <= 0 && state === AI_STATE.FLEE && animal.diet === 'herbivore') {
      animal._fleeExhausted = true;
    }
  }

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

    // Hunger drain: daily need / DAY_TICKS, then ÷10, min 0.5 cal/tick
    // Sleeping: conservation mode — half burn
    let drain = calorieBurnPerTick(animal);
    if (animal.state === AI_STATE.SLEEP) drain *= 0.5;
    animal.calories -= drain;

    updateStamina(animal);

    // Age / growth — juveniles start at 20% size, +1% per tick until adult
    animal.age += 1;
    if (!animal.isAdult) {
      animal.growth = Math.min(1, animal.growth + 0.01);
      animal.size = animal.baseSize * animal.growth;
      if (animal.growth >= 1) {
        animal.isAdult = true;
        animal.growth = 1;
        animal.size = animal.baseSize;
      }
    }

    if (animal.breedingCooldown > 0) animal.breedingCooldown -= 1;

    // Lizard regen
    if (animal.regenPerTick && animal.health < animal.maxHealth) {
      animal.health = Math.min(animal.maxHealth, animal.health + animal.regenPerTick);
    }

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
    ADULT_AGE,
    BREED_COOLDOWN,
    BREED_CALORIE_RATIO,
    HUNGER_SEEK_RATIO,
    HUNGER_RETURN_RATIO,
    DAY_TICKS,
    CALORIE_BURN_DIVISOR,
    MIN_CALORIE_BURN,
    PREDATOR_HUNT_RATIO,
    PREDATOR_SATIATED_RATIO,
    TERRITORY_RADIUS,
    STAMINA_MAX,
    STAMINA_REGEN,
    STAMINA_DRAIN_WALK,
    STAMINA_DRAIN_FLEE,
    STAMINA_DRAIN_HUNT,
    STAMINA_PANT_THRESHOLD,
    FLEE_ENTER_RANGE,
    FLEE_SAFE_RANGE,
    FOOD_DETECT_RANGE,
    PLANT_SIGHT_RANGE,
    PLANT_SIGHT_TILES,
    EAT_RANGE,
    EAT_RATE_PER_SEC,
    WATER_SPEED_MULT,
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
