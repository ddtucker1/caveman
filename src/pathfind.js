/**
 * Grid A* pathfinding on the fixed world tilemap.
 * 4-connected; water is blocked unless allowWater is set.
 * Uses a binary min-heap open set and numeric tile keys for speed.
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
    const cfg = Wildborn.config || {};
    const maxNodes = opts.maxNodes || cfg.pathfindMaxNodes || 6000;
    const mapW = world.MAP_TILES || Wildborn.world.MAP_TILES || 400;
    const mapH = world.MAP_TILES || Wildborn.world.MAP_TILES || 400;
    const TILE_SIZE = world.TILE_SIZE || Wildborn.world.TILE_SIZE || 32;

    startTx = clampInt(startTx, 0, mapW - 1);
    startTy = clampInt(startTy, 0, mapH - 1);
    goalTx = clampInt(goalTx, 0, mapW - 1);
    goalTy = clampInt(goalTy, 0, mapH - 1);

    if (startTx === goalTx && startTy === goalTy) return [];

    if (!isWalkable(world, goalTx, goalTy, allowWater)) {
      const alt = nearestWalkable(world, goalTx, goalTy, allowWater, 6);
      if (!alt) return null;
      goalTx = alt.tx;
      goalTy = alt.ty;
      if (startTx === goalTx && startTy === goalTy) return [];
    }

    // Binary min-heap of { tx, ty, f }; parallel best-f map by numeric key.
    const heap = [];
    const openBest = new Map();
    const cameFrom = new Map();
    const gScore = new Map();

    function key(tx, ty) {
      return ty * mapW + tx;
    }

    function heuristic(tx, ty) {
      return Math.abs(tx - goalTx) + Math.abs(ty - goalTy);
    }

    function heapPush(node) {
      heap.push(node);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p].f <= heap[i].f) break;
        const tmp = heap[p];
        heap[p] = heap[i];
        heap[i] = tmp;
        i = p;
      }
    }

    function heapPop() {
      const top = heap[0];
      const last = heap.pop();
      if (heap.length === 0) return top;
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let smallest = i;
        if (l < heap.length && heap[l].f < heap[smallest].f) smallest = l;
        if (r < heap.length && heap[r].f < heap[smallest].f) smallest = r;
        if (smallest === i) break;
        const tmp = heap[i];
        heap[i] = heap[smallest];
        heap[smallest] = tmp;
        i = smallest;
      }
      return top;
    }

    function pushOpen(tx, ty, g, f) {
      const k = key(tx, ty);
      const prev = openBest.get(k);
      if (prev != null && prev <= f) return;
      openBest.set(k, f);
      gScore.set(k, g);
      heapPush({ tx: tx, ty: ty, f: f });
    }

    pushOpen(startTx, startTy, 0, heuristic(startTx, startTy));

    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    let expanded = 0;
    const goalKey = key(goalTx, goalTy);

    while (heap.length && expanded < maxNodes) {
      const cur = heapPop();
      const ck = key(cur.tx, cur.ty);
      // Stale heap entry (better path already known)
      const bestF = openBest.get(ck);
      if (bestF != null && cur.f > bestF) continue;
      expanded++;

      if (ck === goalKey) {
        return reconstruct(cameFrom, cur.tx, cur.ty, TILE_SIZE, mapW);
      }

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

  function reconstruct(cameFrom, tx, ty, TILE_SIZE, mapW) {
    const tiles = [{ tx: tx, ty: ty }];
    let k = ty * mapW + tx;
    while (cameFrom.has(k)) {
      k = cameFrom.get(k);
      const txx = k % mapW;
      const tyy = (k / mapW) | 0;
      tiles.push({ tx: txx, ty: tyy });
    }
    tiles.reverse();
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
