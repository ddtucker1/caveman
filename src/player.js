/**
 * Player: movable caveman with stats and melee combat.
 */
(function (global) {
  const Wildborn = (global.Wildborn = global.Wildborn || {});
  const { TILE_SIZE } = Wildborn.world;

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

      inventory: {
        wood: 0,
        stone: 0,
        fiber: 0,
        hide: 0,
        meat: 0,
      },
      equipped: 'stick',
      attackPower: ATTACK_POWER,
      attackRange: ATTACK_RANGE,
      attackCooldown: 0,
      /** Remaining seconds of the current swing animation (0 = idle). */
      swingTimer: 0,
      swingDuration: SWING_DURATION,
      /** Animal id hit by the current swing (avoid multi-hit in one swing). */
      swingHitId: null,
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

  /**
   * Start a melee swing toward the facing direction / nearest animal.
   * Hits the closest living animal within ATTACK_RANGE (preferring ones in front).
   * @returns {{ swung:boolean, hit:object|null }}
   */
  function tryPlayerAttack(player, ecosystem) {
    if (!player || !player.alive) return { swung: false, hit: null };
    if (player.attackCooldown > 0) return { swung: false, hit: null };

    player.attackCooldown = ATTACK_COOLDOWN;
    player.swingTimer = player.swingDuration || SWING_DURATION;
    player.swingHitId = null;

    if (!ecosystem || !ecosystem.animals) return { swung: true, hit: null };

    const center = playerCenter(player);
    const range = player.attackRange || ATTACK_RANGE;
    const range2 = range * range;
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
      // Prefer targets roughly in front of the player; still allow side/back hits when close.
      const facing =
        player.facingX * dx + player.facingY * dy;
      const score = d2 - Math.max(0, facing) * 40;
      if (score < bestScore) {
        bestScore = score;
        best = a;
      }
    }

    if (!best) return { swung: true, hit: null };

    player.swingHitId = best.id;
    // Face the target when swinging
    const tdx = best.x - center.x;
    const tdy = best.y - center.y;
    if (Math.abs(tdx) + Math.abs(tdy) > 0.1) {
      const len = Math.hypot(tdx, tdy) || 1;
      player.facingX = tdx / len;
      player.facingY = tdy / len;
    }

    if (Wildborn.animal && typeof Wildborn.animal.applyDamage === 'function') {
      Wildborn.animal.applyDamage(best, player.attackPower || ATTACK_POWER, player);
    }

    return { swung: true, hit: best };
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
    PLAYER_SIZE,
    ATTACK_RANGE,
    ATTACK_POWER,
    ATTACK_COOLDOWN,
    SWING_DURATION,
  };
})(typeof window !== 'undefined' ? window : globalThis);
