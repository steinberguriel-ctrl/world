(() => {
  // --- Preview Mode State ---
  let previewMode = false;
  let previewScale = 1;
  let previewOffsetX = 0;
  let previewOffsetY = 0;
  let previewBtn, previewModal, previewCloseBtn, previewWorldCanvas;

  function getWorldBounds() {
    // תמיד מחזיר את גבולות העולם המלא
    const ws = getActiveWorldSize();
    if (!state.items.length) {
      return { minX: 0, minY: 0, maxX: ws.width, maxY: ws.height };
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const it of state.items) {
      const b = getProjectedBounds(it);
      minX = Math.min(minX, b.minX);
      minY = Math.min(minY, b.minY);
      maxX = Math.max(maxX, b.maxX);
      maxY = Math.max(maxY, b.maxY);
    }
    // תיקון: אם יש חפצים רק באמצע, עדיין תראה את כל העולם
    minX = Math.min(minX, 0);
    minY = Math.min(minY, 0);
    maxX = Math.max(maxX, ws.width);
    maxY = Math.max(maxY, ws.height);
    // Add a small margin
    return { minX: minX - 20, minY: minY - 20, maxX: maxX + 20, maxY: maxY + 20 };
  }

  function drawPreviewWorld() {
    if (!previewWorldCanvas) return;
    const ctx = previewWorldCanvas.getContext('2d');
    ctx.clearRect(0, 0, previewWorldCanvas.width, previewWorldCanvas.height);
    const bounds = getWorldBounds();
    const worldW = bounds.maxX - bounds.minX;
    const worldH = bounds.maxY - bounds.minY;
    const canvasW = previewWorldCanvas.width;
    const canvasH = previewWorldCanvas.height;
    const scale = Math.min(canvasW / worldW, canvasH / worldH, 1);
    const offsetX = (canvasW - worldW * scale) / 2 - bounds.minX * scale;
    const offsetY = (canvasH - worldH * scale) / 2 - bounds.minY * scale;
    ctx.save();
    ctx.setTransform(scale, 0, 0, scale, offsetX, offsetY);
    // Draw each item with a local context, not using global ctx
    const items = state.items.slice().sort(compareItemsByLayer);
    const terrainAdjacency = buildTerrainAdjacency(items);
    const viewState = getParallaxState();
    for (const it of items) {
      if (it.type === 'grass' || it.type === 'rock' || it.type === 'powerbox') {
        draw3DBlock(ctx, it, terrainAdjacency, viewState);
      } else if (it.type === 'spawn') {
        drawSpawnPoint(ctx, it, viewState);
      } else if (images[it.type]) {
        ctx.drawImage(images[it.type], it.x, it.y, it.w, it.h);
      } else {
        ctx.fillStyle = '#90EE90';
        ctx.fillRect(it.x, it.y, it.w, it.h);
      }
    }
    ctx.restore();
  }

  document.addEventListener('DOMContentLoaded', () => {
    previewBtn = document.getElementById('previewBtn');
    previewModal = document.getElementById('previewModal');
    previewCloseBtn = document.getElementById('previewCloseBtn');
    previewWorldCanvas = document.getElementById('previewWorldCanvas');
    if (previewBtn) {
      previewBtn.onclick = () => {
        if (previewModal) {
          drawPreviewWorld();
          previewModal.hidden = false;
        }
      };
    }
    if (previewCloseBtn) {
      previewCloseBtn.onclick = () => {
        if (previewModal) previewModal.hidden = true;
      };
    }
    // ESC key closes preview modal
    document.addEventListener('keydown', function (e) {
      if (!previewModal || previewModal.hidden) return;
      if (e.key === 'Escape') {
        previewModal.hidden = true;
      }
    });
  });



  // CONFIG
  const ASSETS = {
    grass: 'grass.png',
  };
  const PLAY_LOGICAL_WIDTH = 1920;
  const PLAY_LOGICAL_HEIGHT = 1080;
  const ITEM_SIZE = 0;
  const GRID = 50;
  const PLACEMENT_SNAP_STEP = 10;
  const BASE_WORLD_WIDTH = PLAY_LOGICAL_WIDTH;
  const BASE_WORLD_HEIGHT = PLAY_LOGICAL_HEIGHT;
  const GRASS_LIFT = { left: GRID * 0.25, up: GRID * 0.25, diag: GRID * 0.125 };
  const ROCK_LIFT = { left: GRID * 0.375, up: GRID * 0.375, diag: GRID * 0.1875 };
  const TERRAIN_GROW = { left: 0, up: 0, diag: 0 };
  const ROCK_HEIGHT_FACTOR = 1;
  const GRASS_HEIGHT_FACTOR = 0.5;
  const POWERBOX_SIZE_FACTOR = 0.82;
  const DEFAULT_POWERBOX_HP = 1000;
  const PLACEMENT_ANCHOR_VERSION = 2;
  const TERRAIN_DEPTH_FACTOR = 0.2;
  const TERRAIN_PLACE_LEFT_SHIFT = 0;
  const BUILDER_WORLD_STORAGE_KEY = 'builderWorldDataV1';

  // STATE
  const state = {
    items: [], // world items
    settings: {
      powerboxHp: DEFAULT_POWERBOX_HP,
      placementAnchorVersion: PLACEMENT_ANCHOR_VERSION,
      selectedWorldSlot: 0,
      selectedWorldName: ''
    },
    undoStack: [],
    redoStack: []
  };

  const camera = { x: 0, y: 0 };

  function persistWorldState() {
    try {
      localStorage.setItem(BUILDER_WORLD_STORAGE_KEY, JSON.stringify({ items: state.items, settings: state.settings }));
    } catch (err) {
      // Ignore storage errors.
    }
  }

  function sanitizePowerboxHp(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return DEFAULT_POWERBOX_HP;
    return Math.min(999999, Math.max(1, Math.round(n)));
  }

  function loadPersistedWorldState() {
    try {
      const raw = localStorage.getItem(BUILDER_WORLD_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.items)) {
        state.items = parsed.items;
      }
      if (parsed && parsed.settings && Object.prototype.hasOwnProperty.call(parsed.settings, 'powerboxHp')) {
        state.settings.powerboxHp = sanitizePowerboxHp(parsed.settings.powerboxHp);
      }
      if (parsed && parsed.settings && Object.prototype.hasOwnProperty.call(parsed.settings, 'selectedWorldSlot')) {
        const loadedSlot = Number(parsed.settings.selectedWorldSlot);
        if (Number.isFinite(loadedSlot) && loadedSlot === 1) {
          state.settings.selectedWorldSlot = loadedSlot;
        }
      }
      if (parsed && parsed.settings && Object.prototype.hasOwnProperty.call(parsed.settings, 'selectedWorldName')) {
        state.settings.selectedWorldName = String(parsed.settings.selectedWorldName || '');
      }

      const savedAnchorVersion = Number(parsed && parsed.settings && parsed.settings.placementAnchorVersion) || 1;
      if (savedAnchorVersion < PLACEMENT_ANCHOR_VERSION) {
        // One-time migration: old placements were center-anchored on Y.
        state.items = state.items.map((it) => {
          if (it.type !== 'grass' && it.type !== 'rock' && it.type !== 'powerbox') return it;
          const shifted = { ...it, y: it.y - (it.h / 2) };
          const clamped = clampItemToWorld(shifted);
          return { ...shifted, x: clamped.x, y: clamped.y };
        });
      }

      state.items = state.items.map((it) => {
        const clamped = clampItemToWorld(it);
        return { ...it, x: clamped.x, y: clamped.y };
      });

      state.settings.placementAnchorVersion = PLACEMENT_ANCHOR_VERSION;
      persistWorldState();
      draw(); // מצייר את החפצים מיד אחרי טעינה
    } catch (err) {
      // Ignore malformed storage.
    }
  }

  // HELPERS
  const uid = () => Math.random().toString(36).slice(2, 9);

  function getPlacementSizeByType(type) {
    if (type === 'grass' || type === 'rock') return GRID;
    if (type === 'powerbox') return Math.round(GRID * POWERBOX_SIZE_FACTOR);
    if (type === 'spawn') return GRID;
    return ITEM_SIZE;
  }

  function applyTerrainPlacementShift(type, x) {
    if (type === 'grass' || type === 'rock' || type === 'powerbox' || type === 'spawn') return x - TERRAIN_PLACE_LEFT_SHIFT;
    return x;
  }

  function normalizeTerrainItemsToGridSize() {
    state.items = state.items.map(it => {
      if ((it.type === 'grass' || it.type === 'rock') && (it.w !== GRID || it.h !== GRID)) {
        return { ...it, w: GRID, h: GRID };
      }
      if (it.type === 'powerbox') {
        const s = Math.round(GRID * POWERBOX_SIZE_FACTOR);
        if (it.w !== s || it.h !== s) return { ...it, w: s, h: s };
      }
      if (it.type === 'spawn' && (it.w !== GRID || it.h !== GRID)) {
        return { ...it, w: GRID, h: GRID };
      }
      return it;
    });
  }

  // CANVAS SETUP
  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');
  const stageWrap = document.getElementById('stageWrap');
  const stageControls = document.getElementById('stageControls');
  const cameraHud = document.getElementById('cameraHud');
  const scrollLeftBtn = document.getElementById('scrollLeftBtn');
  const scrollRightBtn = document.getElementById('scrollRightBtn');
  const fullscreenBtn = document.getElementById('fullscreenBtn');
  const settingsBtn = document.getElementById('settingsBtn');
  const worldSelectBtn = document.getElementById('worldSelectBtn');
  const settingsModal = document.getElementById('settingsModal');
  const worldSelectModal = document.getElementById('worldSelectModal');
  const settingsCard = settingsModal ? settingsModal.querySelector('.settings-card') : null;
  const worldSelectCard = worldSelectModal ? worldSelectModal.querySelector('.world-select-card') : null;
  const settingsCloseBtn = document.getElementById('settingsCloseBtn');
  const settingsSaveBtn = document.getElementById('settingsSaveBtn');
  const worldSelectCloseBtn = document.getElementById('worldSelectCloseBtn');
  const worldSelectNotice = document.getElementById('worldSelectNotice');
  const worldOptionButtons = worldSelectModal ? Array.from(worldSelectModal.querySelectorAll('.world-option[data-world-name]')) : [];
  const powerboxHpInput = document.getElementById('powerboxHpInput');
  const powerboxPreviewCanvas = document.getElementById('powerboxPreviewCanvas');
  const baseCanvasCssWidth = Number(canvas.getAttribute('width')) || 1200;
  const baseCanvasCssHeight = Number(canvas.getAttribute('height')) || 800;
  let dpr = window.devicePixelRatio || 1;

  function updateSettingsUiValues() {
    window.__builderPowerboxHp = state.settings.powerboxHp;
    if (powerboxHpInput) {
      powerboxHpInput.value = String(state.settings.powerboxHp);
    }
    updateWorldSelectionUi();
    drawPowerboxPalettePreview();
  }

  function getSelectedWorldSlot() {
    const slot = Number(state.settings.selectedWorldSlot);
    return Number.isFinite(slot) && slot === 1 ? 1 : 0;
  }

  function getWorldSizeBySlot(slot) {
    if (slot === 1) {
      const side = Math.round(Math.max(BASE_WORLD_WIDTH, BASE_WORLD_HEIGHT) * 4);
      return { width: side, height: side };
    }
    if (slot === 2 || slot === 3) {
      return {
        width: Math.round(BASE_WORLD_HEIGHT * 2.5),
        height: Math.round(BASE_WORLD_WIDTH * 2.5)
      };
    }
    if (slot === 4 || slot === 5) {
      return {
        width: Math.round(BASE_WORLD_WIDTH * 2.5),
        height: Math.round(BASE_WORLD_HEIGHT * 2.5)
      };
    }
    return { width: BASE_WORLD_WIDTH, height: BASE_WORLD_HEIGHT };
  }

  function getActiveWorldSize() {
    return getWorldSizeBySlot(getSelectedWorldSlot());
  }

  function updateWorldSelectionUi() {
    const selectedSlot = getSelectedWorldSlot();
    const selectedName = typeof state.settings.selectedWorldName === 'string' ? state.settings.selectedWorldName : '';

    if (worldSelectBtn) {
      worldSelectBtn.textContent = selectedSlot > 0 && selectedName
        ? `עולם: ${selectedName}`
        : 'בחירת עולם';
    }

    for (const btn of worldOptionButtons) {
      const slot = Number(btn.dataset.worldSlot);
      btn.classList.toggle('selected', selectedSlot > 0 && slot === selectedSlot);
    }
  }

  function showWorldUnavailableFeedback(button) {
    if (button) {
      button.classList.remove('denied');
      // Restart animation on repeated clicks.
      void button.offsetWidth;
      button.classList.add('denied');
    }
    if (worldSelectNotice) {
      worldSelectNotice.textContent = 'אי אפשר עכשיו';
      window.clearTimeout(showWorldUnavailableFeedback._timer);
      showWorldUnavailableFeedback._timer = window.setTimeout(() => {
        if (worldSelectNotice.textContent === 'אי אפשר עכשיו') {
          worldSelectNotice.textContent = '';
        }
      }, 1400);
    }
  }

  function openWorldSelect() {
    if (!worldSelectModal) return;
    updateWorldSelectionUi();
    if (worldSelectNotice) worldSelectNotice.textContent = '';
    worldSelectModal.hidden = false;
  }

  function closeWorldSelect() {
    if (!worldSelectModal) return;
    worldSelectModal.hidden = true;
    updateWorldSelectionUi();
  }

  function selectWorld(slot, name) {
    const n = Number(slot);
    if (!Number.isFinite(n) || n < 1 || !name) return;
    if (n !== 1) {
      const pressedBtn = worldOptionButtons.find((btn) => Number(btn.dataset.worldSlot) === n);
      showWorldUnavailableFeedback(pressedBtn);
      return;
    }
    state.settings.selectedWorldSlot = n;
    state.settings.selectedWorldName = String(name);
    state.items = state.items.map(it => {
      const clamped = clampItemToWorld(it);
      return { ...it, x: clamped.x, y: clamped.y };
    });
    clampCamera();
    persistWorldState();
    draw();
    closeWorldSelect();
  }

  function drawPowerboxPalettePreview() {
    if (!powerboxPreviewCanvas) return;
    const ctx2 = powerboxPreviewCanvas.getContext('2d');
    if (!ctx2) return;

    const W = powerboxPreviewCanvas.width;
    const H = powerboxPreviewCanvas.height;
    ctx2.clearRect(0, 0, W, H);

    const bg = ctx2.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#fff9de');
    bg.addColorStop(1, '#f3f4f6');
    ctx2.fillStyle = bg;
    ctx2.fillRect(0, 0, W, H);

    const size = 28;
    const x = Math.round((W - size) / 2);
    const y = Math.round((H - size) / 2);
    const r = 5;

    function roundRectPath(ctxRef, px, py, pw, ph, pr) {
      ctxRef.beginPath();
      ctxRef.moveTo(px + pr, py);
      ctxRef.lineTo(px + pw - pr, py);
      ctxRef.arcTo(px + pw, py, px + pw, py + pr, pr);
      ctxRef.lineTo(px + pw, py + ph - pr);
      ctxRef.arcTo(px + pw, py + ph, px + pw - pr, py + ph, pr);
      ctxRef.lineTo(px + pr, py + ph);
      ctxRef.arcTo(px, py + ph, px, py + ph - pr, pr);
      ctxRef.lineTo(px, py + pr);
      ctxRef.arcTo(px, py, px + pr, py, pr);
      ctxRef.closePath();
    }

    const previewDepth = 6;
    drawTopDownDepth(ctx2, x, y, size, size, previewDepth, '#06b6d4', '#f97316');

    const front = ctx2.createLinearGradient(x, y, x + size, y + size);
    front.addColorStop(0, '#f43f5e');
    front.addColorStop(1, '#8b5cf6');
    roundRectPath(ctx2, x, y, size, size, r);
    ctx2.fillStyle = front;
    ctx2.fill();
    ctx2.strokeStyle = '#374151';
    ctx2.lineWidth = 1.3;
    ctx2.stroke();

    const b1 = { x: x + 1, y: y + size };
    const b2 = { x: x + size, y: y + size };
    const b3 = { x: x + size + previewDepth, y: y + size + previewDepth };
    const b4 = { x: x + 1 + previewDepth, y: y + size + previewDepth };
    function frontPoint(t, u) {
      const nx = b1.x + (b2.x - b1.x) * u;
      const ny = b1.y + (b2.y - b1.y) * u;
      const fx = b4.x + (b3.x - b4.x) * u;
      const fy = b4.y + (b3.y - b4.y) * u;
      return { x: nx + (fx - nx) * t, y: ny + (fy - ny) * t };
    }

    const s1 = frontPoint(0.12, 0.12);
    const s2 = frontPoint(0.12, 0.88);
    const s3 = frontPoint(0.3, 0.88);
    const s4 = frontPoint(0.3, 0.12);
    ctx2.fillStyle = '#facc15';
    ctx2.beginPath();
    ctx2.moveTo(s1.x, s1.y);
    ctx2.lineTo(s2.x, s2.y);
    ctx2.lineTo(s3.x, s3.y);
    ctx2.lineTo(s4.x, s4.y);
    ctx2.closePath();
    ctx2.fill();

    const p1 = frontPoint(0.42, 0.2);
    const p2 = frontPoint(0.42, 0.8);
    const p3 = frontPoint(0.88, 0.8);
    const p4 = frontPoint(0.88, 0.2);
    ctx2.fillStyle = '#d1d5db';
    ctx2.beginPath();
    ctx2.moveTo(p1.x, p1.y);
    ctx2.lineTo(p2.x, p2.y);
    ctx2.lineTo(p3.x, p3.y);
    ctx2.lineTo(p4.x, p4.y);
    ctx2.closePath();
    ctx2.fill();
    ctx2.strokeStyle = '#4b5563';
    ctx2.stroke();

    const wheel = frontPoint(0.64, 0.5);
    const wheelR = 2.2;
    ctx2.strokeStyle = '#374151';
    ctx2.lineWidth = 1.1;
    ctx2.beginPath();
    ctx2.arc(wheel.x, wheel.y, wheelR, 0, Math.PI * 2);
    ctx2.stroke();
    ctx2.beginPath();
    ctx2.moveTo(wheel.x - wheelR * 0.75, wheel.y);
    ctx2.lineTo(wheel.x + wheelR * 0.75, wheel.y);
    ctx2.moveTo(wheel.x, wheel.y - wheelR * 0.75);
    ctx2.lineTo(wheel.x, wheel.y + wheelR * 0.75);
    ctx2.stroke();

    const hpText = String(state.settings.powerboxHp);
    ctx2.fillStyle = 'rgba(17,24,39,0.88)';
    ctx2.fillRect(x + 2, y - 10, size - 4, 9);
    ctx2.fillStyle = '#f9fafb';
    ctx2.font = 'bold 9px Arial';
    ctx2.textAlign = 'center';
    ctx2.textBaseline = 'middle';
    ctx2.fillText(hpText, x + size / 2, y - 5.5);
  }

  function openSettings() {
    if (!settingsModal) return;
    updateSettingsUiValues();
    settingsModal.hidden = false;
  }

  function closeSettings() {
    if (!settingsModal) return;
    settingsModal.hidden = true;
    updateSettingsUiValues();
  }

  function saveSettings() {
    if (!powerboxHpInput) return;
    state.settings.powerboxHp = sanitizePowerboxHp(powerboxHpInput.value);
    powerboxHpInput.value = String(state.settings.powerboxHp);
    persistWorldState();
    draw();
    closeSettings();
  }

  function isStageFullscreen() {
    return document.fullscreenElement === stageWrap;
  }

  function resizeCanvas() {
    const fullscreen = isStageFullscreen();
    if (stageControls) {
      stageControls.style.display = fullscreen ? 'none' : 'flex';
    }

    let cssW = baseCanvasCssWidth;
    let cssH = baseCanvasCssHeight;

    if (fullscreen) {
      cssW = stageWrap.clientWidth;
      cssH = stageWrap.clientHeight;
    }

    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    clampCamera();
    state.items = state.items.map(it => {
      const clamped = clampItemToWorld(it);
      return { ...it, x: clamped.x, y: clamped.y };
    });
    draw();
  }
  window.addEventListener('resize', () => { dpr = window.devicePixelRatio || 1; resizeCanvas(); });

  function updateFullscreenButton() {
    if (!fullscreenBtn) return;
    fullscreenBtn.textContent = isStageFullscreen() ? 'צא ממסך מלא' : 'מסך מלא';
  }

  async function toggleStageFullscreen() {
    if (!stageWrap) return;
    try {
      if (isStageFullscreen()) {
        await document.exitFullscreen();
      } else {
        await stageWrap.requestFullscreen();
      }
    } catch (err) {
      // Ignore fullscreen API errors.
    }
  }

  if (fullscreenBtn) {
    fullscreenBtn.addEventListener('click', toggleStageFullscreen);
  }

  if (settingsBtn) settingsBtn.onclick = openSettings;
  if (worldSelectBtn) worldSelectBtn.onclick = openWorldSelect;
  if (settingsCloseBtn) settingsCloseBtn.onclick = closeSettings;
  if (settingsSaveBtn) settingsSaveBtn.onclick = saveSettings;
  if (worldSelectCloseBtn) worldSelectCloseBtn.onclick = closeWorldSelect;
  for (const btn of worldOptionButtons) {
    btn.addEventListener('click', () => {
      selectWorld(btn.dataset.worldSlot, btn.dataset.worldName);
    });
  }
  if (settingsModal) {
    settingsModal.onclick = (ev) => {
      if (ev.target === settingsModal) closeSettings();
    };
  }
  if (worldSelectModal) {
    worldSelectModal.onclick = (ev) => {
      if (ev.target === worldSelectModal) closeWorldSelect();
    };
  }
  if (settingsCard) {
    settingsCard.onclick = (ev) => {
      ev.stopPropagation();
    };
  }
  if (worldSelectCard) {
    worldSelectCard.onclick = (ev) => {
      ev.stopPropagation();
    };
  }
  if (powerboxHpInput) {
    powerboxHpInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        saveSettings();
      }
      if (ev.key === 'Escape') {
        ev.preventDefault();
        closeSettings();
      }
    });
  }
  window.addEventListener('keydown', (ev) => {
    const target = ev.target;
    const inTextInput = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
    if (!inTextInput && (!settingsModal || settingsModal.hidden) && (!worldSelectModal || worldSelectModal.hidden)) {
      const STEP = GRID * 2;
      if (ev.key === 'ArrowLeft') {
        ev.preventDefault();
        camera.x -= STEP;
        clampCamera();
        draw();
        return;
      }
      if (ev.key === 'ArrowRight') {
        ev.preventDefault();
        camera.x += STEP;
        clampCamera();
        draw();
        return;
      }
      if (ev.key === 'ArrowUp') {
        ev.preventDefault();
        camera.y -= STEP;
        clampCamera();
        draw();
        return;
      }
      if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        camera.y += STEP;
        clampCamera();
        draw();
        return;
      }
    }

    if (ev.key === 'Escape' && settingsModal && !settingsModal.hidden) {
      closeSettings();
      return;
    }
    if (ev.key === 'Escape' && worldSelectModal && !worldSelectModal.hidden) {
      closeWorldSelect();
    }
  });

  document.addEventListener('fullscreenchange', () => {
    updateFullscreenButton();
    resizeCanvas();
  });

  updateFullscreenButton();
  if (settingsModal) settingsModal.hidden = true;
  if (worldSelectModal) worldSelectModal.hidden = true;
  resizeCanvas();
  loadPersistedWorldState();
  updateSettingsUiValues();
  draw();

  // CREATE ROCK TEXTURE - Simple rounded stone
  function createRockTexture(w, h) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');

    // צבע אפור צהבהב בסיסי
    const baseColor = '#9a947d';
    const radius = Math.min(w, h) * 0.15;

    // ציור מרובע עם קצוות עגולים
    ctx.fillStyle = baseColor;
    ctx.beginPath();
    const x = w * 0.05, y = h * 0.05;
    const width = w * 0.9, height = h * 0.9;
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.arcTo(x + width, y, x + width, y + radius, radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.arcTo(x + width, y + height, x + width - radius, y + height, radius);
    ctx.lineTo(x + radius, y + height);
    ctx.arcTo(x, y + height, x, y + height - radius, radius);
    ctx.lineTo(x, y + radius);
    ctx.arcTo(x, y, x + radius, y, radius);
    ctx.closePath();
    ctx.fill();

    // וריאציות קלות בצבע
    for (let i = 0; i < 20; i++) {
      const rx = w * 0.15 + Math.random() * w * 0.7;
      const ry = h * 0.15 + Math.random() * h * 0.7;
      const size = 1 + Math.random() * 3;
      ctx.fillStyle = `rgba(${120 + Math.random() * 40}, ${115 + Math.random() * 35}, ${90 + Math.random() * 30}, 0.25)`;
      ctx.beginPath();
      ctx.arc(rx, ry, size, 0, Math.PI * 2);
      ctx.fill();
    }

    return canvas;
  }

  // CREATE GRASS TEXTURE (TOP-DOWN VIEW)
  function createGrassTexture(w, h) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');

    // רקע בסיס - ירוק דשא
    ctx.fillStyle = '#4a7c3b';
    ctx.fillRect(0, 0, w, h);

    // שכבת וריאציות צבע - גוני ירוק
    for (let i = 0; i < w * h / 4; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const size = 1 + Math.random() * 3;
      const brightness = 60 + Math.random() * 30;
      ctx.fillStyle = `hsl(${105 + Math.random() * 20}, ${40 + Math.random() * 30}%, ${brightness}%)`;
      ctx.fillRect(x, y, size, size);
    }

    // נקודות עשב כהות יותר
    for (let i = 0; i < w * h / 8; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      ctx.fillStyle = `rgba(30, 60, 20, ${0.3 + Math.random() * 0.4})`;
      ctx.beginPath();
      ctx.arc(x, y, 0.5 + Math.random() * 1.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // נקודות בהירות - פרחים קטנים אקראיים
    for (let i = 0; i < 30; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      ctx.fillStyle = `rgba(${150 + Math.random() * 100}, ${200 + Math.random() * 55}, ${100 + Math.random() * 100}, 0.6)`;
      ctx.beginPath();
      ctx.arc(x, y, 0.8 + Math.random() * 1.2, 0, Math.PI * 2);
      ctx.fill();
    }

    return canvas;
  }

  // LOAD IMAGES
  const images = {};
  const loadAll = async () => {
    const keys = Object.keys(ASSETS);
    await Promise.all(keys.map(k => new Promise(res => {
      if (k === 'grass') {
        // צור טקסטורת דשא במבט מלמעלה
        images[k] = createGrassTexture(64, 64);
        res();
      } else if (k === 'rock') {
        // צור אבן עגולה
        images[k] = createRockTexture(64, 64);
        res();
      } else {
        const img = new Image();
        img.onload = () => { images[k] = img; res(); };
        img.onerror = () => { images[k] = null; res(); };
        img.src = ASSETS[k];
      }
    })));
    draw();
  };
  loadAll();

  // DRAW
  function clear() {
    ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  }

  function getLiftByType(type) {
    if (type === 'rock') return ROCK_LIFT;
    if (type === 'grass') return GRASS_LIFT;
    return { left: 0, up: 0, diag: 0 };
  }

  function getGrassRenderSize(item) {
    return Math.min(item.w, item.h);
  }

  function getBottomAlignedY(cellY, renderedHeight) {
    return cellY + (GRID - renderedHeight);
  }

  function getProjectedBounds(item) {
    if (item.type === 'rock' || item.type === 'grass' || item.type === 'powerbox' || item.type === 'spawn') {
      const depth = (item.type === 'spawn') ? 0 : Math.max(4, Math.round(Math.min(item.w, item.h) * 0.2));
      return {
        minX: item.x,
        minY: item.y,
        maxX: item.x + item.w + depth,
        maxY: item.y + item.h + depth
      };
    }

    const lift = getLiftByType(item.type);
    return {
      minX: item.x - lift.left - lift.diag,
      minY: item.y - lift.up - lift.diag,
      maxX: item.x + item.w + lift.diag - lift.left,
      maxY: item.y + item.h + lift.diag - lift.up
    };
  }

  function clampItemToWorld(item) {
    const world = getActiveWorldSize();
    const maxW = world.width;
    const maxH = world.height;
    let nx = item.x;
    let ny = item.y;

    for (let i = 0; i < 2; i++) {
      const b = getProjectedBounds({ ...item, x: nx, y: ny });
      if (b.minX < 0) nx += -b.minX;
      if (b.minY < 0) ny += -b.minY;
      if (b.maxX > maxW) nx -= (b.maxX - maxW);
      if (b.maxY > maxH) ny -= (b.maxY - maxH);
    }

    return { x: nx, y: ny };
  }

  function clampCamera() {
    const world = getActiveWorldSize();
    const maxX = Math.max(0, world.width - canvas.clientWidth);
    const maxY = Math.max(0, world.height - canvas.clientHeight);
    camera.x = Math.min(Math.max(camera.x, 0), maxX);
    camera.y = Math.min(Math.max(camera.y, 0), maxY);
  }

  function eventToCanvasCss(ev) {
    const rect = canvas.getBoundingClientRect();
    const cssX = (ev.clientX - rect.left) * (canvas.width / rect.width) / dpr;
    const cssY = (ev.clientY - rect.top) * (canvas.height / rect.height) / dpr;
    return { cssX, cssY, rect };
  }

  function canvasToWorld(cssX, cssY) {
    return {
      worldX: cssX + camera.x,
      worldY: cssY + camera.y
    };
  }

  function updateCameraHud() {
    if (!cameraHud) return;
    cameraHud.textContent = `X: ${Math.round(camera.x)}  Y: ${Math.round(camera.y)}`;
  }

  function getParallaxState() {
    const viewW = canvas.clientWidth || (canvas.width / dpr) || 1;
    const viewH = canvas.clientHeight || (canvas.height / dpr) || 1;
    const world = getActiveWorldSize();
    const maxX = Math.max(1, world.width - viewW);
    const maxY = Math.max(1, world.height - viewH);

    const nx = Math.min(Math.max(camera.x / maxX, 0), 1);
    const ny = Math.min(Math.max(camera.y / maxY, 0), 1);

    const blockOffsetX = (nx - 0.5) * 10;
    const blockOffsetY = (0.5 - ny) * 7;

    return { blockOffsetX, blockOffsetY };
  }

  function drawPoly(points, fillStyle, strokeStyle = null) {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.closePath();
    ctx.fillStyle = fillStyle;
    ctx.fill();
    if (strokeStyle) {
      ctx.strokeStyle = strokeStyle;
      ctx.stroke();
    }
  }

  function roundedRectPath(ctxRef, x, y, w, h, r) {
    ctxRef.beginPath();
    ctxRef.moveTo(x + r, y);
    ctxRef.lineTo(x + w - r, y);
    ctxRef.arcTo(x + w, y, x + w, y + r, r);
    ctxRef.lineTo(x + w, y + h - r);
    ctxRef.arcTo(x + w, y + h, x + w - r, y + h, r);
    function drawPoly(points, fillStyle, strokeStyle = null, ctxArg) {
      const ctxLocal = ctxArg || ctx;
      ctxLocal.save();
      ctxLocal.beginPath();
      ctxLocal.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) ctxLocal.lineTo(points[i].x, points[i].y);
      ctxLocal.closePath();
      ctxLocal.fillStyle = fillStyle;
      ctxLocal.fill();
      if (strokeStyle) {
        ctxLocal.strokeStyle = strokeStyle;
        ctxLocal.lineWidth = 1.2;
        ctxLocal.stroke();
      }
      ctxLocal.restore();
    }
    ctxRef.lineTo(x + r, y + h);
    ctxRef.arcTo(x, y + h, x, y + h - r, r);
    ctxRef.lineTo(x, y + r);
    ctxRef.arcTo(x, y, x + r, y, r);
    ctxRef.closePath();
  }

  function drawTopDownDepth(ctxRef, x, y, w, h, depth, sideColor, bottomColor) {
    if (depth <= 0) return;

    // Right face.
    ctxRef.fillStyle = sideColor;
    ctxRef.beginPath();
    ctxRef.moveTo(x + w, y + 1);
    ctxRef.lineTo(x + w + depth, y + depth + 1);
    ctxRef.lineTo(x + w + depth, y + h + depth);
    ctxRef.lineTo(x + w, y + h);
    ctxRef.closePath();
    ctxRef.fill();

    // Bottom face.
    ctxRef.fillStyle = bottomColor;
    ctxRef.beginPath();
    ctxRef.moveTo(x + 1, y + h);
    ctxRef.lineTo(x + w, y + h);
    ctxRef.lineTo(x + w + depth, y + h + depth);
    ctxRef.lineTo(x + depth + 1, y + h + depth);
    ctxRef.closePath();
    ctxRef.fill();
  }

  function drawStandingGameStone(ctx, x, y, width, height, radius, opts = {}) {
    const r = Math.max(2, radius || Math.round(Math.min(width, height) * 0.14));
    const depth = Math.max(4, Math.round(Math.min(width, height) * 0.2));

    ctx.save();

    ctx.fillStyle = 'rgba(15, 23, 42, 0.22)';
    ctx.beginPath();
    ctx.ellipse(x + width * 0.6, y + height + depth + 2, width * 0.52, Math.max(3, depth * 0.85), 0, 0, Math.PI * 2);
    ctx.fill();

    drawTopDownDepth(ctx, x, y, width, height, depth, '#5e6672', '#4f5662');

    roundedRectPath(ctx, x, y, width, height, r);

    const grad = ctx.createLinearGradient(x, y, x + width, y + height);
    grad.addColorStop(0, '#d3d7de');
    grad.addColorStop(1, '#7b8391');
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.save();
    ctx.clip();
    for (let i = 0; i < 24; i++) {
      const px = x + Math.random() * width;
      const py = y + Math.random() * height;
      const s = 1 + Math.random() * 2;
      ctx.fillStyle = `rgba(${95 + Math.random() * 40}, ${100 + Math.random() * 40}, ${110 + Math.random() * 40}, 0.28)`;
      ctx.fillRect(px, py, s, s);
    }
    ctx.restore();

    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + r + 1, y + 3);
    ctx.lineTo(x + width - r - 1, y + 3);
    ctx.stroke();
    ctx.restore();
  }

  function draw3DGrassBlock(ctx, x, y, size, radius, opts = {}) {
    const r = Math.max(2, radius || Math.round(size * 0.1));
    const depth = Math.max(4, Math.round(size * 0.2));

    ctx.save();

    ctx.fillStyle = 'rgba(20, 83, 45, 0.22)';
    ctx.beginPath();
    ctx.ellipse(x + size * 0.6, y + size + depth + 2, size * 0.54, Math.max(3, depth * 0.9), 0, 0, Math.PI * 2);
    ctx.fill();

    drawTopDownDepth(ctx, x, y, size, size, depth, '#2f8f3a', '#2b7f38');

    // Keep 75% green / 25% brown on the front depth faces (not on top face).
    const tRight = 0.55;
    const tBottom = 0.55;

    // Right face points.
    const r1 = { x: x + size, y: y + 1 };
    const r2 = { x: x + size + depth, y: y + depth + 1 };
    const r3 = { x: x + size + depth, y: y + size + depth };
    const r4 = { x: x + size, y: y + size };
    const rr1 = { x: r1.x + (r2.x - r1.x) * tRight, y: r1.y + (r2.y - r1.y) * tRight };
    const rr2 = { x: r4.x + (r3.x - r4.x) * tRight, y: r4.y + (r3.y - r4.y) * tRight };
    ctx.fillStyle = '#7a4a22';
    ctx.beginPath();
    ctx.moveTo(rr1.x, rr1.y);
    ctx.lineTo(r2.x, r2.y);
    ctx.lineTo(r3.x, r3.y);
    ctx.lineTo(rr2.x, rr2.y);
    ctx.closePath();
    ctx.fill();

    // Bottom/front face points.
    const b1 = { x: x + 1, y: y + size };
    const b2 = { x: x + size, y: y + size };
    const b3 = { x: x + size + depth, y: y + size + depth };
    const b4 = { x: x + depth + 1, y: y + size + depth };
    const bb1 = { x: b1.x + (b4.x - b1.x) * tBottom, y: b1.y + (b4.y - b1.y) * tBottom };
    const bb2 = { x: b2.x + (b3.x - b2.x) * tBottom, y: b2.y + (b3.y - b2.y) * tBottom };
    ctx.beginPath();
    ctx.moveTo(bb1.x, bb1.y);
    ctx.lineTo(bb2.x, bb2.y);
    ctx.lineTo(b3.x, b3.y);
    ctx.lineTo(b4.x, b4.y);
    ctx.closePath();
    ctx.fill();

    roundedRectPath(ctx, x, y, size, size, r);

    const grad = ctx.createLinearGradient(x, y, x + size, y + size);
    grad.addColorStop(0, '#67d66f');
    grad.addColorStop(1, '#2e8c3d');
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.save();
    ctx.clip();
    for (let i = 0; i < 46; i++) {
      const px = x + Math.random() * size;
      const py = y + Math.random() * size;
      const blade = 1 + Math.random() * 2;
      ctx.fillStyle = `rgba(${30 + Math.random() * 40}, ${130 + Math.random() * 80}, ${25 + Math.random() * 25}, 0.5)`;
      ctx.fillRect(px, py, blade, blade);
    }
    ctx.restore();

    ctx.strokeStyle = 'rgba(26, 84, 39, 0.8)';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(x + r + 1, y + 3);
    ctx.lineTo(x + size - r - 1, y + 3);
    ctx.stroke();
    ctx.restore();
  }

  function drawPowerSafeCrate(ctx, x, y, size, opts = {}) {
    const depth = Math.max(4, Math.round(size * 0.2));
    const colors = {
      top: '#f43f5e',
      bottom: '#8b5cf6',
      panel: '#d1d5db',
      panelEdge: '#4b5563',
      outline: '#1f2937',
      hpBg: 'rgba(17, 24, 39, 0.85)',
      hpText: '#f9fafb'
    };

    ctx.save();

    ctx.fillStyle = 'rgba(17, 24, 39, 0.22)';
    ctx.beginPath();
    ctx.ellipse(x + size * 0.62, y + size + depth + 2, size * 0.5, Math.max(3, depth * 0.9), 0, 0, Math.PI * 2);
    ctx.fill();

    drawTopDownDepth(ctx, x, y, size, size, depth, '#06b6d4', '#f97316');

    const front = ctx.createLinearGradient(x, y, x + size, y + size);
    front.addColorStop(0, colors.top);
    front.addColorStop(1, colors.bottom);
    ctx.fillStyle = front;
    ctx.fillRect(x, y, size, size);

    ctx.strokeStyle = colors.outline;
    ctx.lineWidth = 1.4;
    ctx.strokeRect(x, y, size, size);

    const b1 = { x: x + 1, y: y + size };
    const b2 = { x: x + size, y: y + size };
    const b3 = { x: x + size + depth, y: y + size + depth };
    const b4 = { x: x + depth + 1, y: y + size + depth };
    function frontPoint(t, u) {
      const nx = b1.x + (b2.x - b1.x) * u;
      const ny = b1.y + (b2.y - b1.y) * u;
      const fx = b4.x + (b3.x - b4.x) * u;
      const fy = b4.y + (b3.y - b4.y) * u;
      return { x: nx + (fx - nx) * t, y: ny + (fy - ny) * t };
    }

    const s1 = frontPoint(0.12, 0.12);
    const s2 = frontPoint(0.12, 0.88);
    const s3 = frontPoint(0.32, 0.88);
    const s4 = frontPoint(0.32, 0.12);
    ctx.fillStyle = '#facc15';
    ctx.beginPath();
    ctx.moveTo(s1.x, s1.y);
    ctx.lineTo(s2.x, s2.y);
    ctx.lineTo(s3.x, s3.y);
    ctx.lineTo(s4.x, s4.y);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    const sh1 = frontPoint(0.16, 0.2);
    const sh2 = frontPoint(0.16, 0.8);
    ctx.moveTo(sh1.x, sh1.y);
    ctx.lineTo(sh2.x, sh2.y);
    ctx.stroke();

    const p1 = frontPoint(0.46, 0.2);
    const p2 = frontPoint(0.46, 0.8);
    const p3 = frontPoint(0.9, 0.8);
    const p4 = frontPoint(0.9, 0.2);
    ctx.fillStyle = colors.panel;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.lineTo(p3.x, p3.y);
    ctx.lineTo(p4.x, p4.y);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = colors.panelEdge;
    ctx.stroke();

    const wheel = frontPoint(0.68, 0.5);
    const wheelR = Math.max(3, size * 0.075);
    ctx.strokeStyle = colors.panelEdge;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(wheel.x, wheel.y, wheelR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(wheel.x - wheelR * 0.8, wheel.y);
    ctx.lineTo(wheel.x + wheelR * 0.8, wheel.y);
    ctx.moveTo(wheel.x, wheel.y - wheelR * 0.8);
    ctx.lineTo(wheel.x, wheel.y + wheelR * 0.8);
    ctx.stroke();

    // HP display above the crate.
    const hpText = String(state.settings.powerboxHp);
    const fontSize = Math.max(10, Math.round(size * 0.28));
    ctx.font = `bold ${fontSize}px Arial`;
    const textW = ctx.measureText(hpText).width;
    const hpPadX = 6;
    const hpPadY = 4;
    const hpX = x + size / 2 - textW / 2 - hpPadX;
    const hpY = y - fontSize - 7;
    const hpW = textW + hpPadX * 2;
    const hpH = fontSize + hpPadY * 2;

    ctx.fillStyle = colors.hpBg;
    ctx.fillRect(hpX, hpY, hpW, hpH);
    ctx.strokeStyle = 'rgba(250, 204, 21, 0.9)';
    ctx.lineWidth = 1;
    ctx.strokeRect(hpX, hpY, hpW, hpH);

    ctx.fillStyle = colors.hpText;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(hpText, hpX + hpW / 2, hpY + hpH / 2 + 0.5);

    ctx.restore();
  }

  function draw3DBlock(ctx, item, terrainAdjacency, viewState) {
    const parallax = viewState || { blockOffsetX: 0, blockOffsetY: 0 };
    const offsetX = parallax.blockOffsetX || 0;
    const offsetY = parallax.blockOffsetY || 0;

    if (item.type === 'rock') {
      drawStandingGameStone(ctx, item.x + offsetX, item.y + offsetY, item.w, item.h, 3);
      return;
    }

    if (item.type === 'grass') {
      draw3DGrassBlock(ctx, item.x + offsetX, item.y + offsetY, item.w, 3);
      return;
    }

    if (item.type === 'powerbox') {
      drawPowerSafeCrate(ctx, item.x + offsetX, item.y + offsetY, item.w);
      return;
    }

    const lift = getLiftByType(item.type);
    const x = item.x + offsetX;
    const y = item.y + offsetY;
    const w = item.w;
    const h = item.h;

    const A = { x: x - lift.left - lift.diag, y: y - lift.up - lift.diag };
    const B = { x: x + w - lift.left, y: y - lift.up };
    const C = { x: x + w + lift.diag - lift.left, y: y + h + lift.diag - lift.up };
    const D = { x: x - lift.diag - lift.left, y: y + h - lift.up };

    const a = { x, y };
    const b = { x: x + w, y };
    const c = { x: x + w, y: y + h };
    const d = { x, y: y + h };

    const isGrass = item.type === 'grass';
    const top = isGrass ? '#6ec457' : '#b9b29c';
    const right = isGrass ? '#4b9b3a' : '#9f9882';
    const front = isGrass ? '#367f2f' : '#837d69';
    const left = isGrass ? '#58ab44' : '#a9a28d';
    const edge = 'rgba(0,0,0,0.28)';

    drawPoly(ctx, [A, B, C, D], top, edge);
    drawPoly(ctx, [B, C, c, b], right, edge);
    drawPoly(ctx, [D, C, c, d], front, edge);
    drawPoly(ctx, [A, D, d, a], left, edge);

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(A.x, A.y);
    ctx.lineTo(B.x, B.y);
    ctx.lineTo(C.x, C.y);
    ctx.lineTo(D.x, D.y);
    ctx.closePath();
    ctx.clip();

    const topGrad = ctx.createLinearGradient(A.x, A.y, C.x, C.y);
    if (isGrass) {
      topGrad.addColorStop(0, 'rgba(255,255,255,0.30)');
      topGrad.addColorStop(1, 'rgba(0,0,0,0.10)');
    } else {
      topGrad.addColorStop(0, 'rgba(255,255,255,0.24)');
      topGrad.addColorStop(1, 'rgba(0,0,0,0.14)');
    }
    ctx.fillStyle = topGrad;
    ctx.fillRect(A.x - 2, A.y - 2, (w + lift.diag) + 4, (h + lift.diag) + 4);

    ctx.fillStyle = isGrass ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.18)';
    drawPoly(ctx, [
      { x: A.x + 4, y: A.y + 4 },
      { x: A.x + w * 0.45, y: A.y + 5 },
      { x: A.x + w * 0.38, y: A.y + h * 0.28 },
      { x: A.x + 6, y: A.y + h * 0.24 }
    ], ctx.fillStyle);

    ctx.strokeStyle = isGrass ? 'rgba(255,255,255,0.26)' : 'rgba(255,255,255,0.20)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(A.x + 5, A.y + 3);
    ctx.lineTo(B.x - 5, B.y + 2);
    ctx.stroke();

    ctx.restore();
  }

  function drawSpawnPoint(ctx, item, viewState) {
    const parallax = viewState || { blockOffsetX: 0, blockOffsetY: 0 };
    const x = item.x + (parallax.blockOffsetX || 0);
    const y = item.y + (parallax.blockOffsetY || 0);
    const w = item.w;
    const h = item.h;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const r = Math.max(4, Math.min(w, h) * 0.35);

    ctx.save();
    const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.2, cx, cy, r);
    g.addColorStop(0, '#f1f5f9');
    g.addColorStop(0.6, '#94a3b8');
    g.addColorStop(1, '#64748b');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(30, 41, 59, 0.8)';
    ctx.lineWidth = 1.3;
    ctx.stroke();
    ctx.restore();
  }

  function drawItem(it, terrainAdjacency, viewState) {
    if (it.type === 'grass' || it.type === 'rock' || it.type === 'powerbox') {
      draw3DBlock(ctx, it, terrainAdjacency, viewState);
      return;
    }
    if (it.type === 'spawn') {
      drawSpawnPoint(ctx, it, viewState);
      return;
    }
    if (images[it.type]) {
      ctx.drawImage(images[it.type], it.x, it.y, it.w, it.h);
    } else {
      ctx.fillStyle = '#90EE90';
      ctx.fillRect(it.x, it.y, it.w, it.h);
    }
  }

  function buildTerrainAdjacency(items) {
    const terrain = items.filter(it => it.type === 'grass' || it.type === 'rock');
    const TOUCH_EPS = 8;

    return {
      hasRightNeighbor(item) {
        if (item.type !== 'grass' && item.type !== 'rock') return false;

        for (const other of terrain) {
          if (other === item) continue;

          const itemRight = item.x + item.w;
          const touchGap = Math.abs(other.x - itemRight);

          const overlapTop = Math.max(item.y, other.y);
          const overlapBottom = Math.min(item.y + item.h, other.y + other.h);
          const overlapHeight = overlapBottom - overlapTop;

          // Connected means blocks are really side-by-side (touching) with vertical overlap.
          if (touchGap <= TOUCH_EPS && overlapHeight > 0) {
            return true;
          }
        }
        return false;
      }
    };
  }

  function compareItemsByLayer(a, b) {
    // Draw upper-screen items first so lower-screen items stay visually on top.
    return (a.y - b.y) || (a.x - b.x);
  }

  function draw() {
    normalizeTerrainItemsToGridSize();
    clear();
    const terrainAdjacency = buildTerrainAdjacency(state.items);
    const viewState = getParallaxState();
    ctx.save();
    if (previewMode) {
      ctx.setTransform(dpr * previewScale, 0, 0, dpr * previewScale, dpr * previewOffsetX, dpr * previewOffsetY);
    } else {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.translate(-camera.x, -camera.y);
    }
    const sorted = [...state.items].sort(compareItemsByLayer);
    for (const it of sorted) drawItem(it, terrainAdjacency, viewState);
    ctx.restore();
    updateCameraHud();
    // dragging preview handled elsewhere
  }

  function getTopItemAtWorld(worldX, worldY) {
    const sorted = [...state.items].sort(compareItemsByLayer);
    for (let i = sorted.length - 1; i >= 0; i--) {
      const it = sorted[i];
      const b = getProjectedBounds(it);
      if (worldX >= b.minX && worldX <= b.maxX && worldY >= b.minY && worldY <= b.maxY) {
        return it;
      }
    }
    return null;
  }

  // SNAP
  function snap(v) {
    return Math.round(v / PLACEMENT_SNAP_STEP) * PLACEMENT_SNAP_STEP;
  }

  // ACTIONS
  function pushUndo() {
    state.undoStack.push(JSON.stringify(state.items));
    if (state.undoStack.length > 100) state.undoStack.shift();
    state.redoStack = [];
  }
  function undo() {
    if (!state.undoStack.length) return;
    state.redoStack.push(JSON.stringify(state.items));
    const prev = state.undoStack.pop();
    state.items = JSON.parse(prev);
    persistWorldState();
    draw();
  }
  function redo() {
    if (!state.redoStack.length) return;
    state.undoStack.push(JSON.stringify(state.items));
    const next = state.redoStack.pop();
    state.items = JSON.parse(next);
    persistWorldState();
    draw();
  }

  function clearAllItems() {
    if (!state.items.length) return;
    pushUndo();
    state.items = [];
    persistWorldState();
    draw();
  }

  // PALETTE DRAGGING
  let dragging = null; // {type, x,y, w,h, source:'palette'|'world', id}
  let cameraPan = null; // {pointerId,startClientX,startClientY,startCameraX,startCameraY,fromRightButton,moved}
  let ignoreNextContextDelete = false;
  const paletteEls = document.querySelectorAll('.resource');
  paletteEls.forEach(el => {
    el.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      const { type } = el.dataset;
      const placementSize = getPlacementSizeByType(type);
      dragging = { type, x: null, y: null, w: placementSize, h: placementSize, source: 'palette' };
      canvas.setPointerCapture && canvas.setPointerCapture(ev.pointerId);
    });
  });

  // WORLD DRAGGING
  let dragFromWorld = null; // {id, offsetX, offsetY, startX, startY}
  canvas.addEventListener('pointerdown', (ev) => {
    if (ev.button === 1 || ev.button === 2 || (ev.button === 0 && ev.shiftKey)) {
      ev.preventDefault();
      cameraPan = {
        pointerId: ev.pointerId,
        startClientX: ev.clientX,
        startClientY: ev.clientY,
        startCameraX: camera.x,
        startCameraY: camera.y,
        fromRightButton: ev.button === 2,
        moved: false
      };
      canvas.style.cursor = 'grabbing';
      return;
    }

    const { cssX, cssY } = eventToCanvasCss(ev);
    const { worldX, worldY } = canvasToWorld(cssX, cssY);
    const sorted = [...state.items].sort(compareItemsByLayer);
    let hitAny = false;
    for (let i = sorted.length - 1; i >= 0; i--) {
      const it = sorted[i];
      const b = getProjectedBounds(it);
      if (worldX >= b.minX && worldX <= b.maxX && worldY >= b.minY && worldY <= b.maxY) {
        hitAny = true;
        dragFromWorld = { id: it.id, offsetX: worldX - it.x, offsetY: worldY - it.y, startX: it.x, startY: it.y };
        dragging = { type: it.type, x: it.x, y: it.y, w: it.w, h: it.h, source: 'world', id: it.id };
        pushUndo();
        break;
      }
    }

    // Left-drag on empty space pans the camera.
    if (ev.button === 0 && !hitAny) {
      ev.preventDefault();
      cameraPan = {
        pointerId: ev.pointerId,
        startClientX: ev.clientX,
        startClientY: ev.clientY,
        startCameraX: camera.x,
        startCameraY: camera.y,
        fromRightButton: false,
        moved: false
      };
      canvas.style.cursor = 'grabbing';
    }
  });

  canvas.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const speed = 1;
    if (ev.shiftKey) {
      camera.x += ev.deltaY * speed;
    } else {
      camera.x += ev.deltaX * speed;
      camera.y += ev.deltaY * speed;
    }
    clampCamera();
    draw();
  }, { passive: false });

  // Right click deletes the topmost item under the cursor.
  canvas.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    if (ignoreNextContextDelete) {
      ignoreNextContextDelete = false;
      return;
    }
    const { cssX, cssY } = eventToCanvasCss(ev);
    const { worldX, worldY } = canvasToWorld(cssX, cssY);
    const hit = getTopItemAtWorld(worldX, worldY);
    if (!hit) return;

    const idx = state.items.findIndex(i => i.id === hit.id);
    if (idx === -1) return;

    pushUndo();
    state.items.splice(idx, 1);
    persistWorldState();
    draw();
  });

  window.addEventListener('pointermove', (ev) => {
    if (cameraPan && ev.pointerId === cameraPan.pointerId) {
      const dx = ev.clientX - cameraPan.startClientX;
      const dy = ev.clientY - cameraPan.startClientY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        cameraPan.moved = true;
      }
      camera.x = cameraPan.startCameraX - dx;
      camera.y = cameraPan.startCameraY - dy;
      clampCamera();
      draw();
      return;
    }

    if (!dragging) return;
    const { cssX, cssY, rect } = eventToCanvasCss(ev);
    const { worldX, worldY } = canvasToWorld(cssX, cssY);

    if (dragging.source === 'palette') {
      // show preview only when over canvas
      if (ev.clientX >= rect.left && ev.clientX <= rect.right && ev.clientY >= rect.top && ev.clientY <= rect.bottom) {
        const baseX = snap(worldX - dragging.w / 2);
        const rawY = snap(worldY - dragging.h);
        const rawX = applyTerrainPlacementShift(dragging.type, baseX);
        const clamped = clampItemToWorld({ ...dragging, x: rawX, y: rawY });
        dragging.x = clamped.x;
        dragging.y = clamped.y;
      } else {
        dragging.x = null; dragging.y = null;
      }
    } else if (dragging.source === 'world') {
      // move existing item
      const it = state.items.find(i => i.id === dragging.id);
      if (!it) return;
      const rawX = snap(worldX - dragFromWorld.offsetX);
      const rawY = snap(worldY - dragFromWorld.offsetY);
      const clamped = clampItemToWorld({ ...it, x: rawX, y: rawY });
      it.x = clamped.x;
      it.y = clamped.y;
    }
    draw();
    ctx.save();
    ctx.translate(-camera.x, -camera.y);
    // draw preview if palette drag
    if (dragging.source === 'palette' && dragging.x != null) {
      ctx.save();
      ctx.globalAlpha = 0.9;
      drawItem({ ...dragging }, null, getParallaxState());
      ctx.restore();
    }
    ctx.restore();
  });

  window.addEventListener('pointerup', (ev) => {
    if (cameraPan && ev.pointerId === cameraPan.pointerId) {
      if (cameraPan.fromRightButton && cameraPan.moved) {
        ignoreNextContextDelete = true;
      }
      cameraPan = null;
      canvas.style.cursor = 'default';
      return;
    }

    if (!dragging) return;
    const { cssX, cssY, rect } = eventToCanvasCss(ev);
    const { worldX, worldY } = canvasToWorld(cssX, cssY);

    if (dragging.source === 'palette') {
      // dropped on canvas?
      if (ev.clientX >= rect.left && ev.clientX <= rect.right && ev.clientY >= rect.top && ev.clientY <= rect.bottom) {
        let clamped;
        if (dragging.x != null && dragging.y != null) {
          clamped = { x: dragging.x, y: dragging.y };
        } else {
          const baseX = snap(worldX - dragging.w / 2);
          const rawY = snap(worldY - dragging.h);
          const rawX = applyTerrainPlacementShift(dragging.type, baseX);
          clamped = clampItemToWorld({ ...dragging, x: rawX, y: rawY });
        }
        pushUndo();
        state.items.push({ id: uid(), type: dragging.type, x: clamped.x, y: clamped.y, w: dragging.w, h: dragging.h });
        persistWorldState();
      }
    } else if (dragging.source === 'world') {
      persistWorldState();
    }

    dragging = null;
    dragFromWorld = null;
    draw();
  });

  // BACKGROUND COLOR CONTROL
  const bgColorPicker = document.getElementById('bgColorPicker');
  const colorDisplay = document.getElementById('colorDisplay');
  bgColorPicker.addEventListener('input', (ev) => {
    const color = ev.target.value;
    canvas.style.background = color;
    colorDisplay.textContent = `נבחר: ${color}`;
  });

  // TOOLS
  function nudgeHorizontal(dir) {
    const STEP = GRID * 4;
    camera.x += dir * STEP;
    clampCamera();
    draw();
  }

  let holdTimer = null;
  function stopHorizontalHold() {
    if (holdTimer) {
      clearInterval(holdTimer);
      holdTimer = null;
    }
  }

  function startHorizontalHold(dir) {
    stopHorizontalHold();
    nudgeHorizontal(dir);
    holdTimer = setInterval(() => nudgeHorizontal(dir), 85);
  }

  function bindHoldScroll(button, dir) {
    if (!button) return;
    button.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      startHorizontalHold(dir);
    });
    button.addEventListener('pointerup', stopHorizontalHold);
    button.addEventListener('pointerleave', stopHorizontalHold);
    button.addEventListener('pointercancel', stopHorizontalHold);
  }

  bindHoldScroll(scrollLeftBtn, -1);
  bindHoldScroll(scrollRightBtn, 1);
  window.addEventListener('pointerup', stopHorizontalHold);

  document.getElementById('undoBtn').addEventListener('click', undo);
  document.getElementById('redoBtn').addEventListener('click', redo);
  document.getElementById('clearAllBtn').addEventListener('click', clearAllItems);
  document.getElementById('exportBtn').addEventListener('click', () => {
    const data = JSON.stringify({ items: state.items, settings: state.settings }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'world.json'; a.click();
    URL.revokeObjectURL(url);
  });
  document.getElementById('importFile').addEventListener('change', (ev) => {
    const f = ev.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const parsed = JSON.parse(r.result);
        pushUndo();
        state.items = parsed.items || [];
        const nextSettings = parsed && parsed.settings ? parsed.settings : {};
        state.settings.powerboxHp = sanitizePowerboxHp(nextSettings.powerboxHp);
        updateSettingsUiValues();
        persistWorldState();
        draw();
      } catch (err) { alert('Invalid JSON'); }
    };
    r.readAsText(f);
  });
  // ...existing code...
})();