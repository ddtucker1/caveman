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
    clampToRegion,
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

  const INITIAL_PLANT_COUNT = 2000;

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
    const origin = opts.origin || { x: 0, y: 0 };
    const spawnRadius = config.ecosystemSpawnRadius || 48 * 32;
    const tickSeconds = config.ecosystemTickSeconds || 0.5;
    const cellSize = config.spatialCellSize || 96;

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

    // -------------------------------------------------------------------------
    // Spawning helpers
    // -------------------------------------------------------------------------

    function findWalkableSpot(maxAttempts) {
      maxAttempts = maxAttempts || 40;
      for (let i = 0; i < maxAttempts; i++) {
        const angle = rng.float() * Math.PI * 2;
        const dist = Math.sqrt(rng.float()) * spawnRadius;
        const x = origin.x + Math.cos(angle) * dist;
        const y = origin.y + Math.sin(angle) * dist;
        const tile = world.getTileAtPixel(x, y);
        if (!world.isSolid(tile)) {
          return { x: x, y: y, tile: tile };
        }
      }
      // Fallback near origin
      return {
        x: origin.x + rng.range(-64, 64),
        y: origin.y + rng.range(-64, 64),
        tile: 0,
      };
    }

    /** Plants spawn on any land tile (not water, not solid). */
    function findLandSpot(maxAttempts) {
      maxAttempts = maxAttempts || 60;
      for (let i = 0; i < maxAttempts; i++) {
        // Uniform square sample — avoids center clustering from radial sqrt bias
        const x = origin.x + (rng.float() * 2 - 1) * spawnRadius;
        const y = origin.y + (rng.float() * 2 - 1) * spawnRadius;
        const tile = world.getTileAtPixel(x, y);
        if (!world.isSolid(tile) && !world.isSlow(tile)) {
          return { x: x, y: y, tile: tile };
        }
      }
      // Fallback: spiral near origin for any land tile
      const TILE_SIZE = world.TILE_SIZE || 32;
      for (let r = 0; r < 40; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.abs(dx) !== r && Math.abs(dy) !== r && r > 0) continue;
            const x = origin.x + dx * TILE_SIZE;
            const y = origin.y + dy * TILE_SIZE;
            const tile = world.getTileAtPixel(x, y);
            if (!world.isSolid(tile) && !world.isSlow(tile)) {
              return { x: x, y: y, tile: tile };
            }
          }
        }
      }
      return findWalkableSpot();
    }

    function findWaterSpot(maxAttempts) {
      maxAttempts = maxAttempts || 60;
      for (let i = 0; i < maxAttempts; i++) {
        const spot = findWalkableSpot(1);
        if (world.isSlow(world.getTileAtPixel(spot.x, spot.y))) return spot;
        const angle = rng.float() * Math.PI * 2;
        const dist = Math.sqrt(rng.float()) * spawnRadius;
        const x = origin.x + Math.cos(angle) * dist;
        const y = origin.y + Math.sin(angle) * dist;
        if (world.isSlow(world.getTileAtPixel(x, y))) return { x: x, y: y };
      }
      return findWalkableSpot();
    }

    function findRespawnSpot() {
      return findLandSpot(40);
    }

    function spawnInitial() {
      // Plants — scatter across the full spawn map on any land
      const gridN = Math.ceil(Math.sqrt(INITIAL_PLANT_COUNT));
      const extent = spawnRadius * 2;
      const cell = extent / gridN;
      let planted = 0;

      for (let gy = 0; gy < gridN && planted < INITIAL_PLANT_COUNT; gy++) {
        for (let gx = 0; gx < gridN && planted < INITIAL_PLANT_COUNT; gx++) {
          let x =
            origin.x - spawnRadius + (gx + 0.5) * cell + rng.range(-cell * 0.35, cell * 0.35);
          let y =
            origin.y - spawnRadius + (gy + 0.5) * cell + rng.range(-cell * 0.35, cell * 0.35);
          const tile = world.getTileAtPixel(x, y);
          if (world.isSolid(tile) || world.isSlow(tile)) {
            const spot = findLandSpot(12);
            x = spot.x;
            y = spot.y;
          }
          const plant = createPlant(pickSpecies(rng), x, y);
          if (
            world.isSolid(world.getTileAtPixel(plant.x, plant.y)) ||
            world.isSlow(world.getTileAtPixel(plant.x, plant.y))
          ) {
            relocateToLand(plant, world);
          }
          plants.push(plant);
          planted++;
        }
      }

      while (planted < INITIAL_PLANT_COUNT) {
        const spot = findLandSpot();
        plants.push(createPlant(pickSpecies(rng), spot.x, spot.y));
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
          // Cluster herd members near each other
          let x = spot.x;
          let y = spot.y;
          if (inGroup > 0 && def.maxGroupSize > 1) {
            x += rng.range(-40, 40);
            y += rng.range(-40, 40);
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
          }
          // Lion sex: prefer females for hunting flavor (60% female)
          const sex = species === 'lion' ? (rng.chance(0.6) ? 'female' : 'male') : undefined;
          animals.push(createAnimal(species, x, y, { groupId: groupId, sex: sex }));
          inGroup++;
        }
      }
    }

    // -------------------------------------------------------------------------
    // Spatial rebuild
    // -------------------------------------------------------------------------

    function rebuildGrids() {
      plantGrid.clear();
      animalGrid.clear();
      for (let i = 0; i < plants.length; i++) {
        if (plants[i].alive) plantGrid.insert(plants[i]);
      }
      for (let i = 0; i < animals.length; i++) {
        animalGrid.insert(animals[i]);
      }
    }

    // -------------------------------------------------------------------------
    // Context passed into animal AI
    // -------------------------------------------------------------------------

    function makeCtx() {
      return {
        rng: rng,
        tickSeconds: tickSeconds,
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
        spawnPoop: function (x, y) {
          poops.push({
            x: x + rng.range(-3, 3),
            y: y + rng.range(-3, 3),
            life: 30,
            maxLife: 30,
          });
        },
        spawnSplash: function (x, y) {
          // Rate-limit so dense herds don't flood the particle list
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

    function update(dt) {
      rebuildGrids();
      const ctx = makeCtx();

      if (splashCooldown > 0) splashCooldown -= dt;

      // Continuous movement / AI
      for (let i = 0; i < animals.length; i++) {
        const a = animals[i];
        updateAnimal(a, dt, ctx);
        if (a.alive) clampToRegion(a, origin.x, origin.y, spawnRadius * 1.15);
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

      // Plants — grow anywhere; respawn on land
      for (let i = 0; i < plants.length; i++) {
        updatePlant(plants[i], findRespawnSpot);
      }

      // Animals
      const newborns = [];
      const toRemove = [];
      for (let i = 0; i < animals.length; i++) {
        const result = tickAnimal(animals[i], ctx);
        if (result.offspring) {
          for (let k = 0; k < result.offspring.length; k++) {
            newborns.push(result.offspring[k]);
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

      // Rebuild after tick mutations so mid-tick queries stay sane next frame
      rebuildGrids();
    }

    // -------------------------------------------------------------------------
    // Debug stats
    // -------------------------------------------------------------------------

    function getDebugStats() {
      let plantsAlive = 0;
      let plantCalories = 0;
      for (let i = 0; i < plants.length; i++) {
        if (plants[i].alive) {
          plantsAlive++;
          plantCalories += plants[i].calories;
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
        plantAvgCalories: plantsAlive ? Math.round(plantCalories / plantsAlive) : 0,
        herbivores: herbCounts,
        herbTotal: herbTotal,
        predators: predCounts,
        predTotal: predTotal,
        avgCalories: avgCalories,
        corpses: corpses,
        poops: poops.length,
        animalTotal: animals.length,
      };
    }

    // Boot
    // Ensure chunks exist across the spawn region before placing entities
    world.ensureChunksInBounds(
      origin.x - spawnRadius,
      origin.y - spawnRadius,
      origin.x + spawnRadius,
      origin.y + spawnRadius
    );
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
