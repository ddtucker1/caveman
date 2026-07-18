/**
 * Draw helpers: tiles, player, ecosystem sprites, UI overlays.
 * Entity silhouettes come from Wildborn.renderShapes.renderShape().
 */
(function (global) {
  const Wildborn = (global.Wildborn = global.Wildborn || {});
  const { TILE, TILE_SIZE, TILE_COLORS } = Wildborn.world;
  const { worldToScreen } = Wildborn.camera;

  /** Deterministic 0–1 hash for stable terrain decoration. */
  function hash2(x, y) {
    let n = ((x * 374761393) ^ (y * 668265263)) | 0;
    n = (n ^ (n >>> 13)) * 1274126177;
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }

  function clear(ctx, w, h) {
    ctx.fillStyle = '#1a2214';
    ctx.fillRect(0, 0, w, h);
  }

  /** Draw all tiles currently visible through the camera (clamped to map). */
  function drawWorld(ctx, world, camera, time) {
    time = time || 0;
    const mapTiles = world.MAP_TILES || Wildborn.world.MAP_TILES || 400;
    const tx0 = Math.max(0, Math.floor(camera.x / TILE_SIZE));
    const ty0 = Math.max(0, Math.floor(camera.y / TILE_SIZE));
    const tx1 = Math.min(mapTiles - 1, Math.ceil((camera.x + camera.width) / TILE_SIZE));
    const ty1 = Math.min(mapTiles - 1, Math.ceil((camera.y + camera.height) / TILE_SIZE));
    const terrain = Wildborn.shapes.getShapeDefs().shared.terrain;

    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const tile = world.getTile(tx, ty);
        const wx = tx * TILE_SIZE;
        const wy = ty * TILE_SIZE;
        const screen = worldToScreen(camera, wx, wy);
        drawTile(ctx, tile, screen.x, screen.y, tx, ty, time, terrain);
      }
    }
  }

  function drawTile(ctx, tile, sx, sy, tx, ty, time, terrain) {
    // Base fill — grass uses light tan under-tint for texture readability
    if (tile === TILE.GRASS || tile === TILE.DENSE_GRASS) {
      ctx.fillStyle = terrain.grassBase;
      ctx.fillRect(sx, sy, TILE_SIZE, TILE_SIZE);
      ctx.fillStyle =
        tile === TILE.DENSE_GRASS
          ? 'rgba(61,106,44,0.82)'
          : 'rgba(74,122,52,0.78)';
      ctx.fillRect(sx, sy, TILE_SIZE, TILE_SIZE);
      // Speckles
      ctx.fillStyle = terrain.speckleColor;
      const n = 5 + ((tx * 3 + ty) % 3);
      for (let i = 0; i < n; i++) {
        const h = hash2(tx * 17 + i, ty * 13 + i);
        const px = sx + (h * 27) % (TILE_SIZE - 2);
        const py = sy + (hash2(ty + i, tx + i) * 27) % (TILE_SIZE - 2);
        ctx.fillRect(px, py, 1.5, 1.5);
      }
      // Decorative grass tufts (non-interactive)
      if (hash2(tx, ty) > 0.72) {
        ctx.strokeStyle = terrain.tuftColor;
        ctx.lineWidth = 1.2;
        const bx = sx + 8 + hash2(tx + 1, ty) * 14;
        const by = sy + 22;
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.moveTo(bx + i * 3, by);
          ctx.lineTo(bx + i * 3 + (i - 1), by - 6 - i);
          ctx.stroke();
        }
      }
      // Scattered rock formations
      if (hash2(tx + 9, ty + 4) > 0.93) {
        drawRock(ctx, sx + 10, sy + 12, terrain, hash2(tx, ty + 3));
      }
    } else {
      ctx.fillStyle = TILE_COLORS[tile] != null ? TILE_COLORS[tile] : '#888';
      ctx.fillRect(sx, sy, TILE_SIZE, TILE_SIZE);
    }

    if (tile === TILE.TREE) {
      ctx.fillStyle = '#3a5a28';
      ctx.beginPath();
      ctx.arc(sx + TILE_SIZE / 2, sy + 12, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#5a3a1a';
      ctx.fillRect(sx + TILE_SIZE / 2 - 3, sy + TILE_SIZE - 10, 6, 8);
    } else if (tile === TILE.PLANT) {
      ctx.strokeStyle = '#8fd050';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(sx + 12, sy + 24);
      ctx.lineTo(sx + 11, sy + 12);
      ctx.moveTo(sx + 16, sy + 24);
      ctx.lineTo(sx + 18, sy + 14);
      ctx.moveTo(sx + 20, sy + 24);
      ctx.lineTo(sx + 21, sy + 16);
      ctx.stroke();
    } else if (tile === TILE.WATER) {
      // Animated wave frames (slow 2–3 frame cycle)
      const frame = Math.floor((time * 1.2) % 3);
      ctx.fillStyle = terrain.waterHighlight;
      const yOff = frame * 3;
      ctx.fillRect(sx + 4, sy + 8 + yOff, TILE_SIZE - 8, 3);
      ctx.fillRect(sx + 8, sy + 16 + ((frame + 1) % 3) * 2, TILE_SIZE - 14, 2);
      ctx.fillRect(sx + 6, sy + 22 + ((frame + 2) % 3), TILE_SIZE - 12, 2);
    } else if (tile === TILE.CLIFF) {
      ctx.fillStyle = '#8a8a80';
      ctx.fillRect(sx + 2, sy + 2, TILE_SIZE - 4, 4);
      ctx.fillStyle = '#4a4a44';
      ctx.fillRect(sx + 2, sy + TILE_SIZE - 6, TILE_SIZE - 4, 4);
      // Rock-like facets
      ctx.fillStyle = 'rgba(0,0,0,0.15)';
      ctx.beginPath();
      ctx.moveTo(sx + 4, sy + 10);
      ctx.lineTo(sx + 14, sy + 8);
      ctx.lineTo(sx + 18, sy + 20);
      ctx.lineTo(sx + 6, sy + 22);
      ctx.fill();
    }
  }

  function drawRock(ctx, x, y, terrain, seed) {
    ctx.fillStyle = terrain.rockColor;
    ctx.beginPath();
    ctx.moveTo(x, y + 6);
    ctx.lineTo(x + 3 + seed * 4, y);
    ctx.lineTo(x + 10 + seed * 3, y + 2);
    ctx.lineTo(x + 12, y + 8);
    ctx.lineTo(x + 4, y + 10);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = terrain.rockShade;
    ctx.beginPath();
    ctx.moveTo(x + 4, y + 10);
    ctx.lineTo(x + 12, y + 8);
    ctx.lineTo(x + 8, y + 10);
    ctx.fill();
  }

  /**
   * Draw the player as a detailed caveman (scaled hitbox + sprite).
   * Head, messy hair, swinging arms/legs, optional wooden club.
   */
  function drawPlayer(ctx, player, camera) {
    const screen = worldToScreen(camera, player.x, player.y);
    const cx = screen.x + player.w / 2;
    const cy = screen.y + player.h / 2;
    const s = player.w; // 30 — 50% larger than original 20
    const facing = player.facingX >= 0 ? 1 : -1;
    const phase = player.walkPhase || 0;
    const swing = Math.sin(phase) * 0.55;
    const moving = Math.abs(player.vx) + Math.abs(player.vy) > 1;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(facing, 1);

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    ctx.beginPath();
    ctx.ellipse(0, s * 0.42, s * 0.32, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Legs (swing opposite to arms)
    const legLen = s * 0.28;
    ctx.strokeStyle = '#6a4428';
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    const legSwing = moving ? swing : 0;
    ctx.beginPath();
    ctx.moveTo(-s * 0.08, s * 0.08);
    ctx.lineTo(-s * 0.1 - Math.sin(legSwing) * 4, s * 0.08 + legLen);
    ctx.moveTo(s * 0.08, s * 0.08);
    ctx.lineTo(s * 0.1 + Math.sin(legSwing) * 4, s * 0.08 + legLen);
    ctx.stroke();

    // Body — brown/tan, slightly wider at shoulders
    ctx.fillStyle = '#c4a06a';
    ctx.beginPath();
    ctx.moveTo(-s * 0.22, -s * 0.08); // left shoulder
    ctx.lineTo(s * 0.22, -s * 0.08); // right shoulder
    ctx.lineTo(s * 0.16, s * 0.14); // right hip
    ctx.lineTo(-s * 0.16, s * 0.14); // left hip
    ctx.closePath();
    ctx.fill();

    // Arms (opposite swing to legs)
    const armSwing = moving ? -swing : 0;
    ctx.strokeStyle = '#b08958';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(-s * 0.2, -s * 0.05);
    ctx.lineTo(-s * 0.28 - Math.sin(armSwing) * 5, s * 0.12);
    ctx.moveTo(s * 0.2, -s * 0.05);
    ctx.lineTo(s * 0.28 + Math.sin(armSwing) * 5, s * 0.12);
    ctx.stroke();

    // Wooden club in forward hand
    const handX = s * 0.28 + Math.sin(armSwing) * 5;
    const handY = s * 0.12;
    ctx.strokeStyle = '#6a4420';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(handX, handY);
    ctx.lineTo(handX + s * 0.22, handY - s * 0.18);
    ctx.stroke();
    // Club tip nub
    ctx.fillStyle = '#5a3818';
    ctx.beginPath();
    ctx.arc(handX + s * 0.22, handY - s * 0.18, 2.2, 0, Math.PI * 2);
    ctx.fill();

    // Head — round
    const headR = s * 0.16;
    const headY = -s * 0.22;
    ctx.fillStyle = '#d4b08a';
    ctx.beginPath();
    ctx.arc(0, headY, headR, 0, Math.PI * 2);
    ctx.fill();

    // Messy brown hair pixels on top
    ctx.fillStyle = '#5a3a1a';
    const hair = [
      [-4, -headR - 1],
      [-1, -headR - 3],
      [2, -headR - 2],
      [5, -headR - 1],
      [-3, -headR + 1],
      [3, -headR + 1],
      [0, -headR - 4],
    ];
    for (let i = 0; i < hair.length; i++) {
      ctx.fillRect(hair[i][0] - 1, headY + hair[i][1] - 1, 2.2, 2.2);
    }

    // Eyes — two small black dots
    ctx.fillStyle = '#1a120c';
    ctx.beginPath();
    ctx.arc(-3.2, headY - 1, 1.15, 0, Math.PI * 2);
    ctx.arc(3.2, headY - 1, 1.15, 0, Math.PI * 2);
    ctx.fill();

    // Nose — one larger dot
    ctx.beginPath();
    ctx.arc(0.5, headY + 2.5, 1.6, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
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

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} ecosystem
   * @param {object} camera
   * @param {object} [view] { time, hoverWorld, showDebug, showHuntLines }
   */
  function drawEcosystem(ctx, ecosystem, camera, view) {
    if (!ecosystem) return;
    view = view || {};
    const time = view.time || 0;
    const showHuntLines = !!(view.showHuntLines || view.showDebug);

    const pad = 48;
    const x0 = camera.x - pad;
    const y0 = camera.y - pad;
    const x1 = camera.x + camera.width + pad;
    const y1 = camera.y + camera.height + pad;

    const plants = ecosystem.plants;
    for (let i = 0; i < plants.length; i++) {
      const p = plants[i];
      if (p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) continue;
      if (!p.alive) {
        drawPlantSprout(ctx, p, camera);
        continue;
      }
      drawPlantSprite(ctx, p, camera, time);
    }

    // Predator poop (visual only)
    const poops = ecosystem.poops || [];
    for (let i = 0; i < poops.length; i++) {
      const p = poops[i];
      if (p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) continue;
      const s = worldToScreen(camera, p.x, p.y);
      const alpha = Math.max(0, Math.min(1, p.life / (p.maxLife || 30)));
      ctx.fillStyle = 'rgba(92, 58, 28, ' + (0.55 * alpha) + ')';
      ctx.fillRect(s.x - 1, s.y - 1, 3, 3);
    }

    const animals = ecosystem.animals;
    // Pass 1: hunt lines under sprites (hover/debug only)
    if (showHuntLines || view.hoverEntity) {
      for (let i = 0; i < animals.length; i++) {
        const a = animals[i];
        if (!a.alive || a.state === 'DEAD') continue;
        if (a.x < x0 || a.x > x1 || a.y < y0 || a.y > y1) continue;
        const hunting =
          (a.diet === 'predator' || a.diet === 'omnivore') &&
          (a.state === 'SEEK_FOOD' || a.state === 'SEEK_PREY') &&
          a.target &&
          a.target.kind === 'animal' &&
          a.target.alive;
        const showLine =
          hunting &&
          (showHuntLines || (view.hoverEntity && view.hoverEntity.id === a.id));
        if (showLine) {
          drawHuntLine(ctx, a, a.target, camera);
        }
      }
    }

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
      drawAnimalSprite(ctx, a, camera, time, ecosystem);
    }

    // Water splash particles (white dots)
    const splashes = ecosystem.splashes || [];
    for (let i = 0; i < splashes.length; i++) {
      const sp = splashes[i];
      if (sp.x < x0 || sp.x > x1 || sp.y < y0 || sp.y > y1) continue;
      const s = worldToScreen(camera, sp.x, sp.y);
      const alpha = Math.max(0, Math.min(1, sp.life / (sp.maxLife || 0.5)));
      ctx.fillStyle = 'rgba(240, 248, 255, ' + (0.85 * alpha) + ')';
      ctx.fillRect(s.x - 1, s.y - 1, 2, 2);
    }
  }

  function drawHuntLine(ctx, predator, target, camera) {
    const a = worldToScreen(camera, predator.x, predator.y);
    const b = worldToScreen(camera, target.x, target.y);
    ctx.save();
    ctx.strokeStyle = 'rgba(200,40,40,0.55)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  /** Visual multiplier — sprites draw larger than hitboxes for readability. */
  const ENTITY_VISUAL_SCALE = 1.55;

  function drawPlantSprite(ctx, plant, camera, time) {
    const s = worldToScreen(camera, plant.x, plant.y);
    const shapeDef = Wildborn.shapes.getSpeciesDef(plant.species);
    const base = shapeDef ? shapeDef.size : plant.size;
    const scale = (plant.size / base) * ENTITY_VISUAL_SCALE;

    Wildborn.renderShapes.renderShape(
      ctx,
      plant.species,
      s.x,
      s.y,
      scale,
      true,
      {
        time: time,
        state: 'IDLE',
        calories: plant.calories,
        maxCalories: plant.maxCalories,
        id: plant.id,
      }
    );
  }

  /** Tiny sprout icon while a depleted plant waits 1200s to respawn elsewhere. */
  function drawPlantSprout(ctx, plant, camera) {
    const s = worldToScreen(camera, plant.x, plant.y);
    const progress = Math.max(0, Math.min(1, plant.sproutProgress || 0));
    const h = 2 + progress * 8;
    const w = 1 + progress * 3;

    ctx.save();
    ctx.translate(s.x, s.y);
    // Stem
    ctx.strokeStyle = 'rgba(70, 140, 50, ' + (0.45 + progress * 0.45) + ')';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 2);
    ctx.lineTo(0, 2 - h);
    ctx.stroke();
    // Leaves grow with progress
    if (progress > 0.15) {
      ctx.fillStyle = 'rgba(90, 170, 60, ' + (0.5 + progress * 0.5) + ')';
      ctx.beginPath();
      ctx.ellipse(-w * 0.6, 2 - h * 0.7, w, w * 0.55, -0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(w * 0.6, 2 - h * 0.55, w * 0.85, w * 0.5, 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawAnimalSprite(ctx, animal, camera, time, ecosystem) {
    const s = worldToScreen(camera, animal.x, animal.y);
    const shapeDef = Wildborn.shapes.getSpeciesDef(animal.species);
    const base = shapeDef ? shapeDef.size : animal.baseSize || animal.size;
    const scale = (animal.size / base) * ENTITY_VISUAL_SCALE;

    if (animal.burrowed) {
      ctx.fillStyle = 'rgba(80,60,40,0.5)';
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, animal.size * 0.6, animal.size * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    const facingRight = animal.vx >= 0;
    // Persist facing when stopped
    if (Math.abs(animal.vx) < 2 && animal._facingRight != null) {
      // keep last
    } else {
      animal._facingRight = facingRight;
    }
    const face = animal._facingRight !== false;

    const speed = Math.hypot(animal.vx || 0, animal.vy || 0);
    // Threshold lowered with global speed halve (was 8)
    const moving = speed > 4;
    const hunting =
      animal.alive &&
      (animal.diet === 'predator' || animal.diet === 'omnivore') &&
      (animal.state === 'SEEK_FOOD' || animal.state === 'SEEK_PREY') &&
      animal.target &&
      animal.target.kind === 'animal' &&
      animal.target.alive;
    const stalking = hunting && animal.special === 'stealth';
    const fleeing = animal.state === 'FLEE' && !animal._counterAttack;
    const attacking =
      (animal.state === 'FLEE' && animal._counterAttack) ||
      (hunting && animal.attackCooldown > 0);
    const roaring = animal.packCallTimer > 0 && animal.special === 'howl';
    // Lion roar when calling pack (also female_hunt pack feel via packCallTimer)
    const lionRoar =
      animal.species === 'lion' && (animal.packCallTimer > 0 || animal._howlPulse);
    const rearUp =
      animal.species === 'bear' &&
      hunting &&
      animal.stateTimer != null &&
      (animal.state === 'SEEK_FOOD' || animal.state === 'SEEK_PREY') &&
      (Math.floor(time * 2) % 5 === 0);
    const sleeping = animal.alive && animal.state === 'SLEEP';
    const pantThreshold =
      (Wildborn.animal && Wildborn.animal.STAMINA_PANT_THRESHOLD) || 20;
    const panting =
      animal.alive &&
      animal.diet === 'herbivore' &&
      animal.state === 'FLEE' &&
      !animal._counterAttack &&
      (animal.stamina == null || animal.stamina < pantThreshold);

    // Eye look toward nearest threat (herbivore) or food/prey
    let lookX = face ? 0.5 : -0.5;
    let lookY = 0;
    const focus = animal.fleeFrom || animal.target;
    if (focus && focus.x != null) {
      const dx = focus.x - animal.x;
      const dy = focus.y - animal.y;
      const len = Math.hypot(dx, dy) || 1;
      // Convert to local facing space (renderShape flips for left)
      lookX = (face ? dx : -dx) / len;
      lookY = dy / len;
    }

    let deadAge = 0;
    if (animal.state === 'DEAD') {
      if (animal.deadAt == null) animal.deadAt = time;
      deadAge = Math.max(0, time - animal.deadAt);
    }

    Wildborn.renderShapes.renderShape(
      ctx,
      animal.species,
      s.x,
      s.y,
      scale,
      face,
      {
        time: time,
        state: animal.state,
        calories: animal.calories,
        maxCalories: animal.maxCalories,
        stamina: animal.stamina != null ? animal.stamina : 100,
        maxStamina: animal.maxStamina != null ? animal.maxStamina : 100,
        id: animal.id,
        sex: animal.sex,
        isAdult: animal.isAdult,
        moving: moving && !sleeping,
        speed: speed,
        hunting: hunting,
        stalking: stalking,
        fleeing: fleeing,
        attacking: attacking,
        eating: animal.state === 'EATING',
        eatBobPhase: animal.eatBobPhase || 0,
        eatLocked: !!animal.eatLocked,
        eatLockPhase: animal.eatLockPhase || 0,
        roaring: roaring || lionRoar,
        rearUp: rearUp,
        sleeping: sleeping,
        sleepTilt: animal.sleepTilt || 0,
        zzzParticles: animal.zzzParticles || null,
        panting: panting,
        inWater: !!animal._inWater,
        counterAttack: !!animal._counterAttack,
        lookX: lookX,
        lookY: lookY,
        deadAge: deadAge,
        hungrySearch: !!animal._hungerSearch && !animal._hunting,
      }
    );

    // Subtle glow pulse when ready to reproduce (calories ≥ 80% and cooldown done)
    if (
      animal.alive &&
      animal.state !== 'DEAD' &&
      Wildborn.animal &&
      typeof Wildborn.animal.canBreed === 'function' &&
      Wildborn.animal.canBreed(animal)
    ) {
      const pulse = 0.25 + 0.2 * Math.sin(performance.now() * 0.004 + animal.id * 0.7);
      ctx.save();
      ctx.shadowColor = 'rgba(180, 220, 140, ' + pulse.toFixed(3) + ')';
      ctx.shadowBlur = 10 + pulse * 14;
      ctx.strokeStyle = 'rgba(180, 220, 140, ' + (pulse * 0.55).toFixed(3) + ')';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(s.x, s.y, animal.size * 0.85, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  // ---------------------------------------------------------------------------
  // Legend (L) + tooltip
  // ---------------------------------------------------------------------------

  function drawLegend(ctx, ecosystem, stats) {
    if (!ecosystem || !stats) return;

    const shared = Wildborn.shapes.getShapeDefs().shared;
    const plants = Wildborn.shapes.listSpeciesByCategory('plant');
    const herbs = Wildborn.shapes.listSpeciesByCategory('herbivore');
    const preds = Wildborn.shapes.listSpeciesByCategory('predator');

    // Count plants by species
    const plantCounts = {};
    for (let i = 0; i < plants.length; i++) plantCounts[plants[i].id] = 0;
    for (let i = 0; i < ecosystem.plants.length; i++) {
      const p = ecosystem.plants[i];
      if (p.alive) plantCounts[p.species] = (plantCounts[p.species] || 0) + 1;
    }

    let plantsAliveTotal = 0;
    for (const id in plantCounts) plantsAliveTotal += plantCounts[id];
    const plantsMax =
      (stats && stats.plantsMax) ||
      (Wildborn.ecosystem && Wildborn.ecosystem.INITIAL_PLANT_COUNT) ||
      150;

    const rows = [];
    rows.push({
      header: 'PLANTS ' + plantsAliveTotal + '/' + plantsMax,
      color: shared.legendColors.plant,
    });
    for (let i = 0; i < plants.length; i++) {
      rows.push({
        id: plants[i].id,
        label: plants[i].def.label,
        count: plantCounts[plants[i].id] || 0,
        color: shared.legendColors.plant,
      });
    }
    rows.push({ header: 'HERBIVORES', color: shared.legendColors.herbivore });
    for (let i = 0; i < herbs.length; i++) {
      rows.push({
        id: herbs[i].id,
        label: herbs[i].def.label,
        count: (stats.herbivores && stats.herbivores[herbs[i].id]) || 0,
        color: shared.legendColors.herbivore,
      });
    }
    rows.push({ header: 'PREDATORS', color: shared.legendColors.predator });
    for (let i = 0; i < preds.length; i++) {
      rows.push({
        id: preds[i].id,
        label: preds[i].def.label,
        count: (stats.predators && stats.predators[preds[i].id]) || 0,
        color: shared.legendColors.predator,
      });
    }

    const rowH = 18;
    const pad = 10;
    const boxW = 200;
    const boxH = pad * 2 + rows.length * rowH + 18;
    const x = window.innerWidth - boxW - 12;
    const y = 48;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.78)';
    ctx.fillRect(x, y, boxW, boxH);
    ctx.strokeStyle = 'rgba(200, 200, 160, 0.35)';
    ctx.strokeRect(x, y, boxW, boxH);

    ctx.font = 'bold 12px monospace';
    ctx.fillStyle = '#e8e4d4';
    ctx.fillText('LEGEND  (L)', x + pad, y + 14);

    let ry = y + 22;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row.header) {
        ctx.fillStyle = row.color;
        ctx.font = 'bold 11px monospace';
        ctx.fillText(row.header, x + pad, ry + 12);
      } else {
        // Mini icon
        ctx.save();
        Wildborn.renderShapes.renderLegendIcon(ctx, row.id, x + pad + 12, ry + 9, 0.65);
        ctx.restore();
        ctx.font = '11px monospace';
        ctx.fillStyle = '#e8e4d4';
        ctx.fillText(row.label, x + pad + 24, ry + 12);
        ctx.fillStyle = row.color;
        ctx.fillText(String(row.count), x + boxW - pad - 28, ry + 12);
      }
      ry += rowH;
    }
  }

  function stateLabel(entity) {
    if (entity.kind === 'plant') {
      if (!entity.alive) return 'Depleted';
      return 'Growing';
    }
    const s = entity.state;
    if (s === 'DEAD') return 'Dead';
    if (s === 'SLEEP') return 'Sleeping';
    if (s === 'EATING') return 'Eating';
    if (s === 'FLEE') return entity._counterAttack ? 'Attacking' : 'Fleeing';
    if (s === 'SEEK_PREY' || entity._hunting) return 'Hunting';
    if (s === 'SEEK_FOOD' || entity._hungerSearch) return 'Searching for Food';
    if (s === 'ROAM') return 'Roaming';
    if (s === 'IDLE') return 'Idle';
    return s || 'Idle';
  }

  /**
   * Find nearest entity under screen cursor (CSS pixels).
   * @returns {object|null}
   */
  function pickEntityAt(ecosystem, camera, screenX, screenY) {
    if (!ecosystem) return null;
    const worldX = camera.x + screenX;
    const worldY = camera.y + screenY;
    let best = null;
    let bestD = 28 * 28;

    const plants = ecosystem.plants;
    for (let i = 0; i < plants.length; i++) {
      const p = plants[i];
      // Allow picking depleted plants (sprouts) for the inspector
      const dx = p.x - worldX;
      const dy = p.y - worldY;
      const d2 = dx * dx + dy * dy;
      const r = (p.size || 10) * (p.alive ? 0.7 : 0.55);
      if (d2 < r * r && d2 < bestD) {
        bestD = d2;
        best = p;
      }
    }

    const animals = ecosystem.animals;
    for (let i = 0; i < animals.length; i++) {
      const a = animals[i];
      // Respect panther stealth for picking
      if (a.special === 'stealth' && a.alive && a.state !== 'DEAD') {
        const cx = camera.x + camera.width / 2;
        const cy = camera.y + camera.height / 2;
        const dx = a.x - cx;
        const dy = a.y - cy;
        const reveal = a.stealthRevealDist || 120;
        if (dx * dx + dy * dy > reveal * reveal) continue;
      }
      const dx = a.x - worldX;
      const dy = a.y - worldY;
      const d2 = dx * dx + dy * dy;
      const r = (a.size || 10) * 0.75;
      if (d2 < r * r && d2 < bestD) {
        bestD = d2;
        best = a;
      }
    }

    return best;
  }

  function drawTooltip(ctx, entity, screenX, screenY) {
    if (!entity) return;
    const def = Wildborn.shapes.getSpeciesDef(entity.species);
    const name = (def && def.label) || entity.label || entity.species;
    const cal = Math.round(entity.calories);
    const maxCal = Math.round(entity.maxCalories);
    const st = stateLabel(entity);

    const lines = [
      name,
      cal + ' / ' + maxCal + ' cal',
    ];
    if (entity.kind !== 'plant' && entity.stamina != null) {
      lines.push(
        Math.round(entity.stamina) +
          ' / ' +
          Math.round(entity.maxStamina != null ? entity.maxStamina : 100) +
          ' stam'
      );
    }
    lines.push('State: ' + st);

    ctx.font = '12px monospace';
    let maxW = 0;
    for (let i = 0; i < lines.length; i++) {
      maxW = Math.max(maxW, ctx.measureText(lines[i]).width);
    }
    const pad = 8;
    const boxW = maxW + pad * 2;
    const boxH = lines.length * 15 + pad * 2;
    let x = screenX + 14;
    let y = screenY + 14;
    if (x + boxW > window.innerWidth - 4) x = screenX - boxW - 10;
    if (y + boxH > window.innerHeight - 4) y = screenY - boxH - 10;

    ctx.fillStyle = 'rgba(0,0,0,0.82)';
    ctx.fillRect(x, y, boxW, boxH);
    ctx.strokeStyle = 'rgba(220,210,160,0.4)';
    ctx.strokeRect(x, y, boxW, boxH);

    for (let i = 0; i < lines.length; i++) {
      ctx.fillStyle = i === 0 ? '#f0e8c8' : '#d8d4c4';
      if (i === 0) ctx.font = 'bold 12px monospace';
      else ctx.font = '12px monospace';
      ctx.fillText(lines[i], x + pad, y + pad + (i + 1) * 15 - 4);
    }
  }

  /**
   * F3 ecosystem debug panel — counts & average calories by species.
   */
  function drawEcosystemDebug(ctx, stats) {
    if (!stats) return;

    const lines = [];
    lines.push('ECOSYSTEM  tick ' + stats.tick);
    const plantsMax = stats.plantsMax || Wildborn.ecosystem.INITIAL_PLANT_COUNT || 150;
    lines.push(
      'Plants: ' + stats.plantsAlive + ' / ' + plantsMax +
      (stats.plantsSprouting ? '  sprouts ' + stats.plantsSprouting : '') +
      '  avgCal ' + stats.plantAvgCalories +
      '  corpses ' + stats.corpses
    );
    if (stats.mapTiles) {
      lines.push('Map: ' + stats.mapTiles + '×' + stats.mapTiles + ' tiles');
    }
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

  /** Cached terrain bitmap for the full-map minimap (rebuilt per world seed). */
  let _minimapTerrain = null;
  let _minimapSeed = null;
  /** Cached plant/animal dots layer (refreshed on an interval). */
  let _minimapEntities = null;
  let _minimapEntitiesAt = -Infinity;
  let _minimapEntitySize = 0;

  function ensureMinimapTerrain(world) {
    const mapTiles = world.MAP_TILES || Wildborn.world.MAP_TILES || 400;
    if (_minimapTerrain && _minimapSeed === world.seedString) return _minimapTerrain;
    const c = document.createElement('canvas');
    c.width = mapTiles;
    c.height = mapTiles;
    const mctx = c.getContext('2d');
    const img = mctx.createImageData(mapTiles, mapTiles);
    const data = img.data;
    for (let ty = 0; ty < mapTiles; ty++) {
      for (let tx = 0; tx < mapTiles; tx++) {
        const tile = world.getTile(tx, ty);
        const hex = TILE_COLORS[tile] || '#333333';
        const i = (ty * mapTiles + tx) * 4;
        data[i] = parseInt(hex.slice(1, 3), 16);
        data[i + 1] = parseInt(hex.slice(3, 5), 16);
        data[i + 2] = parseInt(hex.slice(5, 7), 16);
        data[i + 3] = 255;
      }
    }
    mctx.putImageData(img, 0, 0);
    _minimapTerrain = c;
    _minimapSeed = world.seedString;
    _minimapEntities = null;
    _minimapEntitiesAt = -Infinity;
    return c;
  }

  function ensureMinimapEntities(ecosystem, mapPx, size) {
    const interval =
      (Wildborn.config && Wildborn.config.minimapEntityInterval) != null
        ? Wildborn.config.minimapEntityInterval
        : 0.2;
    const now =
      typeof performance !== 'undefined' && performance.now
        ? performance.now() / 1000
        : Date.now() / 1000;
    if (
      _minimapEntities &&
      _minimapEntitySize === size &&
      now - _minimapEntitiesAt < interval
    ) {
      return _minimapEntities;
    }
    if (!_minimapEntities || _minimapEntitySize !== size) {
      _minimapEntities = document.createElement('canvas');
      _minimapEntities.width = size;
      _minimapEntities.height = size;
      _minimapEntitySize = size;
    }
    const mctx = _minimapEntities.getContext('2d');
    mctx.clearRect(0, 0, size, size);
    if (ecosystem) {
      const plants = ecosystem.plants;
      for (let i = 0; i < plants.length; i++) {
        const p = plants[i];
        const px = (p.x / mapPx) * size;
        const py = (p.y / mapPx) * size;
        mctx.fillStyle = p.alive ? 'rgba(120, 220, 80, 0.85)' : 'rgba(60, 100, 40, 0.7)';
        mctx.fillRect(px - 0.5, py - 0.5, 1.5, 1.5);
      }
      const animals = ecosystem.animals;
      for (let i = 0; i < animals.length; i++) {
        const a = animals[i];
        if (!a.alive || a.state === 'DEAD') continue;
        const ax = (a.x / mapPx) * size;
        const ay = (a.y / mapPx) * size;
        const pred = a.diet === 'predator' || a.diet === 'omnivore';
        mctx.fillStyle = pred ? 'rgba(220, 70, 60, 0.9)' : 'rgba(240, 230, 180, 0.85)';
        mctx.fillRect(ax - 1, ay - 1, 2, 2);
      }
    }
    _minimapEntitiesAt = now;
    return _minimapEntities;
  }

  /** Layout of the bottom-right minimap in screen CSS pixels. */
  function getMinimapLayout(viewW, viewH, world) {
    const mapTiles =
      (world && world.MAP_TILES) ||
      (Wildborn.world && Wildborn.world.MAP_TILES) ||
      400;
    const mapPx =
      (world && world.MAP_PIXEL_SIZE) ||
      mapTiles * TILE_SIZE;
    const size = Math.min(160, Math.floor(Math.min(viewW, viewH) * 0.22));
    const pad = 10;
    return {
      x: viewW - size - pad,
      y: viewH - size - pad,
      size: size,
      mapTiles: mapTiles,
      mapPx: mapPx,
    };
  }

  /** Screen-space rectangle of the camera viewport on the minimap. */
  function getMinimapViewportRect(layout, camera) {
    const scale = layout.size / layout.mapPx;
    return {
      x: layout.x + camera.x * scale,
      y: layout.y + camera.y * scale,
      w: Math.max(4, camera.width * scale),
      h: Math.max(4, camera.height * scale),
    };
  }

  /**
   * Minimap of the full 400×400 grid (bottom-right).
   * Terrain sample + player / plant / animal dots + camera viewport rect.
   */
  function drawMinimap(ctx, world, player, ecosystem, viewW, viewH, camera) {
    const layout = getMinimapLayout(viewW, viewH, world);
    const { x, y, size, mapTiles, mapPx } = layout;

    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(x - 3, y - 3, size + 6, size + 6);
    ctx.strokeStyle = 'rgba(220, 210, 160, 0.45)';
    ctx.strokeRect(x - 3, y - 3, size + 6, size + 6);

    const terrain = ensureMinimapTerrain(world);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(terrain, x, y, size, size);

    if (ecosystem) {
      const entities = ensureMinimapEntities(ecosystem, mapPx, size);
      ctx.drawImage(entities, x, y, size, size);
    }

    // Player (always live)
    if (player) {
      const px = x + (player.x / mapPx) * size;
      const py = y + (player.y / mapPx) * size;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(px, py, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Current view rectangle (draggable)
    if (camera) {
      const vp = getMinimapViewportRect(layout, camera);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.fillRect(vp.x, vp.y, vp.w, vp.h);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(vp.x + 0.5, vp.y + 0.5, Math.max(1, vp.w - 1), Math.max(1, vp.h - 1));
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.lineWidth = 1;
      ctx.strokeRect(vp.x - 0.5, vp.y - 0.5, vp.w + 1, vp.h + 1);
    }

    ctx.fillStyle = 'rgba(232, 228, 212, 0.85)';
    ctx.font = '10px monospace';
    ctx.fillText(mapTiles + '×' + mapTiles, x + 4, y + 12);

    ctx.restore();
  }

  Wildborn.render = {
    clear,
    drawWorld,
    drawPlayer,
    drawEcosystem,
    drawEcosystemDebug,
    drawLegend,
    drawTooltip,
    drawMinimap,
    getMinimapLayout,
    getMinimapViewportRect,
    pickEntityAt,
    updateHud,
    setSeedDisplay,
    drawDebug,
  };
})(typeof window !== 'undefined' ? window : globalThis);
