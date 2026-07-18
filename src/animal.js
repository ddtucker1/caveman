/**
 * Ecosystem animals — herbivores & predators with a shared state machine,
 * hunger, combat, grouping, and breeding.
 *
 * States: IDLE → SEEK_FOOD → EATING → FLEE → SEEK_MATE → BREEDING → DEAD
 */
(function (global) {
  const Wildborn = (global.Wildborn = global.Wildborn || {});

  const AI_STATE = {
    IDLE: 'IDLE',
    SEEK_FOOD: 'SEEK_FOOD',
    SEEK_PREY: 'SEEK_PREY',
    EATING: 'EATING',
    FLEE: 'FLEE',
    SEEK_MATE: 'SEEK_MATE',
    BREEDING: 'BREEDING',
    ROAM: 'ROAM',
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
  /** Animals on water move at half their current speed. */
  const WATER_SPEED_MULT = 0.5;

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
    chicken: {
      id: 'chicken',
      label: 'Chicken',
      diet: 'herbivore',
      maxGroupSize: 20,
      speed: 'fast',
      caloriesNeededPerDay: 25,
      maxCalories: 50,
      maxHealth: 20,
      defense: 'flee',
      attackPower: 1,
      color: '#f0e8d0',
      accent: '#c44',
      size: 7,
      special: 'eggs',
      corpseYield: 0.5,
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
  const ADULT_AGE = 30;
  const BREED_COOLDOWN = 100;
  const BREED_CALORIE_RATIO = 0.7;
  const HUNGER_SEEK_RATIO = 0.3;
  /** Ticks in one "day" for calorie drain (120 × 0.5s ≈ 60s real time). */
  const DAY_TICKS = 120;
  /** Global calorie burn scale — animals previously burned ~10× too fast. */
  const CALORIE_BURN_DIVISOR = 10;
  /** Minimum calories burned per ecosystem tick. */
  const MIN_CALORIE_BURN = 0.5;
  const EAT_RANGE = 18;
  const ATTACK_RANGE = 22;
  const MATE_RANGE = 28;
  const FLEE_DETECT_RANGE = 160;
  const FOOD_DETECT_RANGE = 320;
  const PACK_JOIN_RANGE = 200;
  const STEAL_RANGE = 24;
  const EAT_RATE = 12; // calories per tick while eating
  const ATTACK_COOLDOWN_TICKS = 2;
  const IDLE_WANDER_CHANCE = 0.35;

  /** Predators hunt at ≤30% calories; return to roaming at ≥80%. */
  const PREDATOR_HUNT_RATIO = 0.3;
  const PREDATOR_SATIATED_RATIO = 0.8;
  /** Roam within this radius of spawn while not hunting. */
  const TERRITORY_RADIUS = 200;
  /** Flee desperation: cross water if predator within this distance. */
  const WATER_DESPERATION_FLEE_DIST = 100;
  /** Starvation desperation: cross water below this calorie ratio. */
  const WATER_DESPERATION_STARVE_RATIO = 0.2;
  /** Chicken egg interval was ~50–90 ticks; 10× rarer → ~500–900. */
  const EGG_TIMER_BASE = 500;
  const EGG_TIMER_JITTER = 400;
  /** Poop while roaming: every 5–10s, fade after 30s. */
  const POOP_INTERVAL_MIN = 5;
  const POOP_INTERVAL_MAX = 10;
  const POOP_FADE_SECONDS = 30;

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

      age: isOffspring ? 0 : ADULT_AGE + Math.floor(Math.random() * 20),
      breedingCooldown: isOffspring ? BREED_COOLDOWN : Math.floor(Math.random() * 40),
      growth: isOffspring ? 0.2 : 1, // scale toward adult size
      isAdult: !isOffspring,

      state: isPred ? AI_STATE.ROAM : AI_STATE.IDLE,
      stateTimer: 0,
      target: null,
      mateTarget: null,
      fleeFrom: null,

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
      size: isOffspring ? def.size * 0.4 : def.size,

      attackCooldown: 0,
      packCallTimer: 0, // seconds remaining for pack to join
      burrowed: false,
      burrowTimer: 0,
      eggTimer:
        def.special === 'eggs'
          ? EGG_TIMER_BASE + Math.floor(Math.random() * EGG_TIMER_JITTER)
          : 0,
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

  function canBreed(a) {
    return (
      a.alive &&
      a.isAdult &&
      a.state !== AI_STATE.DEAD &&
      a.state !== AI_STATE.FLEE &&
      a.breedingCooldown <= 0 &&
      a.calories > a.maxCalories * BREED_CALORIE_RATIO &&
      a.state !== AI_STATE.BREEDING
    );
  }

  function hungerRatio(a) {
    return a.calories / a.maxCalories;
  }

  function isHungry(a) {
    return hungerRatio(a) < HUNGER_SEEK_RATIO;
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
    // Water halves current speed (stacks with global speed halve → ~25% of original)
    if (animal._inWater && animal.special !== 'ambush') {
      speed *= WATER_SPEED_MULT;
    } else if (animal._inWater && animal.special === 'ambush') {
      // Ambush predators keep water bonus but still pay half vs land-equivalent
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
   * Pick a step toward (tx,ty), detouring around water when possible.
   * Returns {x,y} waypoint (may equal target).
   */
  function pathWaypoint(animal, tx, ty, ctx) {
    if (!ctx.isWater || canCrossWater(animal, ctx)) {
      return { x: tx, y: ty };
    }

    const dx = tx - animal.x;
    const dy = ty - animal.y;
    const len = Math.hypot(dx, dy) || 1;
    const step = Math.min(48, len);
    const nx = animal.x + (dx / len) * step;
    const ny = animal.y + (dy / len) * step;

    // Direct path clear of water — go straight
    if (!ctx.isWater(nx, ny) && !segmentHitsWater(animal.x, animal.y, nx, ny, ctx)) {
      return { x: tx, y: ty };
    }

    // Try perpendicular detours (left/right of travel direction)
    const px = -dy / len;
    const py = dx / len;
    const offsets = [40, 70, 110, -40, -70, -110];
    let best = null;
    let bestScore = Infinity;
    for (let i = 0; i < offsets.length; i++) {
      const ox = animal.x + px * offsets[i] + (dx / len) * step * 0.6;
      const oy = animal.y + py * offsets[i] + (dy / len) * step * 0.6;
      if (ctx.isWater(ox, oy)) continue;
      if (segmentHitsWater(animal.x, animal.y, ox, oy, ctx)) continue;
      const score = Math.hypot(ox - tx, oy - ty) + Math.abs(offsets[i]) * 0.15;
      if (score < bestScore) {
        bestScore = score;
        best = { x: ox, y: oy };
      }
    }
    if (best) return best;

    // No dry detour — hold position rather than walk into water
    return { x: animal.x, y: animal.y };
  }

  function segmentHitsWater(x0, y0, x1, y1, ctx) {
    if (!ctx.isWater) return false;
    for (let i = 1; i <= 4; i++) {
      const t = i / 4;
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      if (ctx.isWater(x, y)) return true;
    }
    return false;
  }

  function moveToward(animal, tx, ty, dt, speedMult, ctx) {
    const waypoint = ctx ? pathWaypoint(animal, tx, ty, ctx) : { x: tx, y: ty };
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
    animal.mateTarget = null;
    if (killer && killer.alive) {
      // Killer may immediately start eating
      killer.target = animal;
      killer.state = AI_STATE.EATING;
    }
  }

  /**
   * Spawn 1–3 offspring near parents.
   * @returns {object[]}
   */
  function breed(parentA, parentB, rng) {
    const count = rng.int(1, 3);
    const kids = [];
    for (let i = 0; i < count; i++) {
      const ox = parentA.x + rng.range(-12, 12);
      const oy = parentA.y + rng.range(-12, 12);
      const kid = createAnimal(parentA.species, ox, oy, {
        isOffspring: true,
        groupId: parentA.groupId || parentB.groupId,
      });
      kids.push(kid);
    }
    parentA.breedingCooldown = BREED_COOLDOWN;
    parentB.breedingCooldown = BREED_COOLDOWN;
    parentA.state = isPredator(parentA) ? AI_STATE.ROAM : AI_STATE.IDLE;
    parentB.state = isPredator(parentB) ? AI_STATE.ROAM : AI_STATE.IDLE;
    parentA.mateTarget = null;
    parentB.mateTarget = null;
    parentA.calories *= 0.85;
    parentB.calories *= 0.85;
    return kids;
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
    if (isPredator(animal) && animal.diet !== 'herbivore') {
      updatePredatorHungerGate(animal);
    }

    switch (animal.state) {
      case AI_STATE.IDLE:
        updateIdle(animal, dt, ctx);
        break;
      case AI_STATE.ROAM:
        updateRoam(animal, dt, ctx);
        break;
      case AI_STATE.SEEK_FOOD:
      case AI_STATE.SEEK_PREY:
        updateSeekFood(animal, dt, ctx);
        break;
      case AI_STATE.EATING:
        updateEating(animal, dt, ctx);
        break;
      case AI_STATE.FLEE:
        updateFlee(animal, dt, ctx);
        break;
      case AI_STATE.SEEK_MATE:
        updateSeekMate(animal, dt, ctx);
        break;
      case AI_STATE.BREEDING:
        // Brief pause while breeding resolves on tick
        animal.stateTimer -= dt;
        if (animal.stateTimer <= 0) {
          animal.state = isPredator(animal) ? AI_STATE.ROAM : AI_STATE.IDLE;
        }
        break;
      default:
        wander(animal, dt, ctx.rng, ctx);
    }
  }

  /**
   * Predators: ROAM while calories > 30%; enter SEEK_PREY at ≤30%;
   * stay hunting until calories ≥ 80%, then return to ROAM.
   */
  function updatePredatorHungerGate(animal) {
    const ratio = hungerRatio(animal);
    if (animal.state === AI_STATE.DEAD || animal.state === AI_STATE.FLEE) return;
    if (animal.state === AI_STATE.BREEDING || animal.state === AI_STATE.SEEK_MATE) return;

    if (animal.state === AI_STATE.SEEK_PREY || animal.state === AI_STATE.SEEK_FOOD || animal.state === AI_STATE.EATING) {
      if (ratio >= PREDATOR_SATIATED_RATIO) {
        animal.state = AI_STATE.ROAM;
        animal.target = null;
        animal._hunting = false;
      } else if (ratio <= PREDATOR_HUNT_RATIO || animal._hunting) {
        animal._hunting = true;
        if (animal.state !== AI_STATE.EATING) animal.state = AI_STATE.SEEK_PREY;
      }
      return;
    }

    // Roaming / idle predators
    if (ratio <= PREDATOR_HUNT_RATIO) {
      animal.state = AI_STATE.SEEK_PREY;
      animal.target = null;
      animal._hunting = true;
    } else if (animal.state === AI_STATE.IDLE) {
      animal.state = AI_STATE.ROAM;
    }
  }

  function updateRoam(animal, dt, ctx) {
    // Drop into hunt immediately if calories crossed the threshold mid-frame
    if (hungerRatio(animal) <= PREDATOR_HUNT_RATIO) {
      animal.state = AI_STATE.SEEK_PREY;
      animal.target = null;
      animal._hunting = true;
      return;
    }

    // Occasional breeding while satiated
    if (canBreed(animal) && animal.isAdult && ctx.rng.chance(0.02 * dt)) {
      animal.state = AI_STATE.SEEK_MATE;
      animal.mateTarget = null;
      return;
    }

    // Stay inside territory radius around spawn
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
        FLEE_DETECT_RANGE,
        function (o) {
          return o.alive && isPredator(o) && o.diet !== 'herbivore' && o.id !== animal.id;
        }
      );
      if (threat && (animal.diet === 'herbivore' || animal.special === 'runs_from_all')) {
        // Ostriches run from everything predatory; bears don't flee as herbivores
        if (animal.diet === 'herbivore') {
          animal.state = AI_STATE.FLEE;
          animal.fleeFrom = threat;
          animal.stateTimer = 2.5;
          if (animal.special === 'alert') animal._alertPulse = true;
          return;
        }
      }
    }

    if (isHungry(animal) || hungerRatio(animal) < 0.55) {
      animal.state = AI_STATE.SEEK_FOOD;
      animal.target = null;
      return;
    }

    if (canBreed(animal) && animal.isAdult) {
      animal.state = AI_STATE.SEEK_MATE;
      animal.mateTarget = null;
      return;
    }

    wander(animal, dt, ctx.rng, ctx);
  }

  function updateSeekFood(animal, dt, ctx) {
    // Predators seek herbivores (or corpses); herbivores seek plants; bears do both
    if (!animal.target || !isValidFoodTarget(animal, animal.target)) {
      animal.target = findFoodTarget(animal, ctx);
    }

    if (!animal.target) {
      wander(animal, dt, ctx.rng, ctx);
      if (isPredator(animal) && animal._hunting) {
        // Keep hunting until satiated even if no prey nearby
        return;
      }
      if (!isHungry(animal) && hungerRatio(animal) > 0.6) {
        animal.state = isPredator(animal) ? AI_STATE.ROAM : AI_STATE.IDLE;
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

    moveToward(animal, t.x, t.y, dt, 1, ctx);
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
    // Eggs as food source
    if (t.kind === 'egg') return t.calories > 0;
    return false;
  }

  function findFoodTarget(animal, ctx) {
    // Prefer corpses if very hungry
    if (isPredator(animal) || isHungry(animal)) {
      const corpse = ctx.findNearestAnimal(
        animal.x,
        animal.y,
        FOOD_DETECT_RANGE,
        function (o) {
          return o.state === AI_STATE.DEAD && o.corpseCalories > 0;
        }
      );
      if (corpse && (isPredator(animal) || isHungry(animal))) return corpse;
    }

    if (
      animal.diet === 'predator' ||
      animal.state === AI_STATE.SEEK_PREY ||
      (animal.diet === 'omnivore' && (animal._hunting || hungerRatio(animal) < 0.5))
    ) {
      // Lion females do most hunting (males only when hungrier), unless already in hunt mode
      if (
        animal.special === 'female_hunt' &&
        animal.sex === 'male' &&
        hungerRatio(animal) > 0.25 &&
        !animal._hunting
      ) {
        // Males hunt only when hungrier
      } else {
      const prey = ctx.findNearestAnimal(
        animal.x,
        animal.y,
        FOOD_DETECT_RANGE,
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
          FOOD_DETECT_RANGE * 0.45,
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
          FOOD_DETECT_RANGE * 0.5,
          function (o) {
            return o.alive && o.id !== animal.id && o.calories > 10;
          }
        );
        if (victim) return victim;
      }

      const plant = ctx.findNearestPlant(
        animal.x,
        animal.y,
        FOOD_DETECT_RANGE,
        function (p) {
          return p.alive && p.calories > 0;
        }
      );
      if (plant) return plant;

      // Eggs
      if (ctx.findNearestEgg) {
        const egg = ctx.findNearestEgg(animal.x, animal.y, FOOD_DETECT_RANGE);
        if (egg) return egg;
      }
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
      if (isPredator(animal) && animal._hunting && hungerRatio(animal) < PREDATOR_SATIATED_RATIO) {
        animal.state = AI_STATE.SEEK_PREY;
      } else if (isHungry(animal)) {
        animal.state = AI_STATE.SEEK_FOOD;
      } else {
        animal.state = isPredator(animal) ? AI_STATE.ROAM : AI_STATE.IDLE;
      }
      return;
    }

    // Stay near food
    const d2 = dist2(animal.x, animal.y, t.x, t.y);
    if (d2 > (EAT_RANGE + 8) * (EAT_RANGE + 8)) {
      moveToward(animal, t.x, t.y, dt, 0.8, ctx);
      return;
    }

    animal.vx = 0;
    animal.vy = 0;

    // Raccoon steal from live animal
    if (animal.special === 'steal' && t.kind === 'animal' && t.alive && t.state !== AI_STATE.DEAD) {
      const stolen = Math.min(EAT_RATE * dt * 2, t.calories * 0.05, animal.maxCalories - animal.calories);
      if (stolen > 0) {
        t.calories -= stolen;
        animal.calories += stolen;
      }
      if (animal.calories >= animal.maxCalories * 0.95 || t.calories < 5) {
        animal.state = AI_STATE.IDLE;
        animal.target = null;
      }
      return;
    }

    // Actual calorie transfer happens on tick for plants/corpses (rate-limited there).
    // Here we just hold position; tickAnimal does the eat.
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
        animal.state = isPredator(animal) ? AI_STATE.ROAM : AI_STATE.IDLE;
      }
      return;
    }

    const threat = animal.fleeFrom;
    if (!threat || !threat.alive || animal.stateTimer <= 0) {
      animal.fleeFrom = null;
      animal.state = isPredator(animal) ? AI_STATE.ROAM : AI_STATE.IDLE;
      return;
    }

    const dx = animal.x - threat.x;
    const dy = animal.y - threat.y;
    const len = Math.hypot(dx, dy) || 1;
    const fleeSpeed = animal.special === 'runs_from_all' ? 1.3 : 1.15;
    const tx = animal.x + (dx / len) * 80;
    const ty = animal.y + (dy / len) * 80;
    moveToward(animal, tx, ty, dt, fleeSpeed, ctx);

    // Deer alert: mark nearby deer to flee
    if (animal._alertPulse) {
      animal._alertPulse = false;
      const herd = ctx.queryAnimals(animal.x, animal.y, FLEE_DETECT_RANGE);
      for (let i = 0; i < herd.length; i++) {
        const m = herd[i];
        if (m.alive && m.species === animal.species && m.id !== animal.id) {
          m.state = AI_STATE.FLEE;
          m.fleeFrom = threat;
          m.stateTimer = 2.5;
        }
      }
    }
  }

  function updateSeekMate(animal, dt, ctx) {
    if (!canBreed(animal)) {
      animal.state = isPredator(animal) ? AI_STATE.ROAM : AI_STATE.IDLE;
      animal.mateTarget = null;
      return;
    }

    // Interrupt for hunger / threats
    if (isPredator(animal) && hungerRatio(animal) <= PREDATOR_HUNT_RATIO) {
      animal.state = AI_STATE.SEEK_PREY;
      animal._hunting = true;
      return;
    }
    if (!isPredator(animal) && isHungry(animal)) {
      animal.state = AI_STATE.SEEK_FOOD;
      return;
    }

    if (!animal.mateTarget || !canBreed(animal.mateTarget) || animal.mateTarget.species !== animal.species) {
      animal.mateTarget = ctx.findNearestAnimal(
        animal.x,
        animal.y,
        FOOD_DETECT_RANGE * 0.7,
        function (o) {
          return o.id !== animal.id && canBreed(o) && o.species === animal.species;
        }
      );
    }

    if (!animal.mateTarget) {
      wander(animal, dt, ctx.rng, ctx);
      return;
    }

    const mate = animal.mateTarget;
    const d2 = dist2(animal.x, animal.y, mate.x, mate.y);
    if (d2 <= MATE_RANGE * MATE_RANGE) {
      animal.state = AI_STATE.BREEDING;
      mate.state = AI_STATE.BREEDING;
      animal.stateTimer = 0.8;
      mate.stateTimer = 0.8;
      // EcosystemManager will finalize breed on tick when both BREEDING
      animal._readyToBreed = true;
      mate._readyToBreed = true;
      return;
    }

    moveToward(animal, mate.x, mate.y, dt, 0.75, ctx);
  }

  // ---------------------------------------------------------------------------
  // Discrete tick (hunger, growth, eating calories, breeding age)
  // ---------------------------------------------------------------------------

  /**
   * @param {object} animal
   * @param {object} ctx
   * @returns {{ offspring?: object[], eggs?: object[], remove?: boolean }}
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
    const drain = calorieBurnPerTick(animal);
    animal.calories -= drain;

    // Age / growth
    animal.age += 1;
    if (!animal.isAdult) {
      animal.growth = Math.min(1, animal.growth + 0.01);
      animal.size = animal.baseSize * (0.4 + 0.6 * animal.growth);
      if (animal.age >= ADULT_AGE) {
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

    // Chicken eggs — 1/10th prior rate; max 1 uneaten egg per chicken on screen
    if (animal.special === 'eggs' && animal.isAdult && animal.alive) {
      animal.eggTimer -= 1;
      if (animal.eggTimer <= 0) {
        const hasEgg =
          ctx.hasEggFromChicken && ctx.hasEggFromChicken(animal.id);
        if (!hasEgg) {
          result.eggs = result.eggs || [];
          result.eggs.push({
            kind: 'egg',
            id: 'egg-' + animal.id + '-' + animal.age,
            chickenId: animal.id,
            x: animal.x + ctx.rng.range(-6, 6),
            y: animal.y + ctx.rng.range(-6, 6),
            calories: 15,
            color: '#f5f0e0',
            size: 4,
            decay: 60,
          });
        }
        animal.eggTimer = EGG_TIMER_BASE + ctx.rng.int(0, EGG_TIMER_JITTER);
      }
    }

    // Eating on tick
    if (animal.state === AI_STATE.EATING && animal.target) {
      const t = animal.target;
      const room = animal.maxCalories - animal.calories;
      if (room <= 0) {
        animal.state = postEatState(animal);
        animal.target = null;
      } else if (t.kind === 'plant' && t.alive) {
        const eaten = Wildborn.plant.consumePlant(t, Math.min(EAT_RATE, room));
        animal.calories += eaten;
        if (!t.alive || animal.calories >= animal.maxCalories * 0.95) {
          animal.target = null;
          animal.state = postEatState(animal);
        }
      } else if (t.kind === 'animal' && t.state === AI_STATE.DEAD) {
        const eaten = Math.min(EAT_RATE * 1.5, t.corpseCalories, room);
        t.corpseCalories -= eaten;
        animal.calories += eaten;
        if (t.corpseCalories <= 0 || animal.calories >= animal.maxCalories * 0.95) {
          animal.target = null;
          animal.state = postEatState(animal);
        }
      } else if (t.kind === 'egg') {
        const eaten = Math.min(EAT_RATE, t.calories, room);
        t.calories -= eaten;
        animal.calories += eaten;
        if (t.calories <= 0 || animal.calories >= animal.maxCalories * 0.95) {
          animal.target = null;
          animal.state = postEatState(animal);
        }
      }
    }

    // Starvation
    if (animal.calories <= 0) {
      animal.calories = 0;
      killAnimal(animal, null);
      return result;
    }

    // Breeding resolution (only one parent creates offspring)
    if (animal.state === AI_STATE.BREEDING && animal._readyToBreed) {
      const mate = animal.mateTarget;
      if (
        mate &&
        mate.alive &&
        mate._readyToBreed &&
        mate.species === animal.species &&
        animal.id < mate.id
      ) {
        const kids = breed(animal, mate, ctx.rng);
        animal._readyToBreed = false;
        mate._readyToBreed = false;
        result.offspring = kids;
      } else if (!mate || !mate.alive) {
        animal._readyToBreed = false;
        animal.mateTarget = null;
        if (animal.alive) {
          animal.state = isPredator(animal) ? AI_STATE.ROAM : AI_STATE.IDLE;
        }
      }
    }

    return result;
  }

  /** After eating: predators keep hunting until 80%, else roam/idle. */
  function postEatState(animal) {
    if (isPredator(animal) && animal.diet !== 'herbivore') {
      if (hungerRatio(animal) >= PREDATOR_SATIATED_RATIO) {
        animal._hunting = false;
        return AI_STATE.ROAM;
      }
      animal._hunting = true;
      return AI_STATE.SEEK_PREY;
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

  Wildborn.animal = {
    AI_STATE,
    SPEED,
    HERBIVORE_SPECIES,
    PREDATOR_SPECIES,
    ALL_SPECIES,
    ADULT_AGE,
    BREED_COOLDOWN,
    DAY_TICKS,
    CALORIE_BURN_DIVISOR,
    MIN_CALORIE_BURN,
    PREDATOR_HUNT_RATIO,
    PREDATOR_SATIATED_RATIO,
    TERRITORY_RADIUS,
    EGG_TIMER_BASE,
    createAnimal,
    updateAnimal,
    tickAnimal,
    killAnimal,
    breed,
    canBreed,
    isHerbivore,
    isPredator,
    clampToRegion,
    applyDamage,
    calorieBurnPerTick,
  };
})(typeof window !== 'undefined' ? window : globalThis);
