/**
 * Player: movable caveman with stats, melee combat, harvesting, and inventory.
 */
(function (global) {
  const Wildborn = (global.Wildborn = global.Wildborn || {});
  const { TILE_SIZE, TILE } = Wildborn.world;

  /** Invisible hitbox size (world px). Visual sprite is drawn larger in render.js. */
  const PLAYER_SIZE = 30;
  const BASE_SPEED = 280; // pixels per second (doubled with world scale)
  const WATER_SPEED_MULT = 0.45;

  /** Melee reach from player center (world px). */
  const ATTACK_RANGE = 72;
  /** Damage dealt by the equipped stick/club per successful hit. */
  const ATTACK_POWER = 18;
  /** Seconds between swings. */
  const ATTACK_COOLDOWN = 0.35;
  /** How long the swing animation plays. */
  const SWING_DURATION = 0.28;

  /** Stick hits required to fell a tree or shatter a rock section. */
  const HARVEST_HITS = 20;
  /** Wood granted when a tree falls. */
  const TREE_WOOD_YIELD = 100;
  /** Stone granted when a rock section breaks. */
  const ROCK_STONE_YIELD = 100;
  /** Pickup radius for death backpacks (world px). */
  const BACKPACK_PICKUP_RANGE = 48;

  /** Ordered inventory keys shown in the Q panel. */
  const INVENTORY_KEYS = [
    'wood',
    'stone',
    'leather',
    'fat',
    'bones',
    'fiber',
    'hide',
    'meat',
  ];

  function emptyInventory() {
    return {
      wood: 0,
      stone: 0,
      leather: 0,
      fat: 0,
      bones: 0,
      fiber: 0,
      hide: 0,
      meat: 0,
    };
  }

  function copyInventory(src) {
    const out = emptyInventory();
    if (!src) return out;
    for (let i = 0; i < INVENTORY_KEYS.length; i++) {
      const k = INVENTORY_KEYS[i];
      out[k] = Math.max(0, src[k] || 0);
    }
    return out;
  }

  function inventoryHasItems(inv) {
    if (!inv) return false;
    for (let i = 0; i < INVENTORY_KEYS.length; i++) {
      if ((inv[INVENTORY_KEYS[i]] || 0) > 0) return true;
    }
    return false;
  }

  function addInventory(inv, key, amount) {
    if (!inv || !key || !amount) return;
    inv[key] = (inv[key] || 0) + amount;
  }

  function createPlayer(spawn) {
    spawn = spawn || { x: 0, y: 0 };
    return {
      kind: 'player',
      x: spawn.x,
      y: spawn.y,
      w: PLAYER_SIZE,
      h: PLAYER_SIZE,
      vx: 0,
      vy: 0,
      facingX: 1,
      facingY: 0,
      /** Walk-cycle phase for limb swing (radians). */
      walkPhase: 0,

      hp: 100,
      maxHp: 100,
      /** Alias kept in sync with hp so animal combat helpers can treat the player like prey. */
      health: 100,
      maxHealth: 100,
      alive: true,
      hunger: 100,
      maxHunger: 100,
      thirst: 100,
      maxThirst: 100,
      stamina: 100,
      maxStamina: 100,

      inventory: emptyInventory(),
      equipped: 'stick',
      attackPower: ATTACK_POWER,
      attackRange: ATTACK_RANGE,
      attackCooldown: 0,
      /** Remaining seconds of the current swing animation (0 = idle). */
      swingTimer: 0,
      swingDuration: SWING_DURATION,
      /** Animal id hit by the current swing (avoid multi-hit in one swing). */
      swingHitId: null,
      /** Spawn point used for death respawn. */
      spawnX: spawn.x,
      spawnY: spawn.y,
    };
  }

  function playerCenter(player) {
    return {
      x: player.x + player.w / 2,
      y: player.y + player.h / 2,
    };
  }

  /** Apply damage to the player; returns amount applied. */
  function damagePlayer(player, amount) {
    if (!player || !player.alive) return 0;
    const dmg = Math.max(0, amount || 0);
    player.hp = Math.max(0, player.hp - dmg);
    player.health = player.hp;
    if (player.hp <= 0) {
      player.alive = false;
      player.vx = 0;
      player.vy = 0;
    }
    return dmg;
  }

  /**
   * Apply keyboard input → velocity + collision.
   * @param {object} player
   * @param {{ up:boolean, down:boolean, left:boolean, right:boolean }} keys
   * @param {number} dt seconds
   * @param {object} world
   */
  function updatePlayer(player, keys, dt, world) {
    if (!player.alive) {
      player.vx = 0;
      player.vy = 0;
      if (player.attackCooldown > 0) player.attackCooldown = Math.max(0, player.attackCooldown - dt);
      if (player.swingTimer > 0) player.swingTimer = Math.max(0, player.swingTimer - dt);
      return;
    }

    let dx = 0;
    let dy = 0;
    if (keys.left) dx -= 1;
    if (keys.right) dx += 1;
    if (keys.up) dy -= 1;
    if (keys.down) dy += 1;

    if (dx !== 0 || dy !== 0) {
      const len = Math.hypot(dx, dy);
      dx /= len;
      dy /= len;
      player.facingX = dx;
      player.facingY = dy;
    }

    const centerTile = world.getTileAtPixel(player.x + player.w / 2, player.y + player.h / 2);
    let speed = BASE_SPEED;
    if (world.isSlow(centerTile)) speed *= WATER_SPEED_MULT;

    const nextX = player.x + dx * speed * dt;
    const nextY = player.y + dy * speed * dt;

    if (!collidesWorld(nextX, player.y, player.w, player.h, world)) {
      player.x = nextX;
    }
    if (!collidesWorld(player.x, nextY, player.w, player.h, world)) {
      player.y = nextY;
    }

    // Hard clamp to the fixed 400×400 map edges
    const mapPx = world.MAP_PIXEL_SIZE || Wildborn.world.MAP_PIXEL_SIZE || 25600;
    player.x = Math.max(0, Math.min(mapPx - player.w, player.x));
    player.y = Math.max(0, Math.min(mapPx - player.h, player.y));

    player.vx = dx * speed;
    player.vy = dy * speed;

    const moving = Math.abs(player.vx) + Math.abs(player.vy) > 1;
    if (moving) {
      player.walkPhase += dt * 10;
    } else {
      // Ease limbs back toward rest
      player.walkPhase *= 1 - Math.min(1, dt * 6);
    }

    if (player.attackCooldown > 0) {
      player.attackCooldown = Math.max(0, player.attackCooldown - dt);
    }
    if (player.swingTimer > 0) {
      player.swingTimer = Math.max(0, player.swingTimer - dt);
      if (player.swingTimer <= 0) player.swingHitId = null;
    }
  }

  function tileKey(tx, ty) {
    return tx + ',' + ty;
  }

  /**
   * Find the best TREE / CLIFF tile to harvest in front of (or beside) the player.
   * @returns {{ tx:number, ty:number, tile:number }|null}
   */
  function findHarvestTile(player, world) {
    if (!player || !world || !world.getTile) return null;
    const center = playerCenter(player);
    const range = player.attackRange || ATTACK_RANGE;
    const candidates = [];

    // Sample along facing direction
    const steps = 5;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      candidates.push({
        x: center.x + player.facingX * range * t,
        y: center.y + player.facingY * range * t,
      });
    }
    // Nearby tile centers around the player (side / close hits)
    const baseTx = Math.floor(center.x / TILE_SIZE);
    const baseTy = Math.floor(center.y / TILE_SIZE);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        candidates.push({
          x: (baseTx + dx + 0.5) * TILE_SIZE,
          y: (baseTy + dy + 0.5) * TILE_SIZE,
        });
      }
    }

    let best = null;
    let bestScore = Infinity;
    const seen = Object.create(null);
    const range2 = range * range;

    for (let i = 0; i < candidates.length; i++) {
      const px = candidates[i].x;
      const py = candidates[i].y;
      const tx = Math.floor(px / TILE_SIZE);
      const ty = Math.floor(py / TILE_SIZE);
      const key = tileKey(tx, ty);
      if (seen[key]) continue;
      seen[key] = true;

      const tile = world.getTile(tx, ty);
      if (tile !== TILE.TREE && tile !== TILE.CLIFF) continue;

      const cx = (tx + 0.5) * TILE_SIZE;
      const cy = (ty + 0.5) * TILE_SIZE;
      const dx = cx - center.x;
      const dy = cy - center.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > range2) continue;

      const facing = player.facingX * dx + player.facingY * dy;
      const score = d2 - Math.max(0, facing) * 50;
      if (score < bestScore) {
        bestScore = score;
        best = { tx: tx, ty: ty, tile: tile };
      }
    }

    return best;
  }

  /**
   * Apply one stick hit to a harvestable tile.
   * @returns {{ broken:boolean, resource:?string, amount:number, hitsLeft:number }|null}
   */
  function hitHarvestTile(player, world, target) {
    if (!player || !world || !target) return null;
    const tile = world.getTile(target.tx, target.ty);
    if (tile !== TILE.TREE && tile !== TILE.CLIFF) return null;

    const hits = world.tileHits || (world.tileHits = new Map());
    const key = tileKey(target.tx, target.ty);
    let left = hits.has(key) ? hits.get(key) : HARVEST_HITS;
    left -= 1;

    if (left <= 0) {
      hits.delete(key);
      const replace =
        world.isGrass && world.getTile
          ? TILE.GRASS
          : TILE.GRASS;
      if (typeof world.setTile === 'function') {
        world.setTile(target.tx, target.ty, replace);
      }

      if (tile === TILE.TREE) {
        addInventory(player.inventory, 'wood', TREE_WOOD_YIELD);
        return { broken: true, resource: 'wood', amount: TREE_WOOD_YIELD, hitsLeft: 0 };
      }
      addInventory(player.inventory, 'stone', ROCK_STONE_YIELD);
      return { broken: true, resource: 'stone', amount: ROCK_STONE_YIELD, hitsLeft: 0 };
    }

    hits.set(key, left);
    return { broken: false, resource: null, amount: 0, hitsLeft: left };
  }

  /**
   * Carve one stick-hit of leather/fat/bones from a dead animal.
   * Yields floor(maxCalories / 10) of each resource total.
   */
  function butcherCorpse(player, animal) {
    if (!player || !animal) return null;
    if (animal.alive || animal.state !== 'DEAD') return null;
    if (animal.lootRemaining == null) {
      animal.lootRemaining = Math.floor((animal.maxCalories || 0) / 10);
    }
    if (animal.lootRemaining <= 0) return null;

    animal.lootRemaining -= 1;
    addInventory(player.inventory, 'leather', 1);
    addInventory(player.inventory, 'fat', 1);
    addInventory(player.inventory, 'bones', 1);

    if (animal.lootRemaining <= 0) {
      animal.corpseCalories = 0;
      animal.corpseDecay = 0;
    }

    return {
      leather: 1,
      fat: 1,
      bones: 1,
      remaining: animal.lootRemaining,
    };
  }

  /**
   * Start a melee swing: living animals, then corpses, then trees/rocks.
   * @returns {{ swung:boolean, hit:object|null, harvest:object|null, butcher:object|null }}
   */
  function tryPlayerAttack(player, ecosystem, world) {
    if (!player || !player.alive) {
      return { swung: false, hit: null, harvest: null, butcher: null };
    }
    if (player.attackCooldown > 0) {
      return { swung: false, hit: null, harvest: null, butcher: null };
    }

    player.attackCooldown = ATTACK_COOLDOWN;
    player.swingTimer = player.swingDuration || SWING_DURATION;
    player.swingHitId = null;

    const center = playerCenter(player);
    const range = player.attackRange || ATTACK_RANGE;
    const range2 = range * range;

    // 1) Living animals
    if (ecosystem && ecosystem.animals) {
      let best = null;
      let bestScore = Infinity;
      const animals = ecosystem.animals;
      for (let i = 0; i < animals.length; i++) {
        const a = animals[i];
        if (!a.alive || a.state === 'DEAD') continue;
        const dx = a.x - center.x;
        const dy = a.y - center.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > range2) continue;
        const facing = player.facingX * dx + player.facingY * dy;
        const score = d2 - Math.max(0, facing) * 40;
        if (score < bestScore) {
          bestScore = score;
          best = a;
        }
      }

      if (best) {
        player.swingHitId = best.id;
        faceToward(player, best.x, best.y, center);
        if (Wildborn.animal && typeof Wildborn.animal.applyDamage === 'function') {
          Wildborn.animal.applyDamage(best, player.attackPower || ATTACK_POWER, player);
        }
        return { swung: true, hit: best, harvest: null, butcher: null };
      }

      // 2) Dead animals with loot remaining
      let corpse = null;
      let corpseScore = Infinity;
      for (let i = 0; i < animals.length; i++) {
        const a = animals[i];
        if (a.state !== 'DEAD') continue;
        const loot =
          a.lootRemaining != null
            ? a.lootRemaining
            : Math.floor((a.maxCalories || 0) / 10);
        if (loot <= 0) continue;
        const dx = a.x - center.x;
        const dy = a.y - center.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > range2) continue;
        const facing = player.facingX * dx + player.facingY * dy;
        const score = d2 - Math.max(0, facing) * 40;
        if (score < corpseScore) {
          corpseScore = score;
          corpse = a;
        }
      }

      if (corpse) {
        player.swingHitId = corpse.id;
        faceToward(player, corpse.x, corpse.y, center);
        const butcher = butcherCorpse(player, corpse);
        return { swung: true, hit: corpse, harvest: null, butcher: butcher };
      }
    }

    // 3) Trees / stone rocks
    if (world) {
      const tileTarget = findHarvestTile(player, world);
      if (tileTarget) {
        const cx = (tileTarget.tx + 0.5) * TILE_SIZE;
        const cy = (tileTarget.ty + 0.5) * TILE_SIZE;
        faceToward(player, cx, cy, center);
        const harvest = hitHarvestTile(player, world, tileTarget);
        return { swung: true, hit: null, harvest: harvest, butcher: null };
      }
    }

    return { swung: true, hit: null, harvest: null, butcher: null };
  }

  function faceToward(player, x, y, center) {
    const tdx = x - center.x;
    const tdy = y - center.y;
    if (Math.abs(tdx) + Math.abs(tdy) > 0.1) {
      const len = Math.hypot(tdx, tdy) || 1;
      player.facingX = tdx / len;
      player.facingY = tdy / len;
    }
  }

  /**
   * Drop a backpack with the player's inventory at the death site, then
   * respawn at the starting location with empty pockets and full vitals.
   * @returns {{ backpack:object|null }}
   */
  function handlePlayerDeath(player, spawn) {
    if (!player) return { backpack: null };

    const center = playerCenter(player);
    let backpack = null;
    if (inventoryHasItems(player.inventory)) {
      backpack = {
        kind: 'backpack',
        x: center.x,
        y: center.y,
        inventory: copyInventory(player.inventory),
      };
    }

    const sx = spawn && spawn.x != null ? spawn.x : player.spawnX || 0;
    const sy = spawn && spawn.y != null ? spawn.y : player.spawnY || 0;
    respawnPlayer(player, { x: sx, y: sy });
    return { backpack: backpack };
  }

  function respawnPlayer(player, spawn) {
    player.x = spawn.x;
    player.y = spawn.y;
    player.spawnX = spawn.x;
    player.spawnY = spawn.y;
    player.vx = 0;
    player.vy = 0;
    player.hp = player.maxHp;
    player.health = player.maxHp;
    player.hunger = player.maxHunger;
    player.thirst = player.maxThirst;
    player.stamina = player.maxStamina;
    player.alive = true;
    player.inventory = emptyInventory();
    player.attackCooldown = 0;
    player.swingTimer = 0;
    player.swingHitId = null;
    player.walkPhase = 0;
  }

  /**
   * Merge a backpack into the player inventory and remove it from the list
   * when the caveman walks onto it.
   * @returns {boolean} true if a backpack was picked up
   */
  function tryPickupBackpacks(player, backpacks) {
    if (!player || !player.alive || !backpacks || !backpacks.length) return false;
    const center = playerCenter(player);
    const r2 = BACKPACK_PICKUP_RANGE * BACKPACK_PICKUP_RANGE;
    for (let i = backpacks.length - 1; i >= 0; i--) {
      const bag = backpacks[i];
      const dx = bag.x - center.x;
      const dy = bag.y - center.y;
      if (dx * dx + dy * dy > r2) continue;
      const inv = bag.inventory || emptyInventory();
      for (let k = 0; k < INVENTORY_KEYS.length; k++) {
        const key = INVENTORY_KEYS[k];
        addInventory(player.inventory, key, inv[key] || 0);
      }
      backpacks.splice(i, 1);
      return true;
    }
    return false;
  }

  function collidesWorld(x, y, w, h, world) {
    const points = [
      [x, y],
      [x + w, y],
      [x, y + h],
      [x + w, y + h],
      [x + w / 2, y],
      [x + w / 2, y + h],
      [x, y + h / 2],
      [x + w, y + h / 2],
    ];
    for (let i = 0; i < points.length; i++) {
      const tile = world.getTileAtPixel(points[i][0], points[i][1]);
      if (world.isSolid(tile)) return true;
    }
    return false;
  }

  /** Find a walkable spawn near the center of the fixed 400×400 map. */
  function findSpawn(world, maxRadius) {
    const mapTiles = world.MAP_TILES || Wildborn.world.MAP_TILES || 400;
    const cx = Math.floor(mapTiles / 2);
    const cy = Math.floor(mapTiles / 2);
    maxRadius = maxRadius == null ? mapTiles : maxRadius;
    for (let r = 0; r < maxRadius; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r && r > 0) continue;
          const tx = cx + dx;
          const ty = cy + dy;
          if (tx < 0 || ty < 0 || tx >= mapTiles || ty >= mapTiles) continue;
          const tile = world.getTile(tx, ty);
          if (world.isLand ? world.isLand(tile) : !world.isSolid(tile) && !world.isSlow(tile)) {
            return {
              x: tx * TILE_SIZE + (TILE_SIZE - PLAYER_SIZE) / 2,
              y: ty * TILE_SIZE + (TILE_SIZE - PLAYER_SIZE) / 2,
            };
          }
        }
      }
    }
    return {
      x: cx * TILE_SIZE + (TILE_SIZE - PLAYER_SIZE) / 2,
      y: cy * TILE_SIZE + (TILE_SIZE - PLAYER_SIZE) / 2,
    };
  }

  Wildborn.player = {
    createPlayer,
    updatePlayer,
    findSpawn,
    tryPlayerAttack,
    damagePlayer,
    playerCenter,
    emptyInventory,
    copyInventory,
    inventoryHasItems,
    handlePlayerDeath,
    respawnPlayer,
    tryPickupBackpacks,
    findHarvestTile,
    hitHarvestTile,
    butcherCorpse,
    PLAYER_SIZE,
    ATTACK_RANGE,
    ATTACK_POWER,
    ATTACK_COOLDOWN,
    SWING_DURATION,
    HARVEST_HITS,
    TREE_WOOD_YIELD,
    ROCK_STONE_YIELD,
    BACKPACK_PICKUP_RANGE,
    INVENTORY_KEYS,
  };
})(typeof window !== 'undefined' ? window : globalThis);
