/**
 * EcosystemManager — spawns plants / herbivores / predators, runs the tick
 * loop, maintains spatial grids, and exposes debug stats.
 */
(function (global) {
  const Wildborn = (global.Wildborn = global.Wildborn || {});
  const { createSpatialGrid } = Wildborn.spatial;
  const { createPlant, pickSpecies, updatePlant, relocateToLand } = Wildborn.plant;
  const {
    createAnimal,
    updateAnimal,
    tickAnimal,
    clampToMap,
    HERBIVORE_SPECIES,
    PREDATOR_SPECIES,
    AI_STATE,
  } = Wildborn.animal;

  /** Initial population counts from the design spec. */
  const INITIAL_HERBIVORES = {
    rabbit: 10,
    deer: 8,
    cow: 6,
    raccoon: 5,
    bison: 4,
    ostrich: 3,
    turtle: 5,
    lizard: 8,
  };

  const INITIAL_PREDATORS = {
    wolf: 4,
    lion: 3,
    panther: 2,
    bear: 2,
    alligator: 3,
  };

  /** Exactly 150 plants scattered across the 400×400 map. */
  const INITIAL_PLANT_COUNT = 150;

  /**
   * @param {object} opts
   * @param {object} opts.world
   * @param {object} opts.rng
   * @param {object} opts.config
   * @param {{x:number,y:number}} [opts.origin]
   */
  function createEcosystem(opts) {
    const world = opts.world;
    const rng = opts.rng.derive('ecosystem');
    const config = opts.config || Wildborn.config;
    const mapTiles = world.MAP_TILES || config.mapTiles || 400;
    const mapPixelSize = world.MAP_PIXEL_SIZE || mapTiles * (world.TILE_SIZE || 32);
    const TILE_SIZE = world.TILE_SIZE || 32;
    const origin = opts.origin || {
      x: mapPixelSize / 2,
      y: mapPixelSize / 2,
    };
    const spawnRadius = config.ecosystemSpawnRadius || mapPixelSize / 2;
    const tickSeconds = config.ecosystemTickSeconds || 0.5;
    const cellSize = config.spatialCellSize || 64;

    const plants = [];
    const animals = [];
    /** Visual-only brown pixels from roaming predators. */
    const poops = [];
    /** Short-lived white splash dots when animals move through water. */
    const splashes = [];

    const plantGrid = createSpatialGrid(cellSize);
    const animalGrid = createSpatialGrid(cellSize);

    let tickAccum = 0;
    let tickCount = 0;
    let nextGroupId = 1;
    let splashCooldown = 0;

    function isLandTile(tile) {
      return world.isLand ? world.isLand(tile) : !world.isSolid(tile) && !world.isSlow(tile);
    }

    // -------------------------------------------------------------------------
    // Spawning helpers — pure random tiles on the 400×400 map
    // -------------------------------------------------------------------------

    /** Pick a random land tile (0–199, 0–199). Retry until land is found. */
    function findRandomLandTile(maxAttempts) {
      maxAttempts = maxAttempts || 400;
      for (let i = 0; i < maxAttempts; i++) {
        const tx = rng.int(0, mapTiles - 1);
        const ty = rng.int(0, mapTiles - 1);
        const tile = world.getTile(tx, ty);
        if (isLandTile(tile)) {
          return {
            tx: tx,
            ty: ty,
            x: tx * TILE_SIZE + TILE_SIZE / 2,
            y: ty * TILE_SIZE + TILE_SIZE / 2,
            tile: tile,
          };
        }
      }
      // Fallback spiral from map center
      const cx = Math.floor(mapTiles / 2);
      const cy = Math.floor(mapTiles / 2);
      for (let r = 0; r < mapTiles; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.abs(dx) !== r && Math.abs(dy) !== r && r > 0) continue;
            const tx = cx + dx;
            const ty = cy + dy;
            if (tx < 0 || ty < 0 || tx >= mapTiles || ty >= mapTiles) continue;
            const tile = world.getTile(tx, ty);
            if (isLandTile(tile)) {
              return {
                tx: tx,
                ty: ty,
                x: tx * TILE_SIZE + TILE_SIZE / 2,
                y: ty * TILE_SIZE + TILE_SIZE / 2,
                tile: tile,
              };
            }
          }
        }
      }
      return {
        tx: cx,
        ty: cy,
        x: cx * TILE_SIZE + TILE_SIZE / 2,
        y: cy * TILE_SIZE + TILE_SIZE / 2,
        tile: 0,
      };
    }

    function findWalkableSpot(maxAttempts) {
      maxAttempts = maxAttempts || 80;
      for (let i = 0; i < maxAttempts; i++) {
        const tx = rng.int(0, mapTiles - 1);
        const ty = rng.int(0, mapTiles - 1);
        const tile = world.getTile(tx, ty);
        if (!world.isSolid(tile)) {
          return {
            x: tx * TILE_SIZE + TILE_SIZE / 2,
            y: ty * TILE_SIZE + TILE_SIZE / 2,
            tile: tile,
          };
        }
      }
      return findRandomLandTile();
    }

    function findLandSpot() {
      return findRandomLandTile();
    }

    function findWaterSpot(maxAttempts) {
      maxAttempts = maxAttempts || 120;
      for (let i = 0; i < maxAttempts; i++) {
        const tx = rng.int(0, mapTiles - 1);
        const ty = rng.int(0, mapTiles - 1);
        if (world.isSlow(world.getTile(tx, ty))) {
          return {
            x: tx * TILE_SIZE + TILE_SIZE / 2,
            y: ty * TILE_SIZE + TILE_SIZE / 2,
          };
        }
      }
      return findWalkableSpot();
    }

    /** Respawn: completely random land tile anywhere on the 400×400 map. */
    function findRespawnSpot() {
      return findRandomLandTile(800);
    }

    function spawnInitial() {
      // Plants — pure random scatter: pick tile (0–199), land → spawn, else retry
      let planted = 0;
      let attempts = 0;
      const maxAttempts = INITIAL_PLANT_COUNT * 80;
      while (planted < INITIAL_PLANT_COUNT && attempts < maxAttempts) {
        attempts++;
        const tx = rng.int(0, mapTiles - 1);
        const ty = rng.int(0, mapTiles - 1);
        const tile = world.getTile(tx, ty);
        if (!isLandTile(tile)) continue;
        const x = tx * TILE_SIZE + TILE_SIZE / 2;
        const y = ty * TILE_SIZE + TILE_SIZE / 2;
        const plant = createPlant(pickSpecies(rng), x, y);
        plant.tx = tx;
        plant.ty = ty;
        plants.push(plant);
        planted++;
      }
      // Guaranteed fill if RNG was unlucky (still land-only)
      while (planted < INITIAL_PLANT_COUNT) {
        const spot = findRandomLandTile();
        const plant = createPlant(pickSpecies(rng), spot.x, spot.y);
        plant.tx = spot.tx;
        plant.ty = spot.ty;
        plants.push(plant);
        planted++;
      }

      // Herbivores — assign group ids for herd species
      for (const species in INITIAL_HERBIVORES) {
        const count = INITIAL_HERBIVORES[species];
        const def = HERBIVORE_SPECIES[species];
        let groupId = 0;
        let inGroup = 0;
        for (let i = 0; i < count; i++) {
          if (inGroup === 0 || inGroup >= def.maxGroupSize) {
            groupId = nextGroupId++;
            inGroup = 0;
          }
          const spot = findWalkableSpot();
          let x = spot.x;
          let y = spot.y;
          if (inGroup > 0 && def.maxGroupSize > 1) {
            x += rng.range(-40, 40);
            y += rng.range(-40, 40);
            x = Math.max(TILE_SIZE, Math.min(mapPixelSize - TILE_SIZE, x));
            y = Math.max(TILE_SIZE, Math.min(mapPixelSize - TILE_SIZE, y));
          }
          animals.push(createAnimal(species, x, y, { groupId: groupId }));
          inGroup++;
        }
      }

      // Predators
      for (const species in INITIAL_PREDATORS) {
        const count = INITIAL_PREDATORS[species];
        const def = PREDATOR_SPECIES[species];
        let groupId = 0;
        let inGroup = 0;
        for (let i = 0; i < count; i++) {
          if (inGroup === 0 || inGroup >= def.maxGroupSize) {
            groupId = nextGroupId++;
            inGroup = 0;
          }
          const spot = species === 'alligator' ? findWaterSpot() : findWalkableSpot();
          let x = spot.x;
          let y = spot.y;
          if (inGroup > 0 && def.maxGroupSize > 1) {
            x += rng.range(-50, 50);
            y += rng.range(-50, 50);
            x = Math.max(TILE_SIZE, Math.min(mapPixelSize - TILE_SIZE, x));
            y = Math.max(TILE_SIZE, Math.min(mapPixelSize - TILE_SIZE, y));
          }
          const sex = species === 'lion' ? (rng.chance(0.6) ? 'female' : 'male') : undefined;
          animals.push(createAnimal(species, x, y, { groupId: groupId, sex: sex }));
          inGroup++;
        }
      }
    }

    // -------------------------------------------------------------------------
    // Spatial rebuild
    // -------------------------------------------------------------------------

    function rebuildPlantGrid() {
      plantGrid.clear();
      for (let i = 0; i < plants.length; i++) {
        // Only alive plants are food targets; dead ones stay in memory for sprouts
        if (plants[i].alive) plantGrid.insert(plants[i]);
      }
    }

    function rebuildAnimalGrid() {
      animalGrid.clear();
      for (let i = 0; i < animals.length; i++) {
        animalGrid.insert(animals[i]);
      }
    }

    function rebuildGrids() {
      rebuildPlantGrid();
      rebuildAnimalGrid();
    }

    /** Count living (non-corpse) animals for the population soft-cap. */
    function livingAnimalCount() {
      let n = 0;
      for (let i = 0; i < animals.length; i++) {
        const a = animals[i];
        if (a.alive && a.state !== AI_STATE.DEAD) n++;
      }
      return n;
    }

    /**
     * Cheap far-LOD step: keep sliding along an existing path / velocity
     * without AI decisions or new A* searches.
     * Non-aquatic animals soft-reject water so far LOD cannot pin them in lakes.
     */
    function cheapMoveAnimal(animal, dt) {
      if (animal.state === AI_STATE.DEAD) return;
      const prevX = animal.x;
      const prevY = animal.y;
      if (animal._path && animal._pathIndex < animal._path.length) {
        const wp = animal._path[animal._pathIndex];
        const dx = wp.x - animal.x;
        const dy = wp.y - animal.y;
        const len = Math.hypot(dx, dy);
        if (len < 10) {
          animal._pathIndex++;
          return;
        }
        const speed = Math.max(8, animal.baseSpeed || 20);
        const step = Math.min(len, speed * dt);
        animal.x += (dx / len) * step;
        animal.y += (dy / len) * step;
        animal.vx = (dx / len) * speed;
        animal.vy = (dy / len) * speed;
        animal.facingRight = dx >= 0;
      } else if (animal.vx || animal.vy) {
        animal.x += animal.vx * dt;
        animal.y += animal.vy * dt;
      } else {
        return;
      }

      if (
        !animal.aquatic &&
        !animal.waterSpeedKey &&
        world.isSlow(world.getTileAtPixel(animal.x, animal.y))
      ) {
        animal.x = prevX;
        animal.y = prevY;
        animal.vx = 0;
        animal.vy = 0;
        animal._path = null;
        animal._pathIndex = 0;
        animal._waterStuckTimer = (animal._waterStuckTimer || 0) + dt;
      }
    }

    // -------------------------------------------------------------------------
    // Context passed into animal AI
    // -------------------------------------------------------------------------

    function makeCtx() {
      const pathBudget =
        (config.pathfindBudgetPerFrame != null
          ? config.pathfindBudgetPerFrame
          : 10) | 0;
      return {
        rng: rng,
        tickSeconds: tickSeconds,
        world: world,
        mapPixelSize: mapPixelSize,
        /** Decremented by animal pathfinding; 0 means reuse old paths this frame. */
        pathBudget: pathBudget,
        /** Soft population cap gate used by tickAnimal before breed(). */
        canSpawnOffspring: function () {
          return livingAnimalCount() < (config.maxAnimals || 120);
        },
        isWater: function (x, y) {
          return world.isSlow(world.getTileAtPixel(x, y));
        },
        findNearestPlant: function (x, y, radius, pred) {
          return plantGrid.findNearest(x, y, radius, pred);
        },
        findNearestAnimal: function (x, y, radius, pred) {
          return animalGrid.findNearest(x, y, radius, pred);
        },
        queryAnimals: function (x, y, radius) {
          return animalGrid.queryRadius(x, y, radius);
        },
        /** Animals within eat range of a plant (performance: spatial, not N×M). */
        queryAnimalsNear: function (x, y, radius) {
          return animalGrid.queryRadius(x, y, radius);
        },
        spawnPoop: function (x, y) {
          poops.push({
            x: x + rng.range(-3, 3),
            y: y + rng.range(-3, 3),
            life: 30,
            maxLife: 30,
          });
        },
        spawnSplash: function (x, y) {
          if (splashCooldown > 0) return;
          splashCooldown = 0.04;
          for (let i = 0; i < 3; i++) {
            splashes.push({
              x: x + rng.range(-4, 4),
              y: y + rng.range(-4, 4),
              life: 0.35 + rng.float() * 0.25,
              maxLife: 0.5,
              vx: rng.range(-12, 12),
              vy: rng.range(-18, -4),
            });
          }
        },
      };
    }

    // -------------------------------------------------------------------------
    // Update loop
    // -------------------------------------------------------------------------

    let frameIndex = 0;

    /**
     * @param {number} dt
     * @param {{x:number,y:number}|null} [focus] player/camera focus for sim LOD
     */
    function update(dt, focus) {
      frameIndex += 1;
      // Plants only move on discrete ticks; animals move every frame.
      rebuildAnimalGrid();
      const ctx = makeCtx();

      if (splashCooldown > 0) splashCooldown -= dt;

      const nearPx = config.simLodNearPx || 1400;
      const near2 = nearPx * nearPx;
      const farEvery = Math.max(1, (config.simLodFarEveryN || 4) | 0);
      const fx = focus && focus.x != null ? focus.x : mapPixelSize / 2;
      const fy = focus && focus.y != null ? focus.y : mapPixelSize / 2;

      for (let i = 0; i < animals.length; i++) {
        const a = animals[i];
        const dx = a.x - fx;
        const dy = a.y - fy;
        const far = dx * dx + dy * dy > near2;
        if (far && (i + frameIndex) % farEvery !== 0) {
          cheapMoveAnimal(a, dt);
        } else {
          updateAnimal(a, dt, ctx);
        }
        if (a.alive) clampToMap(a, mapPixelSize);
      }

      // Visual particles (poop fade + splash motion)
      for (let i = poops.length - 1; i >= 0; i--) {
        poops[i].life -= dt;
        if (poops[i].life <= 0) poops.splice(i, 1);
      }
      for (let i = splashes.length - 1; i >= 0; i--) {
        const s = splashes[i];
        s.life -= dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.vy += 40 * dt;
        if (s.life <= 0) splashes.splice(i, 1);
      }

      // Discrete ticks
      tickAccum += dt;
      while (tickAccum >= tickSeconds) {
        tickAccum -= tickSeconds;
        runTick(ctx);
      }
    }

    function runTick(ctx) {
      tickCount += 1;

      // Plants — grow anywhere; respawn teleports to random land
      for (let i = 0; i < plants.length; i++) {
        const p = plants[i];
        updatePlant(p, findRespawnSpot);
        p.tx = Math.floor(p.x / TILE_SIZE);
        p.ty = Math.floor(p.y / TILE_SIZE);
      }

      // Animals
      const maxAnimals = config.maxAnimals || 120;
      let living = livingAnimalCount();
      const newborns = [];
      const toRemove = [];
      for (let i = 0; i < animals.length; i++) {
        const result = tickAnimal(animals[i], ctx);
        if (result.offspring && living < maxAnimals) {
          for (let k = 0; k < result.offspring.length; k++) {
            if (living >= maxAnimals) break;
            newborns.push(result.offspring[k]);
            living++;
          }
        }
        if (result.remove) toRemove.push(animals[i].id);
      }

      if (toRemove.length) {
        const removeSet = {};
        for (let i = 0; i < toRemove.length; i++) removeSet[toRemove[i]] = true;
        for (let i = animals.length - 1; i >= 0; i--) {
          if (removeSet[animals[i].id]) animals.splice(i, 1);
        }
      }

      for (let i = 0; i < newborns.length; i++) {
        animals.push(newborns[i]);
      }

      rebuildGrids();
    }

    // -------------------------------------------------------------------------
    // Debug stats
    // -------------------------------------------------------------------------

    function getDebugStats() {
      let plantsAlive = 0;
      let plantCalories = 0;
      let plantsSprouting = 0;
      for (let i = 0; i < plants.length; i++) {
        if (plants[i].alive) {
          plantsAlive++;
          plantCalories += plants[i].calories;
        } else {
          plantsSprouting++;
        }
      }

      const herbCounts = {};
      const predCounts = {};
      const calorieSum = {};
      const calorieN = {};

      for (const id in HERBIVORE_SPECIES) {
        herbCounts[id] = 0;
        calorieSum[id] = 0;
        calorieN[id] = 0;
      }
      for (const id in PREDATOR_SPECIES) {
        predCounts[id] = 0;
        calorieSum[id] = 0;
        calorieN[id] = 0;
      }

      let herbTotal = 0;
      let predTotal = 0;
      let corpses = 0;

      for (let i = 0; i < animals.length; i++) {
        const a = animals[i];
        if (a.state === AI_STATE.DEAD) {
          corpses++;
          continue;
        }
        if (!a.alive) continue;

        if (HERBIVORE_SPECIES[a.species]) {
          herbCounts[a.species]++;
          herbTotal++;
        } else if (PREDATOR_SPECIES[a.species]) {
          predCounts[a.species]++;
          predTotal++;
        }
        calorieSum[a.species] = (calorieSum[a.species] || 0) + a.calories;
        calorieN[a.species] = (calorieN[a.species] || 0) + 1;
      }

      const avgCalories = {};
      for (const id in calorieSum) {
        avgCalories[id] = calorieN[id] ? Math.round(calorieSum[id] / calorieN[id]) : 0;
      }

      return {
        tick: tickCount,
        plantsAlive: plantsAlive,
        plantsMax: INITIAL_PLANT_COUNT,
        plantsSprouting: plantsSprouting,
        plantAvgCalories: plantsAlive ? Math.round(plantCalories / plantsAlive) : 0,
        herbivores: herbCounts,
        herbTotal: herbTotal,
        predators: predCounts,
        predTotal: predTotal,
        avgCalories: avgCalories,
        corpses: corpses,
        poops: poops.length,
        animalTotal: animals.length,
        mapTiles: mapTiles,
        maxAnimals: config.maxAnimals || 120,
      };
    }

    // Boot — load the entire 400×400 map before placing entities
    if (world.ensureMapLoaded) {
      world.ensureMapLoaded();
    } else {
      world.ensureChunksInBounds(0, 0, mapPixelSize - 1, mapPixelSize - 1);
    }
    spawnInitial();
    rebuildGrids();

    return {
      plants: plants,
      animals: animals,
      poops: poops,
      splashes: splashes,
      update: update,
      getDebugStats: getDebugStats,
      origin: origin,
      spawnRadius: spawnRadius,
      mapTiles: mapTiles,
      mapPixelSize: mapPixelSize,
      tickSeconds: tickSeconds,
      tickCount: function () {
        return tickCount;
      },
    };
  }

  Wildborn.ecosystem = {
    createEcosystem,
    INITIAL_HERBIVORES,
    INITIAL_PREDATORS,
    INITIAL_PLANT_COUNT,
  };
})(typeof window !== 'undefined' ? window : globalThis);
