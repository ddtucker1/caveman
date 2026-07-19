/**
 * Canvas 2D shape renderer for ecosystem entities.
 * All species draw through renderShape() using data from shapes.js / shapes.json.
 * Keep draw calls low: simple geometric primitives only.
 */
(function (global) {
  const Wildborn = (global.Wildborn = global.Wildborn || {});

  /**
   * Primary entry used by all entity sprites.
   * @param {CanvasRenderingContext2D} ctx
   * @param {string} entityType species id
   * @param {number} x screen x (center)
   * @param {number} y screen y (center)
   * @param {number} scale visual scale (1 = species default size)
   * @param {boolean} facingRight
   * @param {object} [opts]
   */
  function renderShape(ctx, entityType, x, y, scale, facingRight, opts) {
    opts = opts || {};
    let def = Wildborn.shapes.getSpeciesDef(entityType);
    if (!def) {
      // Fallback square so missing defs stay visible
      const s = 8 * (scale || 1);
      ctx.fillStyle = '#888';
      ctx.fillRect(x - s / 2, y - s / 2, s, s);
      return;
    }

    // Hunger-search: eye dots turn orange
    if (opts.hungrySearch && def.category !== 'plant') {
      def = Object.assign({}, def, {
        eyeColor: '#ff8c00',
        eyeGlowColor: '#ff8c00',
      });
    }

    const sz = (def.size || 10) * (scale || 1);
    const time = opts.time != null ? opts.time : 0;
    const state = opts.state || 'IDLE';
    const calories = opts.calories != null ? opts.calories : def.size;
    const maxCalories = opts.maxCalories != null ? opts.maxCalories : def.size;
    const calRatio = maxCalories > 0 ? Math.max(0, Math.min(1, calories / maxCalories)) : 1;

    ctx.save();
    ctx.translate(x, y);

    // Shadow stays upright/grounded even when the corpse is flipped
    drawShadow(ctx, sz, def.category === 'plant' ? 0.55 : 0.65);

    // Death: flip upside down, fade out over ~3s
    if (state === 'DEAD') {
      const deadAge = opts.deadAge != null ? opts.deadAge : 0;
      const fade = Math.max(0, 1 - deadAge / 3);
      ctx.globalAlpha *= 0.25 + 0.45 * fade;
      ctx.rotate(Math.PI);
    }

    // Facing
    if (!facingRight) ctx.scale(-1, 1);

    // Sleep: lie on side (tilt toward π/2)
    if ((state === 'SLEEP' || opts.sleeping) && state !== 'DEAD') {
      const tilt = opts.sleepTilt != null ? opts.sleepTilt : Math.PI / 2;
      ctx.rotate(facingRight ? tilt : -tilt);
    }

    // Sleep: dim to ~80% brightness
    if ((state === 'SLEEP' || opts.sleeping) && state !== 'DEAD') {
      ctx.globalAlpha *= 0.8;
    }

    // Shared animation transforms
    const anim = computeAnim(opts, time, state, entityType);
    ctx.translate(anim.ox, anim.oy);
    ctx.scale(anim.sx, anim.sy);
    if (anim.rot) ctx.rotate(anim.rot);

    // Hunt glow (wolf)
    if (opts.hunting && def.features && def.features.indexOf('hunt_glow') >= 0) {
      ctx.save();
      ctx.strokeStyle = 'rgba(200,40,40,0.55)';
      ctx.lineWidth = 2;
      ctx.shadowColor = 'rgba(220,40,40,0.7)';
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.ellipse(0, 0, sz * 0.55, sz * 0.4, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (def.category === 'plant') {
      drawPlant(ctx, entityType, def, sz, calRatio, calories, maxCalories, time);
    } else if (def.category === 'herbivore') {
      drawHerbivore(ctx, entityType, def, sz, opts, time, anim);
    } else if (def.category === 'predator') {
      drawPredator(ctx, entityType, def, sz, opts, time, anim);
    }

    // Corpse gray wash: draw muted overlay silhouette only (local, no filter)
    if (state === 'DEAD') {
      ctx.fillStyle = 'rgba(90, 80, 70, 0.45)';
      ctx.beginPath();
      ctx.ellipse(0, 0, sz * 0.5, sz * 0.35, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();

    // Calorie bar (plants always; animals always when alive)
    if (state !== 'DEAD') {
      if (def.category === 'plant') {
        drawCalorieBar(ctx, x, y, sz, calRatio);
      } else if (def.category === 'herbivore' || def.category === 'predator') {
        drawCalorieBar(ctx, x, y, sz, calRatio);
      }
    }

    // Aggro / status icons (screen space)
    if (def.category === 'predator' && state !== 'DEAD') {
      if (opts.roaring) {
        ctx.fillStyle = '#e05040';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('!', x, y - sz * 0.85);
        ctx.textAlign = 'start';
      }
    }

    // Zzz particles (sleep) — screen space
    if ((state === 'SLEEP' || opts.sleeping) && state !== 'DEAD') {
      drawZzzParticles(ctx, x, y - sz * 0.5, opts.zzzParticles, time);
    }

    // Locked-in eating indicator — small yellow dot above head
    if (opts.eatLocked && (state === 'EATING' || opts.eating) && state !== 'DEAD') {
      ctx.fillStyle = '#f0d030';
      ctx.beginPath();
      ctx.arc(x, y - sz * 0.78, 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(80, 60, 0, 0.55)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }

    // Flee motion lines (screen space, behind facing)
    if (opts.fleeing && state !== 'DEAD') {
      drawMotionLines(ctx, x, y, facingRight, sz);
    }
  }

  // ---------------------------------------------------------------------------
  // Animation helpers
  // ---------------------------------------------------------------------------

  function computeAnim(opts, time, state, entityType) {
    const idPhase = (opts.id || 0) * 0.37;
    const t = time + idPhase;
    let ox = 0;
    let oy = 0;
    let sx = 1;
    let sy = 1;
    let rot = 0;
    let headDip = 0;

    const moving = !!opts.moving;
    const speed = opts.speed || 0;

    if (state === 'DEAD') {
      return { ox: 0, oy: 0, sx: 1, sy: 1, rot: 0, headDip: 0 };
    }

    // Idle breathing 1.0 → 1.02 over 2s
    if (!moving && (state === 'IDLE' || state === 'SLEEP')) {
      const breath = 1 + 0.02 * Math.sin((t / 2) * Math.PI * 2);
      sx = breath;
      sy = 2 - breath;
    }

    // Move bob
    if (moving && state !== 'EATING' && state !== 'SLEEP') {
      oy = Math.sin(t * 8 + speed) * Math.min(1.6, 0.8 + speed * 0.01);
    }

    // Eating head bob toward plant — once per second
    if (state === 'EATING' || opts.eating) {
      const phase =
        opts.eatBobPhase != null ? opts.eatBobPhase : t - Math.floor(t);
      // Sharp bob in the first ~0.35s of each second
      const bob =
        phase < 0.35 ? Math.sin((phase / 0.35) * Math.PI) : 0;
      headDip = bob * 4.5;
      oy += headDip * 0.4;
      rot = 0.18 * bob;

      // Locked-in stubborn eating: brief head shake every 3 seconds
      if (opts.eatLocked) {
        const lockPhase =
          opts.eatLockPhase != null ? opts.eatLockPhase : t % 3;
        if (lockPhase < 0.35) {
          rot += Math.sin((lockPhase / 0.35) * Math.PI * 4) * 0.22;
        }
      }
    }

    // Flee lean forward
    if ((state === 'FLEE' || opts.fleeing) && state !== 'SLEEP') {
      rot = opts.counterAttack ? -0.15 : 0.18;
      ox += opts.counterAttack ? 1.5 * Math.sin(t * 14) : 0;
    }

    // Attack lunge
    if (opts.attacking) {
      ox += Math.sin(t * 16) * 3;
    }

    // Bear rear-up
    if (opts.rearUp) {
      sy *= 1.15;
      sx *= 0.9;
      oy -= 3;
    }

    // Exhausted pant: mouth opens/closes ~3×/sec + slight body pulse
    if (opts.panting) {
      const pant = Math.sin(t * Math.PI * 6);
      opts._jawOpen = 0.35 + 0.55 * (0.5 + 0.5 * pant);
      sx *= 1 + 0.04 * pant;
      sy *= 1 - 0.03 * pant;
    }

    // Rabbit ear twitch encoded as slight vertical ear offset via opts
    opts._earTwitch = Math.sin(t * 6) > 0.92 ? -1.5 : 0;
    // Jaw chew (unless panting overrides)
    if (!opts.panting) {
      opts._jawOpen = state === 'EATING' ? 0.5 + 0.5 * Math.sin(t * 12) : opts.hunting ? 0.7 : 0.15;
    }

    return { ox: ox, oy: oy, sx: sx, sy: sy, rot: rot, headDip: headDip };
  }

  function drawShadow(ctx, sz, ryScale) {
    const shared = Wildborn.shapes.getShapeDefs().shared;
    ctx.fillStyle = shared.shadowColor;
    ctx.beginPath();
    ctx.ellipse(0, sz * 0.42, sz * 0.45, sz * 0.18 * (ryScale || 0.65), 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawCalorieBar(ctx, x, y, sz, ratio) {
    const bar = Wildborn.shapes.getShapeDefs().shared.calorieBar;
    const w = bar.width;
    const h = bar.height;
    const bx = x - w / 2;
    const by = y - sz * 0.55 + bar.offsetY;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(bx, by, w, h);
    let color = '#5aaa3a';
    if (ratio < 0.33) color = '#c05040';
    else if (ratio < 0.66) color = '#d4b84a';
    ctx.fillStyle = color;
    ctx.fillRect(bx, by, w * Math.max(0, Math.min(1, ratio)), h);
  }

  function drawMotionLines(ctx, x, y, facingRight, sz) {
    const dir = facingRight ? -1 : 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      const lx = x + dir * (sz * 0.55 + i * 3);
      const ly = y - 2 + i * 2;
      ctx.beginPath();
      ctx.moveTo(lx, ly);
      ctx.lineTo(lx + dir * 4, ly - 1);
      ctx.stroke();
    }
  }

  function drawZzz(ctx, x, y, time) {
    const phase = (time % 2) / 2;
    ctx.fillStyle = 'rgba(200,200,220,0.75)';
    ctx.font = '10px sans-serif';
    ctx.fillText('z', x + 4, y - phase * 10);
    ctx.font = '8px sans-serif';
    ctx.fillText('z', x + 10, y - 6 - phase * 8);
  }

  /** Draw managed Zzz particles (1/sec, fade over 2s). */
  function drawZzzParticles(ctx, x, y, particles, time) {
    if (!particles || !particles.length) {
      drawZzz(ctx, x, y, time || 0);
      return;
    }
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    for (let i = 0; i < particles.length; i++) {
      const z = particles[i];
      const alpha = Math.max(0, Math.min(1, z.life / (z.maxLife || 2)));
      ctx.fillStyle = 'rgba(200,200,220,' + (0.85 * alpha) + ')';
      ctx.fillText('z', x + z.x, y + z.y);
    }
    ctx.textAlign = 'start';
  }

  function drawEye(ctx, ex, ey, color, lookX, lookY) {
    const lx = Math.max(-0.8, Math.min(0.8, lookX || 0));
    const ly = Math.max(-0.8, Math.min(0.8, lookY || 0));
    ctx.fillStyle = color || '#fff';
    ctx.beginPath();
    ctx.arc(ex + lx, ey + ly, 1.1, 0, Math.PI * 2);
    ctx.fill();
  }

  // ---------------------------------------------------------------------------
  // Plants
  // ---------------------------------------------------------------------------

  function drawPlant(ctx, type, def, sz, calRatio, calories, maxCalories, time) {
    if (type === 'berry_bush') drawBerryBush(ctx, def, sz, calories);
    else if (type === 'grass') drawGrassPlant(ctx, def, sz, calRatio);
    else if (type === 'mushroom') drawMushroom(ctx, def, sz, calRatio);
    else if (type === 'fruit_tree') drawFruitTree(ctx, def, sz, calories);
    else if (type === 'cactus') drawCactus(ctx, def, sz, calRatio, calories, maxCalories);
  }

  function drawBerryBush(ctx, def, sz, calories) {
    const n = def.clusterCount || 4;
    ctx.fillStyle = def.baseColor;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = sz * 0.28;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * r * 0.7, Math.sin(a) * r * 0.5 - 1, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // Center blob
    ctx.beginPath();
    ctx.arc(0, -1, sz * 0.32, 0, Math.PI * 2);
    ctx.fill();

    if (calories > (def.berryCalorieThreshold || 30)) {
      ctx.fillStyle = def.berryColor || def.accentColor;
      const berries = [
        [-2, -3], [3, -1], [-1, 2], [2, -4], [0, 0],
      ];
      for (let i = 0; i < berries.length; i++) {
        ctx.beginPath();
        ctx.arc(berries[i][0], berries[i][1], 1.3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawGrassPlant(ctx, def, sz, calRatio) {
    const h = sz * (0.5 + calRatio * 1.1);
    const color = calRatio < 0.25 ? def.depletedColor : def.baseColor;
    const dark = calRatio < 0.25 ? '#6a5030' : def.darkColor;
    for (let i = 0; i < 3; i++) {
      const bx = -sz * 0.35 + i * sz * 0.35;
      const tipX = bx + (i - 1) * 1.2;
      const grad = ctx.createLinearGradient(bx, h * 0.3, tipX, -h * 0.5);
      grad.addColorStop(0, dark);
      grad.addColorStop(1, color);
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(bx, sz * 0.35);
      ctx.quadraticCurveTo(bx + (i - 1) * 2, -h * 0.1, tipX, -h * 0.45);
      ctx.stroke();
    }
  }

  function drawMushroom(ctx, def, sz, calRatio) {
    // Stem
    ctx.fillStyle = def.stemColor;
    ctx.fillRect(-1.2, -1, 2.4, sz * 0.45);
    // Cap
    ctx.fillStyle = calRatio > 0.5 ? def.capColor : def.capColorAlt;
    ctx.beginPath();
    ctx.ellipse(0, -sz * 0.15, sz * 0.42, sz * 0.28, 0, Math.PI, 0);
    ctx.fill();
    if (calRatio > 0.55) {
      ctx.fillStyle = def.spotColor;
      ctx.beginPath();
      ctx.arc(-2, -sz * 0.22, 1.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(2, -sz * 0.18, 0.9, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawFruitTree(ctx, def, sz, calories) {
    // Trunk
    ctx.fillStyle = def.trunkColor;
    ctx.fillRect(-2, -sz * 0.05, 4, sz * 0.5);
    // Canopy clouds
    ctx.fillStyle = def.canopyColor;
    ctx.beginPath();
    ctx.arc(-sz * 0.22, -sz * 0.25, sz * 0.28, 0, Math.PI * 2);
    ctx.arc(sz * 0.22, -sz * 0.22, sz * 0.26, 0, Math.PI * 2);
    ctx.arc(0, -sz * 0.4, sz * 0.3, 0, Math.PI * 2);
    ctx.fill();
    if (calories > (def.fruitCalorieThreshold || 50)) {
      ctx.fillStyle = def.fruitColor;
      const fruits = [[-3, -4], [4, -6], [0, -10], [3, -2]];
      for (let i = 0; i < fruits.length; i++) {
        ctx.beginPath();
        ctx.arc(fruits[i][0], fruits[i][1], 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawCactus(ctx, def, sz, calRatio, calories, maxCalories) {
    ctx.fillStyle = def.baseColor;
    // Body
    ctx.beginPath();
    ctx.ellipse(0, 0, sz * 0.28, sz * 0.48, 0, 0, Math.PI * 2);
    ctx.fill();
    // Arms
    ctx.beginPath();
    ctx.ellipse(-sz * 0.32, -sz * 0.05, sz * 0.14, sz * 0.2, -0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(sz * 0.3, -sz * 0.12, sz * 0.12, sz * 0.18, 0.35, 0, Math.PI * 2);
    ctx.fill();
    // Ridges
    ctx.strokeStyle = def.ridgeColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, -sz * 0.35);
    ctx.lineTo(0, sz * 0.35);
    ctx.stroke();
    // Flower at max calories
    if (calories >= maxCalories) {
      ctx.fillStyle = def.flowerColor;
      ctx.beginPath();
      ctx.arc(0, -sz * 0.5, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ---------------------------------------------------------------------------
  // Herbivores
  // ---------------------------------------------------------------------------

  function drawHerbivore(ctx, type, def, sz, opts, time, anim) {
    const lookX = opts.lookX || 0;
    const lookY = opts.lookY || 0;
    const headY = opts.eating || opts.state === 'EATING' ? 1.5 : 0;

    if (type === 'rabbit') drawRabbit(ctx, def, sz, opts, lookX, lookY, headY);
    else if (type === 'deer') drawDeer(ctx, def, sz, opts, lookX, lookY, headY);
    else if (type === 'cow') drawCow(ctx, def, sz, opts, lookX, lookY, headY);
    else if (type === 'raccoon') drawRaccoon(ctx, def, sz, opts, lookX, lookY, headY);
    else if (type === 'bison') drawBison(ctx, def, sz, opts, lookX, lookY, headY);
    else if (type === 'ostrich') drawOstrich(ctx, def, sz, opts, lookX, lookY, headY);
    else if (type === 'turtle') drawTurtle(ctx, def, sz, opts, lookX, lookY, headY);
  }

  function drawLegs(ctx, kind, sz, color) {
    ctx.strokeStyle = color || '#5a4030';
    ctx.lineWidth = kind === 'long_thin' || kind === 'very_long' || kind === 'two_thin' ? 1.2 : 2;
    const y0 = sz * 0.25;
    const len =
      kind === 'very_long' ? sz * 0.55 :
      kind === 'long_thin' ? sz * 0.4 :
      kind === 'medium' ? sz * 0.28 :
      sz * 0.2;
    const xs =
      kind === 'two_thin' || kind === 'very_long'
        ? [-sz * 0.12, sz * 0.12]
        : [-sz * 0.25, -sz * 0.1, sz * 0.08, sz * 0.22];
    for (let i = 0; i < xs.length; i++) {
      ctx.beginPath();
      ctx.moveTo(xs[i], y0);
      ctx.lineTo(xs[i] + (i % 2 === 0 ? -0.5 : 0.5), y0 + len);
      ctx.stroke();
    }
  }

  function drawRabbit(ctx, def, sz, opts, lookX, lookY, headY) {
    drawLegs(ctx, 'short', sz, def.bodyColor);
    // Body
    ctx.fillStyle = def.bodyColor;
    ctx.beginPath();
    ctx.ellipse(0, headY, sz * 0.42, sz * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();
    // Head
    ctx.beginPath();
    ctx.ellipse(sz * 0.28, headY - sz * 0.08, sz * 0.22, sz * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    // Ears
    const twitch = opts._earTwitch || 0;
    ctx.fillStyle = def.earColor;
    ctx.beginPath();
    ctx.ellipse(sz * 0.22, headY - sz * 0.42 + twitch, sz * 0.08, sz * 0.28, -0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(sz * 0.34, headY - sz * 0.4 + twitch * 0.5, sz * 0.07, sz * 0.26, 0.1, 0, Math.PI * 2);
    ctx.fill();
    // Cotton tail
    ctx.fillStyle = def.tailColor;
    ctx.beginPath();
    ctx.arc(-sz * 0.38, headY + sz * 0.05, sz * 0.14, 0, Math.PI * 2);
    ctx.fill();
    drawEye(ctx, sz * 0.36, headY - sz * 0.12, def.eyeColor, lookX, lookY);
  }

  function drawDeer(ctx, def, sz, opts, lookX, lookY, headY) {
    drawLegs(ctx, 'long_thin', sz, def.bodyColor);
    ctx.fillStyle = def.bodyColor;
    ctx.beginPath();
    ctx.ellipse(0, headY, sz * 0.48, sz * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    // Neck + head
    ctx.beginPath();
    ctx.ellipse(sz * 0.38, headY - sz * 0.18, sz * 0.16, sz * 0.2, 0.3, 0, Math.PI * 2);
    ctx.fill();
    // Ears
    ctx.fillStyle = def.earColor;
    ctx.beginPath();
    ctx.moveTo(sz * 0.32, headY - sz * 0.35);
    ctx.lineTo(sz * 0.28, headY - sz * 0.48);
    ctx.lineTo(sz * 0.38, headY - sz * 0.35);
    ctx.fill();
    // Antlers on males
    if (opts.sex === 'male' && opts.isAdult !== false) {
      ctx.strokeStyle = def.antlerColor;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(sz * 0.34, headY - sz * 0.38);
      ctx.lineTo(sz * 0.3, headY - sz * 0.58);
      ctx.lineTo(sz * 0.22, headY - sz * 0.52);
      ctx.moveTo(sz * 0.3, headY - sz * 0.58);
      ctx.lineTo(sz * 0.36, headY - sz * 0.62);
      ctx.stroke();
    }
    // Short tail
    ctx.fillStyle = def.bodyColor;
    ctx.fillRect(-sz * 0.5, headY - sz * 0.05, sz * 0.12, sz * 0.08);
    drawEye(ctx, sz * 0.48, headY - sz * 0.22, def.eyeColor, lookX, lookY);
  }

  function drawCow(ctx, def, sz, opts, lookX, lookY, headY) {
    drawLegs(ctx, 'short_stubby', sz, '#4a4030');
    // Udder
    ctx.fillStyle = def.udderColor;
    ctx.beginPath();
    ctx.ellipse(0, headY + sz * 0.28, sz * 0.16, sz * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    // Body
    ctx.fillStyle = def.bodyColor;
    roundRect(ctx, -sz * 0.48, headY - sz * 0.28, sz * 0.96, sz * 0.55, 4);
    ctx.fill();
    // Patches
    ctx.fillStyle = def.patchColor;
    ctx.beginPath();
    ctx.ellipse(-sz * 0.15, headY - sz * 0.05, sz * 0.16, sz * 0.14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(sz * 0.2, headY + sz * 0.05, sz * 0.12, sz * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    // Head
    ctx.fillStyle = def.bodyColor;
    ctx.beginPath();
    ctx.ellipse(sz * 0.42, headY - sz * 0.1, sz * 0.2, sz * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    // Ears
    ctx.fillStyle = def.earColor;
    ctx.beginPath();
    ctx.ellipse(sz * 0.32, headY - sz * 0.28, sz * 0.08, sz * 0.06, 0, 0, Math.PI * 2);
    ctx.fill();
    // Thin tail
    ctx.strokeStyle = '#4a4030';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-sz * 0.48, headY);
    ctx.quadraticCurveTo(-sz * 0.6, headY + sz * 0.2, -sz * 0.52, headY + sz * 0.3);
    ctx.stroke();
    drawEye(ctx, sz * 0.5, headY - sz * 0.14, def.eyeColor, lookX, lookY);
  }

  function drawRaccoon(ctx, def, sz, opts, lookX, lookY, headY) {
    drawLegs(ctx, 'medium', sz, def.bodyColor);
    // Striped tail
    const tx = -sz * 0.45;
    const ty = headY + sz * 0.05;
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i % 2 === 0 ? def.stripeColor : def.tailTip;
      ctx.beginPath();
      ctx.ellipse(tx - i * 2.2, ty + i * 0.5, sz * 0.12, sz * 0.09, 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
    // Body
    ctx.fillStyle = def.bodyColor;
    ctx.beginPath();
    ctx.ellipse(0, headY, sz * 0.4, sz * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();
    // Head
    ctx.beginPath();
    ctx.ellipse(sz * 0.3, headY - sz * 0.05, sz * 0.22, sz * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    // Mask
    ctx.fillStyle = def.maskColor;
    ctx.fillRect(sz * 0.18, headY - sz * 0.14, sz * 0.28, sz * 0.12);
    // Ears
    ctx.fillStyle = def.earColor;
    ctx.beginPath();
    ctx.arc(sz * 0.22, headY - sz * 0.22, sz * 0.08, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(sz * 0.36, headY - sz * 0.22, sz * 0.08, 0, Math.PI * 2);
    ctx.fill();
    drawEye(ctx, sz * 0.38, headY - sz * 0.1, def.eyeColor, lookX, lookY);
  }

  function drawBison(ctx, def, sz, opts, lookX, lookY, headY) {
    drawLegs(ctx, 'short_thick', sz, def.bodyColor);
    // Body
    ctx.fillStyle = def.bodyColor;
    roundRect(ctx, -sz * 0.48, headY - sz * 0.22, sz * 0.95, sz * 0.5, 3);
    ctx.fill();
    // Shoulder hump
    ctx.fillStyle = def.humpColor;
    ctx.beginPath();
    ctx.ellipse(sz * 0.05, headY - sz * 0.28, sz * 0.28, sz * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
    // Head
    ctx.fillStyle = def.bodyColor;
    ctx.beginPath();
    ctx.ellipse(sz * 0.42, headY - sz * 0.05, sz * 0.2, sz * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    // Tiny horns
    ctx.strokeStyle = def.hornColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(sz * 0.35, headY - sz * 0.2);
    ctx.lineTo(sz * 0.32, headY - sz * 0.32);
    ctx.moveTo(sz * 0.48, headY - sz * 0.18);
    ctx.lineTo(sz * 0.52, headY - sz * 0.3);
    ctx.stroke();
    // Bushy tail
    ctx.fillStyle = def.humpColor;
    ctx.beginPath();
    ctx.ellipse(-sz * 0.5, headY + sz * 0.05, sz * 0.1, sz * 0.14, 0.4, 0, Math.PI * 2);
    ctx.fill();
    drawEye(ctx, sz * 0.52, headY - sz * 0.1, def.eyeColor, lookX, lookY);
  }

  function drawOstrich(ctx, def, sz, opts, lookX, lookY, headY) {
    // Very long legs
    ctx.strokeStyle = def.legColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-sz * 0.08, sz * 0.1);
    ctx.lineTo(-sz * 0.12, sz * 0.65);
    ctx.moveTo(sz * 0.1, sz * 0.1);
    ctx.lineTo(sz * 0.14, sz * 0.65);
    ctx.stroke();
    // Body
    ctx.fillStyle = def.bodyColor;
    ctx.beginPath();
    ctx.ellipse(0, headY, sz * 0.35, sz * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();
    // White wing tips
    ctx.fillStyle = def.wingColor;
    ctx.beginPath();
    ctx.ellipse(sz * 0.05, headY + sz * 0.05, sz * 0.18, sz * 0.1, 0.2, 0, Math.PI * 2);
    ctx.fill();
    // Feather fan tail
    ctx.fillStyle = def.bodyColor;
    ctx.beginPath();
    ctx.moveTo(-sz * 0.3, headY);
    ctx.lineTo(-sz * 0.55, headY - sz * 0.2);
    ctx.lineTo(-sz * 0.5, headY + sz * 0.15);
    ctx.fill();
    // Long neck
    ctx.strokeStyle = def.neckColor;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(sz * 0.2, headY - sz * 0.1);
    ctx.quadraticCurveTo(sz * 0.28, headY - sz * 0.45, sz * 0.32, headY - sz * 0.65);
    ctx.stroke();
    // Head
    ctx.fillStyle = def.neckColor;
    ctx.beginPath();
    ctx.ellipse(sz * 0.36, headY - sz * 0.68, sz * 0.1, sz * 0.08, 0, 0, Math.PI * 2);
    ctx.fill();
    drawEye(ctx, sz * 0.4, headY - sz * 0.7, def.eyeColor, lookX, lookY);
  }

  function drawTurtle(ctx, def, sz, opts, lookX, lookY, headY) {
    // Legs
    ctx.fillStyle = def.bodyColor;
    const feet = [
      [-sz * 0.3, sz * 0.2],
      [sz * 0.25, sz * 0.2],
      [-sz * 0.28, -sz * 0.05],
      [sz * 0.22, -sz * 0.05],
    ];
    for (let i = 0; i < feet.length; i++) {
      ctx.beginPath();
      ctx.ellipse(feet[i][0], headY + feet[i][1], sz * 0.1, sz * 0.07, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Shell dome
    ctx.fillStyle = def.shellColor;
    ctx.beginPath();
    ctx.ellipse(0, headY, sz * 0.45, sz * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();
    // Hex pattern
    ctx.strokeStyle = def.shellLineColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-sz * 0.15, headY - sz * 0.15);
    ctx.lineTo(0, headY - sz * 0.22);
    ctx.lineTo(sz * 0.15, headY - sz * 0.15);
    ctx.lineTo(sz * 0.15, headY);
    ctx.lineTo(0, headY + sz * 0.08);
    ctx.lineTo(-sz * 0.15, headY);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, headY - sz * 0.22);
    ctx.lineTo(0, headY + sz * 0.08);
    ctx.stroke();
    // Head
    ctx.fillStyle = def.bodyColor;
    ctx.beginPath();
    ctx.ellipse(sz * 0.42, headY, sz * 0.14, sz * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    // Stubby tail
    ctx.beginPath();
    ctx.ellipse(-sz * 0.45, headY + 1, sz * 0.08, sz * 0.05, 0, 0, Math.PI * 2);
    ctx.fill();
    drawEye(ctx, sz * 0.5, headY - 1, def.eyeColor, lookX, lookY);
  }

  // ---------------------------------------------------------------------------
  // Predators
  // ---------------------------------------------------------------------------

  function drawPredator(ctx, type, def, sz, opts, time, anim) {
    const lookX = opts.lookX || 0;
    const lookY = opts.lookY || 0;
    const headY = opts.eating || opts.state === 'EATING' ? 1.8 : 0;

    if (type === 'wolf') drawWolf(ctx, def, sz, opts, lookX, lookY, headY);
    else if (type === 'lion') drawLion(ctx, def, sz, opts, lookX, lookY, headY);
    else if (type === 'panther') drawPanther(ctx, def, sz, opts, lookX, lookY, headY);
    else if (type === 'bear') drawBear(ctx, def, sz, opts, lookX, lookY, headY);
    else if (type === 'alligator') drawAlligator(ctx, def, sz, opts, lookX, lookY, headY);
  }

  function drawWolf(ctx, def, sz, opts, lookX, lookY, headY) {
    drawLegs(ctx, 'medium', sz, def.bodyColor);
    // Bushy tail
    ctx.fillStyle = def.tailColor;
    ctx.beginPath();
    ctx.ellipse(-sz * 0.48, headY - sz * 0.05, sz * 0.18, sz * 0.12, 0.4, 0, Math.PI * 2);
    ctx.fill();
    // Lean body
    ctx.fillStyle = def.bodyColor;
    ctx.beginPath();
    ctx.ellipse(0, headY, sz * 0.45, sz * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();
    // Head / snout
    ctx.fillStyle = def.snoutColor;
    ctx.beginPath();
    ctx.ellipse(sz * 0.35, headY - sz * 0.08, sz * 0.22, sz * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(sz * 0.45, headY - sz * 0.05);
    ctx.lineTo(sz * 0.65, headY);
    ctx.lineTo(sz * 0.45, headY + sz * 0.08);
    ctx.fill();
    // Teeth when hunting
    if (opts.hunting || opts._jawOpen > 0.5) {
      ctx.fillStyle = def.toothColor;
      ctx.fillRect(sz * 0.52, headY + 1, 1.5, 2.5);
      ctx.fillRect(sz * 0.58, headY + 1, 1.5, 2);
    }
    // Pointed ears
    ctx.fillStyle = def.earColor;
    ctx.beginPath();
    ctx.moveTo(sz * 0.22, headY - sz * 0.2);
    ctx.lineTo(sz * 0.18, headY - sz * 0.42);
    ctx.lineTo(sz * 0.32, headY - sz * 0.22);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(sz * 0.34, headY - sz * 0.2);
    ctx.lineTo(sz * 0.38, headY - sz * 0.4);
    ctx.lineTo(sz * 0.44, headY - sz * 0.18);
    ctx.fill();
    drawEye(ctx, sz * 0.4, headY - sz * 0.14, def.eyeColor, lookX, lookY);
  }

  function drawLion(ctx, def, sz, opts, lookX, lookY, headY) {
    drawLegs(ctx, 'medium', sz, def.bodyColor);
    // Tail with tuft
    ctx.strokeStyle = def.bodyColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-sz * 0.45, headY);
    ctx.quadraticCurveTo(-sz * 0.7, headY - sz * 0.2, -sz * 0.65, headY - sz * 0.35);
    ctx.stroke();
    ctx.fillStyle = def.tailTuft;
    ctx.beginPath();
    ctx.arc(-sz * 0.65, headY - sz * 0.35, 2.5, 0, Math.PI * 2);
    ctx.fill();
    // Body
    ctx.fillStyle = def.bodyColor;
    ctx.beginPath();
    ctx.ellipse(0, headY, sz * 0.48, sz * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    // Mane (darker circle around head) — males denser
    const maneR = opts.sex === 'female' ? sz * 0.28 : sz * 0.36;
    ctx.fillStyle = def.maneColor;
    ctx.beginPath();
    ctx.arc(sz * 0.32, headY - sz * 0.08, maneR, 0, Math.PI * 2);
    ctx.fill();
    // Head
    ctx.fillStyle = def.bodyColor;
    ctx.beginPath();
    ctx.arc(sz * 0.35, headY - sz * 0.08, sz * 0.2, 0, Math.PI * 2);
    ctx.fill();
    // Ears
    ctx.fillStyle = def.earColor;
    ctx.beginPath();
    ctx.arc(sz * 0.25, headY - sz * 0.28, sz * 0.07, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(sz * 0.42, headY - sz * 0.28, sz * 0.07, 0, Math.PI * 2);
    ctx.fill();
    // Jaw chew
    if (opts.eating || opts.state === 'EATING') {
      ctx.fillStyle = '#3a2010';
      ctx.fillRect(sz * 0.42, headY + (opts._jawOpen || 0), 4, 2);
    }
    drawEye(ctx, sz * 0.42, headY - sz * 0.12, def.eyeColor, lookX, lookY);
  }

  function drawPanther(ctx, def, sz, opts, lookX, lookY, headY) {
    drawLegs(ctx, 'medium', sz, def.bodyColor);
    // Long tapering tail
    ctx.fillStyle = def.bodyColor;
    ctx.beginPath();
    ctx.moveTo(-sz * 0.4, headY);
    ctx.lineTo(-sz * 0.85, headY - sz * 0.15);
    ctx.lineTo(-sz * 0.4, headY + sz * 0.08);
    ctx.fill();
    // Sleek body
    ctx.beginPath();
    ctx.ellipse(0, headY, sz * 0.48, sz * 0.26, 0, 0, Math.PI * 2);
    ctx.fill();
    // Head
    ctx.beginPath();
    ctx.ellipse(sz * 0.38, headY - sz * 0.05, sz * 0.2, sz * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
    // Ears
    ctx.fillStyle = def.earColor;
    ctx.beginPath();
    ctx.arc(sz * 0.28, headY - sz * 0.22, sz * 0.07, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(sz * 0.42, headY - sz * 0.22, sz * 0.07, 0, Math.PI * 2);
    ctx.fill();
    // Glowing yellow eyes — brighter when stalking
    const glow = opts.stalking ? def.eyeGlowColor : def.eyeColor;
    if (opts.stalking) {
      ctx.save();
      ctx.shadowColor = glow;
      ctx.shadowBlur = 6;
      drawEye(ctx, sz * 0.42, headY - sz * 0.1, glow, lookX, lookY);
      ctx.restore();
    } else {
      drawEye(ctx, sz * 0.42, headY - sz * 0.1, glow, lookX, lookY);
    }
  }

  function drawBear(ctx, def, sz, opts, lookX, lookY, headY) {
    if (!opts.rearUp) drawLegs(ctx, 'short_thick', sz, def.bodyColor);
    else {
      // Hind-leg stand: legs under body
      ctx.strokeStyle = def.bodyColor;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(-sz * 0.1, sz * 0.15);
      ctx.lineTo(-sz * 0.12, sz * 0.45);
      ctx.moveTo(sz * 0.1, sz * 0.15);
      ctx.lineTo(sz * 0.12, sz * 0.45);
      ctx.stroke();
    }
    // Bulky body
    ctx.fillStyle = def.bodyColor;
    roundRect(ctx, -sz * 0.45, headY - sz * 0.3, sz * 0.9, sz * 0.55, 5);
    ctx.fill();
    // Head
    ctx.beginPath();
    ctx.ellipse(sz * 0.38, headY - sz * 0.1, sz * 0.22, sz * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    // Lighter snout patch
    ctx.fillStyle = def.snoutColor;
    ctx.beginPath();
    ctx.ellipse(sz * 0.52, headY - sz * 0.02, sz * 0.12, sz * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    // Ears
    ctx.fillStyle = def.earColor;
    ctx.beginPath();
    ctx.arc(sz * 0.28, headY - sz * 0.3, sz * 0.09, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(sz * 0.42, headY - sz * 0.3, sz * 0.09, 0, Math.PI * 2);
    ctx.fill();
    // Stubby tail
    ctx.fillStyle = def.bodyColor;
    ctx.beginPath();
    ctx.arc(-sz * 0.45, headY + sz * 0.05, sz * 0.08, 0, Math.PI * 2);
    ctx.fill();
    // Jaw chew
    if (opts.eating || opts.state === 'EATING') {
      ctx.fillStyle = '#2a1810';
      const open = (opts._jawOpen || 0) * 3;
      ctx.fillRect(sz * 0.48, headY + 2 + open * 0.3, 5, 1.5 + open);
    }
    drawEye(ctx, sz * 0.42, headY - sz * 0.16, def.eyeColor, lookX, lookY);
  }

  function drawAlligator(ctx, def, sz, opts, lookX, lookY, headY) {
    // Thick tapering tail
    ctx.fillStyle = def.bodyColor;
    ctx.beginPath();
    ctx.moveTo(-sz * 0.3, headY);
    ctx.lineTo(-sz * 0.9, headY + sz * 0.05);
    ctx.lineTo(-sz * 0.3, headY + sz * 0.18);
    ctx.fill();
    // Long flat body
    ctx.beginPath();
    ctx.ellipse(0, headY + 1, sz * 0.5, sz * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    // Belly
    ctx.fillStyle = def.bellyColor;
    ctx.beginPath();
    ctx.ellipse(sz * 0.05, headY + 3, sz * 0.3, sz * 0.08, 0, 0, Math.PI * 2);
    ctx.fill();
    // Head + open jaw
    ctx.fillStyle = def.jawColor;
    const jaw = opts._jawOpen != null ? opts._jawOpen : 0.3;
    ctx.beginPath();
    ctx.ellipse(sz * 0.45, headY - jaw, sz * 0.28, sz * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = def.bodyColor;
    ctx.beginPath();
    ctx.ellipse(sz * 0.45, headY + jaw * 1.5, sz * 0.28, sz * 0.08, 0, 0, Math.PI * 2);
    ctx.fill();
    // Teeth hint
    ctx.fillStyle = '#e8e0d0';
    ctx.fillRect(sz * 0.5, headY, 2, 1.5);
    ctx.fillRect(sz * 0.58, headY, 2, 1.5);
    drawEye(ctx, sz * 0.4, headY - sz * 0.12, def.eyeColor, lookX, lookY);
    // Water ripple when in water
    if (opts.inWater) {
      ctx.strokeStyle = 'rgba(180,220,255,0.35)';
      ctx.lineWidth = 1;
      const r = sz * 0.55 + (opts.time % 1.5) * 4;
      ctx.beginPath();
      ctx.ellipse(0, sz * 0.25, r, r * 0.35, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // ---------------------------------------------------------------------------
  // Utils
  // ---------------------------------------------------------------------------

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /**
   * Draw a tiny legend icon (for L-panel / tooltips).
   */
  function renderLegendIcon(ctx, entityType, x, y, iconScale) {
    iconScale = iconScale || 0.55;
    renderShape(ctx, entityType, x, y, iconScale, true, {
      time: 0,
      state: 'IDLE',
      calories: 999,
      maxCalories: 999,
      isAdult: true,
      sex: 'male',
    });
  }

  Wildborn.renderShapes = {
    renderShape,
    renderLegendIcon,
    computeAnim,
  };
})(typeof window !== 'undefined' ? window : globalThis);
