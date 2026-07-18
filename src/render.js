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

  // ---------------------------------------------------------------------------
  // Ecosystem rendering
  // ---------------------------------------------------------------------------

  /** Draw plants, animals, eggs visible through the camera. */
  function drawEcosystem(ctx, ecosystem, camera) {
    if (!ecosystem) return;

    const pad = 32;
    const x0 = camera.x - pad;
    const y0 = camera.y - pad;
    const x1 = camera.x + camera.width + pad;
    const y1 = camera.y + camera.height + pad;

    const plants = ecosystem.plants;
    for (let i = 0; i < plants.length; i++) {
      const p = plants[i];
      if (!p.alive) continue;
      if (p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) continue;
      drawPlantSprite(ctx, p, camera);
    }

    const eggs = ecosystem.eggs;
    for (let i = 0; i < eggs.length; i++) {
      const e = eggs[i];
      if (e.x < x0 || e.x > x1 || e.y < y0 || e.y > y1) continue;
      const s = worldToScreen(camera, e.x, e.y);
      ctx.fillStyle = e.color || '#f5f0e0';
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, e.size || 4, (e.size || 4) * 1.2, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    const animals = ecosystem.animals;
    for (let i = 0; i < animals.length; i++) {
      const a = animals[i];
      if (a.x < x0 || a.x > x1 || a.y < y0 || a.y > y1) continue;
      // Panther stealth: invisible until close to camera center (player)
      if (a.special === 'stealth' && a.alive && a.state !== 'DEAD') {
        const cx = camera.x + camera.width / 2;
        const cy = camera.y + camera.height / 2;
        const dx = a.x - cx;
        const dy = a.y - cy;
        const reveal = a.stealthRevealDist || 120;
        if (dx * dx + dy * dy > reveal * reveal) continue;
      }
      drawAnimalSprite(ctx, a, camera);
    }
  }

  function drawPlantSprite(ctx, plant, camera) {
    const s = worldToScreen(camera, plant.x, plant.y);
    const sz = plant.size;
    const calRatio = plant.calories / plant.maxCalories;

    ctx.globalAlpha = 0.55 + 0.45 * calRatio;
    ctx.fillStyle = plant.color;
    ctx.fillRect(s.x - sz / 2, s.y - sz / 2, sz, sz);

    // Species accent (berries / fruit / mushroom cap)
    if (plant.species === 'berry_bush' || plant.species === 'fruit_tree') {
      ctx.fillStyle = plant.accent;
      ctx.fillRect(s.x - 2, s.y - sz / 2 - 2, 3, 3);
      ctx.fillRect(s.x + 1, s.y - 2, 3, 3);
    } else if (plant.species === 'mushroom') {
      ctx.fillStyle = plant.accent;
      ctx.beginPath();
      ctx.arc(s.x, s.y - 2, sz * 0.4, Math.PI, 0);
      ctx.fill();
    } else if (plant.species === 'cactus') {
      ctx.fillStyle = plant.accent;
      ctx.fillRect(s.x - 1, s.y - sz / 2 - 3, 2, 4);
    }
    ctx.globalAlpha = 1;
  }

  function drawAnimalSprite(ctx, animal, camera) {
    const s = worldToScreen(camera, animal.x, animal.y);
    const sz = animal.size;

    if (animal.state === 'DEAD') {
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = '#5a4038';
      ctx.fillRect(s.x - sz / 2, s.y - sz / 3, sz, sz * 0.55);
      ctx.globalAlpha = 1;
      return;
    }

    if (animal.burrowed) {
      ctx.fillStyle = 'rgba(80,60,40,0.5)';
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, sz * 0.6, sz * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    ctx.fillStyle = animal.color;
    ctx.fillRect(s.x - sz / 2, s.y - sz / 2, sz, sz);

    if (animal.accent) {
      ctx.fillStyle = animal.accent;
      ctx.fillRect(s.x - sz / 2, s.y - sz / 2, sz, 3);
    }

    // Juvenile indicator
    if (!animal.isAdult) {
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1;
      ctx.strokeRect(s.x - sz / 2 - 1, s.y - sz / 2 - 1, sz + 2, sz + 2);
    }

    // Tiny hunger pip
    const ratio = animal.calories / animal.maxCalories;
    if (ratio < 0.35) {
      ctx.fillStyle = ratio < 0.15 ? '#c44' : '#c90';
      ctx.fillRect(s.x - sz / 2, s.y + sz / 2 + 1, sz * ratio, 2);
    }
  }

  /**
   * F3 ecosystem debug panel — counts & average calories by species.
   * @param {CanvasRenderingContext2D} ctx
   * @param {object|null} stats from ecosystem.getDebugStats()
   */
  function drawEcosystemDebug(ctx, stats) {
    if (!stats) return;

    const lines = [];
    lines.push('ECOSYSTEM  tick ' + stats.tick);
    lines.push(
      'Plants: ' + stats.plantsAlive + '  avgCal ' + stats.plantAvgCalories +
      '  eggs ' + stats.eggs + '  corpses ' + stats.corpses
    );
    lines.push('Herbivores (' + stats.herbTotal + '):');
    for (const id in stats.herbivores) {
      const n = stats.herbivores[id];
      if (!n) continue;
      lines.push('  ' + id + ': ' + n + '  avgCal ' + (stats.avgCalories[id] || 0));
    }
    lines.push('Predators (' + stats.predTotal + '):');
    for (const id in stats.predators) {
      const n = stats.predators[id];
      if (!n) continue;
      lines.push('  ' + id + ': ' + n + '  avgCal ' + (stats.avgCalories[id] || 0));
    }

    const lineH = 14;
    const pad = 10;
    const boxW = 260;
    const boxH = pad * 2 + lines.length * lineH;
    const x = 8;
    const y = 80;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
    ctx.fillRect(x, y, boxW, boxH);
    ctx.strokeStyle = 'rgba(200, 200, 160, 0.35)';
    ctx.strokeRect(x, y, boxW, boxH);

    ctx.font = '12px monospace';
    ctx.fillStyle = '#e8e4d4';
    for (let i = 0; i < lines.length; i++) {
      const text = lines[i];
      if (text.indexOf('Herbivores') === 0 || text.indexOf('Predators') === 0) {
        ctx.fillStyle = '#d4c48a';
      } else if (text.indexOf('ECOSYSTEM') === 0) {
        ctx.fillStyle = '#8fd050';
      } else {
        ctx.fillStyle = '#e8e4d4';
      }
      ctx.fillText(text, x + pad, y + pad + (i + 1) * lineH - 4);
    }
  }

  Wildborn.render = {
    clear,
    drawWorld,
    drawPlayer,
    drawEcosystem,
    drawEcosystemDebug,
    updateHud,
    setSeedDisplay,
    drawDebug,
  };
})(typeof window !== 'undefined' ? window : globalThis);
