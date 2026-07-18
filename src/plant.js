/**
 * Ecosystem plants — grow calories over time, eaten by herbivores (and bears).
 * When depleted they die and respawn elsewhere after a delay.
 */
(function (global) {
  const Wildborn = (global.Wildborn = global.Wildborn || {});

  /** @typedef {'berry_bush'|'grass'|'mushroom'|'fruit_tree'|'cactus'} PlantSpecies */

  const PLANT_SPECIES = {
    berry_bush: {
      id: 'berry_bush',
      label: 'Berry Bush',
      maxCalories: 250,
      growthPerTick: 2.5,
      color: '#3a8a2a',
      accent: '#c44',
      size: 10,
      spawnWeight: 3,
    },
    grass: {
      id: 'grass',
      label: 'Grass',
      maxCalories: 150,
      growthPerTick: 2.5,
      color: '#5aaa3a',
      accent: '#7cc84a',
      size: 6,
      spawnWeight: 5,
    },
    mushroom: {
      id: 'mushroom',
      label: 'Mushroom',
      maxCalories: 200,
      growthPerTick: 2.0,
      color: '#8a5a3a',
      accent: '#c08050',
      size: 7,
      spawnWeight: 2,
    },
    fruit_tree: {
      id: 'fruit_tree',
      label: 'Fruit Tree',
      maxCalories: 500,
      growthPerTick: 1.75,
      color: '#2a6a1e',
      accent: '#e06040',
      size: 14,
      spawnWeight: 1,
    },
    cactus: {
      id: 'cactus',
      label: 'Cactus',
      maxCalories: 175,
      growthPerTick: 1.5,
      color: '#4a8a4a',
      accent: '#6ab06a',
      size: 9,
      spawnWeight: 1,
    },
  };

  const SPECIES_LIST = Object.keys(PLANT_SPECIES);
  const START_CALORIES = 10;
  const RESPAWN_DELAY_TICKS = 40;

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
      calories: START_CALORIES,
      maxCalories: def.maxCalories,
      growthPerTick: def.growthPerTick,
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

  /** Weighted random species pick. */
  function pickSpecies(rng) {
    let total = 0;
    for (let i = 0; i < SPECIES_LIST.length; i++) {
      total += PLANT_SPECIES[SPECIES_LIST[i]].spawnWeight;
    }
    let roll = rng.float() * total;
    for (let i = 0; i < SPECIES_LIST.length; i++) {
      const id = SPECIES_LIST[i];
      roll -= PLANT_SPECIES[id].spawnWeight;
      if (roll <= 0) return id;
    }
    return SPECIES_LIST[0];
  }

  /**
   * Consume up to `amount` calories. Returns calories actually eaten.
   * Marks plant dead (starts respawn) when calories hit 0.
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
   * One ecosystem tick: grow if alive, or respawn on land.
   * @param {object} plant
   * @param {function(number,number):{x:number,y:number}|null} findRespawnSpot
   */
  function updatePlant(plant, findRespawnSpot) {
    if (plant.alive) {
      if (plant.calories < plant.maxCalories) {
        plant.calories = Math.min(
          plant.maxCalories,
          plant.calories + plant.growthPerTick
        );
      }
      return;
    }

    plant.respawnTimer -= 1;
    if (plant.respawnTimer > 0) return;

    const spot = findRespawnSpot ? findRespawnSpot(plant.x, plant.y) : null;
    if (spot) {
      plant.x = spot.x;
      plant.y = spot.y;
    }
    plant.calories = START_CALORIES;
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
    const tx0 = Math.floor(plant.x / TILE_SIZE);
    const ty0 = Math.floor(plant.y / TILE_SIZE);
    for (let r = 0; r <= maxRadius; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r && r > 0) continue;
          const tile = world.getTile(tx0 + dx, ty0 + dy);
          if (!world.isSolid(tile) && !world.isSlow(tile)) {
            plant.x = (tx0 + dx) * TILE_SIZE + TILE_SIZE / 2;
            plant.y = (ty0 + dy) * TILE_SIZE + TILE_SIZE / 2;
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
    START_CALORIES,
    RESPAWN_DELAY_TICKS,
    createPlant,
    pickSpecies,
    consumePlant,
    updatePlant,
    relocateToLand,
  };
})(typeof window !== 'undefined' ? window : globalThis);
