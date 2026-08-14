import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { ViewHelper } from "three/addons/helpers/ViewHelper.js";

// ======================================================
// 1. 基本設定（Basic Settings）
// ======================================================

const VERTICAL_EXAGGERATION = 1;

const METADATA_URL = "/heightmap_metadata.json";
const HEIGHTMAP_URL = "/heightmap_float32.bin";

const MOON_OVERVIEW_COLOR_MAP_URL = "/moon/lroc_color_2k.jpg";
const MOON_OVERVIEW_BUMP_MAP_URL = "/moon/ldem_3_8bit.jpg";

const DEFAULT_MOON_RADIUS_METERS = 1_737_400;
const CENTRAL_MERIDIAN_DEGREES = 0;

const ROUTE_SAMPLE_INTERVAL_METERS = 5;
const ROUTE_SURFACE_OFFSET_KM = 0.0001;
const ROUTE_LINE_RADIUS_KM = 0.003;

const MARKER_RADIUS_KM = 0.008;
const MARKER_SURFACE_GAP_KM = 0.001;
const FLAG_MARKER_SCALE = 1.6;

const NAMED_POINT_LATITUDE_DEGREES = -84.122515;
const NAMED_POINT_LONGITUDE_DEGREES = 57.725892;
const NAMED_POINT_COLOR = 0x9c27b0;

const SAFE_SLOPE_DEGREES = 10;
const WARNING_SLOPE_DEGREES = 15;

const LOCAL_SPIKE_THRESHOLD_METERS = 15;
const MIN_VALID_NEIGHBOURS = 5;

const DEFAULT_INTERFACE_SCALE = 0.82;
const MIN_INTERFACE_SCALE = 0.6;
const MAX_INTERFACE_SCALE = 1.2;

const KNOWN_NODATA_VALUES = [
  -9999,
  -32768,
  32767,
  -3.4028235e38,
  3.4028235e38
];

// 坡度圖層顏色（Slope Layer Colors）
const SLOPE_COLOR_0_TO_5 = new THREE.Color(0x245cff);
const SLOPE_COLOR_5_TO_10 = new THREE.Color(0x67d9ff);
const SLOPE_COLOR_10_TO_15 = new THREE.Color(0xffdf3f);
const SLOPE_COLOR_15_TO_20 = new THREE.Color(0xff3b30);
const SLOPE_COLOR_ABOVE_20 = new THREE.Color(0x800000);

// 高程色帶顏色（Elevation Band Colors）
const ELEVATION_COLORS = [
  new THREE.Color(0x132a73),
  new THREE.Color(0x245cff),
  new THREE.Color(0x20bfc7),
  new THREE.Color(0x42a84b),
  new THREE.Color(0xd6d33f),
  new THREE.Color(0xff962f),
  new THREE.Color(0xe63b2e)
];

const INVALID_COLOR = new THREE.Color(0x000000);

// ======================================================
// 2. 全域資料（Global Data）
// ======================================================

let terrain = null;
let terrainMetadata = null;

let rawTerrainElevations = null;
let terrainElevations = null;

let terrainWidthKm = 0;
let terrainDepthKm = 0;

let normalTerrainColors = null;
let slopeTerrainColors = null;
let elevationTerrainColors = null;

let slopeLayerEnabled = false;
let elevationLayerEnabled = false;

let startPoint = null;
let goalPoint = null;

let routeLine = null;
let routeSamples = [];

let namedPointMarker = null;

let interfaceScale = DEFAULT_INTERFACE_SCALE;
let allPanelsVisible = true;

const INTERFACE_LANGUAGE_STORAGE_KEY = "interfaceLanguage";

let currentLanguage =
  localStorage.getItem(
    INTERFACE_LANGUAGE_STORAGE_KEY
  ) === "zh"
    ? "zh"
    : "en";

let profileCanvasReady = false;

let demCleaningStatistics = {
  invalidValues: 0,
  repairedInvalidValues: 0,
  spikeValues: 0,
  remainingInvalidValues: 0
};

// ======================================================
// 3. 建立 Three.js 場景（Create Three.js Scene）
// ======================================================

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050608);

const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.001,
  10000
);

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: "high-performance"
});

renderer.setPixelRatio(
  Math.min(window.devicePixelRatio, 1.5)
);

renderer.setSize(
  window.innerWidth,
  window.innerHeight
);

renderer.outputColorSpace = THREE.SRGBColorSpace;

document.body.style.margin = "0";
document.body.style.overflow = "hidden";
document.body.style.background = "#050608";

document.body.appendChild(renderer.domElement);

// ======================================================
// 4. 相機控制（Camera Controls）
// ======================================================

const controls = new OrbitControls(
  camera,
  renderer.domElement
);

controls.enableDamping = true;
controls.dampingFactor = 0.06;

controls.enableRotate = true;
controls.enableZoom = true;
controls.enablePan = true;

controls.maxPolarAngle = Math.PI * 0.495;

// ======================================================
// 4A. 方向指標（View Orientation Gizmo）
// ======================================================

const viewHelper = new ViewHelper(
  camera,
  renderer.domElement
);

viewHelper.setLabels(
  "X",
  "Y",
  "Z"
);

const viewHelperTimer = new THREE.Timer();

renderer.autoClear = false;

// ======================================================
// 5. 光源（Lights）
// ======================================================

scene.add(
  new THREE.AmbientLight(
    0xffffff,
    0.35
  )
);

const hemisphereLight = new THREE.HemisphereLight(
  0xdde8ff,
  0x101216,
  0.55
);

scene.add(hemisphereLight);

const sunlight = new THREE.DirectionalLight(
  0xffffff,
  2.2
);

sunlight.position.set(
  -20,
  25,
  15
);

scene.add(sunlight);

const fillLight = new THREE.DirectionalLight(
  0x8090aa,
  0.2
);

fillLight.position.set(
  20,
  10,
  -20
);

scene.add(fillLight);

// ======================================================
// 6. 網格與座標軸（Grid and Axes）
// ======================================================

const gridHelper = new THREE.GridHelper(
  10,
  20,
  0x555555,
  0x222222
);

scene.add(gridHelper);

const axesHelper = new THREE.AxesHelper(2);

scene.add(axesHelper);

// ======================================================
// 7. 介面樣式（Interface Styles）
// ======================================================

const interfaceStyle = document.createElement("style");

interfaceStyle.textContent = `
  :root {
    --interface-scale: ${DEFAULT_INTERFACE_SCALE};
  }

  :root[data-lang="zh"] .lang-en {
    display: none;
  }

  :root[data-lang="en"] .lang-zh {
    display: none;
  }

  .interface-panel {
    position: fixed;
    z-index: 20;
    padding: 13px 15px;
    color: #ffffff;
    background: rgba(0, 0, 0, 0.84);
    border: 1px solid rgba(255, 255, 255, 0.28);
    border-radius: 7px;
    font-family: Arial, sans-serif;
    font-size: 14px;
    line-height: 1.6;
    box-sizing: border-box;
    backdrop-filter: blur(3px);
    zoom: var(--interface-scale);
  }

  .interface-panel-hidden {
    display: none !important;
  }

  .layer-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 10px;
  }

  .layer-switch {
    position: relative;
    display: inline-block;
    width: 52px;
    height: 28px;
    flex-shrink: 0;
  }

  .layer-switch input {
    opacity: 0;
    width: 0;
    height: 0;
  }

  .layer-slider {
    position: absolute;
    cursor: pointer;
    inset: 0;
    background: #444444;
    border: 1px solid rgba(255, 255, 255, 0.35);
    transition: 0.2s;
    border-radius: 28px;
  }

  .layer-slider::before {
    position: absolute;
    content: "";
    width: 20px;
    height: 20px;
    left: 3px;
    bottom: 3px;
    background: #ffffff;
    transition: 0.2s;
    border-radius: 50%;
  }

  .layer-switch input:checked + .layer-slider {
    background: #2f80ed;
  }

  .layer-switch input:checked + .layer-slider::before {
    transform: translateX(24px);
  }

  .legend-row {
    display: flex;
    align-items: center;
    gap: 9px;
    margin: 5px 0;
  }

  .legend-color {
    display: inline-block;
    width: 18px;
    height: 12px;
    border: 1px solid rgba(255, 255, 255, 0.45);
    border-radius: 2px;
    flex-shrink: 0;
  }

  .coordinate-input {
    width: 100%;
    margin-top: 4px;
    padding: 7px 8px;
    box-sizing: border-box;
    color: #ffffff;
    background: #111111;
    border: 1px solid rgba(255, 255, 255, 0.35);
    border-radius: 4px;
  }

  .coordinate-input:focus {
    outline: 1px solid #67d9ff;
    border-color: #67d9ff;
  }

  .interface-button {
    padding: 6px 9px;
    color: #ffffff;
    background: #202020;
    border: 1px solid rgba(255, 255, 255, 0.35);
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
  }

  .interface-button:hover {
    background: #343434;
  }

  .interface-button:active {
    background: #454545;
  }

  .interface-button.active {
    background: #2f80ed;
    border-color: #67a8ff;
  }

  .interface-control-panel {
    position: fixed;
    left: 50%;
    bottom: 14px;
    transform: translateX(-50%);
    z-index: 100;
    padding: 8px 10px;
    color: #ffffff;
    background: rgba(0, 0, 0, 0.9);
    border: 1px solid rgba(255, 255, 255, 0.35);
    border-radius: 7px;
    font-family: Arial, sans-serif;
    font-size: 12px;
    user-select: none;
    zoom: var(--interface-scale);
  }

  .interface-control-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .panel-divider {
    border: 0;
    border-top: 1px solid rgba(255, 255, 255, 0.18);
    margin: 8px 0;
  }

  .panel-drag-handle {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    margin: -7px -9px 9px;
    padding: 4px 8px;
    color: #bfc7d5;
    background: rgba(255, 255, 255, 0.07);
    border: 1px solid rgba(255, 255, 255, 0.13);
    border-radius: 5px;
    cursor: grab;
    user-select: none;
    touch-action: none;
    pointer-events: auto;
    font-size: 11px;
    line-height: 1.2;
  }

  .panel-drag-handle:hover {
    color: #ffffff;
    background: rgba(255, 255, 255, 0.12);
  }

  .panel-drag-handle:active,
  .panel-being-dragged .panel-drag-handle {
    cursor: grabbing;
  }

  .panel-being-dragged {
    z-index: 500 !important;
  }

  .resize-handle {
    position: absolute;
    z-index: 30;
    pointer-events: auto;
    touch-action: none;
  }

  .resize-handle:hover,
  .resize-handle.resize-handle-active {
    background: rgba(103, 217, 255, 0.35);
  }

  .resize-handle-n,
  .resize-handle-s {
    left: 10px;
    right: 10px;
    height: 7px;
    cursor: ns-resize;
  }

  .resize-handle-n { top: -3px; }
  .resize-handle-s { bottom: -3px; }

  .resize-handle-e,
  .resize-handle-w {
    top: 10px;
    bottom: 10px;
    width: 7px;
    cursor: ew-resize;
  }

  .resize-handle-e { right: -3px; }
  .resize-handle-w { left: -3px; }

  .resize-handle-ne,
  .resize-handle-nw,
  .resize-handle-se,
  .resize-handle-sw {
    width: 14px;
    height: 14px;
    border-radius: 3px;
  }

  .resize-handle-ne { top: -4px; right: -4px; cursor: nesw-resize; }
  .resize-handle-nw { top: -4px; left: -4px; cursor: nwse-resize; }
  .resize-handle-se { bottom: -4px; right: -4px; cursor: nwse-resize; }
  .resize-handle-sw { bottom: -4px; left: -4px; cursor: nesw-resize; }

  @media (max-width: 1100px) {
    .interface-control-panel {
      max-width: 90vw;
    }
  }
`;

document.head.appendChild(interfaceStyle);

// ======================================================
// 8. 介面工具函式（Interface Utility Functions）
// ======================================================

function createPanel(style = {}) {
  const panel = document.createElement("div");

  panel.className = "interface-panel";

  Object.assign(
    panel.style,
    style
  );

  const panelContent =
    document.createElement("div");

  panel.appendChild(panelContent);

  Object.defineProperty(
    panel,
    "innerHTML",
    {
      get() {
        return panelContent.innerHTML;
      },
      set(value) {
        panelContent.innerHTML = value;
      }
    }
  );

  document.body.appendChild(panel);

  return panel;
}

function stopPanelEvents(panel) {
  for (const eventName of [
    "pointerdown",
    "pointerup",
    "click",
    "dblclick",
    "wheel"
  ]) {
    panel.addEventListener(
      eventName,
      (event) => {
        event.stopPropagation();
      }
    );
  }
}

const BILINGUAL_TEXT_PATTERN =
  /([\u3000-\u303F\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF00-\uFF19\uFF1B-\uFF5B\uFF5D-\uFFEF](?:[\u3000-\u303F\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF00-\uFF19\uFF1B-\uFF5B\uFF5D-\uFFEF]|\s)*)\s*\(([^()<>]+)\)/g;

function wrapBilingualText(html) {
  return html.replace(
    BILINGUAL_TEXT_PATTERN,
    (match, chineseText, englishText) => {
      if (!/[A-Za-z]/.test(englishText)) {
        return match;
      }

      return (
        `<span class="lang-zh">${chineseText}</span>` +
        `<span class="lang-en">${englishText}</span>`
      );
    }
  );
}

function setLocalizedHtml(element, html) {
  element.innerHTML =
    wrapBilingualText(html);
}

function appendLocalizedHtml(element, html) {
  element.innerHTML +=
    wrapBilingualText(html);
}

function pickLangText(chineseText, englishText) {
  return currentLanguage === "zh"
    ? chineseText
    : englishText;
}

function createLegendRow(color, text) {
  return `
    <div class="legend-row">
      <span
        class="legend-color"
        style="background:${color}"
      ></span>

      <span>${text}</span>
    </div>
  `;
}

const draggablePanelRecords = [];

let topPanelZIndex = 100;

function bringPanelToFront(panel) {
  topPanelZIndex += 1;
  panel.style.zIndex = String(topPanelZIndex);
}

function makePanelDraggable(
  panel,
  handleText = "拖動面板 (Drag Panel)"
) {
  if (
    !panel ||
    panel.dataset.draggableReady === "true"
  ) {
    return;
  }

  panel.dataset.draggableReady = "true";

  const originalInlineStyle =
    panel.getAttribute("style") ?? "";

  const handle =
    document.createElement("div");

  handle.className =
    "panel-drag-handle";

  handle.innerHTML = wrapBilingualText(`
    <span aria-hidden="true">⠿</span>
    <span>${handleText}</span>
  `);

  panel.prepend(handle);

  const record = {
    panel,
    originalInlineStyle
  };

  draggablePanelRecords.push(record);

  let dragging = false;
  let pointerId = null;
  let offsetX = 0;
  let offsetY = 0;

  handle.addEventListener(
    "pointerdown",
    (event) => {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const rect =
        panel.getBoundingClientRect();

      dragging = true;
      pointerId = event.pointerId;

      offsetX =
        event.clientX -
        rect.left;

      offsetY =
        event.clientY -
        rect.top;

      panel.style.left =
        `${rect.left / interfaceScale}px`;

      panel.style.top =
        `${rect.top / interfaceScale}px`;

      panel.style.right = "auto";
      panel.style.bottom = "auto";
      panel.style.transform = "none";

      panel.classList.add(
        "panel-being-dragged"
      );

      bringPanelToFront(panel);

      controls.enabled = false;

      handle.setPointerCapture(
        pointerId
      );
    }
  );

  handle.addEventListener(
    "pointermove",
    (event) => {
      if (
        !dragging ||
        event.pointerId !== pointerId
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const rect =
        panel.getBoundingClientRect();

      const maximumLeft =
        Math.max(
          0,
          window.innerWidth -
          rect.width
        );

      const maximumTop =
        Math.max(
          0,
          window.innerHeight -
          rect.height
        );

      const nextLeft =
        THREE.MathUtils.clamp(
          event.clientX -
          offsetX,
          0,
          maximumLeft
        );

      const nextTop =
        THREE.MathUtils.clamp(
          event.clientY -
          offsetY,
          0,
          maximumTop
        );

      panel.style.left =
        `${nextLeft / interfaceScale}px`;

      panel.style.top =
        `${nextTop / interfaceScale}px`;
    }
  );

  function finishPanelDrag(event) {
    if (
      !dragging ||
      event.pointerId !== pointerId
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    dragging = false;

    panel.classList.remove(
      "panel-being-dragged"
    );

    if (
      handle.hasPointerCapture(
        pointerId
      )
    ) {
      handle.releasePointerCapture(
        pointerId
      );
    }

    pointerId = null;
    controls.enabled = true;
  }

  handle.addEventListener(
    "pointerup",
    finishPanelDrag
  );

  handle.addEventListener(
    "pointercancel",
    finishPanelDrag
  );
}

const RESIZE_HANDLE_DIRECTIONS = [
  "n",
  "s",
  "e",
  "w",
  "ne",
  "nw",
  "se",
  "sw"
];

const PANEL_MIN_WIDTH_PX = 220;
const PANEL_MIN_HEIGHT_PX = 120;

function makePanelResizable(panel) {
  if (
    !panel ||
    panel.dataset.resizableReady === "true"
  ) {
    return;
  }

  panel.dataset.resizableReady = "true";

  RESIZE_HANDLE_DIRECTIONS.forEach(
    (direction) => {
      const handle =
        document.createElement("div");

      handle.className =
        `resize-handle resize-handle-${direction}`;

      panel.appendChild(handle);

      let resizing = false;
      let pointerId = null;
      let startX = 0;
      let startY = 0;
      let startRect = null;

      handle.addEventListener(
        "pointerdown",
        (event) => {
          if (event.button !== 0) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();

          startRect =
            panel.getBoundingClientRect();

          startX = event.clientX;
          startY = event.clientY;

          panel.style.left =
            `${startRect.left / interfaceScale}px`;

          panel.style.top =
            `${startRect.top / interfaceScale}px`;

          panel.style.width =
            `${startRect.width / interfaceScale}px`;

          panel.style.height =
            `${startRect.height / interfaceScale}px`;

          panel.style.right = "auto";
          panel.style.bottom = "auto";
          panel.style.maxWidth = "none";
          panel.style.maxHeight = "none";
          panel.style.transform = "none";

          resizing = true;
          pointerId = event.pointerId;

          handle.classList.add(
            "resize-handle-active"
          );

          panel.classList.add(
            "panel-being-dragged"
          );

          bringPanelToFront(panel);

          controls.enabled = false;

          handle.setPointerCapture(
            pointerId
          );
        }
      );

      handle.addEventListener(
        "pointermove",
        (event) => {
          if (
            !resizing ||
            event.pointerId !== pointerId
          ) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();

          const deltaX =
            event.clientX - startX;

          const deltaY =
            event.clientY - startY;

          let width = startRect.width;
          let height = startRect.height;
          let left = startRect.left;
          let top = startRect.top;

          if (direction.includes("e")) {
            width =
              startRect.width + deltaX;

            width =
              Math.max(
                PANEL_MIN_WIDTH_PX,
                width
              );

            width =
              Math.min(
                width,
                window.innerWidth -
                left
              );
          }

          if (direction.includes("w")) {
            width =
              startRect.width - deltaX;

            width =
              Math.max(
                PANEL_MIN_WIDTH_PX,
                width
              );

            width =
              Math.min(
                width,
                startRect.right
              );

            left =
              startRect.right - width;
          }

          if (direction.includes("s")) {
            height =
              startRect.height + deltaY;

            height =
              Math.max(
                PANEL_MIN_HEIGHT_PX,
                height
              );

            height =
              Math.min(
                height,
                window.innerHeight -
                top
              );
          }

          if (direction.includes("n")) {
            height =
              startRect.height - deltaY;

            height =
              Math.max(
                PANEL_MIN_HEIGHT_PX,
                height
              );

            height =
              Math.min(
                height,
                startRect.bottom
              );

            top =
              startRect.bottom - height;
          }

          panel.style.left =
            `${left / interfaceScale}px`;

          panel.style.top =
            `${top / interfaceScale}px`;

          panel.style.width =
            `${width / interfaceScale}px`;

          panel.style.height =
            `${height / interfaceScale}px`;
        }
      );

      function finishPanelResize(event) {
        if (
          !resizing ||
          event.pointerId !== pointerId
        ) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();

        resizing = false;

        handle.classList.remove(
          "resize-handle-active"
        );

        panel.classList.remove(
          "panel-being-dragged"
        );

        if (
          handle.hasPointerCapture(
            pointerId
          )
        ) {
          handle.releasePointerCapture(
            pointerId
          );
        }

        pointerId = null;
        controls.enabled = true;
      }

      handle.addEventListener(
        "pointerup",
        finishPanelResize
      );

      handle.addEventListener(
        "pointercancel",
        finishPanelResize
      );
    }
  );
}

function keepDraggablePanelInsideWindow(
  panel
) {
  if (
    !panel ||
    panel.classList.contains(
      "interface-panel-hidden"
    )
  ) {
    return;
  }

  const rect =
    panel.getBoundingClientRect();

  const nextLeft =
    THREE.MathUtils.clamp(
      rect.left,
      0,
      Math.max(
        0,
        window.innerWidth -
        rect.width
      )
    );

  const nextTop =
    THREE.MathUtils.clamp(
      rect.top,
      0,
      Math.max(
        0,
        window.innerHeight -
        rect.height
      )
    );

  if (
    nextLeft !== rect.left ||
    nextTop !== rect.top
  ) {
    panel.style.left =
      `${nextLeft / interfaceScale}px`;

    panel.style.top =
      `${nextTop / interfaceScale}px`;

    panel.style.right = "auto";
    panel.style.bottom = "auto";
    panel.style.transform = "none";
  }
}

function resetDraggablePanelPositions() {
  for (
    const record of
    draggablePanelRecords
  ) {
    record.panel.setAttribute(
      "style",
      record.originalInlineStyle
    );
  }
}

// ======================================================
// 9. DEM 狀態面板（DEM Status Panel）
// ======================================================

const statusPanel = createPanel({
  top: "14px",
  left: "14px",
  maxWidth: "960px",
  pointerEvents: "none"
});

statusPanel.id = "status";

statusPanel.innerHTML = wrapBilingualText(`
  <strong>
    Artemis III／Nobile Rim 2 數位高程模型
    (Digital Elevation Model, DEM)
  </strong><br>

  正在載入並清理地形資料
  (Loading and Cleaning Terrain Data)...
`);

// ======================================================
// 10. 月面座標面板（Lunar Coordinate Panel）
// ======================================================

const coordinatePanel = createPanel({
  top: "14px",
  right: "14px",
  width: "360px",
  maxHeight: "47vh",
  overflowY: "auto",
  pointerEvents: "none"
});

coordinatePanel.innerHTML = wrapBilingualText(`
  <strong>
    月面實際座標
    (Lunar Surface Coordinates)
  </strong><br>

  點擊地形或搜尋座標以讀取資料
  (Click the Terrain or Search Coordinates)
`);

// ======================================================
// 12. 任務路線面板（Mission Route Panel）
// ======================================================

const missionPanel = createPanel({
  left: "14px",
  bottom: "14px",
  width: "430px",
  maxHeight: "48vh",
  overflowY: "auto",
  pointerEvents: "none"
});

// ======================================================
// 13. 圖層面板（Layers Panel — Slope & Elevation Bands）
// ======================================================

const layersPanel = createPanel({
  right: "14px",
  bottom: "14px",
  width: "320px",
  maxHeight: "60vh",
  overflowY: "auto",
  zIndex: "30",
  pointerEvents: "auto",
  userSelect: "none"
});

layersPanel.innerHTML = wrapBilingualText(`
  <div class="layer-header">
    <strong>
      坡度圖層
      (Slope Layer)
    </strong>

    <label class="layer-switch">
      <input id="slope-toggle" type="checkbox">
      <span class="layer-slider"></span>
    </label>
  </div>

  <div style="
    border-top:1px solid rgba(255,255,255,0.18);
    padding-top:9px;
  ">
    ${createLegendRow(
      "#245cff",
      "0–5° 藍色 (Blue)"
    )}

    ${createLegendRow(
      "#67d9ff",
      "5–10° 淡藍色 (Light Blue)"
    )}

    ${createLegendRow(
      "#ffdf3f",
      "10–15° 黃色 (Yellow)"
    )}

    ${createLegendRow(
      "#ff3b30",
      "15–20° 紅色 (Red)"
    )}

    ${createLegendRow(
      "#800000",
      ">20° 深紅色 (Dark Red)"
    )}
  </div>

  <hr class="panel-divider">

  <div class="layer-header">
    <strong>
      等高色帶圖層
      (Elevation Band Layer)
    </strong>

    <label class="layer-switch">
      <input id="elevation-toggle" type="checkbox">
      <span class="layer-slider"></span>
    </label>
  </div>

  <div
    id="elevation-legend"
    style="
      border-top:1px solid rgba(255,255,255,0.18);
      padding-top:9px;
    "
  >
    地形載入後顯示高程分級
    (Elevation Classes Appear After Loading)
  </div>
`);

stopPanelEvents(layersPanel);

const slopeToggle =
  document.querySelector("#slope-toggle");

const elevationToggle =
  document.querySelector("#elevation-toggle");

const elevationLegend =
  document.querySelector("#elevation-legend");

slopeToggle.addEventListener(
  "change",
  () => {
    setSlopeLayerEnabled(
      slopeToggle.checked
    );
  }
);

elevationToggle.addEventListener(
  "change",
  () => {
    setElevationLayerEnabled(
      elevationToggle.checked
    );
  }
);

// ======================================================
// 14A. 月球全貌小視窗（Moon Overview Inset）
// ======================================================

const moonOverviewScene = new THREE.Scene();

moonOverviewScene.background =
  new THREE.Color(0x05070c);

const moonOverviewCamera =
  new THREE.PerspectiveCamera(
    35,
    1,
    0.1,
    10
  );

moonOverviewCamera.position.set(
  0,
  0,
  4.2
);

moonOverviewScene.add(
  new THREE.AmbientLight(
    0xffffff,
    0.4
  )
);

const moonOverviewLight =
  new THREE.DirectionalLight(
    0xffffff,
    1.6
  );

moonOverviewLight.position.set(
  -3,
  2,
  4
);

moonOverviewScene.add(
  moonOverviewLight
);

const moonOverviewTextureLoader =
  new THREE.TextureLoader();

const moonOverviewMaterial =
  new THREE.MeshStandardMaterial({
    color: 0xaaaaaa,
    roughness: 1,
    metalness: 0
  });

moonOverviewTextureLoader.load(
  MOON_OVERVIEW_COLOR_MAP_URL,
  (texture) => {
    moonOverviewMaterial.map = texture;
    moonOverviewMaterial.color.set(0xffffff);
    moonOverviewMaterial.needsUpdate = true;
  },
  undefined,
  (error) => {
    console.warn(
      "月球彩色貼圖載入失敗 (Moon color map failed to load):",
      error
    );
  }
);

moonOverviewTextureLoader.load(
  MOON_OVERVIEW_BUMP_MAP_URL,
  (texture) => {
    moonOverviewMaterial.bumpMap = texture;
    moonOverviewMaterial.bumpScale = 0.015;
    moonOverviewMaterial.needsUpdate = true;
  },
  undefined,
  (error) => {
    console.warn(
      "月球高程貼圖載入失敗 (Moon bump map failed to load):",
      error
    );
  }
);

const moonOverviewGroup =
  new THREE.Group();

moonOverviewScene.add(
  moonOverviewGroup
);

const moonOverviewMesh =
  new THREE.Mesh(
    new THREE.SphereGeometry(
      1,
      64,
      64
    ),
    moonOverviewMaterial
  );

moonOverviewGroup.add(
  moonOverviewMesh
);

const moonOverviewAxis =
  new THREE.Mesh(
    new THREE.CylinderGeometry(
      0.01,
      0.01,
      2.7,
      12
    ),
    new THREE.MeshBasicMaterial({
      color: 0xe8ecf2
    })
  );

moonOverviewGroup.add(
  moonOverviewAxis
);

const moonOverviewPanel = createPanel({
  top: "270px",
  right: "14px",
  width: "200px",
  height: "220px",
  zIndex: "25",
  display: "flex",
  flexDirection: "column",
  background: "transparent",
  backdropFilter: "none",
  padding: "6px"
});

makePanelDraggable(
  moonOverviewPanel,
  "拖動月球 (Drag Moon)"
);

makePanelResizable(
  moonOverviewPanel
);

stopPanelEvents(
  moonOverviewPanel
);

const moonOverviewContent =
  document.createElement("div");

moonOverviewContent.style.flex = "1 1 auto";
moonOverviewContent.style.minHeight = "0";
moonOverviewContent.style.cursor = "grab";
moonOverviewContent.style.touchAction = "none";

moonOverviewPanel.appendChild(
  moonOverviewContent
);

const moonOverviewCanvas =
  document.createElement("canvas");

moonOverviewCanvas.style.display = "block";
moonOverviewCanvas.style.width = "100%";
moonOverviewCanvas.style.height = "100%";

moonOverviewContent.appendChild(
  moonOverviewCanvas
);

const moonOverviewRenderer =
  new THREE.WebGLRenderer({
    canvas: moonOverviewCanvas,
    antialias: true
  });

moonOverviewRenderer.setPixelRatio(
  Math.min(window.devicePixelRatio, 1.5)
);

let moonOverviewLastWidth = 0;
let moonOverviewLastHeight = 0;

let moonOverviewDragging = false;
let moonOverviewTiltX = 0;
let moonOverviewLastPointerX = 0;
let moonOverviewLastPointerY = 0;

moonOverviewContent.addEventListener(
  "pointerdown",
  (event) => {
    moonOverviewDragging = true;

    moonOverviewLastPointerX = event.clientX;
    moonOverviewLastPointerY = event.clientY;

    moonOverviewContent.style.cursor = "grabbing";

    moonOverviewContent.setPointerCapture(
      event.pointerId
    );
  }
);

moonOverviewContent.addEventListener(
  "pointermove",
  (event) => {
    if (!moonOverviewDragging) {
      return;
    }

    const deltaX =
      event.clientX -
      moonOverviewLastPointerX;

    const deltaY =
      event.clientY -
      moonOverviewLastPointerY;

    moonOverviewLastPointerX = event.clientX;
    moonOverviewLastPointerY = event.clientY;

    moonOverviewGroup.rotation.y +=
      deltaX * 0.012;

    moonOverviewTiltX =
      THREE.MathUtils.clamp(
        moonOverviewTiltX +
        deltaY * 0.012,
        -1.3,
        1.3
      );

    moonOverviewGroup.rotation.x =
      moonOverviewTiltX;
  }
);

function stopMoonOverviewDrag(event) {
  if (!moonOverviewDragging) {
    return;
  }

  moonOverviewDragging = false;

  moonOverviewContent.style.cursor = "grab";

  if (
    moonOverviewContent.hasPointerCapture(
      event.pointerId
    )
  ) {
    moonOverviewContent.releasePointerCapture(
      event.pointerId
    );
  }
}

moonOverviewContent.addEventListener(
  "pointerup",
  stopMoonOverviewDrag
);

moonOverviewContent.addEventListener(
  "pointercancel",
  stopMoonOverviewDrag
);

function renderMoonOverview() {
  const width =
    moonOverviewContent.clientWidth;

  const height =
    moonOverviewContent.clientHeight;

  if (
    width < 2 ||
    height < 2
  ) {
    return;
  }

  if (
    width !== moonOverviewLastWidth ||
    height !== moonOverviewLastHeight
  ) {
    moonOverviewLastWidth = width;
    moonOverviewLastHeight = height;

    moonOverviewRenderer.setSize(
      width,
      height,
      false
    );

    moonOverviewCamera.aspect =
      width /
      height;

    moonOverviewCamera.updateProjectionMatrix();
  }

  moonOverviewRenderer.render(
    moonOverviewScene,
    moonOverviewCamera
  );
}

// ======================================================
// 15. 經緯度搜尋與起終點面板
// （Coordinate Search and Route Point Input）
// ======================================================

const coordinateSearchPanel = createPanel({
  top: "150px",
  left: "14px",
  width: "360px",
  zIndex: "35",
  pointerEvents: "auto",
  userSelect: "none"
});

coordinateSearchPanel.innerHTML = wrapBilingualText(`
  <strong>
    經緯度搜尋與起終點設定
    (Coordinate Search and Traverse Point Input)
  </strong>

  <div style="
    margin-top:10px;
    display:grid;
    grid-template-columns:1fr 1fr;
    gap:8px;
  ">
    <label>
      緯度 (Latitude)

      <input
        id="latitude-input"
        class="coordinate-input"
        type="number"
        step="0.000001"
        min="-90"
        max="90"
        placeholder="-84.053178"
      >
    </label>

    <label>
      經度 (Longitude)

      <input
        id="longitude-input"
        class="coordinate-input"
        type="number"
        step="0.000001"
        placeholder="58.241098"
      >
    </label>
  </div>

  <div style="
    margin-top:9px;
    display:grid;
    grid-template-columns:1fr 1fr;
    gap:7px;
  ">
    <button
      id="search-coordinate-button"
      class="interface-button"
    >
      設定點 (Set a Point)
    </button>

    <button
      id="set-start-coordinate-button"
      class="interface-button"
    >
      設為起點 (Set Start)
    </button>

    <button
      id="set-goal-coordinate-button"
      class="interface-button"
    >
      設為終點 (Set Destination)
    </button>

    <button
      id="clear-coordinate-input-button"
      class="interface-button"
    >
      清除輸入 (Clear)
    </button>
  </div>

  <div
    id="coordinate-search-message"
    style="
      margin-top:9px;
      padding-top:8px;
      border-top:1px solid rgba(255,255,255,0.18);
      color:#aaaaaa;
      min-height:22px;
    "
  >
    輸入月球緯度與經度後選擇操作
    (Enter Lunar Latitude and Longitude)
  </div>
`);

stopPanelEvents(coordinateSearchPanel);

const latitudeInput =
  document.querySelector("#latitude-input");

const longitudeInput =
  document.querySelector("#longitude-input");

const searchCoordinateButton =
  document.querySelector(
    "#search-coordinate-button"
  );

const setStartCoordinateButton =
  document.querySelector(
    "#set-start-coordinate-button"
  );

const setGoalCoordinateButton =
  document.querySelector(
    "#set-goal-coordinate-button"
  );

const clearCoordinateInputButton =
  document.querySelector(
    "#clear-coordinate-input-button"
  );

const coordinateSearchMessage =
  document.querySelector(
    "#coordinate-search-message"
  );

searchCoordinateButton.addEventListener(
  "click",
  () => {
    executeCoordinateAction("search");
  }
);

setStartCoordinateButton.addEventListener(
  "click",
  () => {
    executeCoordinateAction("start");
  }
);

setGoalCoordinateButton.addEventListener(
  "click",
  () => {
    executeCoordinateAction("goal");
  }
);

clearCoordinateInputButton.addEventListener(
  "click",
  () => {
    latitudeInput.value = "";
    longitudeInput.value = "";

    showCoordinateSearchMessage(
      "輸入已清除 (Coordinate Input Cleared)",
      "#aaaaaa"
    );
  }
);

for (const input of [
  latitudeInput,
  longitudeInput
]) {
  input.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        executeCoordinateAction("search");
      }
    }
  );
}

// ======================================================
// 16. 介面顯示與縮放控制
// （Interface Visibility and Scale Controls）
// ======================================================

const managedPanels = [
  {
    key: "status",
    label: "DEM",
    panel: statusPanel
  },
  {
    key: "coordinate",
    label: "座標 (Coordinates)",
    panel: coordinatePanel
  },
  {
    key: "search",
    label: "搜尋 (Search)",
    panel: coordinateSearchPanel
  },
  {
    key: "mission",
    label: "任務 (Mission)",
    panel: missionPanel
  },
  {
    key: "layers",
    label: "圖層 (Layers)",
    panel: layersPanel
  },
  {
    key: "moon",
    label: "月球 (Moon)",
    panel: moonOverviewPanel
  }
];

const interfaceControlPanel =
  document.createElement("div");

interfaceControlPanel.className =
  "interface-control-panel";

setLocalizedHtml(interfaceControlPanel, `
  <div class="interface-control-row">
    <button
      id="toggle-all-panels-button"
      class="interface-button"
    >
      隱藏介面 (Hide Interface)
    </button>

    <button
      id="scale-down-button"
      class="interface-button"
      title="縮小介面"
    >
      −
    </button>

    <span
      id="interface-scale-label"
      style="
        min-width:44px;
        text-align:center;
      "
    >
      82%
    </span>

    <button
      id="scale-up-button"
      class="interface-button"
      title="放大介面"
    >
      ＋
    </button>

    <button
      id="scale-reset-button"
      class="interface-button"
    >
      比例重設 (Reset Scale)
    </button>

    <button
      id="position-reset-button"
      class="interface-button"
    >
      位置重設 (Reset Position)
    </button>

    <button
      id="language-toggle-button"
      class="interface-button"
    >
      EN
    </button>
  </div>

  <div
    class="interface-control-row"
    style="margin-top:6px;"
  >
    ${managedPanels.map((item) => `
      <button
        class="
          interface-button
          active
          panel-visibility-button
        "
        data-panel-key="${item.key}"
      >
        ${item.label}
      </button>
    `).join("")}
  </div>
`);

document.body.appendChild(
  interfaceControlPanel
);

for (const eventName of [
  "pointerdown",
  "pointerup",
  "click",
  "dblclick",
  "wheel"
]) {
  interfaceControlPanel.addEventListener(
    eventName,
    (event) => {
      event.stopPropagation();
    }
  );
}

const toggleAllPanelsButton =
  document.querySelector(
    "#toggle-all-panels-button"
  );

const scaleDownButton =
  document.querySelector(
    "#scale-down-button"
  );

const scaleUpButton =
  document.querySelector(
    "#scale-up-button"
  );

const scaleResetButton =
  document.querySelector(
    "#scale-reset-button"
  );

const interfaceScaleLabel =
  document.querySelector(
    "#interface-scale-label"
  );

const positionResetButton =
  document.querySelector(
    "#position-reset-button"
  );

const languageToggleButton =
  document.querySelector(
    "#language-toggle-button"
  );

const panelVisibilityButtons = [
  ...document.querySelectorAll(
    ".panel-visibility-button"
  )
];

function applyInterfaceScale(newScale) {
  interfaceScale =
    THREE.MathUtils.clamp(
      newScale,
      MIN_INTERFACE_SCALE,
      MAX_INTERFACE_SCALE
    );

  document.documentElement.style.setProperty(
    "--interface-scale",
    interfaceScale.toFixed(2)
  );

  interfaceScaleLabel.textContent =
    `${Math.round(
      interfaceScale * 100
    )}%`;
}

function changeInterfaceScale(amount) {
  applyInterfaceScale(
    interfaceScale + amount
  );
}

function updateStaticTitles() {
  const isChinese =
    currentLanguage === "zh";

  scaleDownButton.title =
    isChinese
      ? "縮小介面"
      : "Zoom Out Interface";

  scaleUpButton.title =
    isChinese
      ? "放大介面"
      : "Zoom In Interface";

  languageToggleButton.textContent =
    isChinese
      ? "EN"
      : "中文";

  languageToggleButton.title =
    isChinese
      ? "切換為英文"
      : "Switch to Chinese";
}

function applyLanguage(language) {
  currentLanguage = language;

  document.documentElement.dataset.lang =
    currentLanguage;

  localStorage.setItem(
    INTERFACE_LANGUAGE_STORAGE_KEY,
    currentLanguage
  );

  updateStaticTitles();

  if (profileCanvasReady) {
    drawEnhancedRouteProfile(
      routeSamples,
      enhancedRouteAnalysis
    );
  }
}

function toggleLanguage() {
  applyLanguage(
    currentLanguage === "zh"
      ? "en"
      : "zh"
  );
}

languageToggleButton.addEventListener(
  "click",
  () => {
    toggleLanguage();
  }
);

applyLanguage(currentLanguage);

function getManagedPanel(panelKey) {
  return managedPanels.find(
    (item) => item.key === panelKey
  );
}

function getPanelButton(panelKey) {
  return panelVisibilityButtons.find(
    (button) =>
      button.dataset.panelKey === panelKey
  );
}

function setPanelVisible(
  panelKey,
  visible
) {
  const item =
    getManagedPanel(panelKey);

  if (!item) {
    return;
  }

  item.panel.classList.toggle(
    "interface-panel-hidden",
    !visible
  );

  const button =
    getPanelButton(panelKey);

  if (button) {
    button.classList.toggle(
      "active",
      visible
    );
  }
}

function updateAllPanelButtonState() {
  allPanelsVisible =
    managedPanels.every(
      (item) =>
        !item.panel.classList.contains(
          "interface-panel-hidden"
        )
    );

  setLocalizedHtml(
    toggleAllPanelsButton,
    allPanelsVisible
      ? "隱藏介面 (Hide Interface)"
      : "顯示介面 (Show Interface)"
  );
}

function setAllPanelsVisible(visible) {
  for (const item of managedPanels) {
    setPanelVisible(
      item.key,
      visible
    );
  }

  allPanelsVisible = visible;

  setLocalizedHtml(
    toggleAllPanelsButton,
    visible
      ? "隱藏介面 (Hide Interface)"
      : "顯示介面 (Show Interface)"
  );
}

function toggleAllPanels() {
  setAllPanelsVisible(
    !allPanelsVisible
  );
}

toggleAllPanelsButton.addEventListener(
  "click",
  () => {
    toggleAllPanels();
  }
);

scaleDownButton.addEventListener(
  "click",
  () => {
    changeInterfaceScale(-0.05);
  }
);

scaleUpButton.addEventListener(
  "click",
  () => {
    changeInterfaceScale(0.05);
  }
);

scaleResetButton.addEventListener(
  "click",
  () => {
    applyInterfaceScale(
      DEFAULT_INTERFACE_SCALE
    );
  }
);

positionResetButton.addEventListener(
  "click",
  () => {
    resetDraggablePanelPositions();
  }
);

for (const button of panelVisibilityButtons) {
  button.addEventListener(
    "click",
    () => {
      const panelKey =
        button.dataset.panelKey;

      const currentlyVisible =
        button.classList.contains(
          "active"
        );

      setPanelVisible(
        panelKey,
        !currentlyVisible
      );

      updateAllPanelButtonState();
    }
  );
}

applyInterfaceScale(
  DEFAULT_INTERFACE_SCALE
);

for (const item of managedPanels) {
  makePanelDraggable(
    item.panel
  );

  makePanelResizable(
    item.panel
  );
}

makePanelDraggable(
  interfaceControlPanel,
  "拖動控制列 (Drag Controls)"
);

// ======================================================
// 17. 建立標記（Create Markers）
// ======================================================

const clickMarker =
  createSphereMarker(0xff9500);

clickMarker.visible = false;

scene.add(clickMarker);

const startMarker =
  createFlagMarker(0x00ff66);

startMarker.visible = false;

scene.add(startMarker);

const goalMarker =
  createFlagMarker(0xff3333);

goalMarker.visible = false;

scene.add(goalMarker);

function createSphereMarker(color) {
  const geometry =
    new THREE.SphereGeometry(
      MARKER_RADIUS_KM,
      24,
      24
    );

  const material =
    new THREE.MeshBasicMaterial({
      color,
      depthTest: false,
      depthWrite: false
    });

  const marker =
    new THREE.Mesh(
      geometry,
      material
    );

  marker.renderOrder = 10;

  return marker;
}

function createFlagMarker(color) {
  const group = new THREE.Group();

  const poleHeightKm =
    MARKER_RADIUS_KM * 3 * FLAG_MARKER_SCALE;

  const poleRadiusKm =
    MARKER_RADIUS_KM * 0.12 * FLAG_MARKER_SCALE;

  const poleGeometry =
    new THREE.CylinderGeometry(
      poleRadiusKm,
      poleRadiusKm,
      poleHeightKm,
      8
    );

  const poleMaterial =
    new THREE.MeshBasicMaterial({
      color: 0xdddddd,
      depthTest: false,
      depthWrite: false
    });

  const pole =
    new THREE.Mesh(
      poleGeometry,
      poleMaterial
    );

  pole.position.y =
    poleHeightKm / 2;

  pole.renderOrder = 10;

  group.add(pole);

  const bannerWidthKm =
    MARKER_RADIUS_KM * 1.8 * FLAG_MARKER_SCALE;

  const bannerHeightKm =
    MARKER_RADIUS_KM * 1.1 * FLAG_MARKER_SCALE;

  const bannerThicknessKm =
    MARKER_RADIUS_KM * 0.25 * FLAG_MARKER_SCALE;

  const bannerShape =
    new THREE.Shape();

  bannerShape.moveTo(
    0,
    bannerHeightKm / 2
  );

  bannerShape.lineTo(
    bannerWidthKm,
    0
  );

  bannerShape.lineTo(
    0,
    -bannerHeightKm / 2
  );

  bannerShape.lineTo(
    0,
    bannerHeightKm / 2
  );

  const bannerGeometry =
    new THREE.ExtrudeGeometry(
      bannerShape,
      {
        depth: bannerThicknessKm,
        bevelEnabled: false
      }
    );

  const bannerMaterial =
    new THREE.MeshBasicMaterial({
      color,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide
    });

  const banner =
    new THREE.Mesh(
      bannerGeometry,
      bannerMaterial
    );

  banner.position.set(
    poleRadiusKm,
    poleHeightKm * 0.62,
    -bannerThicknessKm / 2
  );

  banner.renderOrder = 10;

  group.add(banner);

  group.userData.isFlagMarker =
    true;

  return group;
}

function createNamedPointMarker() {
  const point =
    createPointDataFromGeographicCoordinates(
      NAMED_POINT_LATITUDE_DEGREES,
      NAMED_POINT_LONGITUDE_DEGREES
    );

  if (!point) {
    return;
  }

  namedPointMarker =
    createFlagMarker(
      NAMED_POINT_COLOR
    );

  namedPointMarker.userData.isNamedPointMarker =
    true;

  namedPointMarker.userData.point =
    point;

  placeMarkerOnSurface(
    namedPointMarker,
    point
  );

  scene.add(namedPointMarker);
}

// ======================================================
// 18. 載入 DEM（Load DEM）
// ======================================================

loadTerrainData();

async function loadTerrainData() {
  try {
    const cacheBuster =
      Date.now();

    const [
      metadataResponse,
      heightmapResponse
    ] = await Promise.all([
      fetch(
        `${METADATA_URL}?v=${cacheBuster}`
      ),
      fetch(
        `${HEIGHTMAP_URL}?v=${cacheBuster}`
      )
    ]);

    if (!metadataResponse.ok) {
      throw new Error(
        "無法讀取 heightmap_metadata.json"
      );
    }

    if (!heightmapResponse.ok) {
      throw new Error(
        "無法讀取 heightmap_float32.bin"
      );
    }

    const metadata =
      await metadataResponse.json();

    const buffer =
      await heightmapResponse.arrayBuffer();

    createTerrain(
      metadata,
      buffer
    );
  } catch (error) {
    console.error(
      "地形載入失敗：",
      error
    );

    statusPanel.innerHTML = wrapBilingualText(`
      <strong>
        載入失敗
        (Loading Failed)
      </strong><br>

      ${escapeHtml(error.message)}
    `);
  }
}

// ======================================================
// 19. 建立地形（Create Terrain）
// ======================================================

function createTerrain(
  metadata,
  buffer
) {
  const width =
    Number(metadata.width);

  const height =
    Number(metadata.height);

  const minHeightMeters =
    Number(metadata.minHeightMeters);

  const maxHeightMeters =
    Number(metadata.maxHeightMeters);

  const pixelSizeXMeters =
    Math.abs(
      Number(metadata.pixelSizeXMeters)
    );

  const pixelSizeYMeters =
    Math.abs(
      Number(metadata.pixelSizeYMeters)
    );

  validateMetadata({
    width,
    height,
    minHeightMeters,
    maxHeightMeters,
    pixelSizeXMeters,
    pixelSizeYMeters
  });

  terrainMetadata = {
    ...metadata,
    width,
    height,
    minHeightMeters,
    maxHeightMeters,
    pixelSizeXMeters,
    pixelSizeYMeters
  };

  rawTerrainElevations =
    new Float32Array(buffer);

  const expectedValueCount =
    width * height;

  if (
    rawTerrainElevations.length !==
    expectedValueCount
  ) {
    throw new Error(
      `DEM 資料數量錯誤：` +
      `預期 ${expectedValueCount}，` +
      `實際 ${rawTerrainElevations.length}`
    );
  }

  statusPanel.innerHTML = wrapBilingualText(`
    <strong>
      Artemis III／Nobile Rim 2 數位高程模型
      (Digital Elevation Model, DEM)
    </strong><br>

    正在清理地形資料
    (Cleaning Terrain Data)...
  `);

  terrainElevations =
    cleanDemElevations(
      rawTerrainElevations,
      width,
      height
    );

  const actualRange =
    calculateValidElevationRange(
      terrainElevations
    );

  terrainMetadata.minHeightMeters =
    actualRange.min;

  terrainMetadata.maxHeightMeters =
    actualRange.max;

  const metadataTerrainWidthMeters =
    Number(
      metadata.terrainWidthMeters
    );

  const metadataTerrainHeightMeters =
    Number(
      metadata.terrainHeightMeters
    );

  terrainWidthKm =
    Number.isFinite(
      metadataTerrainWidthMeters
    )
      ? metadataTerrainWidthMeters / 1000
      : (
          (width - 1) *
          pixelSizeXMeters
        ) /
        1000;

  terrainDepthKm =
    Number.isFinite(
      metadataTerrainHeightMeters
    )
      ? metadataTerrainHeightMeters / 1000
      : (
          (height - 1) *
          pixelSizeYMeters
        ) /
        1000;

  const geometry =
    new THREE.PlaneGeometry(
      terrainWidthKm,
      terrainDepthKm,
      width - 1,
      height - 1
    );

  const positions =
    geometry.attributes.position;

  if (
    positions.count !==
    expectedValueCount
  ) {
    throw new Error(
      "Three.js 頂點數與 DEM 資料數量不一致"
    );
  }

  normalTerrainColors =
    new Float32Array(
      positions.count * 3
    );

  slopeTerrainColors =
    new Float32Array(
      positions.count * 3
    );

  elevationTerrainColors =
    new Float32Array(
      positions.count * 3
    );

  const heightRangeMeters =
    actualRange.max -
    actualRange.min;

  for (
    let row = 0;
    row < height;
    row += 1
  ) {
    for (
      let column = 0;
      column < width;
      column += 1
    ) {
      const index =
        row * width + column;

      const elevationMeters =
        terrainElevations[index];

      if (
        !isValidElevation(
          elevationMeters
        )
      ) {
        positions.setZ(
          index,
          (
            actualRange.min /
            1000
          ) *
          VERTICAL_EXAGGERATION
        );

        setColorInArray(
          normalTerrainColors,
          index,
          INVALID_COLOR
        );

        setColorInArray(
          slopeTerrainColors,
          index,
          INVALID_COLOR
        );

        setColorInArray(
          elevationTerrainColors,
          index,
          INVALID_COLOR
        );

        continue;
      }

      positions.setZ(
        index,
        (
          elevationMeters /
          1000
        ) *
        VERTICAL_EXAGGERATION
      );

      const normalizedElevation =
        heightRangeMeters > 0
          ? (
              elevationMeters -
              actualRange.min
            ) /
            heightRangeMeters
          : 0;

      const shade =
        THREE.MathUtils.clamp(
          0.22 +
          normalizedElevation *
          0.68,
          0,
          1
        );

      normalTerrainColors[
        index * 3
      ] = shade;

      normalTerrainColors[
        index * 3 + 1
      ] = shade;

      normalTerrainColors[
        index * 3 + 2
      ] = shade;

      setColorInArray(
        elevationTerrainColors,
        index,
        getElevationBandColor(
          elevationMeters,
          actualRange.min,
          actualRange.max
        )
      );
    }
  }

  createSlopeColorMap();

  geometry.setAttribute(
    "color",
    new THREE.BufferAttribute(
      normalTerrainColors,
      3
    )
  );

  positions.needsUpdate = true;

  geometry.rotateX(
    -Math.PI / 2
  );

  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const material =
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 1,
      metalness: 0,
      side: THREE.DoubleSide,
      flatShading: false
    });

  terrain =
    new THREE.Mesh(
      geometry,
      material
    );

  terrain.name =
    "Nobile Rim 2 Terrain";

  scene.add(terrain);

  updateSceneHelpers();
  updateCamera();
  updateStatusPanel();
  updateElevationLegend();
  showMissionInstructions();
  showCoordinateInformation();
  createNamedPointMarker();
}

// ======================================================
// 20. DEM 清理（DEM Cleaning）
// ======================================================

function cleanDemElevations(
  source,
  width,
  height
) {
  const firstPass =
    new Float32Array(
      source.length
    );

  demCleaningStatistics = {
    invalidValues: 0,
    repairedInvalidValues: 0,
    spikeValues: 0,
    remainingInvalidValues: 0
  };

  for (
    let index = 0;
    index < source.length;
    index += 1
  ) {
    const value =
      source[index];

    if (
      isRawDemValueValid(value)
    ) {
      firstPass[index] = value;
    } else {
      firstPass[index] = NaN;

      demCleaningStatistics
        .invalidValues += 1;
    }
  }

  const repaired =
    new Float32Array(
      firstPass
    );

  for (
    let row = 0;
    row < height;
    row += 1
  ) {
    for (
      let column = 0;
      column < width;
      column += 1
    ) {
      const index =
        row * width + column;

      if (
        Number.isFinite(
          firstPass[index]
        )
      ) {
        continue;
      }

      const neighbours =
        getNeighbourValues(
          firstPass,
          width,
          height,
          column,
          row,
          2
        );

      if (
        neighbours.length >=
        MIN_VALID_NEIGHBOURS
      ) {
        repaired[index] =
          calculateMedian(
            neighbours
          );

        demCleaningStatistics
          .repairedInvalidValues += 1;
      } else {
        repaired[index] = NaN;
      }
    }
  }

  const cleaned =
    new Float32Array(
      repaired
    );

  for (
    let row = 1;
    row < height - 1;
    row += 1
  ) {
    for (
      let column = 1;
      column < width - 1;
      column += 1
    ) {
      const index =
        row * width + column;

      const centerValue =
        repaired[index];

      if (
        !Number.isFinite(
          centerValue
        )
      ) {
        continue;
      }

      const neighbours =
        getNeighbourValues(
          repaired,
          width,
          height,
          column,
          row,
          1
        );

      if (
        neighbours.length <
        MIN_VALID_NEIGHBOURS
      ) {
        continue;
      }

      const neighbourMedian =
        calculateMedian(
          neighbours
        );

      if (
        Math.abs(
          centerValue -
          neighbourMedian
        ) >
        LOCAL_SPIKE_THRESHOLD_METERS
      ) {
        cleaned[index] =
          neighbourMedian;

        demCleaningStatistics
          .spikeValues += 1;
      }
    }
  }

  for (
    let index = 0;
    index < cleaned.length;
    index += 1
  ) {
    if (
      !Number.isFinite(
        cleaned[index]
      )
    ) {
      demCleaningStatistics
        .remainingInvalidValues += 1;
    }
  }

  return cleaned;
}

function isRawDemValueValid(value) {
  if (!Number.isFinite(value)) {
    return false;
  }

  if (
    Math.abs(value) >
    1_000_000
  ) {
    return false;
  }

  for (
    const noDataValue of
    KNOWN_NODATA_VALUES
  ) {
    const tolerance =
      Math.max(
        0.001,
        Math.abs(
          noDataValue
        ) *
        1e-6
      );

    if (
      Math.abs(
        value -
        noDataValue
      ) <= tolerance
    ) {
      return false;
    }
  }

  const metadataNoData =
    Number(
      terrainMetadata?.noDataValue ??
      terrainMetadata?.nodata ??
      terrainMetadata?.noData
    );

  if (
    Number.isFinite(
      metadataNoData
    ) &&
    Math.abs(
      value -
      metadataNoData
    ) <
    0.001
  ) {
    return false;
  }

  return true;
}

function isValidElevation(value) {
  return (
    Number.isFinite(value) &&
    Math.abs(value) <
    1_000_000
  );
}

function getNeighbourValues(
  values,
  width,
  height,
  centerColumn,
  centerRow,
  radius = 1
) {
  const neighbours = [];

  for (
    let rowOffset = -radius;
    rowOffset <= radius;
    rowOffset += 1
  ) {
    for (
      let columnOffset = -radius;
      columnOffset <= radius;
      columnOffset += 1
    ) {
      if (
        rowOffset === 0 &&
        columnOffset === 0
      ) {
        continue;
      }

      const column =
        centerColumn +
        columnOffset;

      const row =
        centerRow +
        rowOffset;

      if (
        column < 0 ||
        column >= width ||
        row < 0 ||
        row >= height
      ) {
        continue;
      }

      const value =
        values[
          row * width +
          column
        ];

      if (
        Number.isFinite(value)
      ) {
        neighbours.push(value);
      }
    }
  }

  return neighbours;
}

function calculateMedian(values) {
  if (
    values.length === 0
  ) {
    return NaN;
  }

  const sorted =
    [...values].sort(
      (a, b) => a - b
    );

  const middle =
    Math.floor(
      sorted.length / 2
    );

  if (
    sorted.length % 2 === 0
  ) {
    return (
      sorted[middle - 1] +
      sorted[middle]
    ) / 2;
  }

  return sorted[middle];
}

function calculateValidElevationRange(
  elevations
) {
  let minimum = Infinity;
  let maximum = -Infinity;

  for (
    const value of elevations
  ) {
    if (
      !isValidElevation(value)
    ) {
      continue;
    }

    minimum =
      Math.min(
        minimum,
        value
      );

    maximum =
      Math.max(
        maximum,
        value
      );
  }

  if (
    !Number.isFinite(minimum) ||
    !Number.isFinite(maximum)
  ) {
    throw new Error(
      "清理後沒有有效 DEM 高程資料"
    );
  }

  return {
    min: minimum,
    max: maximum
  };
}

// ======================================================
// 21. 坡度圖層（Slope Layer）
// ======================================================

function createSlopeColorMap() {
  const width =
    terrainMetadata.width;

  const height =
    terrainMetadata.height;

  const pixelSizeXMeters =
    terrainMetadata.pixelSizeXMeters;

  const pixelSizeYMeters =
    terrainMetadata.pixelSizeYMeters;

  for (
    let row = 0;
    row < height;
    row += 1
  ) {
    for (
      let column = 0;
      column < width;
      column += 1
    ) {
      const index =
        row * width + column;

      const leftColumn =
        Math.max(
          column - 1,
          0
        );

      const rightColumn =
        Math.min(
          column + 1,
          width - 1
        );

      const topRow =
        Math.max(
          row - 1,
          0
        );

      const bottomRow =
        Math.min(
          row + 1,
          height - 1
        );

      const leftHeight =
        getElevationAtPixel(
          leftColumn,
          row
        );

      const rightHeight =
        getElevationAtPixel(
          rightColumn,
          row
        );

      const topHeight =
        getElevationAtPixel(
          column,
          topRow
        );

      const bottomHeight =
        getElevationAtPixel(
          column,
          bottomRow
        );

      if (
        !isValidElevation(
          leftHeight
        ) ||
        !isValidElevation(
          rightHeight
        ) ||
        !isValidElevation(
          topHeight
        ) ||
        !isValidElevation(
          bottomHeight
        )
      ) {
        setColorInArray(
          slopeTerrainColors,
          index,
          INVALID_COLOR
        );

        continue;
      }

      const countX =
        Math.max(
          rightColumn -
          leftColumn,
          1
        );

      const countY =
        Math.max(
          bottomRow -
          topRow,
          1
        );

      const slopeX =
        (
          rightHeight -
          leftHeight
        ) /
        (
          countX *
          pixelSizeXMeters
        );

      const slopeY =
        (
          bottomHeight -
          topHeight
        ) /
        (
          countY *
          pixelSizeYMeters
        );

      const slopeDegrees =
        THREE.MathUtils.radToDeg(
          Math.atan(
            Math.hypot(
              slopeX,
              slopeY
            )
          )
        );

      setColorInArray(
        slopeTerrainColors,
        index,
        getSlopeMapColor(
          slopeDegrees
        )
      );
    }
  }
}

function getSlopeMapColor(
  slopeDegrees
) {
  if (
    slopeDegrees < 5
  ) {
    return SLOPE_COLOR_0_TO_5;
  }

  if (
    slopeDegrees < 10
  ) {
    return SLOPE_COLOR_5_TO_10;
  }

  if (
    slopeDegrees < 15
  ) {
    return SLOPE_COLOR_10_TO_15;
  }

  if (
    slopeDegrees <= 20
  ) {
    return SLOPE_COLOR_15_TO_20;
  }

  return SLOPE_COLOR_ABOVE_20;
}

function setSlopeLayerEnabled(
  enabled
) {
  slopeLayerEnabled = enabled;

  if (enabled) {
    elevationLayerEnabled = false;
    elevationToggle.checked = false;
  }

  updateTerrainColorLayer();
}

function setElevationLayerEnabled(
  enabled
) {
  elevationLayerEnabled = enabled;

  if (enabled) {
    slopeLayerEnabled = false;
    slopeToggle.checked = false;
  }

  updateTerrainColorLayer();
}

function updateTerrainColorLayer() {
  if (!terrain) {
    return;
  }

  let selectedColors =
    normalTerrainColors;

  if (
    slopeLayerEnabled
  ) {
    selectedColors =
      slopeTerrainColors;
  } else if (
    elevationLayerEnabled
  ) {
    selectedColors =
      elevationTerrainColors;
  }

  terrain.geometry.setAttribute(
    "color",
    new THREE.BufferAttribute(
      selectedColors,
      3
    )
  );

  terrain.geometry
    .attributes
    .color
    .needsUpdate = true;

  terrain.material.needsUpdate =
    true;
}

function setColorInArray(
  array,
  index,
  color
) {
  array[index * 3] =
    color.r;

  array[index * 3 + 1] =
    color.g;

  array[index * 3 + 2] =
    color.b;
}

// ======================================================
// 22. 高程色帶（Elevation Band Layer）
// ======================================================

function getElevationBandColor(
  elevationMeters,
  minimumElevationMeters,
  maximumElevationMeters
) {
  const range =
    maximumElevationMeters -
    minimumElevationMeters;

  if (
    !Number.isFinite(
      elevationMeters
    ) ||
    range <= 0
  ) {
    return INVALID_COLOR;
  }

  const normalized =
    THREE.MathUtils.clamp(
      (
        elevationMeters -
        minimumElevationMeters
      ) /
      range,
      0,
      1
    );

  const colorIndex =
    Math.min(
      Math.floor(
        normalized *
        ELEVATION_COLORS.length
      ),
      ELEVATION_COLORS.length - 1
    );

  return ELEVATION_COLORS[
    colorIndex
  ];
}

function updateElevationLegend() {
  if (!terrainMetadata) {
    return;
  }

  const minimum =
    terrainMetadata.minHeightMeters;

  const maximum =
    terrainMetadata.maxHeightMeters;

  const interval =
    (
      maximum -
      minimum
    ) /
    ELEVATION_COLORS.length;

  const colorHexValues = [
    "#132a73",
    "#245cff",
    "#20bfc7",
    "#42a84b",
    "#d6d33f",
    "#ff962f",
    "#e63b2e"
  ];

  let legendHtml = "";

  for (
    let index = 0;
    index <
    ELEVATION_COLORS.length;
    index += 1
  ) {
    const startElevation =
      minimum +
      interval *
      index;

    const endElevation =
      minimum +
      interval *
      (index + 1);

    legendHtml +=
      createLegendRow(
        colorHexValues[index],
        `${formatKm(startElevation)} ～ ` +
        `${formatKm(endElevation)} km`
      );
  }

  elevationLegend.innerHTML = wrapBilingualText(`
    ${legendHtml}

    <div style="
      margin-top:8px;
      color:#aaaaaa;
      font-size:12px;
    ">
      藍色代表較低高程，紅色代表較高高程
      (Blue: Lower Elevation; Red: Higher Elevation)
    </div>
  `);
}

// ======================================================
// 23. 資料驗證（Metadata Validation）
// ======================================================

function validateMetadata(values) {
  for (
    const [
      name,
      value
    ] of Object.entries(
      values
    )
  ) {
    if (
      !Number.isFinite(value)
    ) {
      throw new Error(
        `中繼資料缺少或無效：${name}`
      );
    }
  }

  if (
    values.width < 2 ||
    values.height < 2
  ) {
    throw new Error(
      "DEM 寬度與高度至少必須為 2"
    );
  }

  if (
    values.pixelSizeXMeters <= 0 ||
    values.pixelSizeYMeters <= 0
  ) {
    throw new Error(
      "DEM 像素尺寸必須大於 0"
    );
  }
}

// ======================================================
// 24. 場景與相機更新（Scene and Camera Update）
// ======================================================

function updateSceneHelpers() {
  const largestDimension =
    Math.max(
      terrainWidthKm,
      terrainDepthKm
    );

  gridHelper.scale.set(
    terrainWidthKm / 10,
    1,
    terrainDepthKm / 10
  );

  axesHelper.scale.setScalar(
    Math.max(
      largestDimension *
      0.15,
      0.2
    )
  );
}

function updateCamera() {
  const largestDimension =
    Math.max(
      terrainWidthKm,
      terrainDepthKm
    );

  const centerElevationKm =
    (
      terrainMetadata.minHeightMeters +
      terrainMetadata.maxHeightMeters
    ) /
    2 /
    1000 *
    VERTICAL_EXAGGERATION;

  camera.near =
    Math.max(
      largestDimension /
      10000,
      0.0001
    );

  camera.far =
    Math.max(
      largestDimension *
      100,
      100
    );

  camera.updateProjectionMatrix();

  camera.position.set(
    largestDimension *
    0.55,

    centerElevationKm +
    largestDimension *
    0.75,

    largestDimension *
    0.9
  );

  controls.target.set(
    0,
    centerElevationKm,
    0
  );

  controls.minDistance =
    largestDimension *
    0.03;

  controls.maxDistance =
    largestDimension *
    8;

  controls.update();
}

function updateStatusPanel() {
  const {
    width,
    height,
    minHeightMeters,
    maxHeightMeters,
    pixelSizeXMeters,
    pixelSizeYMeters
  } = terrainMetadata;

  const centerElevationMeters =
    sampleElevationBilinear(
      0,
      0
    );

  const centerProjected =
    localToProjectedCoordinates(
      0,
      0
    );

  const centerMoonRadiusMeters =
    Number(
      terrainMetadata
        .moonRadiusMeters ??
      DEFAULT_MOON_RADIUS_METERS
    );

  const centerGeographic =
    inverseSouthPolarStereographic(
      centerProjected.x,
      centerProjected.y,
      centerMoonRadiusMeters,
      CENTRAL_MERIDIAN_DEGREES
    );

  statusPanel.innerHTML = wrapBilingualText(`
    <strong>
      Artemis III／Nobile Rim 2 數位高程模型
      (Digital Elevation Model, DEM)
    </strong><br>

    顯示網格 (Display Grid)：
    ${width} × ${height}

    ｜地面解析度 (Ground Resolution)：
    ${pixelSizeXMeters.toFixed(3)} ×
    ${pixelSizeYMeters.toFixed(3)}
    m/pixel

    ｜地形範圍 (Terrain Extent)：
    ${terrainWidthKm.toFixed(3)} ×
    ${terrainDepthKm.toFixed(3)}
    km

    <br>

    高程範圍 (Elevation Range)：
    ${formatKm(minHeightMeters)} ～
    ${formatKm(maxHeightMeters)}
    km

    ｜地形高差 (Elevation Difference)：
    ${formatKm(
      maxHeightMeters -
      minHeightMeters
    )}
    km

    <br>

    任務區中心座標 (Mission Area Center)：
    ${centerGeographic.latitudeDegrees.toFixed(6)}°,
    ${normalizeLongitude(
      centerGeographic.longitudeDegrees
    ).toFixed(6)}°

    ｜中心高程 (Center Elevation)：
    ${
      Number.isFinite(
        centerElevationMeters
      )
        ? formatKm(centerElevationMeters) + " km"
        : "無資料 (No Data)"
    }

    <br>

    NoData：
    ${demCleaningStatistics.invalidValues}

    ｜修補 (Repaired)：
    ${demCleaningStatistics.repairedInvalidValues}

    ｜尖峰修正 (Spike Correction)：
    ${demCleaningStatistics.spikeValues}

    ｜剩餘無效 (Remaining Invalid)：
    ${demCleaningStatistics.remainingInvalidValues}

    <br>

    左鍵 (Left-Click)：旋轉 (Rotate)｜
    滾輪 (Wheel)：縮放 (Zoom)｜
    右鍵 (Right-Click)：平移 (Pan)

    <br>

    G：網格 (Grid)｜
    A：座標軸 (Axes)｜
    S：坡度 (Slope)｜
    E：高程色帶 (Elevation Bands)｜
    R：清除路線 (Clear Traverse)｜
    U：顯示／隱藏介面 (Show/Hide Interface)｜
    [ / ]：縮小／放大介面 (Zoom Interface Out/In)｜
    面板上方把手 (Drag Handle)：自由拖動 (Free Drag)
  `);
}

// ======================================================
// 26. 經緯度搜尋（Coordinate Search）
// ======================================================

function executeCoordinateAction(action) {
  if (
    !terrain ||
    !terrainMetadata
  ) {
    showCoordinateSearchMessage(
      "地形尚未載入完成 (Terrain Not Yet Loaded)",
      "#ffd84a"
    );

    return;
  }

  const latitudeDegrees =
    Number(
      latitudeInput.value
    );

  const longitudeDegrees =
    Number(
      longitudeInput.value
    );

  if (
    !Number.isFinite(
      latitudeDegrees
    ) ||
    !Number.isFinite(
      longitudeDegrees
    )
  ) {
    showCoordinateSearchMessage(
      "請輸入有效的緯度與經度 (Please Enter a Valid Latitude and Longitude)",
      "#ff6b6b"
    );

    return;
  }

  if (
    latitudeDegrees < -90 ||
    latitudeDegrees > 90
  ) {
    showCoordinateSearchMessage(
      '<span class="lang-zh">緯度必須介於 -90° 到 90°</span>' +
      '<span class="lang-en">Latitude Must Be Between -90° and 90°</span>',
      "#ff6b6b"
    );

    return;
  }

  const normalizedLongitude =
    normalizeLongitude(
      longitudeDegrees
    );

  longitudeInput.value =
    normalizedLongitude.toFixed(6);

  const point =
    createPointDataFromGeographicCoordinates(
      latitudeDegrees,
      normalizedLongitude
    );

  if (!point) {
    showCoordinateSearchMessage(
      '<span class="lang-zh">此座標不在目前 DEM 範圍內，或沒有有效高程資料</span>' +
      '<span class="lang-en">This Coordinate Is Outside the Current DEM ' +
      'Extent or Has No Valid Elevation Data</span>',
      "#ff6b6b"
    );

    return;
  }

  placeMarkerOnSurface(
    clickMarker,
    point
  );

  clickMarker.visible = true;

  focusCameraOnPoint(
    point
  );

  if (action === "start") {
    setStartPointFromCoordinate(
      point
    );

    showCoordinateInformation();

    showCoordinateSearchMessage(
      `已設定起點 (Start Point Set)：` +
      `${point.latitudeDegrees.toFixed(6)}°, ` +
      `${point.longitudeDegrees.toFixed(6)}°`,
      "#42ff78"
    );

    return;
  }

  if (action === "goal") {
    setGoalPointFromCoordinate(
      point
    );

    showCoordinateInformation();

    showCoordinateSearchMessage(
      `已設定終點 (Destination Point Set)：` +
      `${point.latitudeDegrees.toFixed(6)}°, ` +
      `${point.longitudeDegrees.toFixed(6)}°`,
      "#ff7777"
    );

    return;
  }

  showCoordinateSearchMessage(
    `已找到位置，高程 (Location Found, Elevation)：` +
    `${formatKm(point.elevationMeters)} km`,
    "#67d9ff"
  );
}

function createPointDataFromGeographicCoordinates(
  latitudeDegrees,
  longitudeDegrees
) {
  const moonRadiusMeters =
    Number(
      terrainMetadata
        .moonRadiusMeters ??
      DEFAULT_MOON_RADIUS_METERS
    );

  const projected =
    forwardSouthPolarStereographic(
      longitudeDegrees,
      latitudeDegrees,
      moonRadiusMeters,
      CENTRAL_MERIDIAN_DEGREES
    );

  const local =
    projectedToLocalCoordinates(
      projected.x,
      projected.y
    );

  const halfWidthKm =
    terrainWidthKm / 2;

  const halfDepthKm =
    terrainDepthKm / 2;

  const toleranceKm =
    Math.max(
      terrainMetadata
        .pixelSizeXMeters,
      terrainMetadata
        .pixelSizeYMeters
    ) /
    1000;

  if (
    local.xKm <
      -halfWidthKm -
      toleranceKm ||
    local.xKm >
      halfWidthKm +
      toleranceKm ||
    local.zKm <
      -halfDepthKm -
      toleranceKm ||
    local.zKm >
      halfDepthKm +
      toleranceKm
  ) {
    return null;
  }

  const localXKm =
    THREE.MathUtils.clamp(
      local.xKm,
      -halfWidthKm,
      halfWidthKm
    );

  const localZKm =
    THREE.MathUtils.clamp(
      local.zKm,
      -halfDepthKm,
      halfDepthKm
    );

  const elevationMeters =
    sampleElevationBilinear(
      localXKm,
      localZKm
    );

  if (
    !Number.isFinite(
      elevationMeters
    )
  ) {
    return null;
  }

  return createPointDataFromWorldPoint(
    new THREE.Vector3(
      localXKm,

      (
        elevationMeters /
        1000
      ) *
      VERTICAL_EXAGGERATION,

      localZKm
    )
  );
}

function setStartPointFromCoordinate(
  point
) {
  startPoint = point;

  placeMarkerOnSurface(
    startMarker,
    startPoint
  );

  startMarker.visible = true;

  removeRouteLine();
  routeSamples = [];

  if (goalPoint) {
    buildAndAnalyzeRoute();
  } else {
    updateMissionWaitingPanel(
      "start"
    );
  }
}

function setGoalPointFromCoordinate(
  point
) {
  goalPoint = point;

  placeMarkerOnSurface(
    goalMarker,
    goalPoint
  );

  goalMarker.visible = true;

  removeRouteLine();
  routeSamples = [];

  if (startPoint) {
    buildAndAnalyzeRoute();
  } else {
    updateMissionWaitingPanel(
      "goal"
    );
  }
}

function focusCameraOnPoint(point) {
  const largestDimension =
    Math.max(
      terrainWidthKm,
      terrainDepthKm
    );

  const targetY =
    (
      point.elevationMeters /
      1000
    ) *
    VERTICAL_EXAGGERATION;

  let offset =
    camera.position
      .clone()
      .sub(
        controls.target
      );

  if (
    offset.length() <
    0.001
  ) {
    offset =
      new THREE.Vector3(
        largestDimension *
        0.35,

        largestDimension *
        0.55,

        largestDimension *
        0.65
      );
  }

  offset.setLength(
    THREE.MathUtils.clamp(
      offset.length(),
      largestDimension *
      0.15,
      largestDimension *
      0.8
    )
  );

  controls.target.set(
    point.localXKm,
    targetY,
    point.localZKm
  );

  camera.position.copy(
    controls.target
      .clone()
      .add(offset)
  );

  controls.update();
}

function showCoordinateSearchMessage(
  message,
  color = "#aaaaaa"
) {
  coordinateSearchMessage.style.color =
    color;

  setLocalizedHtml(
    coordinateSearchMessage,
    message
  );
}

// ======================================================
// 27. 地形點擊選取（Terrain Picking）
// ======================================================

const raycaster =
  new THREE.Raycaster();

const pointer =
  new THREE.Vector2();

let pointerDownX = 0;
let pointerDownY = 0;

renderer.domElement.addEventListener(
  "pointerdown",
  (event) => {
    pointerDownX =
      event.clientX;

    pointerDownY =
      event.clientY;
  }
);

renderer.domElement.addEventListener(
  "pointerup",
  (event) => {
    if (
      viewHelper.handleClick(event)
    ) {
      return;
    }

    const movement =
      Math.hypot(
        event.clientX -
        pointerDownX,

        event.clientY -
        pointerDownY
      );

    if (movement > 5) {
      return;
    }

    handleTerrainClick(event);
  }
);

function pickTerrainPoint(event) {
  const rect =
    renderer.domElement
      .getBoundingClientRect();

  pointer.x =
    (
      (
        event.clientX -
        rect.left
      ) /
      rect.width
    ) *
    2 -
    1;

  pointer.y =
    -(
      (
        event.clientY -
        rect.top
      ) /
      rect.height
    ) *
    2 +
    1;

  raycaster.setFromCamera(
    pointer,
    camera
  );

  const intersections =
    raycaster.intersectObject(
      terrain,
      false
    );

  if (
    intersections.length === 0
  ) {
    return null;
  }

  return createPointDataFromWorldPoint(
    intersections[0]
      .point
      .clone()
  );
}

// ======================================================
// 28. 座標資料與標記（Coordinates and Markers）
// ======================================================

function rebuildPointUsingDemHeight(
  point
) {
  const elevationMeters =
    sampleElevationBilinear(
      point.localXKm,
      point.localZKm
    );

  if (
    !Number.isFinite(
      elevationMeters
    )
  ) {
    return point;
  }

  return createPointDataFromWorldPoint(
    new THREE.Vector3(
      point.localXKm,

      (
        elevationMeters /
        1000
      ) *
      VERTICAL_EXAGGERATION,

      point.localZKm
    )
  );
}

function createPointDataFromWorldPoint(
  worldPoint
) {
  const localXKm =
    worldPoint.x;

  const localZKm =
    worldPoint.z;

  const projected =
    localToProjectedCoordinates(
      localXKm,
      localZKm
    );

  const moonRadiusMeters =
    Number(
      terrainMetadata
        .moonRadiusMeters ??
      DEFAULT_MOON_RADIUS_METERS
    );

  const geographic =
    inverseSouthPolarStereographic(
      projected.x,
      projected.y,
      moonRadiusMeters,
      CENTRAL_MERIDIAN_DEGREES
    );

  return {
    worldPoint:
      worldPoint.clone(),

    localXKm,
    localZKm,

    projectedXMeters:
      projected.x,

    projectedYMeters:
      projected.y,

    longitudeDegrees:
      normalizeLongitude(
        geographic.longitudeDegrees
      ),

    latitudeDegrees:
      geographic.latitudeDegrees,

    elevationMeters:
      worldPoint.y *
      1000 /
      VERTICAL_EXAGGERATION
  };
}

function placeMarkerOnSurface(
  marker,
  point
) {
  const verticalOffsetKm =
    marker.userData.isFlagMarker
      ? MARKER_SURFACE_GAP_KM
      : MARKER_RADIUS_KM +
        MARKER_SURFACE_GAP_KM;

  marker.position.set(
    point.localXKm,

    (
      point.elevationMeters /
      1000
    ) *
    VERTICAL_EXAGGERATION +
    verticalOffsetKm,

    point.localZKm
  );
}

function formatCoordinatePanelPoint(
  title,
  point
) {
  if (!point) {
    return `
      <strong>${title}</strong><br>

      尚未設定
      (Not Set)
    `;
  }

  return `
    <strong>${title}</strong><br>

    經度 (Longitude)：
    ${point.longitudeDegrees.toFixed(6)}°<br>

    緯度 (Latitude)：
    ${point.latitudeDegrees.toFixed(6)}°<br>

    絕對高程 (Absolute Elevation)：
    ${formatKm(point.elevationMeters)}
    km
  `;
}

function showCoordinateInformation() {
  coordinatePanel.innerHTML = wrapBilingualText(`
    <strong>
      月面實際座標
      (Lunar Surface Coordinates)
    </strong><br>

    ${formatCoordinatePanelPoint(
      "起點 (Start Point)",
      startPoint
    )}

    <hr class="panel-divider">

    ${formatCoordinatePanelPoint(
      "終點 (Destination Point)",
      goalPoint
    )}

    <hr class="panel-divider">

    <span style="color:#aaaaaa">
      CRS：
      Moon South Polar Stereographic<br>

      Projection Centre：
      -90°<br>

      Central Meridian：
      ${CENTRAL_MERIDIAN_DEGREES}°<br>

      Elevation Datum：
      Referenced to ${(
        (
          terrainMetadata?.moonRadiusMeters ??
          DEFAULT_MOON_RADIUS_METERS
        ) / 1000
      ).toFixed(1)} km Sphere
    </span>
  `);
}

function updateMissionPanel(
  analysis
) {
  const status =
    getStatusStyle(
      analysis.status
    );

  missionPanel.innerHTML = wrapBilingualText(`
    <strong>
      月球車任務路線
      (Rover Mission Traverse)
    </strong><br>

    水平距離
    (Horizontal Distance)：
    <strong>
      ${formatKm(analysis.horizontalDistanceMeters)}
      km
    </strong><br>

    地表路徑距離
    (Surface Path Distance)：
    <strong>
      ${formatKm(analysis.surfaceDistanceMeters)}
      km
    </strong><br>

    淨高程變化
    (Net Elevation Change)：
    <strong>
      ${formatSignedNumber(
        analysis.netElevationChangeMeters / 1000,
        3
      )}
      km
    </strong><br>

    累積爬升
    (Cumulative Ascent)：
    <strong>
      ${formatKm(analysis.cumulativeAscentMeters)}
      km
    </strong><br>

    累積下降
    (Cumulative Descent)：
    <strong>
      ${formatKm(analysis.cumulativeDescentMeters)}
      km
    </strong><br>

    平均坡度
    (Average Slope)：
    <strong>
      ${analysis.averageSlopeDegrees.toFixed(2)}°
    </strong><br>

    最大坡度
    (Maximum Slope)：
    <strong>
      ${analysis.maximumSlopeDegrees.toFixed(2)}°
    </strong><br>

    <br>

    路線安全狀態
    (Traverse Safety Status)：

    <strong style="
      color:${status.color};
      border:1px solid ${status.color};
      padding:2px 7px;
      border-radius:10px;
    ">
      ${status.label}
    </strong>
  `);
}

function updateMissionWaitingPanel(
  selectedType
) {
  const isStart =
    selectedType === "start";

  missionPanel.innerHTML = wrapBilingualText(`
    <strong>
      月球車任務路線
      (Rover Mission Traverse)
    </strong><br>

    <span style="
      color:${
        isStart
          ? "#00ff66"
          : "#ff6666"
      };
    ">
      ${
        isStart
          ? "起點已設定 (Start Point Set)"
          : "終點已設定 (Destination Point Set)"
      }
    </span>

    <br><br>

    ${
      isStart
        ? "請設定終點。(Please Set the Destination Point.)"
        : "請設定起點。(Please Set the Start Point.)"
    }
  `);
}

// ======================================================
// 31. DEM 雙線性取樣（Bilinear DEM Sampling）
// ======================================================

function sampleElevationBilinear(
  localXKm,
  localZKm
) {
  if (
    !terrainMetadata ||
    !terrainElevations
  ) {
    return NaN;
  }

  const width =
    terrainMetadata.width;

  const height =
    terrainMetadata.height;

  const normalizedX =
    localXKm /
    terrainWidthKm +
    0.5;

  const normalizedY =
    0.5 +
    localZKm /
    terrainDepthKm;

  if (
    normalizedX < 0 ||
    normalizedX > 1 ||
    normalizedY < 0 ||
    normalizedY > 1
  ) {
    return NaN;
  }

  const pixelX =
    normalizedX *
    (width - 1);

  const pixelY =
    normalizedY *
    (height - 1);

  const x0 =
    Math.floor(pixelX);

  const y0 =
    Math.floor(pixelY);

  const x1 =
    Math.min(
      x0 + 1,
      width - 1
    );

  const y1 =
    Math.min(
      y0 + 1,
      height - 1
    );

  const tx =
    pixelX - x0;

  const ty =
    pixelY - y0;

  const h00 =
    getElevationAtPixel(
      x0,
      y0
    );

  const h10 =
    getElevationAtPixel(
      x1,
      y0
    );

  const h01 =
    getElevationAtPixel(
      x0,
      y1
    );

  const h11 =
    getElevationAtPixel(
      x1,
      y1
    );

  if (
    !isValidElevation(h00) ||
    !isValidElevation(h10) ||
    !isValidElevation(h01) ||
    !isValidElevation(h11)
  ) {
    return NaN;
  }

  const top =
    THREE.MathUtils.lerp(
      h00,
      h10,
      tx
    );

  const bottom =
    THREE.MathUtils.lerp(
      h01,
      h11,
      tx
    );

  return THREE.MathUtils.lerp(
    top,
    bottom,
    ty
  );
}

function getElevationAtPixel(
  column,
  row
) {
  return terrainElevations[
    row *
    terrainMetadata.width +
    column
  ];
}

// ======================================================
// 32. 座標轉換（Coordinate Conversion）
// ======================================================

function localToProjectedCoordinates(
  localXKm,
  localZKm
) {
  const west =
    Number(
      terrainMetadata.west
    );

  const east =
    Number(
      terrainMetadata.east
    );

  const south =
    Number(
      terrainMetadata.south
    );

  const north =
    Number(
      terrainMetadata.north
    );

  if (
    !Number.isFinite(west) ||
    !Number.isFinite(east) ||
    !Number.isFinite(south) ||
    !Number.isFinite(north)
  ) {
    throw new Error(
      "缺少投影範圍資料"
    );
  }

  const centerX =
    (west + east) / 2;

  const centerY =
    (south + north) / 2;

  return {
    x:
      centerX +
      localXKm *
      1000,

    y:
      centerY -
      localZKm *
      1000
  };
}

function projectedToLocalCoordinates(
  projectedX,
  projectedY
) {
  const west =
    Number(
      terrainMetadata.west
    );

  const east =
    Number(
      terrainMetadata.east
    );

  const south =
    Number(
      terrainMetadata.south
    );

  const north =
    Number(
      terrainMetadata.north
    );

  const centerX =
    (west + east) / 2;

  const centerY =
    (south + north) / 2;

  return {
    xKm:
      (
        projectedX -
        centerX
      ) /
      1000,

    zKm:
      (
        centerY -
        projectedY
      ) /
      1000
  };
}

function forwardSouthPolarStereographic(
  longitudeDegrees,
  latitudeDegrees,
  moonRadius,
  centralMeridian = 0
) {
  const latitudeRadians =
    THREE.MathUtils.degToRad(
      latitudeDegrees
    );

  const longitudeDifferenceRadians =
    THREE.MathUtils.degToRad(
      normalizeLongitude(
        longitudeDegrees -
        centralMeridian
      )
    );

  const angularDistance =
    latitudeRadians +
    Math.PI / 2;

  const rho =
    2 *
    moonRadius *
    Math.tan(
      angularDistance / 2
    );

  return {
    x:
      rho *
      Math.sin(
        longitudeDifferenceRadians
      ),

    y:
      rho *
      Math.cos(
        longitudeDifferenceRadians
      )
  };
}

function inverseSouthPolarStereographic(
  projectedX,
  projectedY,
  moonRadius,
  centralMeridian = 0
) {
  const rho =
    Math.hypot(
      projectedX,
      projectedY
    );

  if (
    rho <
    Number.EPSILON
  ) {
    return {
      longitudeDegrees:
        centralMeridian,

      latitudeDegrees:
        -90
    };
  }

  const angularDistance =
    2 *
    Math.atan(
      rho /
      (
        2 *
        moonRadius
      )
    );

  const latitude =
    angularDistance -
    Math.PI / 2;

  const longitude =
    THREE.MathUtils.degToRad(
      centralMeridian
    ) +
    Math.atan2(
      projectedX,
      projectedY
    );

  return {
    longitudeDegrees:
      THREE.MathUtils.radToDeg(
        longitude
      ),

    latitudeDegrees:
      THREE.MathUtils.radToDeg(
        latitude
      )
  };
}

function normalizeLongitude(
  longitude
) {
  return (
    (
      (
        longitude +
        180
      ) %
      360 +
      360
    ) %
    360
  ) -
  180;
}

// ======================================================
// 33. 路線清除與說明（Route Reset and Instructions）
// ======================================================

function showMissionInstructions() {
  missionPanel.innerHTML = wrapBilingualText(`
    <strong>
      月球車任務路線
      (Rover Mission Traverse)
    </strong><br>

    第一次點擊 (First Click)：
    設定起點 (Set Start Point)<br>

    第二次點擊 (Second Click)：
    設定終點 (Set Destination Point)<br>

    第三次點擊 (Third Click)：
    建立新路線 (Create New Traverse)<br>

    <br>

    也可以輸入經緯度後選擇 (Or Enter Latitude/Longitude and Choose)：

    <br>

    設定點 (Set a Point)<br>
    設為起點 (Set as Start)<br>
    設為終點 (Set as Destination)<br>

    <br>

    <span style="color:#aaaaaa">
      綠色標記 (Green Marker)：起點 (Start)<br>
      紅色標記 (Red Marker)：終點 (Destination)<br>
      橘色標記 (Orange Marker)：搜尋位置 (Search Location)<br>
      白色線 (White Line)：貼地路線 (Ground-Hugging Traverse)
    </span>
  `);
}

// ======================================================
// 34. 安全分級（Safety Classification）
// ======================================================

function classifySlope(
  maximumSlope
) {
  if (
    maximumSlope <=
    SAFE_SLOPE_DEGREES
  ) {
    return "safe";
  }

  if (
    maximumSlope <=
    WARNING_SLOPE_DEGREES
  ) {
    return "warning";
  }

  return "unsafe";
}

function getStatusStyle(
  status
) {
  if (
    status === "safe"
  ) {
    return {
      label:
        "安全 (Safe)",

      color:
        "#42ff78"
    };
  }

  if (
    status === "warning"
  ) {
    return {
      label:
        "警告 (Warning)",

      color:
        "#ffd84a"
    };
  }

  return {
    label:
      "不安全 (Unsafe)",

    color:
      "#ff4f4f"
  };
}

// ======================================================
// 35. 工具函式（Utility Functions）
// ======================================================

function formatKm(
  meters,
  digits = 3
) {
  return (
    meters /
    1000
  ).toFixed(
    digits
  );
}

function formatSignedNumber(
  value,
  digits = 1
) {
  return (
    value > 0
      ? "+"
      : ""
  ) +
  value.toFixed(
    digits
  );
}

function escapeHtml(value) {
  return String(value)
    .replaceAll(
      "&",
      "&amp;"
    )
    .replaceAll(
      "<",
      "&lt;"
    )
    .replaceAll(
      ">",
      "&gt;"
    )
    .replaceAll(
      '"',
      "&quot;"
    )
    .replaceAll(
      "'",
      "&#039;"
    );
}

// ======================================================
// 36. 鍵盤快捷鍵（Keyboard Shortcuts）
// ======================================================

window.addEventListener(
  "keydown",
  (event) => {
    const target =
      event.target;

    if (
      target instanceof
        HTMLInputElement ||
      target instanceof
        HTMLTextAreaElement ||
      target instanceof
        HTMLSelectElement
    ) {
      return;
    }

    const key =
      event.key.toLowerCase();

    if (key === "u") {
      toggleAllPanels();
    }

    if (event.key === "[") {
      changeInterfaceScale(
        -0.05
      );
    }

    if (event.key === "]") {
      changeInterfaceScale(
        0.05
      );
    }

    if (key === "g") {
      gridHelper.visible =
        !gridHelper.visible;
    }

    if (key === "a") {
      axesHelper.visible =
        !axesHelper.visible;
    }

    if (key === "r") {
      resetMissionRoute();
    }

    if (key === "s") {
      slopeToggle.checked =
        !slopeToggle.checked;

      setSlopeLayerEnabled(
        slopeToggle.checked
      );
    }

    if (key === "e") {
      elevationToggle.checked =
        !elevationToggle.checked;

      setElevationLayerEnabled(
        elevationToggle.checked
      );
    }
  }
);

// ======================================================
// 37. 視窗調整（Window Resize）
// ======================================================

window.addEventListener(
  "resize",
  () => {
    camera.aspect =
      window.innerWidth /
      window.innerHeight;

    camera.updateProjectionMatrix();

    renderer.setSize(
      window.innerWidth,
      window.innerHeight
    );

    renderer.setPixelRatio(
      Math.min(
        window.devicePixelRatio,
        1.5
      )
    );

    for (
      const record of
      draggablePanelRecords
    ) {
      keepDraggablePanelInsideWindow(
        record.panel
      );
    }
  }
);

// ======================================================
// 38. 動畫迴圈（Animation Loop）
// ======================================================

function animate() {
  requestAnimationFrame(
    animate
  );

  controls.update();

  renderer.clear();

  renderer.render(
    scene,
    camera
  );

  if (
    !moonOverviewPanel.classList.contains(
      "interface-panel-hidden"
    )
  ) {
    renderMoonOverview();
  }

  viewHelperTimer.update();

  if (viewHelper.animating) {
    viewHelper.update(
      viewHelperTimer.getDelta()
    );
  }

  viewHelper.render(renderer);
}

animate();
// ======================================================
// 39. 路線高程剖面圖、坡度分段顏色與危險點標記
// （Route Profile, Slope-Colored Route and Hazard Markers）
// ======================================================

// ------------------------------------------------------
// 39A. 新增設定（Additional Settings）
// ------------------------------------------------------

const ENHANCED_ROUTE_COLOR_SAFE = 0x36d66b;
const ENHANCED_ROUTE_COLOR_PASSABLE = 0xd7df3f;
const ENHANCED_ROUTE_COLOR_WARNING = 0xff8c2a;
const ENHANCED_ROUTE_COLOR_UNSAFE = 0xff3b30;

const ENHANCED_HAZARD_MARKER_RADIUS_KM = 0.012;
const ENHANCED_HAZARD_MARKER_GAP_KM = 0.004;

const ENHANCED_HAZARD_TRIANGLE_RADIUS_KM = MARKER_RADIUS_KM;
const ENHANCED_HAZARD_TRIANGLE_HEIGHT_KM = MARKER_RADIUS_KM * 1.8;

// 單一取樣區段高程變化超過此值，視為高程突變
const ENHANCED_SUDDEN_ELEVATION_CHANGE_METERS = 5;

const ENHANCED_PROFILE_CANVAS_WIDTH = 760;
const ENHANCED_PROFILE_CANVAS_HEIGHT = 350;

// ------------------------------------------------------
// 39B. 新增全域資料（Additional Global Data）
// ------------------------------------------------------

let enhancedRouteAnalysis = null;

const enhancedHazardMarkerGroup =
  new THREE.Group();

enhancedHazardMarkerGroup.name =
  "Route Hazard Markers";

scene.add(
  enhancedHazardMarkerGroup
);

// ======================================================
// 40. 剖面圖介面樣式（Profile Interface Styles）
// ======================================================

const enhancedRouteStyle =
  document.createElement("style");

enhancedRouteStyle.textContent = `
  .enhanced-route-profile-canvas {
    display: block;
    width: 100%;
    height: auto;
    margin-top: 9px;
    background: rgba(4, 7, 12, 0.98);
    border: 1px solid rgba(255, 255, 255, 0.24);
    border-radius: 5px;
    cursor: crosshair;
    box-sizing: border-box;
  }

  .enhanced-profile-information {
    margin-top: 8px;
    min-height: 48px;
    padding: 7px 9px;
    color: #dbe7ff;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.13);
    border-radius: 4px;
    font-size: 12px;
    line-height: 1.5;
    box-sizing: border-box;
  }

  .enhanced-route-legend {
    display: flex;
    align-items: center;
    gap: 9px;
    flex-wrap: wrap;
    margin-top: 8px;
    color: #cccccc;
    font-size: 11px;
  }

  .enhanced-route-legend-item {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }

  .enhanced-route-legend-line {
    display: inline-block;
    width: 20px;
    height: 4px;
    border-radius: 3px;
  }

  .enhanced-marker-legend {
    margin-top: 8px;
    padding-top: 7px;
    color: #aaaaaa;
    border-top: 1px solid rgba(255, 255, 255, 0.15);
    font-size: 11px;
    line-height: 1.6;
  }
`;

document.head.appendChild(
  enhancedRouteStyle
);

// ======================================================
// 41. 建立路線剖面圖面板（Create Route Profile Panel）
// ======================================================

const enhancedRouteProfilePanel =
  createPanel({
    top: "410px",
    left: "390px",
    width: "650px",
    maxHeight: "52vh",
    overflowY: "auto",
    zIndex: "45",
    pointerEvents: "auto",
    userSelect: "none"
  });

enhancedRouteProfilePanel.innerHTML = wrapBilingualText(`
  <strong>
    路線高程剖面圖
    (Traverse Elevation Cross Section)
  </strong><br>

  <span style="color:#aaaaaa">
    設定起點與終點後，顯示累積距離、絕對高程、
    分段坡度、最大坡度位置與危險路段。
    (Set the Start and Destination Points to Display Distance,
    Elevation, Segment Slope, Maximum Slope Position
    and Hazardous Sections.)
  </span>

  <canvas
    id="enhanced-route-profile-canvas"
    class="enhanced-route-profile-canvas"
    width="${ENHANCED_PROFILE_CANVAS_WIDTH}"
    height="${ENHANCED_PROFILE_CANVAS_HEIGHT}"
  ></canvas>

  <div
    id="enhanced-profile-information"
    class="enhanced-profile-information"
  >
    尚未建立路線
    (No Traverse Created)
  </div>

  <div class="enhanced-route-legend">
    <span class="enhanced-route-legend-item">
      <span
        class="enhanced-route-legend-line"
        style="background:#36d66b"
      ></span>
      0–5° 安全 (Safe)
    </span>

    <span class="enhanced-route-legend-item">
      <span
        class="enhanced-route-legend-line"
        style="background:#d7df3f"
      ></span>
      5–10° 可通行 (Passable)
    </span>

    <span class="enhanced-route-legend-item">
      <span
        class="enhanced-route-legend-line"
        style="background:#ff8c2a"
      ></span>
      10–15° 警告 (Warning)
    </span>

    <span class="enhanced-route-legend-item">
      <span
        class="enhanced-route-legend-line"
        style="background:#ff3b30"
      ></span>
      &gt;15° 不安全 (Unsafe)
    </span>
  </div>

  <div class="enhanced-marker-legend">
    紅色標記 (Red Marker)：最大坡度／不安全路段
    (Maximum Slope / Unsafe Section)<br>

    綠色標記 (Green Marker)：最大爬升
    (Maximum Ascent)<br>

    淡藍色標記 (Light Blue Marker)：最大下降
    (Maximum Descent)<br>

    黃色標記 (Yellow Marker)：高程突然變化
    (Sudden Elevation Change)<br>

    點擊標記可查看該位置資料。
    (Click a Marker to View Its Data.)
  </div>
`);

stopPanelEvents(
  enhancedRouteProfilePanel
);

const enhancedRouteProfileCanvas =
  document.querySelector(
    "#enhanced-route-profile-canvas"
  );

const enhancedProfileInformation =
  document.querySelector(
    "#enhanced-profile-information"
  );

// 加入原本的介面控制系統
managedPanels.push({
  key: "profile",
  label: "剖面 (Cross Section)",
  panel: enhancedRouteProfilePanel
});

const enhancedProfileVisibilityButton =
  document.createElement("button");

enhancedProfileVisibilityButton.className =
  "interface-button active panel-visibility-button";

enhancedProfileVisibilityButton.dataset.panelKey =
  "profile";

setLocalizedHtml(
  enhancedProfileVisibilityButton,
  "剖面 (Cross Section)"
);

const interfaceControlRows =
  interfaceControlPanel.querySelectorAll(
    ".interface-control-row"
  );

if (interfaceControlRows.length > 1) {
  interfaceControlRows[1].appendChild(
    enhancedProfileVisibilityButton
  );
}

panelVisibilityButtons.push(
  enhancedProfileVisibilityButton
);

enhancedProfileVisibilityButton.addEventListener(
  "click",
  () => {
    const currentlyVisible =
      enhancedProfileVisibilityButton
        .classList
        .contains("active");

    setPanelVisible(
      "profile",
      !currentlyVisible
    );

    updateAllPanelButtonState();
  }
);

makePanelDraggable(
  enhancedRouteProfilePanel,
  "拖動剖面圖 (Drag Cross Section)"
);

makePanelResizable(
  enhancedRouteProfilePanel
);

// ======================================================
// 42. 路線坡度顏色函式（Route Slope Color Functions）
// ======================================================

function getEnhancedRouteSlopeColorHex(
  slopeDegrees
) {
  if (slopeDegrees < 5) {
    return ENHANCED_ROUTE_COLOR_SAFE;
  }

  if (slopeDegrees < 10) {
    return ENHANCED_ROUTE_COLOR_PASSABLE;
  }

  if (slopeDegrees <= 15) {
    return ENHANCED_ROUTE_COLOR_WARNING;
  }

  return ENHANCED_ROUTE_COLOR_UNSAFE;
}

function getEnhancedRouteSlopeColorCss(
  slopeDegrees
) {
  return (
    "#" +
    getEnhancedRouteSlopeColorHex(
      slopeDegrees
    )
      .toString(16)
      .padStart(6, "0")
  );
}

function getSlopeStatusLabel(
  slopeDegrees
) {
  if (slopeDegrees < 5) {
    return "安全 (Safe)";
  }

  if (slopeDegrees < 10) {
    return "可通行 (Passable)";
  }

  if (slopeDegrees <= 15) {
    return "警告 (Warning)";
  }

  return "不安全 (Unsafe)";
}

// ======================================================
// 43. 路線分析（Route Analysis）
// ======================================================

function analyzeRoute(
  samples
) {
  let surfaceDistanceMeters = 0;
  let cumulativeAscentMeters = 0;
  let cumulativeDescentMeters = 0;

  let maximumSlopeDegrees = 0;
  let slopeSumDegrees = 0;
  let slopeCount = 0;

  let maximumSlopeIndex = 1;

  let maximumAscentIndex = 1;
  let maximumDescentIndex = 1;

  let maximumAscentMeters = -Infinity;
  let maximumDescentMeters = Infinity;

  const dangerousSegmentIndices = [];
  const suddenChangeIndices = [];

  samples[0].cumulativeDistanceMeters = 0;
  samples[0].horizontalDistanceMeters = 0;
  samples[0].surfaceSegmentDistanceMeters = 0;
  samples[0].elevationDifferenceMeters = 0;
  samples[0].signedSlopeDegrees = 0;
  samples[0].slopeDegrees = 0;

  for (
    let index = 1;
    index < samples.length;
    index += 1
  ) {
    const previous =
      samples[index - 1];

    const current =
      samples[index];

    const horizontalDistanceMeters =
      Math.hypot(
        (
          current.localXKm -
          previous.localXKm
        ) *
        1000,

        (
          current.localZKm -
          previous.localZKm
        ) *
        1000
      );

    const elevationDifferenceMeters =
      current.elevationMeters -
      previous.elevationMeters;

    const surfaceSegmentDistanceMeters =
      Math.hypot(
        horizontalDistanceMeters,
        elevationDifferenceMeters
      );

    surfaceDistanceMeters +=
      surfaceSegmentDistanceMeters;

    current.cumulativeDistanceMeters =
      surfaceDistanceMeters;

    current.horizontalDistanceMeters =
      horizontalDistanceMeters;

    current.surfaceSegmentDistanceMeters =
      surfaceSegmentDistanceMeters;

    current.elevationDifferenceMeters =
      elevationDifferenceMeters;

    if (
      elevationDifferenceMeters > 0
    ) {
      cumulativeAscentMeters +=
        elevationDifferenceMeters;
    } else {
      cumulativeDescentMeters +=
        Math.abs(
          elevationDifferenceMeters
        );
    }

    if (
      elevationDifferenceMeters >
      maximumAscentMeters
    ) {
      maximumAscentMeters =
        elevationDifferenceMeters;

      maximumAscentIndex =
        index;
    }

    if (
      elevationDifferenceMeters <
      maximumDescentMeters
    ) {
      maximumDescentMeters =
        elevationDifferenceMeters;

      maximumDescentIndex =
        index;
    }

    let signedSlopeDegrees = 0;
    let slopeDegrees = 0;

    if (
      horizontalDistanceMeters > 0
    ) {
      signedSlopeDegrees =
        THREE.MathUtils.radToDeg(
          Math.atan2(
            elevationDifferenceMeters,
            horizontalDistanceMeters
          )
        );

      slopeDegrees =
        Math.abs(
          signedSlopeDegrees
        );

      if (
        slopeDegrees >
        maximumSlopeDegrees
      ) {
        maximumSlopeDegrees =
          slopeDegrees;

        maximumSlopeIndex =
          index;
      }

      slopeSumDegrees +=
        slopeDegrees;

      slopeCount += 1;
    }

    current.signedSlopeDegrees =
      signedSlopeDegrees;

    current.slopeDegrees =
      slopeDegrees;

    if (
      slopeDegrees >
      WARNING_SLOPE_DEGREES
    ) {
      dangerousSegmentIndices.push(
        index
      );
    }

    if (
      Math.abs(
        elevationDifferenceMeters
      ) >=
      ENHANCED_SUDDEN_ELEVATION_CHANGE_METERS
    ) {
      suddenChangeIndices.push(
        index
      );
    }
  }

  const first =
    samples[0];

  const last =
    samples[
      samples.length - 1
    ];

  return {
    horizontalDistanceMeters:
      Math.hypot(
        (
          last.localXKm -
          first.localXKm
        ) *
        1000,

        (
          last.localZKm -
          first.localZKm
        ) *
        1000
      ),

    surfaceDistanceMeters,

    cumulativeAscentMeters,

    cumulativeDescentMeters,

    maximumSlopeDegrees,

    maximumSlopeIndex,

    maximumAscentIndex,

    maximumDescentIndex,

    maximumAscentMeters,

    maximumDescentMeters,

    dangerousSegmentIndices,

    suddenChangeIndices,

    averageSlopeDegrees:
      slopeCount > 0
        ? slopeSumDegrees /
          slopeCount
        : 0,

    netElevationChangeMeters:
      last.elevationMeters -
      first.elevationMeters,

    sampleCount:
      samples.length,

    status:
      classifySlope(
        maximumSlopeDegrees
      )
  };
}

// ======================================================
// 44. 建立分段彩色路線（Create Slope-Colored Route）
// ======================================================

function createEnhancedColoredRoute(
  samples
) {
  routeLine =
    new THREE.Group();

  routeLine.name =
    "Slope-Colored Rover Route";

  for (
    let index = 1;
    index < samples.length;
    index += 1
  ) {
    const previous =
      samples[index - 1];

    const current =
      samples[index];

    const curve =
      new THREE.LineCurve3(
        new THREE.Vector3(
          previous.localXKm,

          previous.elevationMeters /
            1000 *
            VERTICAL_EXAGGERATION +
            ROUTE_SURFACE_OFFSET_KM,

          previous.localZKm
        ),

        new THREE.Vector3(
          current.localXKm,

          current.elevationMeters /
            1000 *
            VERTICAL_EXAGGERATION +
            ROUTE_SURFACE_OFFSET_KM,

          current.localZKm
        )
      );

    const geometry =
      new THREE.TubeGeometry(
        curve,
        1,
        ROUTE_LINE_RADIUS_KM,
        8,
        false
      );

    const material =
      new THREE.MeshBasicMaterial({
        color:
          getEnhancedRouteSlopeColorHex(
            current.slopeDegrees
          ),

        depthTest: true,
        depthWrite: false
      });

    const segment =
      new THREE.Mesh(
        geometry,
        material
      );

    segment.renderOrder = 5;

    segment.userData.routeSegmentIndex =
      index;

    segment.userData.slopeDegrees =
      current.slopeDegrees;

    routeLine.add(
      segment
    );
  }

  scene.add(
    routeLine
  );
}

// ======================================================
// 45. 危險點標記工具（Hazard Marker Utilities）
// ======================================================

function clearEnhancedHazardMarkers() {
  while (
    enhancedHazardMarkerGroup
      .children
      .length > 0
  ) {
    const marker =
      enhancedHazardMarkerGroup
        .children[0];

    enhancedHazardMarkerGroup.remove(
      marker
    );

    marker.geometry?.dispose();

    if (
      Array.isArray(
        marker.material
      )
    ) {
      for (
        const material of
        marker.material
      ) {
        material.dispose();
      }
    } else {
      marker.material?.dispose();
    }
  }
}

function groupEnhancedConsecutiveIndices(
  indices
) {
  if (
    indices.length === 0
  ) {
    return [];
  }

  const groups = [
    [indices[0]]
  ];

  for (
    let index = 1;
    index < indices.length;
    index += 1
  ) {
    const current =
      indices[index];

    const previous =
      indices[index - 1];

    if (
      current ===
      previous + 1
    ) {
      groups[
        groups.length - 1
      ].push(
        current
      );
    } else {
      groups.push(
        [current]
      );
    }
  }

  return groups;
}

function createEnhancedHazardMarker(
  point,
  options,
  usedMarkerKeys
) {
  if (!point) {
    return;
  }

  const markerKey =
    `${options.type}:` +
    `${point.localXKm.toFixed(6)}:` +
    `${point.localZKm.toFixed(6)}`;

  if (
    usedMarkerKeys.has(
      markerKey
    )
  ) {
    return;
  }

  usedMarkerKeys.add(
    markerKey
  );

  const isTriangleMarker =
    options.shape === "triangle";

  const geometry =
    isTriangleMarker
      ? new THREE.ConeGeometry(
          ENHANCED_HAZARD_TRIANGLE_RADIUS_KM,
          ENHANCED_HAZARD_TRIANGLE_HEIGHT_KM,
          3
        )
      : new THREE.SphereGeometry(
          ENHANCED_HAZARD_MARKER_RADIUS_KM,
          20,
          20
        );

  const material =
    new THREE.MeshBasicMaterial({
      color: options.color,
      depthTest: false,
      depthWrite: false
    });

  const marker =
    new THREE.Mesh(
      geometry,
      material
    );

  const markerHeightOffsetKm =
    isTriangleMarker
      ? ENHANCED_HAZARD_TRIANGLE_HEIGHT_KM / 2
      : ENHANCED_HAZARD_MARKER_RADIUS_KM;

  marker.position.set(
    point.localXKm,

    point.elevationMeters /
      1000 *
      VERTICAL_EXAGGERATION +
      markerHeightOffsetKm +
      ENHANCED_HAZARD_MARKER_GAP_KM,

    point.localZKm
  );

  marker.renderOrder = 25;

  marker.userData.isEnhancedHazardMarker =
    true;

  marker.userData.point =
    point;

  marker.userData.hazardType =
    options.type;

  marker.userData.hazardTitle =
    options.title;

  marker.userData.hazardDetail =
    options.detail;

  marker.userData.slopeDegrees =
    options.slopeDegrees;

  enhancedHazardMarkerGroup.add(
    marker
  );
}

function createEnhancedRouteHazardMarkers(
  samples,
  analysis
) {
  clearEnhancedHazardMarkers();

  const usedMarkerKeys =
    new Set();

  // 最大坡度點
  const maximumSlopePoint =
    samples[
      analysis.maximumSlopeIndex
    ];

  createEnhancedHazardMarker(
    maximumSlopePoint,
    {
      type: "maximum-slope",

      shape:
        "triangle",

      title:
        "最大坡度點 " +
        "(Maximum Slope Point)",

      color:
        0xff1744,

      slopeDegrees:
        maximumSlopePoint
          .slopeDegrees,

      detail:
        `最大坡度 ` +
        `(Maximum Slope)：` +
        `${analysis.maximumSlopeDegrees.toFixed(2)}°`
    },
    usedMarkerKeys
  );

  // 最大爬升點
  const maximumAscentPoint =
    samples[
      analysis.maximumAscentIndex
    ];

  createEnhancedHazardMarker(
    maximumAscentPoint,
    {
      type:
        "maximum-ascent",

      shape:
        "triangle",

      title:
        "最大爬升點 " +
        "(Maximum Ascent Point)",

      color:
        0x00e676,

      slopeDegrees:
        maximumAscentPoint
          .slopeDegrees,

      detail:
        `單一區段爬升 ` +
        `(Segment Ascent)：` +
        `${formatSignedNumber(
          Math.max(
            0,
            analysis.maximumAscentMeters
          ) / 1000,
          3
        )} km`
    },
    usedMarkerKeys
  );

  // 最大下降點
  const maximumDescentPoint =
    samples[
      analysis.maximumDescentIndex
    ];

  createEnhancedHazardMarker(
    maximumDescentPoint,
    {
      type:
        "maximum-descent",

      shape:
        "triangle",

      title:
        "最大下降點 " +
        "(Maximum Descent Point)",

      color:
        0x40c4ff,

      slopeDegrees:
        maximumDescentPoint
          .slopeDegrees,

      detail:
        `單一區段下降 ` +
        `(Segment Descent)：` +
        `${formatSignedNumber(
          Math.min(
            0,
            analysis.maximumDescentMeters
          ) / 1000,
          3
        )} km`
    },
    usedMarkerKeys
  );

  // 不安全連續路段
  const dangerousGroups =
    groupEnhancedConsecutiveIndices(
      analysis
        .dangerousSegmentIndices
    );

  for (
    const dangerousGroup of
    dangerousGroups
  ) {
    let selectedIndex =
      dangerousGroup[0];

    for (
      const index of
      dangerousGroup
    ) {
      if (
        samples[index]
          .slopeDegrees >
        samples[selectedIndex]
          .slopeDegrees
      ) {
        selectedIndex =
          index;
      }
    }

    const selectedPoint =
      samples[selectedIndex];

    createEnhancedHazardMarker(
      selectedPoint,
      {
        type:
          "unsafe-section",

        shape:
          "triangle",

        title:
          "不安全路段 " +
          "(Unsafe Section)",

        color:
          0xff3b30,

        slopeDegrees:
          selectedPoint
            .slopeDegrees,

        detail:
          `<span class="lang-zh">此連續路段共有 ` +
          `${dangerousGroup.length} 個區段` +
          `超過 ${WARNING_SLOPE_DEGREES}°</span>` +
          `<span class="lang-en">${dangerousGroup.length} Segments Exceed ` +
          `${WARNING_SLOPE_DEGREES}°</span>`
      },
      usedMarkerKeys
    );
  }

  // 高程突變點
  for (
    const index of
    analysis.suddenChangeIndices
  ) {
    const suddenPoint =
      samples[index];

    createEnhancedHazardMarker(
      suddenPoint,
      {
        type:
          "sudden-change",

        title:
          "高程突變點 " +
          "(Sudden Elevation Change)",

        color:
          0xffd600,

        slopeDegrees:
          suddenPoint
            .slopeDegrees,

        detail:
          `單一區段高程變化 ` +
          `(Segment Elevation Change)：` +
          `${formatSignedNumber(
            suddenPoint
              .elevationDifferenceMeters / 1000,
            3
          )} km`
      },
      usedMarkerKeys
    );
  }
}

// ======================================================
// 46. 危險標記點擊資訊（Hazard Marker Click Information）
// ======================================================

function pickEnhancedHazardMarker(
  event
) {
  if (
    enhancedHazardMarkerGroup
      .children
      .length === 0
  ) {
    return null;
  }

  const rect =
    renderer.domElement
      .getBoundingClientRect();

  pointer.x =
    (
      (
        event.clientX -
        rect.left
      ) /
      rect.width
    ) *
    2 -
    1;

  pointer.y =
    -(
      (
        event.clientY -
        rect.top
      ) /
      rect.height
    ) *
    2 +
    1;

  raycaster.setFromCamera(
    pointer,
    camera
  );

  const intersections =
    raycaster.intersectObjects(
      enhancedHazardMarkerGroup
        .children,
      true
    );

  if (
    intersections.length === 0
  ) {
    return null;
  }

  return intersections[0].object;
}

function showEnhancedHazardInformation(
  marker
) {
  const point =
    marker.userData.point;

  const slopeDegrees =
    marker.userData.slopeDegrees;

  enhancedProfileInformation.innerHTML = wrapBilingualText(`
    <strong style="
      color:${getEnhancedRouteSlopeColorCss(
        slopeDegrees
      )};
    ">
      ${marker.userData.hazardTitle}
    </strong><br>

    ${marker.userData.hazardDetail}<br>

    <hr class="panel-divider">

    坡度
    (Slope)：
    <strong>
      ${slopeDegrees.toFixed(2)}°
    </strong><br>

    累積距離
    (Cumulative Distance)：
    ${formatKm(point.cumulativeDistanceMeters)}
    km<br>

    緯度
    (Latitude)：
    ${point.latitudeDegrees.toFixed(6)}°<br>

    經度
    (Longitude)：
    ${point.longitudeDegrees.toFixed(6)}°<br>

    絕對高程
    (Absolute Elevation)：
    ${formatKm(point.elevationMeters)}
    km<br>

    單段高程變化
    (Segment Elevation Change)：
    ${formatSignedNumber(
      point.elevationDifferenceMeters / 1000,
      3
    )}
    km
  `);

  placeMarkerOnSurface(
    clickMarker,
    point
  );

  clickMarker.visible =
    true;
}

// ======================================================
// 46A. 命名標記點選取（Named Point Marker Selection）
// ======================================================

function pickNamedPointMarker(
  event
) {
  if (!namedPointMarker) {
    return null;
  }

  const rect =
    renderer.domElement
      .getBoundingClientRect();

  pointer.x =
    (
      (
        event.clientX -
        rect.left
      ) /
      rect.width
    ) *
    2 -
    1;

  pointer.y =
    -(
      (
        event.clientY -
        rect.top
      ) /
      rect.height
    ) *
    2 +
    1;

  raycaster.setFromCamera(
    pointer,
    camera
  );

  const intersections =
    raycaster.intersectObject(
      namedPointMarker,
      true
    );

  return intersections.length > 0
    ? namedPointMarker
    : null;
}

function selectNamedPointMarker() {
  const point =
    namedPointMarker.userData.point;

  latitudeInput.value =
    point.latitudeDegrees.toFixed(6);

  longitudeInput.value =
    point.longitudeDegrees.toFixed(6);

  placeMarkerOnSurface(
    clickMarker,
    point
  );

  clickMarker.visible =
    true;

  showCoordinateSearchMessage(
    `已選取標記點 (Selected Marked Point)：` +
    `${point.latitudeDegrees.toFixed(6)}°, ` +
    `${point.longitudeDegrees.toFixed(6)}°`,
    "#c77dff"
  );
}

function drawEnhancedProfileTriangleMarker(
  context,
  centerX,
  centerY,
  color
) {
  const triangleRadius = 6;

  context.fillStyle = color;

  context.beginPath();

  context.moveTo(
    centerX,
    centerY - triangleRadius
  );

  context.lineTo(
    centerX + triangleRadius * 0.9,
    centerY + triangleRadius * 0.75
  );

  context.lineTo(
    centerX - triangleRadius * 0.9,
    centerY + triangleRadius * 0.75
  );

  context.closePath();

  context.fill();
}

// ======================================================
// 47. 繪製路線高程剖面圖（Draw Route Elevation Profile）
// ======================================================

function drawEnhancedRouteProfile(
  samples,
  analysis,
  highlightedIndex = null
) {
  const canvas =
    enhancedRouteProfileCanvas;

  const context =
    canvas.getContext("2d");

  const width =
    canvas.width;

  const height =
    canvas.height;

  context.clearRect(
    0,
    0,
    width,
    height
  );

  context.fillStyle =
    "#05090f";

  context.fillRect(
    0,
    0,
    width,
    height
  );

  if (
    !samples ||
    samples.length < 2 ||
    !analysis
  ) {
    context.fillStyle =
      "#aab4c4";

    context.font =
      "16px Arial";

    context.textAlign =
      "center";

    context.textBaseline =
      "middle";

    context.fillText(
      pickLangText(
        "尚未建立路線",
        "No Traverse Created"
      ),
      width / 2,
      height / 2
    );

    return;
  }

  const margin = {
    left: 78,
    right: 25,
    top: 34,
    bottom: 67
  };

  const plotWidth =
    width -
    margin.left -
    margin.right;

  const plotHeight =
    height -
    margin.top -
    margin.bottom;

  const elevations =
    samples.map(
      (sample) =>
        sample.elevationMeters
    );

  let minimumElevation =
    Math.min(
      ...elevations
    );

  let maximumElevation =
    Math.max(
      ...elevations
    );

  const elevationRange =
    maximumElevation -
    minimumElevation;

  const elevationPadding =
    Math.max(
      2,
      elevationRange *
      0.08
    );

  minimumElevation -=
    elevationPadding;

  maximumElevation +=
    elevationPadding;

  const totalDistance =
    Math.max(
      analysis.surfaceDistanceMeters,
      1
    );

  function xFromDistance(
    distanceMeters
  ) {
    return (
      margin.left +
      distanceMeters /
      totalDistance *
      plotWidth
    );
  }

  function yFromElevation(
    elevationMeters
  ) {
    return (
      margin.top +
      (
        maximumElevation -
        elevationMeters
      ) /
      (
        maximumElevation -
        minimumElevation
      ) *
      plotHeight
    );
  }

  context.save();

  context.beginPath();

  context.rect(
    margin.left,
    margin.top,
    plotWidth,
    plotHeight
  );

  context.clip();

  // 危險區段紅色背景
  for (
    let index = 1;
    index < samples.length;
    index += 1
  ) {
    if (
      samples[index]
        .slopeDegrees <=
      WARNING_SLOPE_DEGREES
    ) {
      continue;
    }

    const startX =
      xFromDistance(
        samples[index - 1]
          .cumulativeDistanceMeters
      );

    const endX =
      xFromDistance(
        samples[index]
          .cumulativeDistanceMeters
      );

    context.fillStyle =
      "rgba(255, 59, 48, 0.19)";

    context.fillRect(
      startX,
      margin.top,
      Math.max(
        1,
        endX - startX
      ),
      plotHeight
    );
  }

  // 水平網格
  context.strokeStyle =
    "rgba(255, 255, 255, 0.12)";

  context.lineWidth = 1;

  for (
    let gridIndex = 0;
    gridIndex <= 5;
    gridIndex += 1
  ) {
    const y =
      margin.top +
      plotHeight *
      gridIndex /
      5;

    context.beginPath();

    context.moveTo(
      margin.left,
      y
    );

    context.lineTo(
      margin.left +
      plotWidth,
      y
    );

    context.stroke();
  }

  // 垂直網格
  for (
    let gridIndex = 0;
    gridIndex <= 6;
    gridIndex += 1
  ) {
    const x =
      margin.left +
      plotWidth *
      gridIndex /
      6;

    context.beginPath();

    context.moveTo(
      x,
      margin.top
    );

    context.lineTo(
      x,
      margin.top +
      plotHeight
    );

    context.stroke();
  }

  // 高程曲線下方漸層
  context.beginPath();

  context.moveTo(
    xFromDistance(0),
    margin.top +
    plotHeight
  );

  for (
    const sample of
    samples
  ) {
    context.lineTo(
      xFromDistance(
        sample
          .cumulativeDistanceMeters
      ),

      yFromElevation(
        sample.elevationMeters
      )
    );
  }

  context.lineTo(
    xFromDistance(
      totalDistance
    ),
    margin.top +
    plotHeight
  );

  context.closePath();

  const profileGradient =
    context.createLinearGradient(
      0,
      margin.top,
      0,
      margin.top +
      plotHeight
    );

  profileGradient.addColorStop(
    0,
    "rgba(103, 217, 255, 0.36)"
  );

  profileGradient.addColorStop(
    1,
    "rgba(36, 92, 255, 0.04)"
  );

  context.fillStyle =
    profileGradient;

  context.fill();

  // 依坡度顏色畫各區段
  context.lineWidth = 3;
  context.lineCap = "round";

  for (
    let index = 1;
    index < samples.length;
    index += 1
  ) {
    const previous =
      samples[index - 1];

    const current =
      samples[index];

    context.strokeStyle =
      getEnhancedRouteSlopeColorCss(
        current.slopeDegrees
      );

    context.beginPath();

    context.moveTo(
      xFromDistance(
        previous
          .cumulativeDistanceMeters
      ),

      yFromElevation(
        previous.elevationMeters
      )
    );

    context.lineTo(
      xFromDistance(
        current
          .cumulativeDistanceMeters
      ),

      yFromElevation(
        current.elevationMeters
      )
    );

    context.stroke();
  }

  // 最大坡度位置
  const maximumSlopeSample =
    samples[
      analysis.maximumSlopeIndex
    ];

  const maximumSlopeX =
    xFromDistance(
      maximumSlopeSample
        .cumulativeDistanceMeters
    );

  const maximumSlopeY =
    yFromElevation(
      maximumSlopeSample
        .elevationMeters
    );

  context.strokeStyle =
    "#ff1744";

  context.lineWidth =
    1.5;

  context.setLineDash([
    5,
    4
  ]);

  context.beginPath();

  context.moveTo(
    maximumSlopeX,
    margin.top
  );

  context.lineTo(
    maximumSlopeX,
    margin.top +
    plotHeight
  );

  context.stroke();

  context.setLineDash([]);

  context.fillStyle =
    "#ff1744";

  context.beginPath();

  context.arc(
    maximumSlopeX,
    maximumSlopeY,
    5,
    0,
    Math.PI * 2
  );

  context.fill();

  // 最大爬升位置
  const maximumAscentSample =
    samples[
      analysis.maximumAscentIndex
    ];

  drawEnhancedProfileTriangleMarker(
    context,
    xFromDistance(
      maximumAscentSample
        .cumulativeDistanceMeters
    ),
    yFromElevation(
      maximumAscentSample
        .elevationMeters
    ),
    "#00e676"
  );

  // 最大下降位置
  const maximumDescentSample =
    samples[
      analysis.maximumDescentIndex
    ];

  drawEnhancedProfileTriangleMarker(
    context,
    xFromDistance(
      maximumDescentSample
        .cumulativeDistanceMeters
    ),
    yFromElevation(
      maximumDescentSample
        .elevationMeters
    ),
    "#40c4ff"
  );

  // 不安全路段位置
  const dangerousGroups =
    groupEnhancedConsecutiveIndices(
      analysis
        .dangerousSegmentIndices
    );

  for (
    const dangerousGroup of
    dangerousGroups
  ) {
    let selectedIndex =
      dangerousGroup[0];

    for (
      const index of
      dangerousGroup
    ) {
      if (
        samples[index]
          .slopeDegrees >
        samples[selectedIndex]
          .slopeDegrees
      ) {
        selectedIndex =
          index;
      }
    }

    const selectedSample =
      samples[selectedIndex];

    drawEnhancedProfileTriangleMarker(
      context,
      xFromDistance(
        selectedSample
          .cumulativeDistanceMeters
      ),
      yFromElevation(
        selectedSample
          .elevationMeters
      ),
      "#ff3b30"
    );
  }

  // 滑鼠目前位置
  if (
    Number.isInteger(
      highlightedIndex
    ) &&
    samples[
      highlightedIndex
    ]
  ) {
    const selectedSample =
      samples[
        highlightedIndex
      ];

    const selectedX =
      xFromDistance(
        selectedSample
          .cumulativeDistanceMeters
      );

    const selectedY =
      yFromElevation(
        selectedSample
          .elevationMeters
      );

    context.strokeStyle =
      "#ffffff";

    context.lineWidth = 1;

    context.setLineDash([
      3,
      3
    ]);

    context.beginPath();

    context.moveTo(
      selectedX,
      margin.top
    );

    context.lineTo(
      selectedX,
      margin.top +
      plotHeight
    );

    context.stroke();

    context.setLineDash([]);

    context.fillStyle =
      "#ffffff";

    context.beginPath();

    context.arc(
      selectedX,
      selectedY,
      4,
      0,
      Math.PI * 2
    );

    context.fill();
  }

  context.restore();

  // 外框
  context.strokeStyle =
    "#9ba8bb";

  context.lineWidth = 1;

  context.strokeRect(
    margin.left,
    margin.top,
    plotWidth,
    plotHeight
  );

  // Y 軸刻度
  context.fillStyle =
    "#cbd5e1";

  context.font =
    "12px Arial";

  context.textAlign =
    "right";

  context.textBaseline =
    "middle";

  for (
    let gridIndex = 0;
    gridIndex <= 5;
    gridIndex += 1
  ) {
    const elevationValue =
      maximumElevation -
      (
        maximumElevation -
        minimumElevation
      ) *
      gridIndex /
      5;

    const y =
      margin.top +
      plotHeight *
      gridIndex /
      5;

    context.fillText(
      `${formatKm(elevationValue)} km`,
      margin.left - 8,
      y
    );
  }

  // X 軸刻度
  context.textAlign =
    "center";

  context.textBaseline =
    "top";

  for (
    let gridIndex = 0;
    gridIndex <= 6;
    gridIndex += 1
  ) {
    const distanceValue =
      totalDistance *
      gridIndex /
      6;

    const x =
      margin.left +
      plotWidth *
      gridIndex /
      6;

    const distanceLabel =
      `${formatKm(distanceValue, 2)} km`;

    context.fillText(
      distanceLabel,
      x,
      margin.top +
      plotHeight +
      9
    );
  }

  // X 軸名稱
  context.fillStyle =
    "#ffffff";

  context.font =
    "bold 13px Arial";

  context.textAlign =
    "center";

  context.fillText(
    pickLangText(
      "累積距離",
      "Cumulative Distance"
    ),
    margin.left +
    plotWidth /
    2,
    height - 23
  );

  // Y 軸名稱
  context.save();

  context.translate(
    18,
    margin.top +
    plotHeight /
    2
  );

  context.rotate(
    -Math.PI / 2
  );

  context.fillText(
    pickLangText(
      "絕對高程",
      "Absolute Elevation"
    ),
    0,
    0
  );

  context.restore();

  // 最大坡度文字
  context.fillStyle =
    "#ff8a9b";

  context.font =
    "bold 12px Arial";

  context.textAlign =
    "left";

  context.textBaseline =
    "bottom";

  context.fillText(
    pickLangText(
      "最大坡度：",
      "Maximum Slope: "
    ) +
    `${analysis.maximumSlopeDegrees.toFixed(2)}°`,
    margin.left + 5,
    margin.top - 8
  );
}

// ======================================================
// 48. 剖面圖滑鼠查詢（Profile Pointer Inspection）
// ======================================================

function showEnhancedProfileSummary(
  analysis
) {
  if (
    !analysis ||
    routeSamples.length < 2
  ) {
    enhancedProfileInformation.innerHTML = wrapBilingualText(`
      尚未建立路線
      (No Traverse Created)
    `);

    return;
  }

  const maximumSlopePoint =
    routeSamples[
      analysis.maximumSlopeIndex
    ];

  const maximumAscentPoint =
    routeSamples[
      analysis.maximumAscentIndex
    ];

  const maximumDescentPoint =
    routeSamples[
      analysis.maximumDescentIndex
    ];

  enhancedProfileInformation.innerHTML = wrapBilingualText(`
    最大坡度位置
    (Maximum Slope Position)：
    <strong>
      ${formatKm(
        maximumSlopePoint
          .cumulativeDistanceMeters
      )}
      km
    </strong>

    ｜最大坡度
    (Maximum Slope)：
    <strong style="color:#ff5c6c">
      ${analysis.maximumSlopeDegrees.toFixed(2)}°
    </strong><br>

    最大爬升區段
    (Maximum Ascent Segment)：
    <strong>
      ${formatSignedNumber(
        analysis.maximumAscentMeters / 1000,
        3
      )}
      km
    </strong>

    ｜位置
    (Position)：
    ${formatKm(
      maximumAscentPoint
        .cumulativeDistanceMeters
    )}
    km<br>

    最大下降區段
    (Maximum Descent Segment)：
    <strong>
      ${formatSignedNumber(
        analysis.maximumDescentMeters / 1000,
        3
      )}
      km
    </strong>

    ｜位置
    (Position)：
    ${formatKm(
      maximumDescentPoint
        .cumulativeDistanceMeters
    )}
    km<br>

    不安全區段數
    (Unsafe Segment Count)：
    <strong>
      ${analysis
        .dangerousSegmentIndices
        .length}
    </strong>

    ｜高程突變點
    (Sudden Elevation Changes)：
    <strong>
      ${analysis
        .suddenChangeIndices
        .length}
    </strong>
  `);
}

function handleEnhancedProfilePointerMove(
  event
) {
  if (
    !enhancedRouteAnalysis ||
    routeSamples.length < 2
  ) {
    return;
  }

  const rect =
    enhancedRouteProfileCanvas
      .getBoundingClientRect();

  const canvasScaleX =
    enhancedRouteProfileCanvas.width /
    rect.width;

  const canvasX =
    (
      event.clientX -
      rect.left
    ) *
    canvasScaleX;

  const leftMargin = 78;
  const rightMargin = 25;

  const profilePlotWidth =
    enhancedRouteProfileCanvas.width -
    leftMargin -
    rightMargin;

  const normalizedPosition =
    THREE.MathUtils.clamp(
      (
        canvasX -
        leftMargin
      ) /
      profilePlotWidth,
      0,
      1
    );

  const targetDistanceMeters =
    normalizedPosition *
    enhancedRouteAnalysis
      .surfaceDistanceMeters;

  let nearestIndex = 0;
  let nearestDifference = Infinity;

  for (
    let index = 0;
    index < routeSamples.length;
    index += 1
  ) {
    const difference =
      Math.abs(
        routeSamples[index]
          .cumulativeDistanceMeters -
        targetDistanceMeters
      );

    if (
      difference <
      nearestDifference
    ) {
      nearestDifference =
        difference;

      nearestIndex =
        index;
    }
  }

  const selectedSample =
    routeSamples[
      nearestIndex
    ];

  const slopeStatus =
    getSlopeStatusLabel(
      selectedSample.slopeDegrees
    );

  enhancedProfileInformation.innerHTML = wrapBilingualText(`
    累積距離
    (Cumulative Distance)：
    <strong>
      ${formatKm(
        selectedSample
          .cumulativeDistanceMeters
      )}
      km
    </strong>

    ｜絕對高程
    (Absolute Elevation)：
    <strong>
      ${formatKm(
        selectedSample
          .elevationMeters
      )}
      km
    </strong><br>

    坡度
    (Slope)：
    <strong style="
      color:${getEnhancedRouteSlopeColorCss(
        selectedSample.slopeDegrees
      )};
    ">
      ${selectedSample
        .slopeDegrees
        .toFixed(2)}°
      ${slopeStatus}
    </strong><br>

    單段高程變化
    (Segment Elevation Change)：
    ${formatSignedNumber(
      selectedSample
        .elevationDifferenceMeters / 1000,
      3
    )}
    km<br>

    緯度
    (Latitude)：
    ${selectedSample
      .latitudeDegrees
      .toFixed(6)}°

    ｜經度
    (Longitude)：
    ${selectedSample
      .longitudeDegrees
      .toFixed(6)}°
  `);

  drawEnhancedRouteProfile(
    routeSamples,
    enhancedRouteAnalysis,
    nearestIndex
  );
}

enhancedRouteProfileCanvas.addEventListener(
  "pointermove",
  handleEnhancedProfilePointerMove
);

enhancedRouteProfileCanvas.addEventListener(
  "pointerleave",
  () => {
    if (
      enhancedRouteAnalysis
    ) {
      showEnhancedProfileSummary(
        enhancedRouteAnalysis
      );

      drawEnhancedRouteProfile(
        routeSamples,
        enhancedRouteAnalysis
      );
    }
  }
);

// ======================================================
// 49. 重設剖面圖（Reset Route Profile）
// ======================================================

function resetEnhancedRouteProfile() {
  enhancedRouteAnalysis =
    null;

  enhancedProfileInformation.innerHTML = wrapBilingualText(`
    尚未建立路線
    (No Traverse Created)
  `);

  drawEnhancedRouteProfile(
    [],
    null
  );
}

// ======================================================
// 50. 建立路線（Route Creation）
// ======================================================

function buildAndAnalyzeRoute() {
  if (
    !startPoint ||
    !goalPoint
  ) {
    return;
  }

  removeRouteLine();

  clearEnhancedHazardMarkers();

  const horizontalDistanceMeters =
    Math.hypot(
      (
        goalPoint.localXKm -
        startPoint.localXKm
      ) *
      1000,

      (
        goalPoint.localZKm -
        startPoint.localZKm
      ) *
      1000
    );

  const segmentCount =
    Math.max(
      2,
      Math.ceil(
        horizontalDistanceMeters /
        ROUTE_SAMPLE_INTERVAL_METERS
      )
    );

  routeSamples = [];

  for (
    let index = 0;
    index <= segmentCount;
    index += 1
  ) {
    const t =
      index /
      segmentCount;

    const localXKm =
      THREE.MathUtils.lerp(
        startPoint.localXKm,
        goalPoint.localXKm,
        t
      );

    const localZKm =
      THREE.MathUtils.lerp(
        startPoint.localZKm,
        goalPoint.localZKm,
        t
      );

    const elevationMeters =
      sampleElevationBilinear(
        localXKm,
        localZKm
      );

    if (
      !Number.isFinite(
        elevationMeters
      )
    ) {
      continue;
    }

    routeSamples.push(
      createPointDataFromWorldPoint(
        new THREE.Vector3(
          localXKm,

          elevationMeters /
            1000 *
            VERTICAL_EXAGGERATION,

          localZKm
        )
      )
    );
  }

  if (
    routeSamples.length < 2
  ) {
    missionPanel.innerHTML = wrapBilingualText(`
      <strong>
        路線建立失敗
        (Traverse Creation Failed)
      </strong><br>

      沿線沒有足夠的有效高程資料。
      (Insufficient Valid Elevation Data Along the Traverse.)
    `);

    resetEnhancedRouteProfile();

    return;
  }

  enhancedRouteAnalysis =
    analyzeRoute(
      routeSamples
    );

  createEnhancedColoredRoute(
    routeSamples
  );

  createEnhancedRouteHazardMarkers(
    routeSamples,
    enhancedRouteAnalysis
  );

  updateMissionPanel(
    enhancedRouteAnalysis
  );

  drawEnhancedRouteProfile(
    routeSamples,
    enhancedRouteAnalysis
  );

  showEnhancedProfileSummary(
    enhancedRouteAnalysis
  );
}

// ======================================================
// 51. 路線清除（Route Removal）
// ======================================================

function removeRouteLine() {
  if (!routeLine) {
    return;
  }

  scene.remove(
    routeLine
  );

  routeLine.traverse(
    (child) => {
      child.geometry?.dispose();

      if (
        Array.isArray(
          child.material
        )
      ) {
        for (
          const material of
          child.material
        ) {
          material.dispose();
        }
      } else {
        child.material?.dispose();
      }
    }
  );

  routeLine = null;
}

// ======================================================
// 52. 路線重設（Route Reset）
// ======================================================

function resetMissionRoute() {
  startPoint = null;
  goalPoint = null;

  routeSamples = [];

  enhancedRouteAnalysis =
    null;

  startMarker.visible =
    false;

  goalMarker.visible =
    false;

  removeRouteLine();

  clearEnhancedHazardMarkers();

  resetEnhancedRouteProfile();

  showMissionInstructions();

  showCoordinateInformation();
}

// ======================================================
// 53. 地形點擊（Terrain Click）
// ======================================================

function handleTerrainClick(
  event
) {
  if (
    !terrain ||
    !terrainMetadata
  ) {
    return;
  }

  // 優先檢查是否點擊危險標記
  const hazardMarker =
    pickEnhancedHazardMarker(
      event
    );

  if (
    hazardMarker
  ) {
    showEnhancedHazardInformation(
      hazardMarker
    );

    return;
  }

  // 檢查是否點擊命名標記點
  const namedMarkerHit =
    pickNamedPointMarker(
      event
    );

  if (
    namedMarkerHit
  ) {
    selectNamedPointMarker();

    return;
  }

  const point =
    pickTerrainPoint(
      event
    );

  if (!point) {
    return;
  }

  const correctedPoint =
    rebuildPointUsingDemHeight(
      point
    );

  placeMarkerOnSurface(
    clickMarker,
    correctedPoint
  );

  clickMarker.visible =
    true;

  if (
    !startPoint ||
    (
      startPoint &&
      goalPoint
    )
  ) {
    resetMissionRoute();

    startPoint =
      correctedPoint;

    placeMarkerOnSurface(
      startMarker,
      startPoint
    );

    startMarker.visible =
      true;

    showCoordinateInformation();

    updateMissionWaitingPanel(
      "start"
    );

    return;
  }

  goalPoint =
    correctedPoint;

  placeMarkerOnSurface(
    goalMarker,
    goalPoint
  );

  goalMarker.visible =
    true;

  showCoordinateInformation();

  buildAndAnalyzeRoute();
}

// 初始顯示空白剖面圖
resetEnhancedRouteProfile();

profileCanvasReady = true;

setAllPanelsVisible(false);