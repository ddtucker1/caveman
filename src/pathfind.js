/**
 * Grid A* pathfinding on the fixed world tilemap.
 * 4-connected; water is blocked unless allowWater is set.
 */
(function (global) {
  const Wildborn = (global.Wildborn = global.Wildborn || {});

  /**
   * @param {object} world
   * @param {number} startTx
   * @param {number} startTy
   * @param {number} goalTx
   * @param {number} goalTy
   * @param {{ allowWater?: boolean, maxNodes?: number }} [opts]
   * @returns {{x:number,y:number}[]|null} pixel-center waypoints (excluding start)
   */
  function findPath(world, startTx, startTy, goalTx, goalTy, opts) {
    opts = opts || {};
    const allowWater = !!opts.allowWater;
    // 400×400 map: allow longer paths (Manhattan up to ~800 tiles)
    const maxNodes = opts.maxNodes || 48000;
    const mapW = world.MAP_TILES || Wildborn.world.MAP_TILES || 400;
    const mapH = world.MAP_TILES || Wildborn.world.MAP_TILES || 400;
    const TILE_SIZE = world.TILE_SIZE || Wildborn.world.TILE_SIZE || 32;

    startTx = clampInt(startTx, 0, mapW - 1);
    startTy = clampInt(startTy, 0, mapH - 1);
    goalTx = clampInt(goalTx, 0, mapW - 1);
    goalTy = clampInt(goalTy, 0, mapH - 1);

    if (startTx === goalTx && startTy === goalTy) return [];

    if (!isWalkable(world, goalTx, goalTy, allowWater)) {
      // Soften goal: nearest walkable around target
      const alt = nearestWalkable(world, goalTx, goalTy, allowWater, 6);
      if (!alt) return null;
      goalTx = alt.tx;
      goalTy = alt.ty;
      if (startTx === goalTx && startTy === goalTy) return [];
    }

    const open = [];
    const openSet = new Map();
    const cameFrom = new Map();
    const gScore = new Map();

    function key(tx, ty) {
      return tx + ',' + ty;
    }

    function heuristic(tx, ty) {
      return Math.abs(tx - goalTx) + Math.abs(ty - goalTy);
    }

    function pushOpen(tx, ty, g, f) {
      const k = key(tx, ty);
      const prev = openSet.get(k);
      if (prev != null && prev <= f) return;
      openSet.set(k, f);
      open.push({ tx: tx, ty: ty, f: f });
      gScore.set(k, g);
    }

    function popOpen() {
      let bestI = 0;
      let bestF = open[0].f;
      for (let i = 1; i < open.length; i++) {
        if (open[i].f < bestF) {
          bestF = open[i].f;
          bestI = i;
        }
      }
      const node = open[bestI];
      open[bestI] = open[open.length - 1];
      open.pop();
      openSet.delete(key(node.tx, node.ty));
      return node;
    }

    pushOpen(startTx, startTy, 0, heuristic(startTx, startTy));

    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    let expanded = 0;

    while (open.length && expanded < maxNodes) {
      const cur = popOpen();
      expanded++;
      if (cur.tx === goalTx && cur.ty === goalTy) {
        return reconstruct(cameFrom, cur.tx, cur.ty, TILE_SIZE);
      }

      const ck = key(cur.tx, cur.ty);
      const gCur = gScore.get(ck);
      for (let i = 0; i < dirs.length; i++) {
        const nx = cur.tx + dirs[i][0];
        const ny = cur.ty + dirs[i][1];
        if (nx < 0 || ny < 0 || nx >= mapW || ny >= mapH) continue;
        if (!isWalkable(world, nx, ny, allowWater)) continue;
        const nk = key(nx, ny);
        const tentative = gCur + 1;
        if (gScore.has(nk) && tentative >= gScore.get(nk)) continue;
        cameFrom.set(nk, ck);
        pushOpen(nx, ny, tentative, tentative + heuristic(nx, ny));
      }
    }

    return null;
  }

  function reconstruct(cameFrom, tx, ty, TILE_SIZE) {
    const tiles = [{ tx: tx, ty: ty }];
    let k = tx + ',' + ty;
    while (cameFrom.has(k)) {
      k = cameFrom.get(k);
      const parts = k.split(',');
      tiles.push({ tx: +parts[0], ty: +parts[1] });
    }
    tiles.reverse();
    // Drop start tile; return pixel centers
    const out = [];
    for (let i = 1; i < tiles.length; i++) {
      out.push({
        x: tiles[i].tx * TILE_SIZE + TILE_SIZE / 2,
        y: tiles[i].ty * TILE_SIZE + TILE_SIZE / 2,
      });
    }
    return out;
  }

  function isWalkable(world, tx, ty, allowWater) {
    const tile = world.getTile(tx, ty);
    if (world.isSolid(tile)) return false;
    if (world.isSlow(tile) && !allowWater) return false;
    return true;
  }

  function nearestWalkable(world, tx, ty, allowWater, maxR) {
    const mapW = world.MAP_TILES || 400;
    const mapH = world.MAP_TILES || 400;
    for (let r = 0; r <= maxR; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r && r > 0) continue;
          const nx = tx + dx;
          const ny = ty + dy;
          if (nx < 0 || ny < 0 || nx >= mapW || ny >= mapH) continue;
          if (isWalkable(world, nx, ny, allowWater)) return { tx: nx, ty: ny };
        }
      }
    }
    return null;
  }

  function clampInt(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v | 0));
  }

  /**
   * Build / refresh a path for an entity toward a world-pixel target.
   * @returns {{x:number,y:number}[]|null}
   */
  function pathToPixel(world, fromX, fromY, toX, toY, opts) {
    const TILE_SIZE = world.TILE_SIZE || 32;
    const stx = Math.floor(fromX / TILE_SIZE);
    const sty = Math.floor(fromY / TILE_SIZE);
    const gtx = Math.floor(toX / TILE_SIZE);
    const gty = Math.floor(toY / TILE_SIZE);
    return findPath(world, stx, sty, gtx, gty, opts);
  }

  Wildborn.pathfind = {
    findPath,
    pathToPixel,
    isWalkable,
  };
})(typeof window !== 'undefined' ? window : globalThis);
