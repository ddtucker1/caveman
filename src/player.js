/**
 * Phase 1 player: movable caveman with basic stats.
 * Combat / inventory / crafting arrive in later phases.
 */
(function (global) {
  const Wildborn = (global.Wildborn = global.Wildborn || {});
  const { TILE_SIZE } = Wildborn.world;

  /** Hitbox / visual size — 50% larger than the original 20×20. */
  const PLAYER_SIZE = 30;
  const BASE_SPEED = 140; // pixels per second
  const WATER_SPEED_MULT = 0.45;

  function createPlayer(spawn) {
    spawn = spawn || { x: 0, y: 0 };
    return {
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
    };
  }

  /**
   * Apply keyboard input → velocity + collision.
   * @param {object} player
   * @param {{ up:boolean, down:boolean, left:boolean, right:boolean }} keys
   * @param {number} dt seconds
   * @param {object} world
   */
  function updatePlayer(player, keys, dt, world) {
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

    player.vx = dx * speed;
    player.vy = dy * speed;

    const moving = Math.abs(player.vx) + Math.abs(player.vy) > 1;
    if (moving) {
      player.walkPhase += dt * 10;
    } else {
      // Ease limbs back toward rest
      player.walkPhase *= 1 - Math.min(1, dt * 6);
    }
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

  /** Find a walkable spawn near world origin. */
  function findSpawn(world, maxRadius) {
    maxRadius = maxRadius == null ? 40 : maxRadius;
    for (let r = 0; r < maxRadius; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r && r > 0) continue;
          const tile = world.getTile(dx, dy);
          if (!world.isSolid(tile) && !world.isSlow(tile)) {
            return {
              x: dx * TILE_SIZE + (TILE_SIZE - PLAYER_SIZE) / 2,
              y: dy * TILE_SIZE + (TILE_SIZE - PLAYER_SIZE) / 2,
            };
          }
        }
      }
    }
    return { x: 0, y: 0 };
  }

  Wildborn.player = { createPlayer, updatePlayer, findSpawn, PLAYER_SIZE };
})(typeof window !== 'undefined' ? window : globalThis);
