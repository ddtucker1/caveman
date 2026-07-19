/**
 * Ecosystem plants — fully grown on spawn/respawn, no growth ticks.
 * When fully consumed they disappear and reappear after 2765s at a random
 * valid land tile, again at full max calories.
 */
(function (global) {
  const Wildborn = (global.Wildborn = global.Wildborn || {});

  /** @typedef {'berry_bush'|'grass'|'mushroom'|'fruit_tree'|'cactus'} PlantSpecies */

  /** Visual sizes are 2× the previous defaults (matched in shapes.json / shapes.js). */
  const PLANT_SPECIES = {
    grass: {
      id: 'grass',
      label: 'Grass',
      maxCalories: 150,
      color: '#5aaa3a',
      accent: '#7cc84a',
      size: 12,
    },
    berry_bush: {
      id: 'berry_bush',
      label: 'Berry Bush',
      maxCalories: 250,
      color: '#3a8a2a',
      accent: '#c44',
      size: 20,
    },
    mushroom: {
      id: 'mushroom',
      label: 'Mushroom',
      maxCalories: 200,
      color: '#8a5a3a',
      accent: '#c08050',
      size: 14,
    },
    fruit_tree: {
      id: 'fruit_tree',
      label: 'Fruit Tree',
      maxCalories: 2000,
      color: '#2a6a1e',
      accent: '#e06040',
      size: 28,
    },
    cactus: {
      id: 'cactus',
      label: 'Cactus',
      maxCalories: 175,
      color: '#4a8a4a',
      accent: '#6ab06a',
      size: 18,
    },
  };

  const SPECIES_LIST = Object.keys(PLANT_SPECIES);
  /** 2765 seconds at 0.5s/tick → 5530 ticks. */
  const RESPAWN_DELAY_SECONDS = 2765;
  const RESPAWN_DELAY_TICKS = 5530;

  let nextPlantId = 1;

  /**
   * @param {PlantSpecies} speciesId
   * @param {number} x
   * @param {number} y
   */
  function createPlant(speciesId, x, y) {
    const def = PLANT_SPECIES[speciesId];
    if (!def) throw new Error('Unknown plant species: ' + speciesId);

    return {
      kind: 'plant',
      id: nextPlantId++,
      species: speciesId,
      x: x,
      y: y,
      /** Tile coords for grid systems (kept in sync with x/y). */
      tx: 0,
      ty: 0,
      /** Always spawn fully grown. */
      calories: def.maxCalories,
      maxCalories: def.maxCalories,
      alive: true,
      respawnTimer: 0,
      color: def.color,
      accent: def.accent,
      size: def.size,
      /** Pending respawn location chosen when depleted. */
      respawnX: x,
      respawnY: y,
    };
  }

  /** Uniform random species pick (no spawn weights). */
  function pickSpecies(rng) {
    const i = rng.int ? rng.int(0, SPECIES_LIST.length - 1) : Math.floor(rng.float() * SPECIES_LIST.length);
    return SPECIES_LIST[i];
  }

  /**
   * Consume up to `amount` calories. Returns calories actually eaten.
   * When calories hit 0 the plant disappears and starts the 2765s respawn timer.
   */
  function consumePlant(plant, amount) {
    if (!plant.alive || plant.calories <= 0) return 0;
    const taken = Math.min(plant.calories, amount);
    plant.calories -= taken;
    if (plant.calories <= 0) {
      plant.calories = 0;
      plant.alive = false;
      plant.respawnTimer = RESPAWN_DELAY_TICKS;
    }
    return taken;
  }

  /**
   * One ecosystem tick: alive plants do nothing; dead plants count down and
   * respawn fully grown at a random valid land spot.
   * @param {object} plant
   * @param {function(number,number):{x:number,y:number}|null} findRespawnSpot
   */
  function updatePlant(plant, findRespawnSpot) {
    if (plant.alive) return;

    plant.respawnTimer -= 1;
    if (plant.respawnTimer > 0) return;

    const spot = findRespawnSpot ? findRespawnSpot(plant.x, plant.y) : null;
    if (spot) {
      plant.x = spot.x;
      plant.y = spot.y;
      if (spot.tx != null) plant.tx = spot.tx;
      if (spot.ty != null) plant.ty = spot.ty;
    }
    plant.calories = plant.maxCalories;
    plant.alive = true;
    plant.respawnTimer = 0;
  }

  /**
   * Relocate a plant to the nearest land tile (not water/solid).
   * @param {object} plant
   * @param {object} world
   * @param {number} [maxRadius]
   * @returns {boolean} whether a land tile was found
   */
  function relocateToLand(plant, world, maxRadius) {
    maxRadius = maxRadius == null ? 24 : maxRadius;
    const TILE_SIZE = world.TILE_SIZE || Wildborn.world.TILE_SIZE;
    const mapTiles = world.MAP_TILES || Wildborn.world.MAP_TILES || 400;
    const tx0 = Math.floor(plant.x / TILE_SIZE);
    const ty0 = Math.floor(plant.y / TILE_SIZE);
    for (let r = 0; r <= maxRadius; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r && r > 0) continue;
          const tx = tx0 + dx;
          const ty = ty0 + dy;
          if (tx < 0 || ty < 0 || tx >= mapTiles || ty >= mapTiles) continue;
          const tile = world.getTile(tx, ty);
          if (world.isLand ? world.isLand(tile) : !world.isSolid(tile) && !world.isSlow(tile)) {
            plant.x = tx * TILE_SIZE + TILE_SIZE / 2;
            plant.y = ty * TILE_SIZE + TILE_SIZE / 2;
            plant.tx = tx;
            plant.ty = ty;
            return true;
          }
        }
      }
    }
    return false;
  }

  Wildborn.plant = {
    PLANT_SPECIES,
    SPECIES_LIST,
    RESPAWN_DELAY_TICKS,
    RESPAWN_DELAY_SECONDS,
    createPlant,
    pickSpecies,
    consumePlant,
    updatePlant,
    relocateToLand,
  };
})(typeof window !== 'undefined' ? window : globalThis);
