/**
 * Ecosystem animals — herbivores & predators with a shared state machine,
 * hunger, combat, and asexual reproduction.
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

  /** Diet-class land speeds (px/s). Per-species speed keys are aliases only. */
  const HERBIVORE_LAND_SPEED = 60;
  const PREDATOR_LAND_SPEED = 72;
  const SPEED = {
    herbivore: HERBIVORE_LAND_SPEED,
    predator: PREDATOR_LAND_SPEED,
    /** Legacy aliases — land pace is diet-class, not tiered. */
    very_slow: HERBIVORE_LAND_SPEED,
    slow: HERBIVORE_LAND_SPEED,
    medium: HERBIVORE_LAND_SPEED,
    fast: PREDATOR_LAND_SPEED,
    very_fast: PREDATOR_LAND_SPEED,
  };
  const MIN_SPEED = 1;
  /** Non-aquatic herbivores on water: 32 px/s (32/60 of land). */
  const HERBIVORE_WATER_SPEED_MULT = 32 / HERBIVORE_LAND_SPEED;
  /** Non-aquatic predators on water: 36 px/s (36/72 of land). */
  const PREDATOR_WATER_SPEED_MULT = 36 / PREDATOR_LAND_SPEED;
  /** @deprecated Prefer diet-specific water mults; kept as predator water alias. */
  const WATER_SPEED_MULT = PREDATOR_WATER_SPEED_MULT;
  /** Default aquatic water pace (turtles): 48 px/s (48/60 of land). */
  const AQUATIC_WATER_SPEED_MULT = 48 / HERBIVORE_LAND_SPEED;
  /** Corpse stays onscreen for 1 minute (120 ticks × 0.5s). */
  const CORPSE_DECAY_TICKS = 120;
  const TILE_SIZE = 64;
  /** Herbivores "see" plants within this many tiles (25 × 64 = 1600px). */
  const PLANT_SIGHT_TILES = 25;
  const PLANT_SIGHT_RANGE = PLANT_SIGHT_TILES * TILE_SIZE;
  /** Predators detect food/prey within this many tiles (20 × 64 = 1280px). */
  const PREDATOR_SIGHT_TILES = 20;
  const PREDATOR_SIGHT_RANGE = PREDATOR_SIGHT_TILES * TILE_SIZE;

  // ---------------------------------------------------------------------------
  // Species definitions
  // ---------------------------------------------------------------------------

  /** @type {Record<string, object>} */
  const HERBIVORE_SPECIES = {
    rabbit: {
      id: 'rabbit',
      label: 'Rabbit',
      diet: 'herbivore',
      speed: 'medium',
      maxCalories: 60,
      maxHealth: 30,
      attackPower: 2,
      color: '#c8c0b0',
      size: 16,
    },
    deer: {
      id: 'deer',
      label: 'Deer',
      diet: 'herbivore',
      speed: 'medium',
      maxCalories: 160,
      maxHealth: 70,
      attackPower: 4,
      color: '#8a6238',
      size: 28,
    },
    bison: {
      id: 'bison',
      label: 'Bison',
      diet: 'herbivore',
      speed: 'medium',
      maxCalories: 400,
      maxHealth: 200,
      attackPower: 25,
      color: '#5a4030',
      size: 40,
    },
    ostrich: {
      id: 'ostrich',
      label: 'Ostrich',
      diet: 'herbivore',
      speed: 'medium',
      maxCalories: 140,
      maxHealth: 80,
      attackPower: 18,
      color: '#b09060',
      size: 32,
    },
    turtle: {
      id: 'turtle',
      label: 'Turtle',
      diet: 'herbivore',
      speed: 'medium',
      aquatic: true,
      /** 48 px/s in water with herbivore (60) land speed. */
      waterSpeedMult: 48 / HERBIVORE_LAND_SPEED,
      maxCalories: 80,
      maxHealth: 150,
      attackPower: 2,
      color: '#3a6a3a',
      accent: '#2a4a2a',
      size: 22,
    },
  };

  /** @type {Record<string, object>} */
  const PREDATOR_SPECIES = {
    wolf: {
      id: 'wolf',
      label: 'Wolf',
      diet: 'predator',
      speed: 'predator',
      maxCalories: 200,
      maxHealth: 90,
      attackStyle: 'bite',
      attackPower: 22,
      color: '#7a7a88',
      size: 26,
    },
    bear: {
      id: 'bear',
      label: 'Bear',
      diet: 'predator',
      speed: 'predator',
      maxCalories: 500,
      maxHealth: 220,
      attackStyle: 'swipe',
      attackPower: 40,
      color: '#4a3020',
      size: 40,
    },
    alligator: {
      id: 'alligator',
      label: 'Alligator',
      diet: 'predator',
      speed: 'predator',
      aquatic: true,
      /** 108 px/s in water with predator (72) land speed. */
      waterSpeedMult: 108 / PREDATOR_LAND_SPEED,
      maxCalories: 360,
      maxHealth: 180,
      attackStyle: 'death_roll',
      attackPower: 35,
      color: '#2a5a2a',
      size: 36,
    },
  };

  const ALL_SPECIES = Object.assign({}, HERBIVORE_SPECIES, PREDATOR_SPECIES);

  // Timing / thresholds
  /** 600s (10 min) herbivore reproduction cooldown at 0.5s/tick → 1200 ticks. */
  const BREED_COOLDOWN = 1200;
  /** 1200s (20 min) predator reproduction cooldown → 2400 ticks. */
  const PREDATOR_BREED_COOLDOWN = BREED_COOLDOWN * 2;
  /** Calories must be ≥ 80% of max to reproduce. */
  const BREED_CALORIE_RATIO = 0.8;
  /** Enter SEARCHING_FOR_FOOD / hunting at ≤50% calories. */
  const HUNGER_SEEK_RATIO = 0.5;
  /** Leave hunger-search and resume normal behavior at ≥70%. */
  const HUNGER_RETURN_RATIO = 0.7;
  /** Herbivores burn 1 calorie every 12 seconds. */
  const HERBIVORE_CALORIE_BURN_INTERVAL_SEC = 12;
  /** Predators burn 1 calorie every 8 seconds. */
  const PREDATOR_CALORIE_BURN_INTERVAL_SEC = 8;
  /** Animals must be within 40px of a plant to eat it. */
  const EAT_RANGE = 40;
  const ATTACK_RANGE = 44;
  /** Herbivores enter FLEE when a predator is within this range. */
  const FLEE_ENTER_RANGE = 200;
  /** Herbivores stop fleeing once the predator is this far away. */
  const FLEE_SAFE_RANGE = 400;
  /**
   * While eating a plant, interrupt only if a predator within this range is
   * actively targeting this animal (stubborn eating).
   */
  const EAT_PREDATOR_INTERRUPT_RANGE = 100;
  /** Plant eating: 5 calories per second per animal (real-time in updateEating). Stacks. */
  const EAT_RATE_PER_SEC = 5;
  const ATTACK_COOLDOWN_TICKS = 2;
  /** Recompute grid path at most this often (seconds). */
  const PATH_REPATH_SECONDS = 0.45;

  /** All predators hunt for food at ≤50% calories. */
  const PREDATOR_HUNT_RATIO = 0.5;
  /** Predators attack other predators (any species) at ≤25% calories. */
  const PREDATOR_RIVAL_HUNT_RATIO = 0.25;
  /** Stop hunting / leave search at ≥70% calories. */
  const PREDATOR_SATIATED_RATIO = HUNGER_RETURN_RATIO;
  /** Predator prey search expands faster than herbivore plant search (tiles/sec). */
  const PREDATOR_SEARCH_EXPAND_TILES_PER_SEC = 5;
  /** Roam within this radius of spawn while not hunting. */
  const TERRITORY_RADIUS = 400;
  /**
   * Once past TERRITORY_RADIUS, keep walking home until inside this fraction.
   * Without hysteresis, roam ↔ return flipped every frame on the boundary and
   * looked like vibration (especially against tree lines).
   */
  const TERRITORY_RETURN_RATIO = 0.7;
  /** Flee desperation: cross water if predator within this distance. */
  const WATER_DESPERATION_FLEE_DIST = 200;
  /** Starvation desperation: cross water below this calorie ratio. */
  const WATER_DESPERATION_STARVE_RATIO = 0.2;
  /** Seconds pinned at a water edge before allowing a temporary water crossing. */
  const WATER_STUCK_CROSS_SECONDS = 1.25;
  /** Seconds pinned against trees/mountains/water before forcing an escape step. */
  const OBSTACLE_STUCK_ESCAPE_SECONDS = 0.85;
  /**
   * Keep a cul-de-sac escape waypoint this long. Re-picking every time the next
   * step was blocked flipped animals between opposite openings (in-place vibration).
   */
  const ESCAPE_GOAL_STICKY_SECONDS = 2.5;
  /** Minimum map fraction to travel when hunger-searching distant areas. */
  const HUNGER_EXPLORE_MIN_MAP_FRAC = 0.35;
  /**
   * At ≤50% calories, commit to running one direction longer so animals
   * observe new parts of the map before picking another heading.
   */
  const HUNGER_EXPLORE_GOAL_MIN = 22;
  const HUNGER_EXPLORE_GOAL_MAX = 40;
  /** Sleep / nap. */
  const SLEEP_ENTER_RATIO = 0.9;
  const SLEEP_WAKE_RATIO = 0.7;
  const SLEEP_IDLE_SECONDS = 5;
  const SLEEP_MIN_SECONDS = 10;
  const SLEEP_MAX_SECONDS = 60;
  const SLEEP_WAKE_PREDATOR_RANGE = 300;
  const SLEEP_WAKE_FOOD_RANGE = 200;
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
   * @param {{ isOffspring?: boolean, sex?: string }} [opts]
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

    const isPred = def.diet === 'predator';
    // All predators: 72 land; all herbivores: 60 land.
    const baseSpeed = Math.max(
      MIN_SPEED,
      isPred ? PREDATOR_LAND_SPEED : HERBIVORE_LAND_SPEED
    );

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
      health: def.maxHealth,
      maxHealth: def.maxHealth,

      /** Per-animal reproduction cooldown in ticks (persists with animal state). */
      breedingCooldown: isOffspring
        ? breedCooldownFor(def.diet)
        : Math.floor(Math.random() * breedCooldownFor(def.diet)),
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
      /** Expanding food detect radius while hunger-searching / hunting. */
      _searchRadius: isPred ? PREDATOR_SIGHT_RANGE : PLANT_SIGHT_RANGE,
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
      /** Seconds spent fully blocked by trees / mountains / shoreline. */
      _obstacleStuckTimer: 0,
      /** Sticky cul-de-sac exit waypoint (and how long to keep it). */
      _escapeGoal: null,
      _escapeGoalTimer: 0,
      _escapeRefreshedForWater: false,
      /** True while walking back inside territory after straying past the rim. */
      _returningHome: false,

      sex: opts.sex || (Math.random() < 0.5 ? 'male' : 'female'),

      speedKey: def.speed,
      baseSpeed: baseSpeed,
      /** Aquatic species cross water freely; waterSpeedMult controls swim vs land pace. */
      aquatic: !!(def.aquatic || def.waterSpeed),
      waterSpeedKey: def.waterSpeed || null,
      /** Relative water speed (turtle 24/30; alligator 54/36; others diet-class). */
      waterSpeedMult:
        def.waterSpeedMult != null
          ? def.waterSpeedMult
          : def.aquatic || def.waterSpeed
            ? AQUATIC_WATER_SPEED_MULT
            : isPred
              ? PREDATOR_WATER_SPEED_MULT
              : HERBIVORE_WATER_SPEED_MULT,
      attackPower: def.attackPower || 5,
      attackStyle: def.attackStyle || null,

      color: def.color,
      accent: def.accent || null,
      baseSize: def.size,
      size: def.size,

      attackCooldown: 0,

      // Corpse fields (set on death)
      corpseCalories: 0,
      corpseDecay: 0,
      alive: true,
    };
  }

  /**
   * Per-tick calorie drain.
   * Herbivores: 1 calorie every 12 seconds.
   * Predators: 1 calorie every 8 seconds.
   */
  function calorieBurnPerTick(animal) {
    const tickSec =
      (Wildborn.config && Wildborn.config.ecosystemTickSeconds) || 0.5;
    if (PREDATOR_SPECIES[animal.species] || animal.diet === 'predator') {
      return tickSec / PREDATOR_CALORIE_BURN_INTERVAL_SEC;
    }
    return tickSec / HERBIVORE_CALORIE_BURN_INTERVAL_SEC;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function isHerbivore(a) {
    return a.diet === 'herbivore';
  }

  function isPredator(a) {
    return a.diet === 'predator';
  }

  /** Reproduction cooldown ticks: herbivores 10 min, predators 20 min. */
  function breedCooldownFor(diet) {
    return diet === 'predator' ? PREDATOR_BREED_COOLDOWN : BREED_COOLDOWN;
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
    return isPredator(animal) ? AI_STATE.ROAM : AI_STATE.IDLE;
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

  /**
   * Starving predators turn on other predators for food at ≤25% calories
   * (same species or different species).
   */
  function canAttackPredatorRival(attacker, target) {
    if (!attacker || !target) return false;
    if (!isPredator(attacker) || !isPredator(target)) return false;
    if (!target.alive || target.id === attacker.id) return false;
    return hungerRatio(attacker) <= PREDATOR_RIVAL_HUNT_RATIO;
  }

  /** Calories ratio at which a predator enters active prey hunting. */
  function huntThreshold(_animal) {
    return PREDATOR_HUNT_RATIO;
  }

  function baseFoodSightRange(animal) {
    if (animal.diet === 'herbivore') return PLANT_SIGHT_RANGE;
    return PREDATOR_SIGHT_RANGE;
  }

  function initialSearchRadius(animal) {
    return baseFoodSightRange(animal);
  }

  /** Begin map-wide prey hunt (all predators at ≤50%). */
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
    animal._obstacleStuckTimer = 0;
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
    animal._obstacleStuckTimer = 0;
    animal.state = AI_STATE.SEEK_FOOD;
    clearPath(animal);
  }

  function clearHungerSearch(animal) {
    animal._hungerSearch = false;
    animal._searchRadius = baseFoodSightRange(animal);
    animal._spiralAngle = 0;
    animal._spiralRadius = 0;
    animal._spiralOriginX = null;
    animal._spiralOriginY = null;
    animal._exploreGoal = null;
    animal._exploreTimer = 0;
    animal._waterStuckTimer = 0;
    animal._obstacleStuckTimer = 0;
  }

  /** Max search radius that covers the full map from any point. */
  function mapSearchCap(ctx) {
    const mapPx = (ctx && ctx.mapPixelSize) || 25600;
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

  /** Non-aquatic water pace: herbivores 16/30, predators 18/36. */
  function nonAquaticWaterSpeedMult(animal) {
    if (animal.diet === 'herbivore') return HERBIVORE_WATER_SPEED_MULT;
    return PREDATOR_WATER_SPEED_MULT;
  }

  function effectiveSpeed(animal, speedMult) {
    speedMult = speedMult == null ? 1 : speedMult;
    let speed = Math.max(MIN_SPEED, animal.baseSpeed * speedMult);
    if (animal._inWater) {
      // Aquatic (alligator/turtle): species waterSpeedMult; others: diet water mult
      if (animal.aquatic) {
        speed = Math.max(
          MIN_SPEED,
          animal.baseSpeed * aquaticWaterSpeedMult(animal) * speedMult
        );
      } else {
        speed *= nonAquaticWaterSpeedMult(animal);
      }
    }
    return Math.max(MIN_SPEED, speed);
  }

  /** True if pixel sits on a solid tile (dark green trees / mountains). */
  function isSolidAt(ctx, x, y) {
    if (!ctx) return false;
    if (ctx.isSolid) return !!ctx.isSolid(x, y);
    if (ctx.world) {
      return ctx.world.isSolid(ctx.world.getTileAtPixel(x, y));
    }
    return false;
  }

  /**
   * True when the animal may enter water: aquatic species, fleeing a nearby
   * predator, starving, or pinned on a shoreline long enough to unstick.
   * Once already in water, keep permission until land so soft-reject cannot
   * bounce them forever on the shoreline mid-crossing.
   */
  function canCrossWater(animal, ctx) {
    if (animal.aquatic || animal.waterSpeedKey) return true;
    // Finish a crossing already underway (timer decay used to yank them back)
    if (ctx && ctx.isWater && ctx.isWater(animal.x, animal.y)) return true;
    if (animal.state === AI_STATE.FLEE && animal.fleeFrom && animal.fleeFrom.alive) {
      const d = Math.hypot(animal.x - animal.fleeFrom.x, animal.y - animal.fleeFrom.y);
      if (d <= WATER_DESPERATION_FLEE_DIST) return true;
    }
    // Starving animals may cross even before a food target is locked
    if (hungerRatio(animal) < WATER_DESPERATION_STARVE_RATIO) {
      return true;
    }
    // Shoreline pin: any animal stuck long enough may take a temporary crossing
    // (not only hunger-search). Roamers otherwise freeze forever in coves.
    if ((animal._waterStuckTimer || 0) >= WATER_STUCK_CROSS_SECONDS) {
      return true;
    }
    return false;
  }

  /** Solid tiles always block; water blocks unless the animal may cross. */
  function isTerrainBlocked(animal, ctx, x, y) {
    if (isSolidAt(ctx, x, y)) return true;
    if (ctx && ctx.isWater && ctx.isWater(x, y) && !canCrossWater(animal, ctx)) {
      return true;
    }
    return false;
  }

  /**
   * Pick a dry (when possible) waypoint in a completely different part of the map.
   */
  function pickDistantExploreGoal(animal, ctx) {
    const mapPx = (ctx && ctx.mapPixelSize) || 25600;
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
      if (isSolidAt(ctx, x, y)) continue;
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
   * Scan nearby rings for a more open walkable pixel so animals can leave
   * tree / water cul-de-sacs instead of freezing on the edge.
   *
   * @param {object|null} preferNear When re-picking after a sticky timeout,
   *   bias toward the previous escape heading so opposite openings do not win
   *   on tiny position noise (that ping-pong reads as vibration).
   */
  function findNearbyEscape(animal, ctx, maxRadiusTiles, preferNear) {
    if (!ctx) return null;
    maxRadiusTiles = maxRadiusTiles == null ? 5 : maxRadiusTiles;
    const pinnedAtWater = isNearWater(animal, ctx);
    let preferDx = 0;
    let preferDy = 0;
    let preferLen = 0;
    if (preferNear) {
      preferDx = preferNear.x - animal.x;
      preferDy = preferNear.y - animal.y;
      preferLen = Math.hypot(preferDx, preferDy);
    }
    let fallback = null;
    let fallbackScore = -1;
    // Near → far so we prefer the cul-de-sac exit over open land behind trees.
    for (let r = 1; r <= maxRadiusTiles; r++) {
      const rad = r * TILE_SIZE;
      const samples = 8 + r * 4;
      let best = null;
      let bestScore = -1;
      for (let i = 0; i < samples; i++) {
        const ang = (i / samples) * Math.PI * 2;
        const x = animal.x + Math.cos(ang) * rad;
        const y = animal.y + Math.sin(ang) * rad;
        if (isTerrainBlocked(animal, ctx, x, y)) continue;
        // First step toward the candidate must be walkable (no tunneling)
        const dx = x - animal.x;
        const dy = y - animal.y;
        const len = Math.hypot(dx, dy) || 1;
        const stepX = animal.x + (dx / len) * Math.min(len, TILE_SIZE * 0.55);
        const stepY = animal.y + (dy / len) * Math.min(len, TILE_SIZE * 0.55);
        if (isTerrainBlocked(animal, ctx, stepX, stepY)) continue;
        const onWater = !!(ctx.isWater && ctx.isWater(x, y));
        let open = 0;
        let waterNeighbors = 0;
        const dirs = [
          [TILE_SIZE, 0],
          [-TILE_SIZE, 0],
          [0, TILE_SIZE],
          [0, -TILE_SIZE],
        ];
        for (let d = 0; d < dirs.length; d++) {
          const nx = x + dirs[d][0];
          const ny = y + dirs[d][1];
          if (!isTerrainBlocked(animal, ctx, nx, ny)) {
            open++;
          }
          if (ctx.isWater && ctx.isWater(nx, ny)) waterNeighbors++;
        }
        // Prefer open dry inland tiles. Shore-to-shore "escapes" keep animals
        // pinned on the waterline even when open == 2 along the beach.
        let score = open * 10 + r + (onWater ? 0 : 8);
        if (pinnedAtWater && !onWater && waterNeighbors === 0) score += 14;
        else if (pinnedAtWater && waterNeighbors > 0) score -= waterNeighbors * 4;
        if (preferLen > 1) {
          score += 16 * ((dx * preferDx + dy * preferDy) / (len * preferLen));
        }
        if (score > bestScore) {
          bestScore = score;
          best = { x: x, y: y };
        }
      }
      // Accept a clearly open inland exit as soon as we see one. Require a
      // higher score so plain shoreline tiles (open=2) are not treated as free.
      if (best && bestScore >= 36) return best;
      if (best && bestScore > fallbackScore) {
        fallbackScore = bestScore;
        fallback = best;
      }
    }
    return fallback;
  }

  function clearEscapeGoal(animal) {
    animal._escapeGoal = null;
    animal._escapeGoalTimer = 0;
    animal._escapeRefreshedForWater = false;
  }

  /**
   * Step toward an escape point for one frame. Returns true if movement applied.
   */
  function stepTowardEscape(animal, esc, dt, speedMult, ctx) {
    if (!esc) return false;
    const dx = esc.x - animal.x;
    const dy = esc.y - animal.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.5) return false;
    const speed = effectiveSpeed(animal, speedMult);
    const prevX = animal.x;
    const prevY = animal.y;
    const step = Math.min(len, speed * Math.max(dt, 0.05));
    const nextX = animal.x + (dx / len) * step;
    const nextY = animal.y + (dy / len) * step;
    // Axis-separate so we can slide out of corners
    if (!isSolidAt(ctx, nextX, prevY)) animal.x = nextX;
    if (!isSolidAt(ctx, animal.x, nextY)) animal.y = nextY;
    if (
      ctx &&
      ctx.isWater &&
      ctx.isWater(animal.x, animal.y) &&
      !canCrossWater(animal, ctx)
    ) {
      animal.x = prevX;
      animal.y = prevY;
      return false;
    }
    if (animal.x === prevX && animal.y === prevY) return false;
    animal.vx = (dx / len) * speed;
    animal.vy = (dy / len) * speed;
    return true;
  }

  /**
   * Try stepping along an obstacle edge toward a blocked goal instead of freezing.
   * Returns true if a legal step was applied.
   *
   * Prefers continuing the previous slide heading so left/right candidate order
   * cannot flip every frame (that looks like rapid vibration in place).
   */
  function tryShoreSlide(animal, tx, ty, dt, speedMult, ctx) {
    const dx = tx - animal.x;
    const dy = ty - animal.y;
    const len = Math.hypot(dx, dy) || 1;
    const fx = dx / len;
    const fy = dy / len;
    // Perpendicular / diagonal / reverse directions around trees & shorelines
    const candidates = [
      { x: -fy, y: fx },
      { x: fy, y: -fx },
      { x: -fy * 0.7 + fx * 0.3, y: fx * 0.7 + fy * 0.3 },
      { x: fy * 0.7 + fx * 0.3, y: -fx * 0.7 + fy * 0.3 },
      { x: -fy * 0.3 + fx * 0.7, y: fx * 0.3 + fy * 0.7 },
      { x: fy * 0.3 + fx * 0.7, y: -fx * 0.3 + fy * 0.7 },
      { x: -fx, y: -fy },
      { x: -fx * 0.5 - fy * 0.85, y: -fy * 0.5 + fx * 0.85 },
      { x: -fx * 0.5 + fy * 0.85, y: -fy * 0.5 - fx * 0.85 },
    ];
    const speed = effectiveSpeed(animal, speedMult);
    const stuck =
      (animal._obstacleStuckTimer || 0) >= OBSTACLE_STUCK_ESCAPE_SECONDS ||
      (animal._waterStuckTimer || 0) >= WATER_STUCK_CROSS_SECONDS;
    const stepLens = stuck
      ? [speed * Math.max(dt, 0.08), TILE_SIZE * 0.55, TILE_SIZE * 0.9]
      : [speed * Math.max(dt, 0.05), TILE_SIZE * 0.45];
    const allowWater = canCrossWater(animal, ctx);
    const prevVx = animal._slideVx;
    const prevVy = animal._slideVy;
    const hasPrev =
      prevVx != null &&
      prevVy != null &&
      Math.hypot(prevVx, prevVy) > 0.01;

    let best = null;
    let bestScore = -Infinity;
    for (let s = 0; s < stepLens.length; s++) {
      const step = stepLens[s];
      for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        const cl = Math.hypot(c.x, c.y) || 1;
        const ux = c.x / cl;
        const uy = c.y / cl;
        const nx = animal.x + ux * step;
        const ny = animal.y + uy * step;
        if (isSolidAt(ctx, nx, ny)) continue;
        if (ctx && ctx.isWater && ctx.isWater(nx, ny) && !allowWater) continue;
        // Progress toward goal + strong bonus for keeping the last slide side
        let score = ux * fx + uy * fy;
        if (hasPrev) {
          const pLen = Math.hypot(prevVx, prevVy) || 1;
          score += 2.5 * ((ux * prevVx + uy * prevVy) / pLen);
        }
        // Prefer shorter probe first (same stepLens order) via small bias
        score += (stepLens.length - s) * 0.05;
        if (score > bestScore) {
          bestScore = score;
          best = { ux: ux, uy: uy, nx: nx, ny: ny };
        }
      }
      // Commit to a short legal step before trying larger hops
      if (best && !stuck) break;
    }
    if (!best) {
      animal._slideVx = null;
      animal._slideVy = null;
      return false;
    }
    animal.vx = best.ux * speed;
    animal.vy = best.uy * speed;
    animal._slideVx = animal.vx;
    animal._slideVy = animal.vy;
    animal.x = best.nx;
    animal.y = best.ny;
    return true;
  }

  /** True when a pixel sits on or beside water. */
  function pixelNearWater(ctx, x, y) {
    if (!ctx || !ctx.isWater) return false;
    if (ctx.isWater(x, y)) return true;
    const offsets = [
      [TILE_SIZE, 0],
      [-TILE_SIZE, 0],
      [0, TILE_SIZE],
      [0, -TILE_SIZE],
    ];
    for (let i = 0; i < offsets.length; i++) {
      if (ctx.isWater(x + offsets[i][0], y + offsets[i][1])) return true;
    }
    return false;
  }

  /**
   * Escape waypoint that sticks across frames. Re-picking whenever the next
   * step was blocked flipped animals between opposite openings every frame
   * (rapid in-place vibration in tree corridors).
   *
   * When a temporary water crossing first becomes allowed, refresh once if the
   * sticky goal is still on the shoreline so animals can aim inland/across.
   */
  function getStickyEscape(animal, ctx, maxRadiusTiles) {
    const existing = animal._escapeGoal;
    const timer = animal._escapeGoalTimer || 0;
    if (existing && timer > 0) {
      const dist = Math.hypot(existing.x - animal.x, existing.y - animal.y);
      if (dist <= TILE_SIZE * 0.4) {
        // Arrived — allow a fresh farther exit if still pocket-stuck
        clearEscapeGoal(animal);
      } else {
        const refreshShoreOnce =
          !animal._escapeRefreshedForWater &&
          isNearWater(animal, ctx) &&
          canCrossWater(animal, ctx) &&
          pixelNearWater(ctx, existing.x, existing.y);
        if (refreshShoreOnce) {
          animal._escapeRefreshedForWater = true;
          // fall through to re-pick an inland / crossable goal
        } else {
          // Keep the goal even when the immediate step is solid — shore-slide
          // / axis steps still make progress. Do not re-sample here.
          return existing;
        }
      }
    }
    const prev = existing;
    const esc = findNearbyEscape(animal, ctx, maxRadiusTiles, prev);
    animal._escapeGoal = esc || null;
    animal._escapeGoalTimer = esc ? ESCAPE_GOAL_STICKY_SECONDS : 0;
    return esc;
  }

  /**
   * Shared unstick: walk / slide toward a sticky escape (not the caller's
   * momentary "away from velocity" point — that reversed every frame).
   * Returns true if the animal moved.
   */
  function tryUnstick(animal, tx, ty, dt, speedMult, ctx) {
    const esc = getStickyEscape(animal, ctx, 6);
    const goalX = esc ? esc.x : tx;
    const goalY = esc ? esc.y : ty;
    if (esc && stepTowardEscape(animal, esc, dt, speedMult, ctx)) return true;
    if (tryShoreSlide(animal, goalX, goalY, dt, speedMult, ctx)) return true;
    return false;
  }

  /**
   * Micro-slides along an edge used to clear stuck timers every frame while the
   * animal never left the cul-de-sac. Track a local anchor so fidgeting inside
   * one tile still builds escape pressure.
   *
   * When the pocket is against water, also build `_waterStuckTimer` — otherwise
   * animals boxed by trees+water never flip canCrossWater (obstacle time alone
   * does not authorize a swim) and freeze on the shoreline forever.
   */
  function updateLocalStuck(animal, dt, ctx) {
    if ((animal._escapeGoalTimer || 0) > 0) {
      animal._escapeGoalTimer = Math.max(0, animal._escapeGoalTimer - dt);
    }
    if (!animal._stuckAnchor) {
      animal._stuckAnchor = { x: animal.x, y: animal.y };
      return;
    }
    const fromAnchor = Math.hypot(
      animal.x - animal._stuckAnchor.x,
      animal.y - animal._stuckAnchor.y
    );
    if (fromAnchor > TILE_SIZE * 1.35) {
      animal._stuckAnchor = { x: animal.x, y: animal.y };
      animal._obstacleStuckTimer = Math.max(
        0,
        (animal._obstacleStuckTimer || 0) - dt * 2
      );
      animal._waterStuckTimer = Math.max(0, (animal._waterStuckTimer || 0) - dt * 2);
      return;
    }
    // Still in the same pocket — count time even when axis-sliding a few pixels
    animal._obstacleStuckTimer = (animal._obstacleStuckTimer || 0) + dt;
    if (isNearWater(animal, ctx)) {
      animal._waterStuckTimer = (animal._waterStuckTimer || 0) + dt;
    }
  }

  /** True when a nearby tile is water (shoreline / cove). */
  function isNearWater(animal, ctx) {
    if (!ctx || !ctx.isWater) return false;
    if (ctx.isWater(animal.x, animal.y)) return true;
    const offsets = [
      [TILE_SIZE, 0],
      [-TILE_SIZE, 0],
      [0, TILE_SIZE],
      [0, -TILE_SIZE],
      [TILE_SIZE, TILE_SIZE],
      [-TILE_SIZE, TILE_SIZE],
      [TILE_SIZE, -TILE_SIZE],
      [-TILE_SIZE, -TILE_SIZE],
    ];
    for (let i = 0; i < offsets.length; i++) {
      if (ctx.isWater(animal.x + offsets[i][0], animal.y + offsets[i][1])) {
        return true;
      }
    }
    return false;
  }

  /** True when nearby tiles include water or solids (edge / cove / tree line). */
  function nearBlockingTerrain(animal, ctx) {
    if (!ctx) return false;
    const offsets = [
      [TILE_SIZE, 0],
      [-TILE_SIZE, 0],
      [0, TILE_SIZE],
      [0, -TILE_SIZE],
      [TILE_SIZE, TILE_SIZE],
      [-TILE_SIZE, TILE_SIZE],
      [TILE_SIZE, -TILE_SIZE],
      [-TILE_SIZE, -TILE_SIZE],
    ];
    for (let i = 0; i < offsets.length; i++) {
      const x = animal.x + offsets[i][0];
      const y = animal.y + offsets[i][1];
      if (isSolidAt(ctx, x, y)) return true;
      if (ctx.isWater && ctx.isWater(x, y)) return true;
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
        // path == null → A* failed (usually water / solids blocking a dry-only search)
        if (!canCrossWater(animal, ctx) && ctx.isWater && ctx.isWater(tx, ty)) {
          // Goal is in water — slide along shore instead of freezing
          animal._waterStuckTimer = (animal._waterStuckTimer || 0) + dt;
          animal._obstacleStuckTimer = (animal._obstacleStuckTimer || 0) + dt;
          if (tryUnstick(animal, tx, ty, dt, speedMult, ctx)) return;
          animal.vx = 0;
          animal.vy = 0;
          return;
        }
        if (!canCrossWater(animal, ctx)) {
          // No dry path across water — slide shoreward rather than bee-line into the edge
          animal._waterStuckTimer = (animal._waterStuckTimer || 0) + dt;
          animal._obstacleStuckTimer = (animal._obstacleStuckTimer || 0) + dt;
          if (tryUnstick(animal, tx, ty, dt, speedMult, ctx)) return;
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
      animal._obstacleStuckTimer = 0;
      return;
    }
    const speed = effectiveSpeed(animal, speedMult);

    animal.vx = (dx / len) * speed;
    animal.vy = (dy / len) * speed;
    const prevX = animal.x;
    const prevY = animal.y;
    const nextX = animal.x + animal.vx * dt;
    const nextY = animal.y + animal.vy * dt;

    // Axis-separate solid collision (trees / mountains) — same idea as the caveman
    if (!isSolidAt(ctx, nextX, prevY)) {
      animal.x = nextX;
    } else {
      animal.vx = 0;
    }
    if (!isSolidAt(ctx, animal.x, nextY)) {
      animal.y = nextY;
    } else {
      animal.vy = 0;
    }

    // Fully blocked by solid terrain — slide / escape instead of freezing
    if (animal.x === prevX && animal.y === prevY && (dx !== 0 || dy !== 0)) {
      clearPath(animal);
      animal._obstacleStuckTimer = (animal._obstacleStuckTimer || 0) + dt;
      if (ctx && tryUnstick(animal, tx, ty, dt, speedMult, ctx)) return;
      // Abandon a hopeless explore waypoint so hunger-search can pick another
      if (
        (animal._obstacleStuckTimer || 0) >= OBSTACLE_STUCK_ESCAPE_SECONDS &&
        animal._exploreGoal
      ) {
        animal._exploreGoal = null;
        animal._exploreTimer = 0;
      }
      animal.vx = 0;
      animal.vy = 0;
      return;
    }

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
      animal._obstacleStuckTimer = (animal._obstacleStuckTimer || 0) + dt;
      clearPath(animal);
      if (tryUnstick(animal, tx, ty, dt, speedMult, ctx)) return;
      animal.vx = 0;
      animal.vy = 0;
      return;
    }

    // Pocket-aware progress: micro-slides along edges do not clear stuck time
    const moved = Math.hypot(animal.x - prevX, animal.y - prevY);
    if (ctx && nearBlockingTerrain(animal, ctx)) {
      updateLocalStuck(animal, dt, ctx);
    } else if (moved > 0.2) {
      animal._waterStuckTimer = Math.max(0, (animal._waterStuckTimer || 0) - dt * 2);
      animal._obstacleStuckTimer = Math.max(
        0,
        (animal._obstacleStuckTimer || 0) - dt * 2
      );
      animal._stuckAnchor = { x: animal.x, y: animal.y };
      animal._slideVx = null;
      animal._slideVy = null;
      animal._avoidAng = null;
      clearEscapeGoal(animal);
    }

    // Splash particles when moving through water
    if (animal._inWater && ctx && ctx.spawnSplash) {
      if (moved > 0.5) ctx.spawnSplash(animal.x, animal.y);
    }
  }

  function wander(animal, dt, rng, ctx) {
    // Edge / cove fidgeting: if we have been in the same local pocket beside
    // water or trees, force a walk toward more open land before random wander.
    if (
      ctx &&
      nearBlockingTerrain(animal, ctx) &&
      (animal._obstacleStuckTimer || 0) >= OBSTACLE_STUCK_ESCAPE_SECONDS
    ) {
      const esc = getStickyEscape(animal, ctx, 7);
      if (esc) {
        // Path around tree corridors once pocket-stuck — direct steps alone
        // thrash when the exit is not a straight line.
        if ((animal._obstacleStuckTimer || 0) >= OBSTACLE_STUCK_ESCAPE_SECONDS * 1.4) {
          moveToward(animal, esc.x, esc.y, dt, 0.85, ctx);
          updateLocalStuck(animal, dt, ctx);
          animal.stateTimer = 0.55 + rng.float() * 0.6;
          return;
        }
        if (stepTowardEscape(animal, esc, dt, 0.85, ctx)) {
          updateLocalStuck(animal, dt, ctx);
          animal.stateTimer = 0.55 + rng.float() * 0.6;
          return;
        }
        if (tryShoreSlide(animal, esc.x, esc.y, dt, 0.85, ctx)) {
          updateLocalStuck(animal, dt, ctx);
          animal.stateTimer = 0.55 + rng.float() * 0.6;
          return;
        }
        // Last resort nudge: hop toward the escape tile when sliding fails.
        // Once shoreline-pinned long enough, allow a longer water hop so tree+water
        // pockets can be left instead of freezing on the edge.
        const dx = esc.x - animal.x;
        const dy = esc.y - animal.y;
        const len = Math.hypot(dx, dy) || 1;
        const allowWetHop = canCrossWater(animal, ctx);
        const hopMax = allowWetHop ? TILE_SIZE * 1.25 : TILE_SIZE * 0.6;
        const hop = Math.min(len, hopMax);
        const hx = animal.x + (dx / len) * hop;
        const hy = animal.y + (dy / len) * hop;
        if (!isTerrainBlocked(animal, ctx, hx, hy) && !isSolidAt(ctx, hx, hy)) {
          animal.x = hx;
          animal.y = hy;
          animal.vx = (dx / len) * effectiveSpeed(animal, 0.85);
          animal.vy = (dy / len) * effectiveSpeed(animal, 0.85);
          animal._stuckAnchor = { x: animal.x, y: animal.y };
          // Keep the sticky escape — clearing it here re-picked opposite exits.
          animal.stateTimer = 0.7 + rng.float() * 0.5;
          return;
        }
      }
    }

    if (animal.stateTimer <= 0 || (animal.vx === 0 && animal.vy === 0)) {
      const angle = rng.float() * Math.PI * 2;
      let speed = Math.max(MIN_SPEED, animal.baseSpeed * 0.4);
      if (animal._inWater) {
        speed = animal.aquatic
          ? Math.max(MIN_SPEED, animal.baseSpeed * aquaticWaterSpeedMult(animal) * 0.4)
          : speed * nonAquaticWaterSpeedMult(animal);
      }
      // Fresh heading — drop sticky avoid angle from the last bounce
      animal._avoidAng = null;
      // Bias fresh headings away from nearby blockers once pocket-stuck
      if (
        ctx &&
        nearBlockingTerrain(animal, ctx) &&
        (animal._obstacleStuckTimer || 0) >= OBSTACLE_STUCK_ESCAPE_SECONDS * 0.5
      ) {
        const esc = getStickyEscape(animal, ctx, 6);
        if (esc) {
          const dx = esc.x - animal.x;
          const dy = esc.y - animal.y;
          const len = Math.hypot(dx, dy) || 1;
          animal.vx = (dx / len) * speed;
          animal.vy = (dy / len) * speed;
          animal.stateTimer = 1 + rng.float() * 1.5;
        } else {
          animal.vx = Math.cos(angle) * speed;
          animal.vy = Math.sin(angle) * speed;
          animal.stateTimer = 1 + rng.float() * 2;
        }
      } else {
        animal.vx = Math.cos(angle) * speed;
        animal.vy = Math.sin(angle) * speed;
        animal.stateTimer = 1 + rng.float() * 2;
      }
    }

    // Soft avoidance of solids (always) and water (unless desperate / aquatic)
    let nx = animal.x + animal.vx * dt;
    let ny = animal.y + animal.vy * dt;
    const blockedWater =
      ctx && ctx.isWater && ctx.isWater(nx, ny) && !canCrossWater(animal, ctx);
    const blockedSolid = isSolidAt(ctx, nx, ny);
    if (blockedWater || blockedSolid) {
      // Sample escape headings. Prefer side-steps and the last avoid heading
      // before 180° reverse — reverse-first caused edge bounce vibration.
      let found = false;
      const baseAng = Math.atan2(animal.vy, animal.vx);
      const tryAngles = [];
      if (animal._avoidAng != null) tryAngles.push(animal._avoidAng);
      tryAngles.push(
        baseAng + Math.PI * 0.5,
        baseAng - Math.PI * 0.5,
        baseAng + Math.PI * 0.75,
        baseAng - Math.PI * 0.75,
        baseAng + Math.PI * 0.25,
        baseAng - Math.PI * 0.25,
        baseAng + Math.PI,
        rng.float() * Math.PI * 2,
        rng.float() * Math.PI * 2
      );
      const speed =
        Math.hypot(animal.vx, animal.vy) || Math.max(MIN_SPEED, animal.baseSpeed * 0.4);
      // Longer probe steps once pinned so one-tile cul-de-sacs can be left
      const stuckHard =
        (animal._obstacleStuckTimer || 0) >= OBSTACLE_STUCK_ESCAPE_SECONDS ||
        (animal._waterStuckTimer || 0) >= WATER_STUCK_CROSS_SECONDS;
      const probeDt = stuckHard ? Math.max(dt, 0.2) : dt;
      for (let i = 0; i < tryAngles.length; i++) {
        const ang = tryAngles[i];
        const ax = Math.cos(ang) * speed;
        const ay = Math.sin(ang) * speed;
        const tx = animal.x + ax * probeDt;
        const ty = animal.y + ay * probeDt;
        if (isSolidAt(ctx, tx, ty)) continue;
        if (ctx && ctx.isWater && ctx.isWater(tx, ty) && !canCrossWater(animal, ctx)) {
          continue;
        }
        animal.vx = ax;
        animal.vy = ay;
        animal._avoidAng = ang;
        nx = animal.x + ax * dt;
        ny = animal.y + ay * dt;
        // If the short step is still blocked but the probe was clear, take the probe
        if (isTerrainBlocked(animal, ctx, nx, ny) && stuckHard) {
          nx = tx;
          ny = ty;
        }
        found = true;
        break;
      }
      animal.stateTimer = 0.55 + rng.float() * 0.75;
      if (!found) {
        // Fully boxed — accumulate stuck time, then slide / escape to open land.
        // Count shoreline pressure even when this frame bounced off a tree: many
        // water-edge traps are tree+water pockets that never soft-reject water.
        animal._obstacleStuckTimer = (animal._obstacleStuckTimer || 0) + dt;
        if (blockedWater || isNearWater(animal, ctx)) {
          animal._waterStuckTimer = (animal._waterStuckTimer || 0) + dt;
        }
        const awayX = animal.x - (animal.vx || 1);
        const awayY = animal.y - (animal.vy || 0);
        if (tryUnstick(animal, awayX, awayY, dt, 0.55, ctx)) {
          animal.stateTimer = 0.5 + rng.float() * 0.5;
          return;
        }
        // canCrossWater may have flipped after the timer bump — retry once
        if ((blockedWater || isNearWater(animal, ctx)) && canCrossWater(animal, ctx)) {
          const esc = getStickyEscape(animal, ctx, 6);
          if (esc && stepTowardEscape(animal, esc, dt, 0.55, ctx)) {
            animal.stateTimer = 0.5 + rng.float() * 0.5;
            return;
          }
        }
        animal.vx = 0;
        animal.vy = 0;
        animal.stateTimer = 0;
        return;
      }
    }

    const prevX = animal.x;
    const prevY = animal.y;
    // Axis-separate solid collision so wanderers slide along tree/mountain edges
    if (!isSolidAt(ctx, nx, prevY)) {
      animal.x = nx;
    } else {
      animal.vx = 0;
    }
    if (!isSolidAt(ctx, animal.x, ny)) {
      animal.y = ny;
    } else {
      animal.vy = 0;
    }

    // Soft reject illegal water after axis move
    if (
      ctx &&
      ctx.isWater &&
      ctx.isWater(animal.x, animal.y) &&
      !canCrossWater(animal, ctx)
    ) {
      animal.x = prevX;
      animal.y = prevY;
      animal._waterStuckTimer = (animal._waterStuckTimer || 0) + dt;
      animal._obstacleStuckTimer = (animal._obstacleStuckTimer || 0) + dt;
      if (tryUnstick(animal, prevX - animal.vx, prevY - animal.vy, dt, 0.55, ctx)) {
        animal.stateTimer = 0.4 + rng.float() * 0.6;
        return;
      }
      animal.vx = 0;
      animal.vy = 0;
      animal.stateTimer = 0;
      return;
    }

    animal.stateTimer -= dt;

    const moved = Math.hypot(animal.x - prevX, animal.y - prevY);
    if (ctx && nearBlockingTerrain(animal, ctx)) {
      // Pocket time ignores micro-slides; only a real exit clears the anchor
      updateLocalStuck(animal, dt, ctx);
      if (moved < 0.2 && ctx.isWater && ctx.isWater(nx, ny)) {
        animal._waterStuckTimer = (animal._waterStuckTimer || 0) + dt;
      }
    } else if (moved > 0.2) {
      animal._waterStuckTimer = Math.max(0, (animal._waterStuckTimer || 0) - dt * 2);
      animal._obstacleStuckTimer = Math.max(
        0,
        (animal._obstacleStuckTimer || 0) - dt * 2
      );
      animal._stuckAnchor = { x: animal.x, y: animal.y };
      animal._avoidAng = null;
      animal._slideVx = null;
      animal._slideVy = null;
      clearEscapeGoal(animal);
    } else if (Math.hypot(animal.vx, animal.vy) > 1) {
      animal._obstacleStuckTimer = (animal._obstacleStuckTimer || 0) + dt;
    }

    if (animal._inWater && ctx && ctx.spawnSplash) {
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
    if (isPredator(target)) {
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
    // Herbivores always flee when hit
    target.state = AI_STATE.FLEE;
    target.fleeFrom = attacker;
    target.stateTimer = 2.5;
    return dmg;
  }

  function killAnimal(animal, killer) {
    animal.alive = false;
    animal.state = AI_STATE.DEAD;
    animal.health = 0;
    animal.vx = 0;
    animal.vy = 0;
    // Corpses yield only the calories the creature had at death.
    animal.corpseCalories = Math.max(0, animal.calories);
    animal.corpseDecay = CORPSE_DECAY_TICKS; // 1 minute onscreen
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
    });
    parent.breedingCooldown = breedCooldownFor(parent.diet);
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

    // Predator hunger gate: all predators hunt at ≤50%
    if (isPredator(animal) && animal.state !== AI_STATE.SLEEP) {
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
   * Predators: ROAM while calories > 50%; enter SEEK_PREY hunt at ≤50%;
   * stay hunting until calories ≥ 70%, then ROAM.
   */
  function updatePredatorHungerGate(animal) {
    const ratio = hungerRatio(animal);
    if (animal.state === AI_STATE.DEAD || animal.state === AI_STATE.FLEE || animal.state === AI_STATE.SLEEP) return;

    const threshold = huntThreshold(animal);

    // All predators: full hunt mode at ≤50%
    if (ratio <= threshold) {
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

    if (animal.state === AI_STATE.IDLE) animal.state = AI_STATE.ROAM;
  }

  /**
   * Shared hunger-search entry/exit for herbivores.
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
    // Predators already gated above
    if (isPredator(animal)) {
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
    if (isPredator(animal) && hungerRatio(animal) <= huntThreshold(animal)) {
      enterPreyHunt(animal);
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
      animal._returningHome = true;
    }
    if (animal._returningHome) {
      if (dist <= TERRITORY_RADIUS * TERRITORY_RETURN_RATIO) {
        animal._returningHome = false;
      } else {
        // Drop cul-de-sac escapes that point away from home — they fought
        // moveToward(spawn) on the territory rim and caused boundary vibration.
        if (animal._escapeGoal) {
          const esc = animal._escapeGoal;
          const escAway =
            (esc.x - animal.x) * (animal.spawnX - animal.x) +
              (esc.y - animal.y) * (animal.spawnY - animal.y) <
            0;
          if (escAway) clearEscapeGoal(animal);
        }
        moveToward(animal, animal.spawnX, animal.spawnY, dt, 0.5, ctx);
        return;
      }
    }
    wander(animal, dt, ctx.rng, ctx);
  }

  /**
   * Nearest living predator within range.
   * Herbivores flee from predators on sight.
   */
  function findPredatorThreat(animal, ctx, range) {
    if (!ctx || !ctx.findNearestAnimal) return null;
    return ctx.findNearestAnimal(animal.x, animal.y, range, function (o) {
      return o.alive && isPredator(o) && o.id !== animal.id;
    });
  }

  /** Enter FLEE from a seen predator. */
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
    if (isPredator(animal)) {
      animal.state = AI_STATE.ROAM;
      return;
    }

    // Threat scan — herbivores run from predators on sight
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
    if (isPredator(animal)) {
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
    if (animal.diet === 'herbivore' && hungerRatio(animal) < SLEEP_ENTER_RATIO) {
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
    // Herbivores abandon food search and flee when they see a predator
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

    // Predators seek herbivores (or corpses); herbivores seek plants only
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
   * Hunting predators: grow faster while searching map-wide.
   */
  function updateHungerSearchMovement(animal, dt, ctx) {
    const cap = mapSearchCap(ctx);
    const prev = animal._searchRadius || initialSearchRadius(animal);
    let tilesPerSec = 2;
    if (animal._hunting) tilesPerSec = PREDATOR_SEARCH_EXPAND_TILES_PER_SEC;
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
    if (t.kind === 'plant') return animal.diet === 'herbivore' && t.alive && t.calories > 0;
    if (t.kind === 'animal') {
      // Herbivores never eat animals (living or dead) — plants only.
      if (animal.diet === 'herbivore') return false;
      if (t.state === AI_STATE.DEAD) return t.corpseCalories > 0;
      if (!t.alive) return false;
      // Live herbivore prey
      if (isPredator(animal) && t.diet === 'herbivore') return true;
      // Starving predators attack other predators (any species) at ≤25%
      if (canAttackPredatorRival(animal, t)) return true;
      return false;
    }
    return false;
  }

  function foodDetectRange(animal) {
    // Expanding map-wide detect radius while hunger-searching or hunting
    if (animal._hungerSearch || animal._hunting) {
      return animal._searchRadius || initialSearchRadius(animal);
    }
    return baseFoodSightRange(animal);
  }

  function findFoodTarget(animal, ctx) {
    const detect = foodDetectRange(animal);

    // Predators prefer corpses; herbivores never eat dead animals.
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
      animal._hunting
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

      // Desperate predators: attack other predators (same or different species) at ≤25%
      if (hungerRatio(animal) <= PREDATOR_RIVAL_HUNT_RATIO) {
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

    if (animal.diet === 'herbivore') {
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
    const range = t.kind === 'plant' ? EAT_RANGE : EAT_RANGE + 16;
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
    if (t.kind === 'plant' && t.alive) {
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
    if (isPredator(animal)) {
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

    // Non-herbivore flee (timer-based) — edge cases only
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

    // Hunger drain: herbivores 1/12 cal/s; predators 1/8 cal/s
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

  /** After eating: predators keep hunting until 70%, else roam/idle. */
  function postEatState(animal) {
    if (isPredator(animal)) {
      if (animal._hunting) {
        if (hungerRatio(animal) >= PREDATOR_SATIATED_RATIO) {
          animal._hunting = false;
          clearHungerSearch(animal);
          return AI_STATE.ROAM;
        }
        return AI_STATE.SEEK_PREY;
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
    mapPixelSize = mapPixelSize == null ? 25600 : mapPixelSize;
    const pad = Math.max(8, (animal.size || 16) * 0.5);
    animal.x = Math.max(pad, Math.min(mapPixelSize - pad, animal.x));
    animal.y = Math.max(pad, Math.min(mapPixelSize - pad, animal.y));
  }

  Wildborn.animal = {
    AI_STATE,
    SPEED,
    HERBIVORE_LAND_SPEED,
    PREDATOR_LAND_SPEED,
    HERBIVORE_WATER_SPEED_MULT,
    PREDATOR_WATER_SPEED_MULT,
    CORPSE_DECAY_TICKS,
    HERBIVORE_SPECIES,
    PREDATOR_SPECIES,
    ALL_SPECIES,
    BREED_COOLDOWN,
    PREDATOR_BREED_COOLDOWN,
    BREED_CALORIE_RATIO,
    HUNGER_SEEK_RATIO,
    HUNGER_RETURN_RATIO,
    HERBIVORE_CALORIE_BURN_INTERVAL_SEC,
    PREDATOR_CALORIE_BURN_INTERVAL_SEC,
    PREDATOR_HUNT_RATIO,
    PREDATOR_RIVAL_HUNT_RATIO,
    PREDATOR_SATIATED_RATIO,
    TERRITORY_RADIUS,
    TERRITORY_RETURN_RATIO,
    FLEE_ENTER_RANGE,
    FLEE_SAFE_RANGE,
    EAT_PREDATOR_INTERRUPT_RANGE,
    PLANT_SIGHT_RANGE,
    PLANT_SIGHT_TILES,
    PREDATOR_SIGHT_RANGE,
    PREDATOR_SIGHT_TILES,
    EAT_RANGE,
    EAT_RATE_PER_SEC,
    WATER_SPEED_MULT,
    AQUATIC_WATER_SPEED_MULT,
    WATER_STUCK_CROSS_SECONDS,
    OBSTACLE_STUCK_ESCAPE_SECONDS,
    ESCAPE_GOAL_STICKY_SECONDS,
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
    isSolidAt,
    isNearWater,
    findNearbyEscape,
    getStickyEscape,
    tryUnstick,
  };
})(typeof window !== 'undefined' ? window : globalThis);
