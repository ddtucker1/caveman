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
    // Outside the player's view radius is pure black.
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);
  }

  /**
   * Chebyshev tile radius around the player that is drawn.
   * Simulation continues outside; graphics are skipped.
   */
  function getViewRadiusTiles() {
    const cfg = Wildborn.config;
    return cfg && cfg.viewRadiusTiles != null ? cfg.viewRadiusTiles : 20;
  }

  /** Player tile coords (floor of center). */
  function playerTile(player) {
    if (!player) return { tx: 0, ty: 0 };
    const cx = player.x + (player.w || 0) / 2;
    const cy = player.y + (player.h || 0) / 2;
    return {
      tx: Math.floor(cx / TILE_SIZE),
      ty: Math.floor(cy / TILE_SIZE),
    };
  }

  /** True if world pixel is within the player's drawn view radius. */
  function inViewRadius(player, wx, wy, radiusTiles) {
    if (!player) return true;
    radiusTiles = radiusTiles != null ? radiusTiles : getViewRadiusTiles();
    const pt = playerTile(player);
    const tx = Math.floor(wx / TILE_SIZE);
    const ty = Math.floor(wy / TILE_SIZE);
    return Math.max(Math.abs(tx - pt.tx), Math.abs(ty - pt.ty)) <= radiusTiles;
  }

  /** World-pixel AABB of the visible tile square around the player. */
  function getViewWorldBounds(player, radiusTiles) {
    radiusTiles = radiusTiles != null ? radiusTiles : getViewRadiusTiles();
    const pt = playerTile(player);
    return {
      x0: (pt.tx - radiusTiles) * TILE_SIZE,
      y0: (pt.ty - radiusTiles) * TILE_SIZE,
      x1: (pt.tx + radiusTiles + 1) * TILE_SIZE,
      y1: (pt.ty + radiusTiles + 1) * TILE_SIZE,
      tx0: pt.tx - radiusTiles,
      ty0: pt.ty - radiusTiles,
      tx1: pt.tx + radiusTiles,
      ty1: pt.ty + radiusTiles,
    };
  }

  /** Draw all tiles currently visible through the camera AND within view radius. */
  function drawWorld(ctx, world, camera, time, player) {
    time = time || 0;
    const mapTiles = world.MAP_TILES || Wildborn.world.MAP_TILES || 400;
    const radius = getViewRadiusTiles();
    const view = player ? getViewWorldBounds(player, radius) : null;

    // Camera frustum clamped to map, further clamped to player view radius.
    let tx0 = Math.max(0, Math.floor(camera.x / TILE_SIZE));
    let ty0 = Math.max(0, Math.floor(camera.y / TILE_SIZE));
    let tx1 = Math.min(mapTiles - 1, Math.ceil((camera.x + camera.width) / TILE_SIZE));
    let ty1 = Math.min(mapTiles - 1, Math.ceil((camera.y + camera.height) / TILE_SIZE));

    if (view) {
      tx0 = Math.max(tx0, Math.max(0, view.tx0));
      ty0 = Math.max(ty0, Math.max(0, view.ty0));
      tx1 = Math.min(tx1, Math.min(mapTiles - 1, view.tx1));
      ty1 = Math.min(ty1, Math.min(mapTiles - 1, view.ty1));
    }

    if (tx0 > tx1 || ty0 > ty1) return;

    const terrain = Wildborn.shapes.getShapeDefs().shared.terrain;

    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const tile = world.getTile(tx, ty);
        const wx = tx * TILE_SIZE;
        const wy = ty * TILE_SIZE;
        const screen = worldToScreen(camera, wx, wy);
        const neighbors = {
          n: ty > 0 ? world.getTile(tx, ty - 1) : tile,
          s: ty < mapTiles - 1 ? world.getTile(tx, ty + 1) : tile,
          w: tx > 0 ? world.getTile(tx - 1, ty) : tile,
          e: tx < mapTiles - 1 ? world.getTile(tx + 1, ty) : tile,
          nw: tx > 0 && ty > 0 ? world.getTile(tx - 1, ty - 1) : tile,
          ne: tx < mapTiles - 1 && ty > 0 ? world.getTile(tx + 1, ty - 1) : tile,
          sw: tx > 0 && ty < mapTiles - 1 ? world.getTile(tx - 1, ty + 1) : tile,
          se: tx < mapTiles - 1 && ty < mapTiles - 1 ? world.getTile(tx + 1, ty + 1) : tile,
        };
        drawTile(ctx, tile, screen.x, screen.y, tx, ty, time, terrain, neighbors);
      }
    }
  }

  /** Map tile id → base fill color used for blending. */
  function tileBlendColor(tile, terrain) {
    if (tile === TILE.GRASS) return terrain.grassTint || '#4a7a34';
    if (tile === TILE.DENSE_GRASS) return terrain.denseGrassTint || '#3a6a28';
    if (tile === TILE.WATER) return terrain.waterBase || TILE_COLORS[TILE.WATER];
    if (tile === TILE.TREE) return TILE_COLORS[TILE.TREE];
    if (tile === TILE.CLIFF) return TILE_COLORS[TILE.CLIFF];
    if (tile === TILE.PLANT) return TILE_COLORS[TILE.PLANT];
    return TILE_COLORS[tile] != null ? TILE_COLORS[tile] : '#888';
  }

  function isSoftTerrain(tile) {
    return (
      tile === TILE.GRASS ||
      tile === TILE.DENSE_GRASS ||
      tile === TILE.PLANT ||
      tile === TILE.WATER
    );
  }

  /** Soft edge strip toward a neighbor of a different type. */
  function blendEdge(ctx, sx, sy, dir, neighborColor, strength) {
    strength = strength == null ? 0.42 : strength;
    const edge = Math.max(10, TILE_SIZE * 0.28);
    let grad;
    if (dir === 'n') {
      grad = ctx.createLinearGradient(sx, sy, sx, sy + edge);
    } else if (dir === 's') {
      grad = ctx.createLinearGradient(sx, sy + TILE_SIZE, sx, sy + TILE_SIZE - edge);
    } else if (dir === 'w') {
      grad = ctx.createLinearGradient(sx, sy, sx + edge, sy);
    } else {
      grad = ctx.createLinearGradient(sx + TILE_SIZE, sy, sx + TILE_SIZE - edge, sy);
    }
    grad.addColorStop(0, neighborColor);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.globalAlpha = strength;
    ctx.fillRect(sx, sy, TILE_SIZE, TILE_SIZE);
    ctx.globalAlpha = 1;
  }

  /** Soft corner smear for diagonal neighbor transitions. */
  function blendCorner(ctx, sx, sy, corner, neighborColor) {
    const r = Math.max(12, TILE_SIZE * 0.32);
    let cx = sx;
    let cy = sy;
    if (corner === 'ne') {
      cx = sx + TILE_SIZE;
      cy = sy;
    } else if (corner === 'sw') {
      cx = sx;
      cy = sy + TILE_SIZE;
    } else if (corner === 'se') {
      cx = sx + TILE_SIZE;
      cy = sy + TILE_SIZE;
    }
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, neighborColor);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.globalAlpha = 0.28;
    ctx.fillRect(sx, sy, TILE_SIZE, TILE_SIZE);
    ctx.globalAlpha = 1;
  }

  function drawTile(ctx, tile, sx, sy, tx, ty, time, terrain, neighbors) {
    neighbors = neighbors || {};
    const baseColor = tileBlendColor(tile, terrain);

    // Ground underlay — warm soil for soft biomes, solid for rock/tree
    if (tile === TILE.GRASS || tile === TILE.DENSE_GRASS || tile === TILE.PLANT) {
      ctx.fillStyle = terrain.grassBase || '#b8a060';
      ctx.fillRect(sx, sy, TILE_SIZE, TILE_SIZE);
      ctx.fillStyle =
        tile === TILE.DENSE_GRASS
          ? 'rgba(58,106,40,0.84)'
          : tile === TILE.PLANT
            ? 'rgba(90,150,50,0.78)'
            : 'rgba(74,122,52,0.80)';
      ctx.fillRect(sx, sy, TILE_SIZE, TILE_SIZE);
    } else if (tile === TILE.WATER) {
      const deep = terrain.waterDeep || '#1e4e78';
      const shallow = terrain.waterBase || '#2a6a9a';
      const nearShore =
        neighbors.n === TILE.GRASS ||
        neighbors.n === TILE.DENSE_GRASS ||
        neighbors.s === TILE.GRASS ||
        neighbors.s === TILE.DENSE_GRASS ||
        neighbors.w === TILE.GRASS ||
        neighbors.w === TILE.DENSE_GRASS ||
        neighbors.e === TILE.GRASS ||
        neighbors.e === TILE.DENSE_GRASS;
      ctx.fillStyle = nearShore ? shallow : deep;
      ctx.fillRect(sx, sy, TILE_SIZE, TILE_SIZE);
    } else {
      ctx.fillStyle = baseColor;
      ctx.fillRect(sx, sy, TILE_SIZE, TILE_SIZE);
    }

    // Neighbor blending for soft terrain transitions
    if (isSoftTerrain(tile)) {
      const dirs = [
        ['n', neighbors.n],
        ['s', neighbors.s],
        ['w', neighbors.w],
        ['e', neighbors.e],
      ];
      for (let i = 0; i < dirs.length; i++) {
        const nTile = dirs[i][1];
        if (nTile == null || nTile === tile) continue;
        if (!isSoftTerrain(nTile) && nTile !== TILE.TREE && nTile !== TILE.CLIFF) continue;
        const nColor = tileBlendColor(nTile, terrain);
        const strength =
          (tile === TILE.WATER) !== (nTile === TILE.WATER) ? 0.55 : 0.38;
        blendEdge(ctx, sx, sy, dirs[i][0], nColor, strength);
      }
      const corners = [
        ['nw', neighbors.nw],
        ['ne', neighbors.ne],
        ['sw', neighbors.sw],
        ['se', neighbors.se],
      ];
      for (let i = 0; i < corners.length; i++) {
        const nTile = corners[i][1];
        if (nTile == null || nTile === tile) continue;
        if (!isSoftTerrain(nTile)) continue;
        blendCorner(ctx, sx, sy, corners[i][0], tileBlendColor(nTile, terrain));
      }
    }

    // Grass / dense grass detail
    if (tile === TILE.GRASS || tile === TILE.DENSE_GRASS) {
      ctx.fillStyle = terrain.speckleColor;
      const n = 10 + ((tx * 3 + ty) % 5);
      for (let i = 0; i < n; i++) {
        const h = hash2(tx * 17 + i, ty * 13 + i);
        const px = sx + 2 + (h * (TILE_SIZE - 6));
        const py = sy + 2 + (hash2(ty + i, tx + i) * (TILE_SIZE - 6));
        const s = 1.5 + (hash2(tx + i, ty) > 0.5 ? 1.2 : 0);
        ctx.fillRect(px, py, s, s);
      }
      // Decorative grass tufts
      if (hash2(tx, ty) > 0.62) {
        ctx.strokeStyle = terrain.tuftColor;
        ctx.lineWidth = 1.6;
        ctx.lineCap = 'round';
        const bx = sx + TILE_SIZE * 0.22 + hash2(tx + 1, ty) * TILE_SIZE * 0.45;
        const by = sy + TILE_SIZE * 0.72;
        for (let i = 0; i < 4; i++) {
          ctx.beginPath();
          ctx.moveTo(bx + i * 4, by);
          ctx.quadraticCurveTo(
            bx + i * 4 + (i - 1.5),
            by - TILE_SIZE * 0.12,
            bx + i * 4 + (i - 1.5) * 1.4,
            by - TILE_SIZE * 0.22 - i * 1.5
          );
          ctx.stroke();
        }
        if (terrain.tuftTip) {
          ctx.strokeStyle = terrain.tuftTip;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(bx + 4, by - TILE_SIZE * 0.1);
          ctx.lineTo(bx + 5, by - TILE_SIZE * 0.2);
          ctx.stroke();
        }
      }
      // Scattered rock formations
      if (hash2(tx + 9, ty + 4) > 0.93) {
        drawRock(
          ctx,
          sx + TILE_SIZE * 0.28,
          sy + TILE_SIZE * 0.35,
          terrain,
          hash2(tx, ty + 3)
        );
      }
    }

    if (tile === TILE.TREE) {
      const canopy = terrain.treeCanopy || '#3a6a28';
      const canopyLight = terrain.treeCanopyLight || '#4e8a38';
      const trunk = terrain.treeTrunk || '#5a3a1a';
      // Soft ground moss under tree
      ctx.fillStyle = 'rgba(50,90,30,0.35)';
      ctx.beginPath();
      ctx.ellipse(
        sx + TILE_SIZE / 2,
        sy + TILE_SIZE * 0.78,
        TILE_SIZE * 0.38,
        TILE_SIZE * 0.14,
        0,
        0,
        Math.PI * 2
      );
      ctx.fill();
      ctx.fillStyle = canopy;
      ctx.beginPath();
      ctx.arc(sx + TILE_SIZE * 0.38, sy + TILE_SIZE * 0.34, TILE_SIZE * 0.26, 0, Math.PI * 2);
      ctx.arc(sx + TILE_SIZE * 0.62, sy + TILE_SIZE * 0.36, TILE_SIZE * 0.24, 0, Math.PI * 2);
      ctx.arc(sx + TILE_SIZE * 0.5, sy + TILE_SIZE * 0.22, TILE_SIZE * 0.28, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = canopyLight;
      ctx.beginPath();
      ctx.arc(sx + TILE_SIZE * 0.55, sy + TILE_SIZE * 0.2, TILE_SIZE * 0.14, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = trunk;
      ctx.fillRect(
        sx + TILE_SIZE / 2 - TILE_SIZE * 0.07,
        sy + TILE_SIZE * 0.55,
        TILE_SIZE * 0.14,
        TILE_SIZE * 0.32
      );
      ctx.fillStyle = 'rgba(255,220,160,0.12)';
      ctx.fillRect(
        sx + TILE_SIZE / 2 - TILE_SIZE * 0.02,
        sy + TILE_SIZE * 0.55,
        TILE_SIZE * 0.05,
        TILE_SIZE * 0.32
      );
    } else if (tile === TILE.PLANT) {
      ctx.strokeStyle = '#8fd050';
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      const baseY = sy + TILE_SIZE * 0.78;
      ctx.beginPath();
      ctx.moveTo(sx + TILE_SIZE * 0.35, baseY);
      ctx.quadraticCurveTo(
        sx + TILE_SIZE * 0.32,
        sy + TILE_SIZE * 0.45,
        sx + TILE_SIZE * 0.3,
        sy + TILE_SIZE * 0.28
      );
      ctx.moveTo(sx + TILE_SIZE * 0.5, baseY);
      ctx.quadraticCurveTo(
        sx + TILE_SIZE * 0.52,
        sy + TILE_SIZE * 0.42,
        sx + TILE_SIZE * 0.56,
        sy + TILE_SIZE * 0.3
      );
      ctx.moveTo(sx + TILE_SIZE * 0.65, baseY);
      ctx.quadraticCurveTo(
        sx + TILE_SIZE * 0.66,
        sy + TILE_SIZE * 0.48,
        sx + TILE_SIZE * 0.7,
        sy + TILE_SIZE * 0.36
      );
      ctx.stroke();
    } else if (tile === TILE.WATER) {
      const frame = Math.floor((time * 1.2) % 3);
      ctx.fillStyle = terrain.waterHighlight;
      const yOff = frame * (TILE_SIZE * 0.06);
      ctx.fillRect(
        sx + TILE_SIZE * 0.1,
        sy + TILE_SIZE * 0.22 + yOff,
        TILE_SIZE * 0.8,
        TILE_SIZE * 0.06
      );
      ctx.fillRect(
        sx + TILE_SIZE * 0.18,
        sy + TILE_SIZE * 0.45 + ((frame + 1) % 3) * (TILE_SIZE * 0.04),
        TILE_SIZE * 0.6,
        TILE_SIZE * 0.04
      );
      ctx.fillRect(
        sx + TILE_SIZE * 0.14,
        sy + TILE_SIZE * 0.68 + ((frame + 2) % 3) * (TILE_SIZE * 0.03),
        TILE_SIZE * 0.7,
        TILE_SIZE * 0.035
      );
      // Shore foam when adjacent to land
      const shoreDirs = [
        [neighbors.n, 0, 0, TILE_SIZE, TILE_SIZE * 0.18],
        [neighbors.s, 0, TILE_SIZE * 0.82, TILE_SIZE, TILE_SIZE * 0.18],
        [neighbors.w, 0, 0, TILE_SIZE * 0.18, TILE_SIZE],
        [neighbors.e, TILE_SIZE * 0.82, 0, TILE_SIZE * 0.18, TILE_SIZE],
      ];
      ctx.fillStyle = 'rgba(220,240,255,0.18)';
      for (let i = 0; i < shoreDirs.length; i++) {
        const nTile = shoreDirs[i][0];
        if (
          nTile === TILE.GRASS ||
          nTile === TILE.DENSE_GRASS ||
          nTile === TILE.PLANT ||
          nTile === TILE.TREE
        ) {
          ctx.fillRect(
            sx + shoreDirs[i][1],
            sy + shoreDirs[i][2],
            shoreDirs[i][3],
            shoreDirs[i][4]
          );
        }
      }
    } else if (tile === TILE.CLIFF) {
      ctx.fillStyle = terrain.cliffHighlight || '#9a9a90';
      ctx.fillRect(sx + 4, sy + 4, TILE_SIZE - 8, TILE_SIZE * 0.12);
      ctx.fillStyle = terrain.cliffShade || '#4a4a44';
      ctx.fillRect(sx + 4, sy + TILE_SIZE - TILE_SIZE * 0.16, TILE_SIZE - 8, TILE_SIZE * 0.1);
      ctx.fillStyle = 'rgba(0,0,0,0.16)';
      ctx.beginPath();
      ctx.moveTo(sx + TILE_SIZE * 0.12, sy + TILE_SIZE * 0.28);
      ctx.lineTo(sx + TILE_SIZE * 0.42, sy + TILE_SIZE * 0.22);
      ctx.lineTo(sx + TILE_SIZE * 0.55, sy + TILE_SIZE * 0.58);
      ctx.lineTo(sx + TILE_SIZE * 0.18, sy + TILE_SIZE * 0.62);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.beginPath();
      ctx.moveTo(sx + TILE_SIZE * 0.5, sy + TILE_SIZE * 0.3);
      ctx.lineTo(sx + TILE_SIZE * 0.78, sy + TILE_SIZE * 0.26);
      ctx.lineTo(sx + TILE_SIZE * 0.72, sy + TILE_SIZE * 0.5);
      ctx.fill();
    }
  }

  function drawRock(ctx, x, y, terrain, seed) {
    const s = TILE_SIZE / 32;
    ctx.fillStyle = terrain.rockColor;
    ctx.beginPath();
    ctx.moveTo(x, y + 6 * s);
    ctx.lineTo(x + (3 + seed * 4) * s, y);
    ctx.lineTo(x + (10 + seed * 3) * s, y + 2 * s);
    ctx.lineTo(x + 12 * s, y + 8 * s);
    ctx.lineTo(x + 4 * s, y + 10 * s);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = terrain.rockShade;
    ctx.beginPath();
    ctx.moveTo(x + 4 * s, y + 10 * s);
    ctx.lineTo(x + 12 * s, y + 8 * s);
    ctx.lineTo(x + 8 * s, y + 10 * s);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath();
    ctx.moveTo(x + 3 * s, y + 3 * s);
    ctx.lineTo(x + 7 * s, y + 1 * s);
    ctx.lineTo(x + 6 * s, y + 4 * s);
    ctx.fill();
  }

  /**
   * Draw the player as a detailed caveman.
   * Visual size is 2× the invisible hitbox; collision stays at player.w × player.h.
   */
  function drawPlayer(ctx, player, camera) {
    const screen = worldToScreen(camera, player.x, player.y);
    const cx = screen.x + player.w / 2;
    const cy = screen.y + player.h / 2;
    /** Draw scale — twice the hitbox for a larger, more readable figure. */
    const PLAYER_VISUAL_SCALE = 2;
    const s = player.w * PLAYER_VISUAL_SCALE; // 60 when hitbox is 30
    const facing = player.facingX >= 0 ? 1 : -1;
    const phase = player.walkPhase || 0;
    const swing = Math.sin(phase) * 0.55;
    const moving = Math.abs(player.vx) + Math.abs(player.vy) > 2;
    const swinging = (player.swingTimer || 0) > 0;
    const swingDur = player.swingDuration || 0.28;
    // 0 → 1 over the swing; arcs the club forward then slightly back.
    const swingT = swinging ? 1 - player.swingTimer / swingDur : 0;
    const weaponAngle = swinging
      ? -0.85 + Math.sin(swingT * Math.PI) * 2.1
      : 0;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(facing, 1);

    // Shadow under feet
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.ellipse(0, s * 0.44, s * 0.36, s * 0.09, 0, 0, Math.PI * 2);
    ctx.fill();

    // Legs (swing opposite to arms)
    const legLen = s * 0.30;
    const legSwing = moving ? swing : 0;
    ctx.strokeStyle = '#6a4428';
    ctx.lineWidth = s * 0.085;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-s * 0.09, s * 0.10);
    ctx.lineTo(-s * 0.11 - Math.sin(legSwing) * s * 0.14, s * 0.10 + legLen);
    ctx.moveTo(s * 0.09, s * 0.10);
    ctx.lineTo(s * 0.11 + Math.sin(legSwing) * s * 0.14, s * 0.10 + legLen);
    ctx.stroke();

    // Feet
    ctx.fillStyle = '#5a3818';
    ctx.beginPath();
    ctx.ellipse(
      -s * 0.11 - Math.sin(legSwing) * s * 0.14,
      s * 0.10 + legLen + s * 0.02,
      s * 0.08,
      s * 0.035,
      0,
      0,
      Math.PI * 2
    );
    ctx.ellipse(
      s * 0.11 + Math.sin(legSwing) * s * 0.14,
      s * 0.10 + legLen + s * 0.02,
      s * 0.08,
      s * 0.035,
      0,
      0,
      Math.PI * 2
    );
    ctx.fill();

    // Loincloth / fur wrap at hips
    ctx.fillStyle = '#7a4a22';
    ctx.beginPath();
    ctx.moveTo(-s * 0.18, s * 0.10);
    ctx.lineTo(s * 0.18, s * 0.10);
    ctx.lineTo(s * 0.14, s * 0.22);
    ctx.lineTo(0, s * 0.26);
    ctx.lineTo(-s * 0.14, s * 0.22);
    ctx.closePath();
    ctx.fill();
    // Fur fringe
    ctx.strokeStyle = '#5a3414';
    ctx.lineWidth = s * 0.035;
    ctx.beginPath();
    ctx.moveTo(-s * 0.12, s * 0.20);
    ctx.lineTo(-s * 0.14, s * 0.28);
    ctx.moveTo(0, s * 0.24);
    ctx.lineTo(0, s * 0.32);
    ctx.moveTo(s * 0.12, s * 0.20);
    ctx.lineTo(s * 0.14, s * 0.28);
    ctx.stroke();

    // Torso — tan skin with light shoulder highlight
    const skinGrad = ctx.createLinearGradient(0, -s * 0.12, 0, s * 0.16);
    skinGrad.addColorStop(0, '#d4b078');
    skinGrad.addColorStop(0.55, '#c4a06a');
    skinGrad.addColorStop(1, '#a88850');
    ctx.fillStyle = skinGrad;
    ctx.beginPath();
    ctx.moveTo(-s * 0.24, -s * 0.10); // left shoulder
    ctx.lineTo(s * 0.24, -s * 0.10); // right shoulder
    ctx.lineTo(s * 0.18, s * 0.14); // right hip
    ctx.lineTo(-s * 0.18, s * 0.14); // left hip
    ctx.closePath();
    ctx.fill();

    // Chest muscle hint
    ctx.strokeStyle = 'rgba(150, 110, 70, 0.4)';
    ctx.lineWidth = s * 0.03;
    ctx.beginPath();
    ctx.moveTo(-s * 0.08, -s * 0.02);
    ctx.quadraticCurveTo(0, s * 0.04, s * 0.08, -s * 0.02);
    ctx.stroke();
    // Belly shade
    ctx.fillStyle = 'rgba(120, 80, 40, 0.12)';
    ctx.beginPath();
    ctx.ellipse(0, s * 0.08, s * 0.12, s * 0.06, 0, 0, Math.PI * 2);
    ctx.fill();

    // Arms (opposite swing to legs; forward arm follows weapon during attack)
    const armSwing = moving && !swinging ? -swing : 0;
    const frontArmAngle = swinging ? weaponAngle * 0.85 : armSwing;
    ctx.strokeStyle = '#b08958';
    ctx.lineWidth = s * 0.085;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-s * 0.22, -s * 0.06);
    ctx.lineTo(-s * 0.30 - Math.sin(armSwing) * s * 0.16, s * 0.14);
    ctx.moveTo(s * 0.22, -s * 0.06);
    ctx.lineTo(
      s * 0.30 + Math.sin(frontArmAngle) * s * 0.18,
      s * 0.14 - (1 - Math.cos(frontArmAngle)) * s * 0.12
    );
    ctx.stroke();

    // Hands
    const backHandX = -s * 0.30 - Math.sin(armSwing) * s * 0.16;
    const backHandY = s * 0.14;
    const handX = s * 0.30 + Math.sin(frontArmAngle) * s * 0.18;
    const handY = s * 0.14 - (1 - Math.cos(frontArmAngle)) * s * 0.12;
    ctx.fillStyle = '#b08958';
    ctx.beginPath();
    ctx.arc(backHandX, backHandY, s * 0.055, 0, Math.PI * 2);
    ctx.arc(handX, handY, s * 0.055, 0, Math.PI * 2);
    ctx.fill();

    // Wooden club in forward hand (rotates with swing)
    const clubLen = s * 0.32;
    const clubAng = swinging ? -0.65 + weaponAngle : -0.65;
    const clubTipX = handX + Math.cos(clubAng) * clubLen;
    const clubTipY = handY + Math.sin(clubAng) * clubLen;
    ctx.strokeStyle = '#6a4420';
    ctx.lineWidth = s * 0.09;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(handX, handY);
    ctx.lineTo(clubTipX, clubTipY);
    ctx.stroke();
    // Club head (knotty tip)
    ctx.fillStyle = '#5a3818';
    ctx.beginPath();
    ctx.arc(clubTipX, clubTipY, s * 0.09, 0, Math.PI * 2);
    ctx.fill();
    // Wood grain line
    ctx.strokeStyle = 'rgba(40, 24, 8, 0.45)';
    ctx.lineWidth = s * 0.025;
    ctx.beginPath();
    ctx.moveTo(handX + (clubTipX - handX) * 0.15, handY + (clubTipY - handY) * 0.15);
    ctx.lineTo(handX + (clubTipX - handX) * 0.75, handY + (clubTipY - handY) * 0.75);
    ctx.stroke();

    // Head
    const headR = s * 0.175;
    const headY = -s * 0.24;
    ctx.fillStyle = '#d4b08a';
    ctx.beginPath();
    ctx.arc(0, headY, headR, 0, Math.PI * 2);
    ctx.fill();

    // Brow ridge
    ctx.strokeStyle = '#b89068';
    ctx.lineWidth = s * 0.045;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-s * 0.11, headY - s * 0.04);
    ctx.quadraticCurveTo(0, headY - s * 0.07, s * 0.11, headY - s * 0.04);
    ctx.stroke();

    // Messy brown hair clumps
    ctx.fillStyle = '#5a3a1a';
    const hair = [
      [-0.14, -0.18],
      [-0.06, -0.24],
      [0.02, -0.26],
      [0.10, -0.22],
      [0.16, -0.16],
      [-0.10, -0.12],
      [0.08, -0.12],
      [-0.02, -0.28],
      [0.14, -0.10],
    ];
    for (let i = 0; i < hair.length; i++) {
      const hx = hair[i][0] * s;
      const hy = headY + hair[i][1] * s;
      ctx.beginPath();
      ctx.arc(hx, hy, s * 0.055, 0, Math.PI * 2);
      ctx.fill();
    }

    // Ears
    ctx.fillStyle = '#c49870';
    ctx.beginPath();
    ctx.ellipse(-headR * 0.95, headY + s * 0.01, s * 0.04, s * 0.055, 0, 0, Math.PI * 2);
    ctx.ellipse(headR * 0.95, headY + s * 0.01, s * 0.04, s * 0.055, 0, 0, Math.PI * 2);
    ctx.fill();

    // Eyes
    ctx.fillStyle = '#1a120c';
    ctx.beginPath();
    ctx.arc(-s * 0.055, headY - s * 0.01, s * 0.032, 0, Math.PI * 2);
    ctx.arc(s * 0.055, headY - s * 0.01, s * 0.032, 0, Math.PI * 2);
    ctx.fill();
    // Eye whites (tiny highlight)
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.arc(-s * 0.048, headY - s * 0.018, s * 0.012, 0, Math.PI * 2);
    ctx.arc(s * 0.062, headY - s * 0.018, s * 0.012, 0, Math.PI * 2);
    ctx.fill();

    // Nose
    ctx.fillStyle = '#b88860';
    ctx.beginPath();
    ctx.ellipse(s * 0.01, headY + s * 0.04, s * 0.035, s * 0.045, 0.15, 0, Math.PI * 2);
    ctx.fill();

    // Mouth
    ctx.strokeStyle = '#8a6040';
    ctx.lineWidth = s * 0.025;
    ctx.beginPath();
    ctx.arc(0, headY + s * 0.09, s * 0.045, 0.15, Math.PI - 0.15);
    ctx.stroke();

    // Short beard stubble
    ctx.fillStyle = 'rgba(70, 45, 25, 0.45)';
    ctx.beginPath();
    ctx.arc(-s * 0.05, headY + s * 0.11, s * 0.03, 0, Math.PI * 2);
    ctx.arc(0, headY + s * 0.13, s * 0.035, 0, Math.PI * 2);
    ctx.arc(s * 0.05, headY + s * 0.11, s * 0.03, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function updateHud(player) {
    setBar('bar-health', player.hp / player.maxHp);
    setBar('bar-hunger', player.hunger / player.maxHunger);
    setBar('bar-thirst', player.thirst / player.maxThirst);
    setBar('bar-stamina', player.stamina / player.maxStamina);
  }

  /**
   * Draw death backpacks left on the ground (loot piles).
   * @param {CanvasRenderingContext2D} ctx
   * @param {object[]} backpacks
   * @param {object} camera
   * @param {object} [player]
   */
  function drawBackpacks(ctx, backpacks, camera, player) {
    if (!backpacks || !backpacks.length) return;
    for (let i = 0; i < backpacks.length; i++) {
      const bag = backpacks[i];
      if (player && !inViewRadius(player, bag.x, bag.y)) continue;
      const sx = bag.x - camera.x;
      const sy = bag.y - camera.y;
      if (
        sx < -40 ||
        sy < -40 ||
        sx > camera.width + 40 ||
        sy > camera.height + 40
      ) {
        continue;
      }

      ctx.save();
      ctx.translate(sx, sy);

      // Simple hide satchel
      ctx.fillStyle = '#6a4a28';
      ctx.beginPath();
      ctx.moveTo(-10, -4);
      ctx.lineTo(10, -4);
      ctx.lineTo(12, 10);
      ctx.lineTo(-12, 10);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#8a6238';
      ctx.fillRect(-8, -10, 16, 7);

      ctx.strokeStyle = '#3a2814';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-8, -10, 16, 7);
      ctx.beginPath();
      ctx.moveTo(-10, -4);
      ctx.lineTo(10, -4);
      ctx.lineTo(12, 10);
      ctx.lineTo(-12, 10);
      ctx.closePath();
      ctx.stroke();

      // Strap buckle
      ctx.fillStyle = '#c9a227';
      ctx.fillRect(-3, -2, 6, 4);

      ctx.restore();
    }
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
   * @param {object} [view] { time, hoverWorld, showDebug, showHuntLines, player }
   */
  function drawEcosystem(ctx, ecosystem, camera, view) {
    if (!ecosystem) return;
    view = view || {};
    const time = view.time || 0;
    const showHuntLines = !!(view.showHuntLines || view.showDebug);
    const player = view.player || null;
    const radius = getViewRadiusTiles();
    const viewBounds = player ? getViewWorldBounds(player, radius) : null;

    const pad = 48;
    let x0 = camera.x - pad;
    let y0 = camera.y - pad;
    let x1 = camera.x + camera.width + pad;
    let y1 = camera.y + camera.height + pad;
    if (viewBounds) {
      x0 = Math.max(x0, viewBounds.x0);
      y0 = Math.max(y0, viewBounds.y0);
      x1 = Math.min(x1, viewBounds.x1);
      y1 = Math.min(y1, viewBounds.y1);
    }

    const plants = ecosystem.plants;
    for (let i = 0; i < plants.length; i++) {
      const p = plants[i];
      if (!p.alive) continue;
      if (p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) continue;
      drawPlantSprite(ctx, p, camera, time);
    }

    const animals = ecosystem.animals;
    // Pass 1: hunt lines under sprites (hover/debug only)
    if (showHuntLines || view.hoverEntity) {
      for (let i = 0; i < animals.length; i++) {
        const a = animals[i];
        if (!a.alive || a.state === 'DEAD') continue;
        if (a.x < x0 || a.x > x1 || a.y < y0 || a.y > y1) continue;
        const hunting =
          a.diet === 'predator' &&
          (a.state === 'SEEK_FOOD' || a.state === 'SEEK_PREY') &&
          a.target &&
          (a.target.kind === 'animal' || a.target.kind === 'player') &&
          (a.target.kind === 'player'
            ? a.target.alive !== false && (a.target.hp == null || a.target.hp > 0)
            : a.target.alive);
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
    let tx = target.x;
    let ty = target.y;
    if (target.kind === 'player') {
      tx = target.x + (target.w || 0) / 2;
      ty = target.y + (target.h || 0) / 2;
    }
    const b = worldToScreen(camera, tx, ty);
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
  const ENTITY_VISUAL_SCALE = 1.65;

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

  function drawAnimalSprite(ctx, animal, camera, time, ecosystem) {
    const s = worldToScreen(camera, animal.x, animal.y);
    const shapeDef = Wildborn.shapes.getSpeciesDef(animal.species);
    const base = shapeDef ? shapeDef.size : animal.baseSize || animal.size;
    const scale = (animal.size / base) * ENTITY_VISUAL_SCALE;

    // Any westward motion → face west; any eastward motion → face east.
    // Hold last facing when horizontal velocity is zero (idle / vertical-only).
    if (animal.vx < 0) animal._facingRight = false;
    else if (animal.vx > 0) animal._facingRight = true;
    const face = animal._facingRight !== false;

    const speed = Math.hypot(animal.vx || 0, animal.vy || 0);
    // Threshold scaled with doubled movement speeds
    const moving = speed > 8;
    const hunting =
      animal.alive &&
      animal.diet === 'predator' &&
      (animal.state === 'SEEK_FOOD' || animal.state === 'SEEK_PREY') &&
      animal.target &&
      (animal.target.kind === 'animal' || animal.target.kind === 'player') &&
      (animal.target.kind === 'player'
        ? animal.target.alive !== false &&
          (animal.target.hp == null || animal.target.hp > 0)
        : animal.target.alive);
    const fleeing = animal.state === 'FLEE' && !animal._counterAttack;
    const rearUp =
      animal.species === 'bear' &&
      hunting &&
      animal.stateTimer != null &&
      (animal.state === 'SEEK_FOOD' || animal.state === 'SEEK_PREY') &&
      (Math.floor(time * 2) % 5 === 0);
    const sleeping = animal.alive && animal.state === 'SLEEP';

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
        id: animal.id,
        sex: animal.sex,
        isAdult: animal.isAdult,
        moving: moving && !sleeping,
        speed: speed,
        hunting: hunting,
        stalking: false,
        fleeing: fleeing,
        eating: animal.state === 'EATING',
        eatBobPhase: animal.eatBobPhase || 0,
        eatLocked: !!animal.eatLocked,
        eatLockPhase: animal.eatLockPhase || 0,
        roaring: false,
        rearUp: rearUp,
        sleeping: sleeping,
        sleepTilt: animal.sleepTilt || 0,
        zzzParticles: animal.zzzParticles || null,
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
      100;

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
   * Only entities inside the player's view radius can be picked.
   * @returns {object|null}
   */
  function pickEntityAt(ecosystem, camera, screenX, screenY, player) {
    if (!ecosystem) return null;
    const worldX = camera.x + screenX;
    const worldY = camera.y + screenY;
    if (player && !inViewRadius(player, worldX, worldY)) return null;

    let best = null;
    let bestD = 56 * 56;

    const plants = ecosystem.plants;
    for (let i = 0; i < plants.length; i++) {
      const p = plants[i];
      // Allow picking depleted plants for the inspector (respawn timer)
      if (player && !inViewRadius(player, p.x, p.y)) continue;
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
      if (player && !inViewRadius(player, a.x, a.y)) continue;
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
    const plantsMax = stats.plantsMax || Wildborn.ecosystem.INITIAL_PLANT_COUNT || 100;
    lines.push(
      'Plants: ' + stats.plantsAlive + ' / ' + plantsMax +
      (stats.plantsSprouting ? '  waiting ' + stats.plantsSprouting : '') +
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
        const pred = a.diet === 'predator';
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
    drawBackpacks,
    getMinimapLayout,
    getMinimapViewportRect,
    pickEntityAt,
    updateHud,
    setSeedDisplay,
    drawDebug,
    getViewRadiusTiles,
    getViewWorldBounds,
    inViewRadius,
  };
})(typeof window !== 'undefined' ? window : globalThis);
