/**
 * Wildborn — main entry.
 * Phase 1: menu → seeded world → player movement → camera → render loop.
 * Ecosystem: plants / herbivores / predators (toggle via Wildborn.config).
 */
(function () {
  const config = Wildborn.config;
  const { createRng, randomSeedString } = Wildborn.rng;
  const { createWorld, TILE_SIZE, MAP_PIXEL_SIZE } = Wildborn.world;
  const { createPlayer, updatePlayer, findSpawn, tryPlayerAttack } = Wildborn.player;
  const {
    createCamera,
    updateCamera,
    snapCamera,
    clampCameraToMap,
  } = Wildborn.camera;
  const {
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
  } = Wildborn.render;
  const { createEcosystem } = Wildborn.ecosystem;

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  /** @type {'menu' | 'playing'} */
  let state = 'menu';

  const game = {
    seedString: '',
    rng: null,
    world: null,
    player: null,
    camera: null,
    ecosystem: null,
    keys: { up: false, down: false, left: false, right: false },
    lastTime: 0,
    fps: 0,
    fpsAccum: 0,
    fpsFrames: 0,
    showEcosystemDebug: !!config.ecosystemDebugOverlay,
    showLegend: !!config.showLegend,
    showCensus: !!config.showCensus,
    censusRefreshAccum: 0,
    mouseX: 0,
    mouseY: 0,
    hoverEntity: null,
    /** Entity currently shown in the inspector popup (follows entity). */
    inspectEntity: null,
    time: 0,
    /** Global sim speed multiplier (1 or 3). */
    speed: config.gameSpeed || 1,
    /** Active minimap viewport drag (null when idle). */
    minimapDrag: null,
  };

  // ---------------------------------------------------------------------------
  // Ecosystem Census popup (Tab / top-right button)
  // ---------------------------------------------------------------------------

  const CENSUS_ICONS = {
    berry_bush: '🌿',
    grass: '🌿',
    mushroom: '🍄',
    fruit_tree: '🌳',
    cactus: '🌵',
    rabbit: '🐇',
    deer: '🦌',
    bison: '🦬',
    ostrich: '🦤',
    turtle: '🐢',
    wolf: '🐺',
    bear: '🐻',
    alligator: '🐊',
  };

  const btnCensus = document.getElementById('btn-census');
  const censusWindow = document.getElementById('census-window');
  const censusClose = document.getElementById('census-close');
  const censusTitlebar = document.getElementById('census-titlebar');
  const censusPlantRows = document.getElementById('census-plant-rows');
  const censusAnimalRows = document.getElementById('census-animal-rows');

  function censusRowHtml(id, label, count) {
    const icon = CENSUS_ICONS[id] || '•';
    return (
      '<div class="census-row">' +
      '<span class="census-icon">' + icon + '</span>' +
      '<span class="census-name">' + label + '</span>' +
      '<span class="census-count">' + count + '</span>' +
      '</div>'
    );
  }

  function refreshCensus() {
    if (!game.ecosystem || !censusPlantRows || !censusAnimalRows) return;

    const plants = Wildborn.shapes.listSpeciesByCategory('plant');
    const herbs = Wildborn.shapes.listSpeciesByCategory('herbivore');
    const preds = Wildborn.shapes.listSpeciesByCategory('predator');
    const stats = game.ecosystem.getDebugStats();

    const plantCounts = {};
    for (let i = 0; i < plants.length; i++) plantCounts[plants[i].id] = 0;
    for (let i = 0; i < game.ecosystem.plants.length; i++) {
      const p = game.ecosystem.plants[i];
      if (p.alive) plantCounts[p.species] = (plantCounts[p.species] || 0) + 1;
    }

    let plantHtml = '';
    for (let i = 0; i < plants.length; i++) {
      const id = plants[i].id;
      plantHtml += censusRowHtml(id, plants[i].def.label, plantCounts[id] || 0);
    }
    censusPlantRows.innerHTML = plantHtml;

    let animalHtml = '';
    for (let i = 0; i < herbs.length; i++) {
      const id = herbs[i].id;
      const n = (stats.herbivores && stats.herbivores[id]) || 0;
      animalHtml += censusRowHtml(id, herbs[i].def.label, n);
    }
    animalHtml += '<hr class="census-sep" />';
    for (let i = 0; i < preds.length; i++) {
      const id = preds[i].id;
      const n = (stats.predators && stats.predators[id]) || 0;
      animalHtml += censusRowHtml(id, preds[i].def.label, n);
    }
    censusAnimalRows.innerHTML = animalHtml;
  }

  function resetCensusPosition() {
    if (!censusWindow) return;
    censusWindow.style.left = '';
    censusWindow.style.top = '112px';
    censusWindow.style.right = '12px';
  }

  // ---------------------------------------------------------------------------
  // Game speed (3× toggle)
  // ---------------------------------------------------------------------------

  const btnSpeed = document.getElementById('btn-speed');

  function syncSpeedButton() {
    if (!btnSpeed) return;
    const fast = game.speed >= 3;
    btnSpeed.textContent = fast ? 'Speed 1×' : 'Speed 3×';
    btnSpeed.classList.toggle('active', fast);
    btnSpeed.title = fast ? 'Return to normal speed' : 'Run game at 3× speed';
  }

  function setGameSpeed(speed) {
    game.speed = speed;
    config.gameSpeed = speed;
    syncSpeedButton();
  }

  function toggleGameSpeed() {
    setGameSpeed(game.speed >= 3 ? 1 : 3);
  }

  if (btnSpeed) {
    btnSpeed.addEventListener('click', function (e) {
      e.preventDefault();
      toggleGameSpeed();
    });
  }

  function setCensusVisible(visible) {
    game.showCensus = !!visible;
    config.showCensus = game.showCensus;
    if (!censusWindow) return;
    if (game.showCensus) {
      censusWindow.classList.remove('hidden');
      refreshCensus();
      game.censusRefreshAccum = 0;
    } else {
      censusWindow.classList.add('hidden');
    }
  }

  function toggleCensus() {
    setCensusVisible(!game.showCensus);
  }

  if (btnCensus) {
    btnCensus.addEventListener('click', function (e) {
      e.preventDefault();
      toggleCensus();
    });
  }
  if (censusClose) {
    censusClose.addEventListener('click', function (e) {
      e.preventDefault();
      setCensusVisible(false);
    });
  }

  // Drag census window by title bar
  (function setupCensusDrag() {
    if (!censusWindow || !censusTitlebar) return;
    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;

    censusTitlebar.addEventListener('mousedown', function (e) {
      if (e.target === censusClose) return;
      dragging = true;
      const rect = censusWindow.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      censusWindow.style.right = 'auto';
      e.preventDefault();
    });

    window.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      const maxX = window.innerWidth - censusWindow.offsetWidth;
      const maxY = window.innerHeight - censusWindow.offsetHeight;
      const x = Math.max(0, Math.min(maxX, e.clientX - offsetX));
      const y = Math.max(0, Math.min(maxY, e.clientY - offsetY));
      censusWindow.style.left = x + 'px';
      censusWindow.style.top = y + 'px';
    });

    window.addEventListener('mouseup', function () {
      dragging = false;
    });
  })();

  // ---------------------------------------------------------------------------
  // Entity Inspector popup (click plant/animal)
  // ---------------------------------------------------------------------------

  const inspectorWindow = document.getElementById('inspector-window');
  const inspectorTitlebar = document.getElementById('inspector-titlebar');
  const inspectorTitle = document.getElementById('inspector-title');
  const inspectorBody = document.getElementById('inspector-body');
  const inspectorClose = document.getElementById('inspector-close');

  function inspRow(label, value) {
    return (
      '<div class="insp-row">' +
      '<span class="insp-label">' + label + '</span>' +
      '<span class="insp-value">' + value + '</span>' +
      '</div>'
    );
  }

  function inspectorTypeClass(entity) {
    if (!entity) return 'plant';
    if (entity.kind === 'plant') return 'plant';
    if (entity.diet === 'predator') return 'predator';
    return 'herbivore';
  }

  function countAnimalsEatingPlant(plant, ecosystem) {
    if (!ecosystem || !plant) return 0;
    let n = 0;
    const animals = ecosystem.animals;
    for (let i = 0; i < animals.length; i++) {
      const a = animals[i];
      if (
        a.alive &&
        a.state === 'EATING' &&
        a.target &&
        a.target.kind === 'plant' &&
        a.target.id === plant.id
      ) {
        n++;
      }
    }
    return n;
  }

  function formatInspectState(entity) {
    if (entity.kind === 'plant') {
      if (!entity.alive) {
        const tickSec =
          (game.ecosystem && game.ecosystem.tickSeconds) ||
          config.ecosystemTickSeconds ||
          0.5;
        const secs = Math.max(0, Math.ceil((entity.respawnTimer || 0) * tickSec));
        return 'Depleted (respawning in ' + secs + 's)';
      }
      if (countAnimalsEatingPlant(entity, game.ecosystem) > 0) return 'Being Eaten';
      return 'Growing';
    }
    const s = entity.state;
    if (s === 'DEAD') return 'Dead';
    if (s === 'SLEEP') return 'Sleeping';
    if (s === 'EATING') return 'Eating';
    if (s === 'FLEE') return entity._counterAttack ? 'Attacking' : 'Fleeing';
    if (s === 'SEEK_PREY' || entity._hunting) {
      if (entity.target && entity.target.kind === 'player') return 'Hunting player';
      return 'Hunting';
    }
    if (s === 'SEEK_FOOD' || entity._hungerSearch) return 'Searching for Food';
    if (s === 'ROAM') return 'Roaming';
    if (s === 'IDLE') return 'Idle';
    return s || 'Idle';
  }

  function buildInspectorHtml(entity) {
    if (!entity) return '';
    const def = Wildborn.shapes.getSpeciesDef(entity.species);
    const name = (def && def.label) || entity.label || entity.species;
    const tickSec =
      (game.ecosystem && game.ecosystem.tickSeconds) ||
      config.ecosystemTickSeconds ||
      0.5;
    let html = '';

    if (entity.kind === 'plant') {
      const eaters = countAnimalsEatingPlant(entity, game.ecosystem);
      const respawnSec =
        !entity.alive && entity.respawnTimer > 0
          ? Math.ceil(entity.respawnTimer * tickSec)
          : 0;
      html += inspRow('Calories', Math.round(entity.calories) + ' / ' + Math.round(entity.maxCalories));
      html += inspRow('Status', formatInspectState(entity));
      if (respawnSec > 0) html += inspRow('Respawn in', respawnSec + 's');
      html += inspRow('Animals eating', String(eaters));
      return { name: name, html: html };
    }

    const burnPerTick =
      Wildborn.animal && typeof Wildborn.animal.calorieBurnPerTick === 'function'
        ? Wildborn.animal.calorieBurnPerTick(entity)
        : 0;
    const burnPerSec = burnPerTick / tickSec;
    const cooldownTicks = entity.breedingCooldown || 0;
    const cooldownSec = Math.ceil(cooldownTicks * tickSec);
    const repro = cooldownTicks <= 0 ? 'ready' : cooldownSec + 's remaining';
    const curSpeed = Math.hypot(entity.vx || 0, entity.vy || 0);
    const maxSpeed = entity.baseSpeed != null ? entity.baseSpeed : 0;

    html += inspRow('Calories', Math.round(entity.calories) + ' / ' + Math.round(entity.maxCalories));
    html += inspRow('Burn rate', burnPerSec.toFixed(2) + ' cal/s');
    html += inspRow('State', formatInspectState(entity));
    html += inspRow('Reproduction', repro);
    html += inspRow('Speed', curSpeed.toFixed(1) + ' / ' + maxSpeed.toFixed(1));

    if (entity.diet === 'predator') {
      html += inspRow('Hunt threshold', '50%');
      let targetName = '—';
      if (
        (entity._hunting || entity.state === 'SEEK_PREY' || entity.state === 'SEEK_FOOD') &&
        entity.target
      ) {
        if (entity.target.kind === 'player') {
          targetName = 'Caveman';
        } else if (entity.target.kind === 'animal') {
          const tDef = Wildborn.shapes.getSpeciesDef(entity.target.species);
          targetName =
            (tDef && tDef.label) ||
            entity.target.label ||
            entity.target.species ||
            '—';
        }
      }
      html += inspRow('Hunt target', targetName);
    }

    return { name: name, html: html };
  }

  function closeInspector() {
    game.inspectEntity = null;
    if (inspectorWindow) inspectorWindow.classList.add('hidden');
  }

  function openInspector(entity) {
    if (!entity || !inspectorWindow) {
      closeInspector();
      return;
    }
    game.inspectEntity = entity;
    inspectorWindow.classList.remove('hidden');
    refreshInspector();
    positionInspector();
  }

  function refreshInspector() {
    if (!game.inspectEntity || !inspectorBody || !inspectorTitle) return;
    const entity = game.inspectEntity;
    // Drop inspector if entity was removed
    if (entity.kind === 'animal' && game.ecosystem) {
      const stillThere = game.ecosystem.animals.indexOf(entity) >= 0;
      if (!stillThere) {
        closeInspector();
        return;
      }
    }
    const built = buildInspectorHtml(entity);
    inspectorTitle.textContent = built.name;
    if (inspectorTitlebar) {
      inspectorTitlebar.classList.remove('plant', 'herbivore', 'predator');
      inspectorTitlebar.classList.add(inspectorTypeClass(entity));
    }
    inspectorBody.innerHTML = built.html;
  }

  function positionInspector() {
    if (!game.inspectEntity || !inspectorWindow || !game.camera) return;
    const entity = game.inspectEntity;
    const screen = Wildborn.camera.worldToScreen(game.camera, entity.x, entity.y);
    const pad = 12;
    const boxW = inspectorWindow.offsetWidth || 260;
    const boxH = inspectorWindow.offsetHeight || 180;
    let x = screen.x + 18;
    let y = screen.y - boxH * 0.35;
    if (x + boxW > window.innerWidth - pad) x = screen.x - boxW - 18;
    if (y < pad) y = pad;
    if (y + boxH > window.innerHeight - pad) y = window.innerHeight - boxH - pad;
    if (x < pad) x = pad;
    inspectorWindow.style.left = Math.round(x) + 'px';
    inspectorWindow.style.top = Math.round(y) + 'px';
  }

  if (inspectorClose) {
    inspectorClose.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      closeInspector();
    });
  }
  if (inspectorWindow) {
    inspectorWindow.addEventListener('mousedown', function (e) {
      e.stopPropagation();
    });
    inspectorWindow.addEventListener('click', function (e) {
      e.stopPropagation();
    });
  }

  // ---------------------------------------------------------------------------
  // Canvas sizing (CSS pixels via setTransform)
  // ---------------------------------------------------------------------------

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (game.camera) {
      game.camera.width = window.innerWidth;
      game.camera.height = window.innerHeight;
    }
  }

  window.addEventListener('resize', resize);
  resize();

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------

  const KEY_MAP = {
    KeyW: 'up', ArrowUp: 'up',
    KeyS: 'down', ArrowDown: 'down',
    KeyA: 'left', ArrowLeft: 'left',
    KeyD: 'right', ArrowRight: 'right',
  };

  window.addEventListener('keydown', function (e) {
    const dir = KEY_MAP[e.code];
    if (dir) {
      game.keys[dir] = true;
      // Player movement re-centers the camera after a minimap pan.
      if (game.camera) game.camera.followPlayer = true;
      e.preventDefault();
      return;
    }

    // F3 — toggle ecosystem debug overlay
    if (e.code === 'F3') {
      game.showEcosystemDebug = !game.showEcosystemDebug;
      config.ecosystemDebugOverlay = game.showEcosystemDebug;
      e.preventDefault();
      return;
    }

    // L — toggle species legend
    if (e.code === 'KeyL' && state === 'playing') {
      game.showLegend = !game.showLegend;
      config.showLegend = game.showLegend;
      e.preventDefault();
      return;
    }

    // Tab — toggle Ecosystem Census
    if (e.code === 'Tab' && state === 'playing') {
      toggleCensus();
      e.preventDefault();
      return;
    }

    // ESC — close entity inspector
    if (e.code === 'Escape' && state === 'playing' && game.inspectEntity) {
      closeInspector();
      e.preventDefault();
    }
  });

  window.addEventListener('keyup', function (e) {
    const dir = KEY_MAP[e.code];
    if (dir) {
      game.keys[dir] = false;
      e.preventDefault();
    }
  });

  function pointInRect(px, py, r) {
    return px >= r.x && py >= r.y && px <= r.x + r.w && py <= r.y + r.h;
  }

  function applyMinimapCameraFromPointer(mx, my) {
    if (!game.camera || !game.world || !game.minimapDrag) return;
    const layout = getMinimapLayout(window.innerWidth, window.innerHeight, game.world);
    const scale = layout.size / layout.mapPx;
    const centerX = (mx - layout.x) / scale;
    const centerY = (my - layout.y) / scale;
    game.camera.x = centerX - game.minimapDrag.grabOffsetX / scale;
    game.camera.y = centerY - game.minimapDrag.grabOffsetY / scale;
    game.camera.followPlayer = false;
    clampCameraToMap(game.camera, MAP_PIXEL_SIZE);
  }

  canvas.addEventListener('mousemove', function (e) {
    const rect = canvas.getBoundingClientRect();
    game.mouseX = e.clientX - rect.left;
    game.mouseY = e.clientY - rect.top;

    if (game.minimapDrag) {
      applyMinimapCameraFromPointer(game.mouseX, game.mouseY);
      // Grabbing the view rect — show move cursor
      canvas.style.cursor = 'move';
      return;
    }

    if (
      state === 'playing' &&
      config.showMinimap !== false &&
      game.world &&
      game.camera
    ) {
      const layout = getMinimapLayout(window.innerWidth, window.innerHeight, game.world);
      const vp = getMinimapViewportRect(layout, game.camera);
      canvas.style.cursor = pointInRect(game.mouseX, game.mouseY, vp)
        ? 'move'
        : 'crosshair';
    }
  });

  canvas.addEventListener('mousedown', function (e) {
    if (state !== 'playing') return;

    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    // Minimap drag (left button only)
    if (
      e.button === 0 &&
      config.showMinimap !== false &&
      game.world &&
      game.camera
    ) {
      const layout = getMinimapLayout(window.innerWidth, window.innerHeight, game.world);
      const vp = getMinimapViewportRect(layout, game.camera);
      if (pointInRect(mx, my, vp)) {
        game.minimapDrag = {
          grabOffsetX: mx - vp.x,
          grabOffsetY: my - vp.y,
        };
        game.camera.followPlayer = false;
        canvas.style.cursor = 'move';
        e.preventDefault();
        return;
      }
    }

    // Left click — swing weapon / attack nearby animals
    if (e.button === 0 && game.player && game.player.alive) {
      // Ignore clicks on the minimap body (not just the viewport rect)
      if (config.showMinimap !== false && game.world && game.camera) {
        const layout = getMinimapLayout(window.innerWidth, window.innerHeight, game.world);
        if (
          mx >= layout.x &&
          my >= layout.y &&
          mx <= layout.x + layout.size &&
          my <= layout.y + layout.size
        ) {
          return;
        }
      }
      tryPlayerAttack(game.player, game.ecosystem);
      e.preventDefault();
    }
  });

  window.addEventListener('mouseup', function () {
    if (game.minimapDrag) {
      game.minimapDrag = null;
      if (state === 'playing') canvas.style.cursor = 'crosshair';
    }
  });

  // Right-click — inspect entity under cursor
  canvas.addEventListener('contextmenu', function (e) {
    e.preventDefault();
    if (state !== 'playing' || !game.ecosystem || !config.ecosystemEnabled) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    if (config.showMinimap !== false && game.world && game.camera) {
      const layout = getMinimapLayout(window.innerWidth, window.innerHeight, game.world);
      if (
        mx >= layout.x &&
        my >= layout.y &&
        mx <= layout.x + layout.size &&
        my <= layout.y + layout.size
      ) {
        return;
      }
    }

    const hit = pickEntityAt(
      game.ecosystem,
      game.camera,
      mx,
      my,
      game.player
    );
    if (hit) {
      openInspector(hit);
    } else {
      closeInspector();
    }
  });

  // ---------------------------------------------------------------------------
  // Menu
  // ---------------------------------------------------------------------------

  const menuEl = document.getElementById('menu');
  const seedInput = document.getElementById('seed-input');
  const btnStart = document.getElementById('btn-start');
  const btnRandom = document.getElementById('btn-random');

  btnRandom.addEventListener('click', function () {
    seedInput.value = randomSeedString();
  });

  btnStart.addEventListener('click', function () {
    const seed = seedInput.value.trim() || randomSeedString();
    startGame(seed);
  });

  seedInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') btnStart.click();
  });

  seedInput.value = randomSeedString();

  // ---------------------------------------------------------------------------
  // Game start / loop
  // ---------------------------------------------------------------------------

  function startGame(seedString) {
    game.seedString = seedString;
    game.rng = createRng(seedString);
    game.world = createWorld(seedString);
    game.camera = createCamera({
      width: window.innerWidth,
      height: window.innerHeight,
    });

    // Lock the playable world to the fixed 400×400 map (25600×25600 px)
    if (game.world.ensureMapLoaded) {
      game.world.ensureMapLoaded();
    } else {
      game.world.ensureChunksInBounds(0, 0, MAP_PIXEL_SIZE - 1, MAP_PIXEL_SIZE - 1);
    }
    const spawn = findSpawn(game.world);
    game.player = createPlayer(spawn);

    // Living ecosystem (optional — config.ecosystemEnabled)
    game.ecosystem = null;
    if (config.ecosystemEnabled) {
      game.ecosystem = createEcosystem({
        world: game.world,
        rng: game.rng,
        config: config,
        origin: { x: spawn.x, y: spawn.y },
      });
    }

    snapCamera(game.camera, game.player, MAP_PIXEL_SIZE);
    setSeedDisplay(seedString);
    updateHud(game.player);

    if (btnCensus) btnCensus.classList.remove('hidden');
    if (btnSpeed) btnSpeed.classList.remove('hidden');
    syncSpeedButton();
    resetCensusPosition();
    setCensusVisible(!!config.showCensus);
    closeInspector();
    game.minimapDrag = null;
    if (game.camera) game.camera.followPlayer = true;

    menuEl.classList.add('hidden');
    state = 'playing';
    game.lastTime = performance.now();
    game.time = 0;
  }

  function update(dt) {
    // Cap raw frame dt, then apply global speed so 3× still stays stable.
    const step = Math.min(dt, 0.05) * (game.speed || 1);
    game.time += step;

    updatePlayer(game.player, game.keys, step, game.world);
    updateCamera(game.camera, game.player, MAP_PIXEL_SIZE);

    // Keep the whole fixed map loaded (49 chunks at 400×400 / 64)
    if (game.world.ensureMapLoaded) {
      game.world.ensureMapLoaded();
    } else {
      const bounds = getVisibleBounds(game.camera, TILE_SIZE * 2);
      game.world.ensureChunksInBounds(bounds.x0, bounds.y0, bounds.x1, bounds.y1);
    }

    if (game.ecosystem && config.ecosystemEnabled) {
      // Pass player focus so far animals can use cheaper sim LOD.
      game.ecosystem.update(step, game.player);
      game.hoverEntity = pickEntityAt(
        game.ecosystem,
        game.camera,
        game.mouseX,
        game.mouseY,
        game.player
      );
    } else {
      game.hoverEntity = null;
    }

    if (game.showCensus && game.ecosystem) {
      game.censusRefreshAccum += step;
      if (game.censusRefreshAccum >= 2) {
        game.censusRefreshAccum = 0;
        refreshCensus();
      }
    }

    if (game.inspectEntity) {
      refreshInspector();
      positionInspector();
    }

    updateHud(game.player);
  }

  function render() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    clear(ctx, w, h);
    drawWorld(ctx, game.world, game.camera, game.time, game.player);

    if (game.ecosystem && config.ecosystemEnabled) {
      drawEcosystem(ctx, game.ecosystem, game.camera, {
        time: game.time,
        showDebug: game.showEcosystemDebug,
        showHuntLines: game.showEcosystemDebug,
        hoverEntity: game.hoverEntity,
        player: game.player,
      });
    }

    drawPlayer(ctx, game.player, game.camera);

    const playerTx = Math.floor(game.player.x / TILE_SIZE);
    const playerTy = Math.floor(game.player.y / TILE_SIZE);
    drawDebug(ctx, {
      fps: game.fps,
      chunkCount: game.world.chunks.size,
      playerTx: playerTx,
      playerTy: playerTy,
    });

    if (game.showEcosystemDebug && game.ecosystem) {
      drawEcosystemDebug(ctx, game.ecosystem.getDebugStats());
    }

    if (game.showLegend && game.ecosystem) {
      drawLegend(ctx, game.ecosystem, game.ecosystem.getDebugStats());
    }

    if (game.hoverEntity) {
      drawTooltip(ctx, game.hoverEntity, game.mouseX, game.mouseY);
    }

    if (config.showMinimap !== false && game.world) {
      drawMinimap(ctx, game.world, game.player, game.ecosystem, w, h, game.camera);
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    if (state !== 'playing') return;

    const dt = (now - game.lastTime) / 1000;
    game.lastTime = now;

    game.fpsAccum += dt;
    game.fpsFrames += 1;
    if (game.fpsAccum >= 0.5) {
      game.fps = Math.round(game.fpsFrames / game.fpsAccum);
      game.fpsAccum = 0;
      game.fpsFrames = 0;
    }

    update(dt);
    render();
  }

  requestAnimationFrame(frame);

  // Console access for verification / testing
  window.__wildborn = game;
})();
