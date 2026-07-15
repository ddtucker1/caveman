/**
 * Draw helpers: tiles, player, UI bars.
 * Phase 1 — simple colored shapes only.
 */
(function (global) {
  const Wildborn = (global.Wildborn = global.Wildborn || {});
  const { TILE, TILE_SIZE, TILE_COLORS } = Wildborn.world;
  const { worldToScreen } = Wildborn.camera;

  function clear(ctx, w, h) {
    ctx.fillStyle = '#1a2214';
    ctx.fillRect(0, 0, w, h);
  }

  /** Draw all tiles currently visible through the camera. */
  function drawWorld(ctx, world, camera) {
    const tx0 = Math.floor(camera.x / TILE_SIZE);
    const ty0 = Math.floor(camera.y / TILE_SIZE);
    const tx1 = Math.ceil((camera.x + camera.width) / TILE_SIZE);
    const ty1 = Math.ceil((camera.y + camera.height) / TILE_SIZE);

    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const tile = world.getTile(tx, ty);
        const wx = tx * TILE_SIZE;
        const wy = ty * TILE_SIZE;
        const screen = worldToScreen(camera, wx, wy);
        drawTile(ctx, tile, screen.x, screen.y);
      }
    }
  }

  function drawTile(ctx, tile, sx, sy) {
    ctx.fillStyle = TILE_COLORS[tile] != null ? TILE_COLORS[tile] : '#888';
    ctx.fillRect(sx, sy, TILE_SIZE, TILE_SIZE);

    if (tile === TILE.TREE) {
      ctx.fillStyle = '#3a5a28';
      ctx.fillRect(sx + 4, sy + 4, TILE_SIZE - 8, TILE_SIZE - 8);
      ctx.fillStyle = '#5a3a1a';
      ctx.fillRect(sx + TILE_SIZE / 2 - 3, sy + TILE_SIZE - 10, 6, 8);
    } else if (tile === TILE.PLANT) {
      ctx.fillStyle = '#8fd050';
      ctx.fillRect(sx + 10, sy + 8, 4, 16);
      ctx.fillRect(sx + 16, sy + 12, 4, 12);
      ctx.fillRect(sx + 6, sy + 14, 4, 10);
    } else if (tile === TILE.WATER) {
      ctx.fillStyle = 'rgba(180, 220, 255, 0.15)';
      ctx.fillRect(sx + 4, sy + 10, TILE_SIZE - 8, 4);
      ctx.fillRect(sx + 8, sy + 18, TILE_SIZE - 16, 3);
    } else if (tile === TILE.CLIFF) {
      ctx.fillStyle = '#8a8a80';
      ctx.fillRect(sx + 2, sy + 2, TILE_SIZE - 4, 4);
      ctx.fillStyle = '#4a4a44';
      ctx.fillRect(sx + 2, sy + TILE_SIZE - 6, TILE_SIZE - 4, 4);
    } else if (tile === TILE.GRASS || tile === TILE.DENSE_GRASS) {
      ctx.fillStyle = tile === TILE.DENSE_GRASS ? '#2e5520' : '#3a6528';
      ctx.fillRect(sx + 6, sy + 18, 2, 6);
      ctx.fillRect(sx + 14, sy + 14, 2, 8);
      ctx.fillRect(sx + 22, sy + 16, 2, 7);
    }
  }

  /** Draw the player as a caveman-colored square with a stick. */
  function drawPlayer(ctx, player, camera) {
    const screen = worldToScreen(camera, player.x, player.y);
    const sx = screen.x;
    const sy = screen.y;

    ctx.fillStyle = '#c4a06a';
    ctx.fillRect(sx, sy, player.w, player.h);

    ctx.fillStyle = '#a87848';
    ctx.fillRect(sx + 3, sy + 2, player.w - 6, 6);

    const cx = sx + player.w / 2;
    const cy = sy + player.h / 2;
    const stickLen = 16;
    ctx.strokeStyle = '#6a4420';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + player.facingX * stickLen, cy + player.facingY * stickLen);
    ctx.stroke();
  }

  function updateHud(player) {
    setBar('bar-health', player.hp / player.maxHp);
    setBar('bar-hunger', player.hunger / player.maxHunger);
    setBar('bar-thirst', player.thirst / player.maxThirst);
    setBar('bar-stamina', player.stamina / player.maxStamina);
  }

  function setBar(id, ratio) {
    const el = document.querySelector('#' + id + ' > span');
    if (el) el.style.width = Math.max(0, Math.min(1, ratio)) * 100 + '%';
  }

  function setSeedDisplay(seedString) {
    const el = document.getElementById('seed-display');
    if (el) el.textContent = 'Seed: ' + seedString;
  }

  /** Debug overlay uses CSS-pixel coords (canvas is DPR-scaled via setTransform). */
  function drawDebug(ctx, info) {
    const h = window.innerHeight;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(8, h - 54, 200, 44);
    ctx.fillStyle = '#cfc';
    ctx.font = '12px monospace';
    ctx.fillText('FPS: ' + info.fps, 14, h - 36);
    ctx.fillText('Chunks: ' + info.chunkCount, 14, h - 22);
    ctx.fillText('Tile: ' + info.playerTx + ', ' + info.playerTy, 14, h - 8);
  }

  Wildborn.render = {
    clear,
    drawWorld,
    drawPlayer,
    updateHud,
    setSeedDisplay,
    drawDebug,
  };
})(typeof window !== 'undefined' ? window : globalThis);
