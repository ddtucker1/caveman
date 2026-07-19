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

  /** After a species hits zero living animals, wait 25 min then spawn this many. */
  const EXTINCTION_REPOPULATE_COUNT = 4;
  /** 1500 seconds (25 min) at 0.5s/tick → 3000 ticks. */
  const EXTINCTION_REPOPULATE_DELAY_SECONDS = 1500;
  const EXTINCTION_REPOPULATE_DELAY_TICKS = 3000;

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
    /** Short-lived white splash dots when animals move through water. */
    const splashes = [];

    const plantGrid = createSpatialGrid(cellSize);
    const animalGrid = createSpatialGrid(cellSize);

    let tickAccum = 0;
    let tickCount = 0;
    let nextGroupId = 1;
    let splashCooldown = 0;
    /** speciesId → ticks remaining until extinction repopulation fires. */
    const extinctionTimers = {};

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
        // Land only — never trees/mountains (or water) for generic spawns
        if (world.isLand ? world.isLand(tile) : !world.isSolid(tile) && !world.isSlow(tile)) {
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

    /**
     * Jitter a pack/herd member near a valid anchor without landing on
     * trees, mountains, or (for land animals) water.
     */
    function jitterNearSpot(spot, range, allowWater) {
      for (let i = 0; i < 12; i++) {
        let x = spot.x + rng.range(-range, range);
        let y = spot.y + rng.range(-range, range);
        x = Math.max(TILE_SIZE, Math.min(mapPixelSize - TILE_SIZE, x));
        y = Math.max(TILE_SIZE, Math.min(mapPixelSize - TILE_SIZE, y));
        const tile = world.getTileAtPixel(x, y);
        if (world.isSolid(tile)) continue;
        if (!allowWater && world.isSlow(tile)) continue;
        return { x: x, y: y };
      }
      return { x: spot.x, y: spot.y };
    }

    /** Respawn: completely random land tile anywhere on the 400×400 map. */
    function findRespawnSpot() {
      return findRandomLandTile(800);
    }

    function isLiveAnimal(animal) {
      return !!(animal && animal.alive && animal.state !== AI_STATE.DEAD);
    }

    function countLiveSpecies(speciesId) {
      let n = 0;
      for (let i = 0; i < animals.length; i++) {
        const a = animals[i];
        if (a.species === speciesId && isLiveAnimal(a)) n++;
      }
      return n;
    }

    /** Spawn `count` of a species at independent random map locations. */
    function spawnSpeciesAtRandom(speciesId, count) {
      const def = HERBIVORE_SPECIES[speciesId] || PREDATOR_SPECIES[speciesId];
      if (!def) return;
      const allowWater = speciesId === 'alligator' || !!def.aquatic;
      for (let i = 0; i < count; i++) {
        const spot = allowWater ? findWaterSpot() : findWalkableSpot();
        const sex = speciesId === 'lion' ? (rng.chance(0.6) ? 'female' : 'male') : undefined;
        animals.push(
          createAnimal(speciesId, spot.x, spot.y, {
            groupId: nextGroupId++,
            sex: sex,
          })
        );
      }
    }

    /**
     * When any species reaches zero living population, wait 25 minutes then
     * repopulate with EXTINCTION_REPOPULATE_COUNT individuals at random spots.
     */
    function updateExtinctionRepopulation() {
      for (const speciesId in HERBIVORE_SPECIES) {
        advanceExtinctionTimer(speciesId);
      }
      for (const speciesId in PREDATOR_SPECIES) {
        advanceExtinctionTimer(speciesId);
      }
    }

    function advanceExtinctionTimer(speciesId) {
      if (countLiveSpecies(speciesId) > 0) {
        delete extinctionTimers[speciesId];
        return;
      }
      if (extinctionTimers[speciesId] == null) {
        extinctionTimers[speciesId] = EXTINCTION_REPOPULATE_DELAY_TICKS;
      }
      extinctionTimers[speciesId] -= 1;
      if (extinctionTimers[speciesId] > 0) return;
      spawnSpeciesAtRandom(speciesId, EXTINCTION_REPOPULATE_COUNT);
      delete extinctionTimers[speciesId];
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
            const jittered = jitterNearSpot(spot, 40, !!def.aquatic);
            x = jittered.x;
            y = jittered.y;
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
          const allowWater = species === 'alligator' || !!def.aquatic;
          const spot = allowWater ? findWaterSpot() : findWalkableSpot();
          let x = spot.x;
          let y = spot.y;
          if (inGroup > 0 && def.maxGroupSize > 1) {
            const jittered = jitterNearSpot(spot, 50, allowWater);
            x = jittered.x;
            y = jittered.y;
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

    /**
     * Cheap far-LOD step: keep sliding along an existing path / velocity
     * without AI decisions or new A* searches.
     * Soft-rejects solids (trees / mountains) always, and water for non-aquatic
     * animals so far LOD cannot pin them in lakes or tunnel through terrain.
     */
    function cheapMoveAnimal(animal, dt) {
      if (animal.state === AI_STATE.DEAD) return;
      const prevX = animal.x;
      const prevY = animal.y;
      let nextX = animal.x;
      let nextY = animal.y;
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
        nextX = animal.x + (dx / len) * step;
        nextY = animal.y + (dy / len) * step;
        animal.vx = (dx / len) * speed;
        animal.vy = (dy / len) * speed;
        animal.facingRight = dx >= 0;
      } else if (animal.vx || animal.vy) {
        nextX = animal.x + animal.vx * dt;
        nextY = animal.y + animal.vy * dt;
      } else {
        // Stationary far-LOD animals still need an escape chance when pinned
        // against water / tree edges between full AI frames. Build pressure
        // only when open land neighbors are scarce — otherwise timers never
        // rise for animals that arrived with vx=vy=0.
        const openLand = countOpenLandNeighbors(animal.x, animal.y);
        if (openLand <= 1) {
          animal._obstacleStuckTimer = (animal._obstacleStuckTimer || 0) + dt;
          if (isNearWaterPixel(animal.x, animal.y)) {
            animal._waterStuckTimer = (animal._waterStuckTimer || 0) + dt;
          }
        }
        maybeCheapUnstick(animal, dt);
        return;
      }

      // Axis-separate solid collision (trees / mountains)
      if (!world.isSolid(world.getTileAtPixel(nextX, prevY))) {
        animal.x = nextX;
      } else {
        animal.vx = 0;
      }
      if (!world.isSolid(world.getTileAtPixel(animal.x, nextY))) {
        animal.y = nextY;
      } else {
        animal.vy = 0;
      }

      const wasInWater = world.isSlow(world.getTileAtPixel(prevX, prevY));
      const inWater = world.isSlow(world.getTileAtPixel(animal.x, animal.y));
      const nearWater = inWater || isNearWaterPixel(animal.x, animal.y);
      // Finish a crossing already underway; otherwise require stuck pressure.
      const allowWater =
        animal.aquatic ||
        animal.waterSpeedKey ||
        wasInWater ||
        (animal._waterStuckTimer || 0) >=
          ((Wildborn.animal && Wildborn.animal.WATER_STUCK_CROSS_SECONDS) || 1.25);

      if (!allowWater && inWater) {
        animal.x = prevX;
        animal.y = prevY;
        animal.vx = 0;
        animal.vy = 0;
        animal._path = null;
        animal._pathIndex = 0;
        animal._waterStuckTimer = (animal._waterStuckTimer || 0) + dt;
        animal._obstacleStuckTimer = (animal._obstacleStuckTimer || 0) + dt;
        maybeCheapUnstick(animal, dt);
        return;
      }

      if (animal.x === prevX && animal.y === prevY) {
        animal._obstacleStuckTimer = (animal._obstacleStuckTimer || 0) + dt;
        // Tree+water pockets often bounce off solids without ever entering water,
        // so shoreline pressure must still accumulate for a temporary crossing.
        if (nearWater) {
          animal._waterStuckTimer = (animal._waterStuckTimer || 0) + dt;
        }
        maybeCheapUnstick(animal, dt);
      } else {
        animal._obstacleStuckTimer = Math.max(
          0,
          (animal._obstacleStuckTimer || 0) - dt * 2
        );
        // Do not decay the crossing timer while swimming — that used to yank
        // far-LOD animals back onto the shoreline mid-crossing.
        if (!inWater) {
          animal._waterStuckTimer = Math.max(0, (animal._waterStuckTimer || 0) - dt);
        }
      }
    }

    /** True when this pixel or an orthogonal/diagonal neighbor is water. */
    function isNearWaterPixel(x, y) {
      if (world.isSlow(world.getTileAtPixel(x, y))) return true;
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
        if (world.isSlow(world.getTileAtPixel(x + offsets[i][0], y + offsets[i][1]))) {
          return true;
        }
      }
      return false;
    }

    /** Count orthogonal land neighbors that are neither water nor solid. */
    function countOpenLandNeighbors(x, y) {
      const offsets = [
        [TILE_SIZE, 0],
        [-TILE_SIZE, 0],
        [0, TILE_SIZE],
        [0, -TILE_SIZE],
      ];
      let open = 0;
      for (let i = 0; i < offsets.length; i++) {
        const px = x + offsets[i][0];
        const py = y + offsets[i][1];
        const tile = world.getTileAtPixel(px, py);
        if (!world.isSlow(tile) && !world.isSolid(tile) && world.isLand(tile)) {
          open++;
        }
      }
      return open;
    }

    /**
     * Far-LOD escape: step onto a nearby land pixel when pinned at water/tree edges.
     * Avoids animals freezing until the next full AI update.
     */
    function maybeCheapUnstick(animal, dt) {
      const waterStuck = animal._waterStuckTimer || 0;
      const obstacleStuck = animal._obstacleStuckTimer || 0;
      const waterThresh =
        (Wildborn.animal && Wildborn.animal.WATER_STUCK_CROSS_SECONDS) || 1.25;
      const obstThresh =
        (Wildborn.animal && Wildborn.animal.OBSTACLE_STUCK_ESCAPE_SECONDS) || 0.85;
      if (waterStuck < waterThresh * 0.5 && obstacleStuck < obstThresh * 0.5) {
        return;
      }
      const nearWater = isNearWaterPixel(animal.x, animal.y);
      const allowWater =
        animal.aquatic ||
        animal.waterSpeedKey ||
        waterStuck >= waterThresh ||
        (nearWater && obstacleStuck >= obstThresh);
      const speed = Math.max(8, animal.baseSpeed || 20);
      const stuckHard = waterStuck >= waterThresh || obstacleStuck >= obstThresh;
      const step = Math.max(
        TILE_SIZE * (stuckHard ? 0.85 : 0.45),
        speed * Math.max(dt, 0.1)
      );
      const dirs = [
        [step, 0],
        [-step, 0],
        [0, step],
        [0, -step],
        [step * 0.7, step * 0.7],
        [-step * 0.7, step * 0.7],
        [step * 0.7, -step * 0.7],
        [-step * 0.7, -step * 0.7],
      ];
      // Prefer the last successful escape heading so far-LOD movers do not
      // ping-pong between opposite open steps each frame.
      const order = [];
      const prefer = animal._cheapUnstickDir;
      if (prefer != null && prefer >= 0 && prefer < dirs.length) order.push(prefer);
      for (let i = 0; i < dirs.length; i++) {
        if (i !== prefer) order.push(i);
      }
      // Prefer dry land exits; only take water when that is the remaining outlet.
      let waterFallback = null;
      for (let o = 0; o < order.length; o++) {
        const i = order[o];
        const nx = animal.x + dirs[i][0];
        const ny = animal.y + dirs[i][1];
        if (world.isSolid(world.getTileAtPixel(nx, ny))) continue;
        const wet = world.isSlow(world.getTileAtPixel(nx, ny));
        if (wet && !allowWater) continue;
        if (wet) {
          if (!waterFallback) waterFallback = i;
          continue;
        }
        animal.x = nx;
        animal.y = ny;
        animal.vx = (dirs[i][0] / step) * speed * 0.5;
        animal.vy = (dirs[i][1] / step) * speed * 0.5;
        animal._cheapUnstickDir = i;
        animal._path = null;
        animal._pathIndex = 0;
        return;
      }
      if (waterFallback != null) {
        const i = waterFallback;
        animal.x = animal.x + dirs[i][0];
        animal.y = animal.y + dirs[i][1];
        animal.vx = (dirs[i][0] / step) * speed * 0.5;
        animal.vy = (dirs[i][1] / step) * speed * 0.5;
        animal._cheapUnstickDir = i;
        animal._path = null;
        animal._pathIndex = 0;
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
        isWater: function (x, y) {
          return world.isSlow(world.getTileAtPixel(x, y));
        },
        /** Dark green trees and mountains — impassable for animals and the caveman. */
        isSolid: function (x, y) {
          return world.isSolid(world.getTileAtPixel(x, y));
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

      // Visual particles (splash motion)
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

      // Animals — no population cap; breeding limited by calories / cooldown / food web
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

      updateExtinctionRepopulation();
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
        animalTotal: animals.length,
        mapTiles: mapTiles,
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
    EXTINCTION_REPOPULATE_COUNT,
    EXTINCTION_REPOPULATE_DELAY_SECONDS,
    EXTINCTION_REPOPULATE_DELAY_TICKS,
  };
})(typeof window !== 'undefined' ? window : globalThis);
