/**
 * Uniform grid spatial hash for nearby-entity queries.
 * Rebuild each tick — simpler and faster than incremental insert/remove for
 * hundreds of moving agents.
 */
(function (global) {
  const Wildborn = (global.Wildborn = global.Wildborn || {});

  /**
   * @param {number} cellSize world pixels per cell
   */
  function createSpatialGrid(cellSize) {
    cellSize = cellSize || 96;
    /** @type {Map<string, object[]>} */
    let cells = new Map();

    function key(cx, cy) {
      return cx + ',' + cy;
    }

    function clear() {
      cells = new Map();
    }

    /** Insert an entity that has numeric .x / .y fields. */
    function insert(entity) {
      const cx = Math.floor(entity.x / cellSize);
      const cy = Math.floor(entity.y / cellSize);
      const k = key(cx, cy);
      let bucket = cells.get(k);
      if (!bucket) {
        bucket = [];
        cells.set(k, bucket);
      }
      bucket.push(entity);
      entity._cellKey = k;
    }

    /**
     * Query entities whose cell centers fall within radius of (x, y).
     * Exact distance filtering is left to the caller when needed.
     */
    function queryRadius(x, y, radius) {
      const r = radius;
      const cx0 = Math.floor((x - r) / cellSize);
      const cy0 = Math.floor((y - r) / cellSize);
      const cx1 = Math.floor((x + r) / cellSize);
      const cy1 = Math.floor((y + r) / cellSize);
      const out = [];
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          const bucket = cells.get(key(cx, cy));
          if (!bucket) continue;
          for (let i = 0; i < bucket.length; i++) out.push(bucket[i]);
        }
      }
      return out;
    }

    /**
     * Find the nearest entity matching predicate within maxRadius.
     * @returns {object|null}
     */
    function findNearest(x, y, maxRadius, predicate) {
      const candidates = queryRadius(x, y, maxRadius);
      let best = null;
      let bestDist = maxRadius * maxRadius;
      for (let i = 0; i < candidates.length; i++) {
        const e = candidates[i];
        if (predicate && !predicate(e)) continue;
        const dx = e.x - x;
        const dy = e.y - y;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestDist) {
          bestDist = d2;
          best = e;
        }
      }
      return best;
    }

    return {
      cellSize,
      clear,
      insert,
      queryRadius,
      findNearest,
      get cells() {
        return cells;
      },
    };
  }

  Wildborn.spatial = { createSpatialGrid };
})(typeof window !== 'undefined' ? window : globalThis);
