/**
 * Wildborn — main entry.
 * Phase 1: menu → seeded world → player movement → camera → render loop.
 * Ecosystem: plants / herbivores / predators (toggle via Wildborn.config).
 */
(function () {
  const config = Wildborn.config;
  const { createRng, randomSeedString } = Wildborn.rng;
  const { createWorld, TILE_SIZE, MAP_PIXEL_SIZE } = Wildborn.world;
  const { createPlayer, updatePlayer, findSpawn } = Wildborn.player;
  const {
    createCamera,
    updateCamera,
    snapCamera,
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
    time: 0,
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
    cow: '🐄',
    raccoon: '🦝',
    bison: '🦬',
    ostrich: '🦤',
    turtle: '🐢',
    lizard: '🦎',
    wolf: '🐺',
    lion: '🦁',
    panther: '🐆',
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
    censusWindow.style.top = '80px';
    censusWindow.style.right = '12px';
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
    }
  });

  window.addEventListener('keyup', function (e) {
    const dir = KEY_MAP[e.code];
    if (dir) {
      game.keys[dir] = false;
      e.preventDefault();
    }
  });

  canvas.addEventListener('mousemove', function (e) {
    const rect = canvas.getBoundingClientRect();
    game.mouseX = e.clientX - rect.left;
    game.mouseY = e.clientY - rect.top;
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

    // Lock the playable world to the fixed 400×400 map (12800×12800 px)
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
    resetCensusPosition();
    setCensusVisible(!!config.showCensus);

    menuEl.classList.add('hidden');
    state = 'playing';
    game.lastTime = performance.now();
    game.time = 0;
  }

  function update(dt) {
    const step = Math.min(dt, 0.05);
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
      game.ecosystem.update(step);
      game.hoverEntity = pickEntityAt(
        game.ecosystem,
        game.camera,
        game.mouseX,
        game.mouseY
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

    updateHud(game.player);
  }

  function render() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    clear(ctx, w, h);
    drawWorld(ctx, game.world, game.camera, game.time);

    if (game.ecosystem && config.ecosystemEnabled) {
      drawEcosystem(ctx, game.ecosystem, game.camera, {
        time: game.time,
        showDebug: game.showEcosystemDebug,
        showHuntLines: game.showEcosystemDebug,
        hoverEntity: game.hoverEntity,
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
      drawMinimap(ctx, game.world, game.player, game.ecosystem, w, h);
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
