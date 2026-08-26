import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import {
  setLoadingOverlayProgress,
  hideLoadingOverlay,
  showLoadingOverlayError
} from "./loading-overlay.js";

import {
  createViewGizmo,
  setViewGizmoGlobalAxisOrientation,
  computeGlobalAxisOrientationQuaternion,
  createSceneAxisHelper
} from "./view-gizmo.js";

import {
  initUiCore,
  createPanel,
  stopPanelEvents,
  wrapBilingualText,
  setLocalizedHtml,
  appendLocalizedHtml,
  pickLangText,
  createLegendRow,
  makePanelDraggable,
  makePanelResizable,
  keepAllDraggablePanelsInsideWindow,
  resetDraggablePanelPositions
} from "./ui-core.js";

import { createMoonOverview } from "./moon-overview.js";

import {
  formatKm,
  formatSignedNumber,
  escapeHtml
} from "./utils.js";

import {
  initMarkers,
  createSphereMarker,
  createFlagMarker,
  disposeMarkerObject,
  getWaypointMarkerColor
} from "./markers.js";

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
const ROUTE_LINE_RADIUS_KM = 0.006;

const MARKER_RADIUS_KM = 0.008;
const MARKER_SURFACE_GAP_KM = 0.001;
const FLAG_MARKER_SCALE = 6.4;

const NAMED_POINT_LATITUDE_DEGREES = -84.122515;
const NAMED_POINT_LONGITUDE_DEGREES = 57.725892;
const NAMED_POINT_COLOR = 0x9c27b0;

const SAFE_SLOPE_DEGREES = 10;
const WARNING_SLOPE_DEGREES = 15;

const LOCAL_SPIKE_THRESHOLD_METERS = 8;
const MIN_VALID_NEIGHBOURS = 5;
const MAX_SPIKE_CLEANUP_PASSES = 4;

const PROMINENT_PEAK_SEARCH_RADIUS_PIXELS = 6;
const PROMINENT_PEAK_THRESHOLD_METERS = 35;

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

let terrainCenterLatitudeDegrees = null;
let terrainCenterLongitudeDegrees = null;

let normalTerrainColors = null;
let slopeTerrainColors = null;
let elevationTerrainColors = null;

let slopeLayerEnabled = false;
let elevationLayerEnabled = false;

let waypoints = [];
let waypointMarkers = [];
let selectedWaypointIndex = null;

let activeWaypointPointerId = null;
let activeWaypointIndex = null;
let waypointDragMoved = false;

let routeLine = null;
let routeSamples = [];
let routeSlopeColoringEnabled = false;

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
  prominentPeaksFilled: 0,
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

initUiCore({
  defaultInterfaceScale: DEFAULT_INTERFACE_SCALE,
  getInterfaceScale: () => interfaceScale,
  getCurrentLanguage: () => currentLanguage,
  controls
});

// ======================================================
// 4A. 方向指標（View Orientation Gizmo）
// ======================================================

const {
  viewHelper,
  viewHelperTimer
} = createViewGizmo(
  camera,
  renderer
);

// ViewHelper 是直接畫在 canvas 右下角的 WebGL 視口，預設緊貼畫面
// 邊角（沒有留白）；這裡讓它跟其他面板一樣留 14px 邊界，說明文字
// 標籤再對齊同一個寬度、置中排在正上方，讓使用者知道上面的
// +X/+Y/+Z 不是東南西北，而是月球的全域本體固定坐標系。
const VIEW_GIZMO_MARGIN_PX = 14;
const VIEW_GIZMO_SIZE_PX = 128;

viewHelper.location = {
  right: VIEW_GIZMO_MARGIN_PX,
  bottom: VIEW_GIZMO_MARGIN_PX,
  top: null,
  left: null
};

const viewGizmoCaption =
  document.createElement("div");

viewGizmoCaption.style.cssText = `
  position: fixed;
  right: ${VIEW_GIZMO_MARGIN_PX}px;
  bottom: ${
    VIEW_GIZMO_MARGIN_PX +
    VIEW_GIZMO_SIZE_PX +
    6
  }px;
  width: ${VIEW_GIZMO_SIZE_PX}px;
  z-index: 20;
  padding: 3px 4px;
  color: #cbd5e1;
  background: rgba(0, 0, 0, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 4px;
  font-family: Arial, sans-serif;
  font-size: 10px;
  line-height: 1.35;
  text-align: center;
  pointer-events: none;
`;

// wrapBilingualText() 的自動中英文判斷規則要求括號前緊接著中文，
// 這裡因為夾了「MOON_ME」這段英文字對不上規則，所以改成手動標記
// lang-zh／lang-en，才能真的隨語言切換。
viewGizmoCaption.innerHTML =
  '<span class="lang-zh">全域坐標系 MOON_ME</span>' +
  '<span class="lang-en">MOON_ME Global Frame</span>';

document.body.appendChild(
  viewGizmoCaption
);

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

const axesHelper = createSceneAxisHelper(2);

scene.add(axesHelper);

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

const moonOverview = createMoonOverview({
  colorMapUrl: MOON_OVERVIEW_COLOR_MAP_URL,
  bumpMapUrl: MOON_OVERVIEW_BUMP_MAP_URL
});

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
      id="add-waypoint-coordinate-button"
      class="interface-button"
    >
      新增路徑點 (Add Waypoint)
    </button>

    <button
      id="clear-coordinate-input-button"
      class="interface-button"
    >
      清除輸入 (Clear)
    </button>
  </div>

  <div style="
    margin-top:7px;
    display:grid;
    grid-template-columns:1fr 1fr;
    gap:7px;
  ">
    <button
      id="save-route-button"
      class="interface-button"
    >
      儲存路線 (Save Route)
    </button>

    <button
      id="load-route-button"
      class="interface-button"
    >
      載入路線 (Load Route)
    </button>

    <button
      id="export-route-csv-button"
      class="interface-button"
    >
      匯出 (Export) CSV
    </button>

    <button
      id="export-route-geojson-button"
      class="interface-button"
    >
      匯出 (Export) GeoJSON
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

const addWaypointCoordinateButton =
  document.querySelector(
    "#add-waypoint-coordinate-button"
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

addWaypointCoordinateButton.addEventListener(
  "click",
  () => {
    executeCoordinateAction("waypoint");
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

const saveRouteButton =
  document.querySelector(
    "#save-route-button"
  );

const loadRouteButton =
  document.querySelector(
    "#load-route-button"
  );

const exportRouteCsvButton =
  document.querySelector(
    "#export-route-csv-button"
  );

const exportRouteGeoJsonButton =
  document.querySelector(
    "#export-route-geojson-button"
  );

saveRouteButton.addEventListener(
  "click",
  () => {
    saveRouteToLocalStorage();
  }
);

loadRouteButton.addEventListener(
  "click",
  () => {
    loadRouteFromLocalStorage();
  }
);

exportRouteCsvButton.addEventListener(
  "click",
  () => {
    exportRouteAsCsv();
  }
);

exportRouteGeoJsonButton.addEventListener(
  "click",
  () => {
    exportRouteAsGeoJson();
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
    panel: moonOverview.panel
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
      面板比例重設 (Reset Panel Scale)
    </button>

    <button
      id="position-reset-button"
      class="interface-button"
    >
      面板位置重設 (Reset Panel Position)
    </button>

    <button
      id="language-toggle-button"
      class="interface-button"
    >
      Chinese
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
      ? "英文"
      : "Chinese";

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
// 17. 建立標記（Create Markers）— 幾何建構工具移至 markers.js
// ======================================================

initMarkers({
  scene,
  markerRadiusKm: MARKER_RADIUS_KM,
  flagMarkerScale: FLAG_MARKER_SCALE
});

const clickMarker =
  createSphereMarker(0xff9500);

clickMarker.visible = false;

scene.add(clickMarker);

function rebuildWaypointMarkers() {
  for (const marker of waypointMarkers) {
    disposeMarkerObject(marker);
  }

  waypointMarkers = waypoints.map((point, index) => {
    const marker = createFlagMarker(
      getWaypointMarkerColor(index, waypoints.length)
    );

    scene.add(marker);

    placeMarkerOnSurface(marker, point);

    marker.visible = true;

    marker.scale.setScalar(
      index === selectedWaypointIndex
        ? 1.4
        : 1
    );

    return marker;
  });
}

function getWaypointDisplayLabelParts(index) {
  if (index === 0) {
    return {
      zh: "起點",
      en: "Start Point"
    };
  }

  if (index === waypoints.length - 1) {
    return {
      zh: "終點",
      en: "Destination Point"
    };
  }

  return {
    zh: `路徑點 ${index}`,
    en: `Waypoint ${index}`
  };
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

async function readArrayBufferWithProgress(
  response,
  onProgress
) {
  const totalBytes =
    Number(
      response.headers.get(
        "content-length"
      )
    );

  if (
    !response.body ||
    !Number.isFinite(totalBytes) ||
    totalBytes <= 0
  ) {
    const buffer =
      await response.arrayBuffer();

    onProgress(1);

    return buffer;
  }

  const reader =
    response.body.getReader();

  const chunks = [];
  let receivedBytes = 0;

  while (true) {
    const { done, value } =
      await reader.read();

    if (done) {
      break;
    }

    chunks.push(value);
    receivedBytes += value.byteLength;

    onProgress(
      Math.min(
        receivedBytes / totalBytes,
        1
      )
    );
  }

  const combined =
    new Uint8Array(receivedBytes);

  let offset = 0;

  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return combined.buffer;
}

async function loadTerrainData() {
  try {
    const [
      metadataResponse,
      heightmapResponse
    ] = await Promise.all([
      fetch(METADATA_URL),
      fetch(HEIGHTMAP_URL)
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
      await readArrayBufferWithProgress(
        heightmapResponse,
        (ratio) => {
          setLoadingOverlayProgress(
            Math.round(ratio * 100)
          );
        }
      );

    createTerrain(
      metadata,
      buffer
    );

    hideLoadingOverlay();
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

    showLoadingOverlayError(
      escapeHtml(error.message)
    );
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
    prominentPeaksFilled: 0,
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

  // 單一像素雜訊有時會連成 2～3 格的小群集：群集內每個像素的
  // 緊鄰中位數會被彼此拉高，單一次比對可能偵測不到，因此重複
  // 執行直到某一輪沒有再修正任何像素為止（最多 MAX_SPIKE_CLEANUP_PASSES 輪）。
  for (
    let pass = 0;
    pass < MAX_SPIKE_CLEANUP_PASSES;
    pass += 1
  ) {
    const passInput =
      new Float32Array(
        cleaned
      );

    let correctedThisPass = 0;

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
          passInput[index];

        if (
          !Number.isFinite(
            centerValue
          )
        ) {
          continue;
        }

        const neighbours =
          getNeighbourValues(
            passInput,
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

          correctedThisPass += 1;
        }
      }
    }

    if (correctedThisPass === 0) {
      break;
    }
  }

  // 有些雜訊會形成平滑但極窄的「錐狀突起」，內部每個像素彼此
  // 支撐、緊鄰中位數比對抓不到，因此另外找出「在一定範圍內是
  // 唯一最高點、且比範圍邊緣高出很多」的孤立尖峰，直接用邊緣
  // 資料內插填平整個突起範圍，而不是只修正單一像素。
  const prominentPeaks =
    findProminentPeaks(
      cleaned,
      width,
      height,
      PROMINENT_PEAK_SEARCH_RADIUS_PIXELS,
      PROMINENT_PEAK_THRESHOLD_METERS
    );

  const preFillSnapshot =
    new Float32Array(
      cleaned
    );

  for (
    const peak of
    prominentPeaks
  ) {
    demCleaningStatistics
      .prominentPeaksFilled +=
      fillPeakFootprint(
        cleaned,
        preFillSnapshot,
        width,
        height,
        peak.row,
        peak.column,
        PROMINENT_PEAK_SEARCH_RADIUS_PIXELS
      );
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

function findProminentPeaks(
  data,
  width,
  height,
  radius,
  prominenceThresholdMeters
) {
  const peaks = [];

  for (
    let row = radius;
    row < height - radius;
    row += 1
  ) {
    for (
      let column = radius;
      column < width - radius;
      column += 1
    ) {
      const centerValue =
        data[row * width + column];

      if (
        !Number.isFinite(
          centerValue
        )
      ) {
        continue;
      }

      let isLocalMaximum = true;
      const edgeRingValues = [];

      for (
        let dy = -radius;
        dy <= radius;
        dy += 1
      ) {
        for (
          let dx = -radius;
          dx <= radius;
          dx += 1
        ) {
          if (dx === 0 && dy === 0) {
            continue;
          }

          const neighbourValue =
            data[
              (row + dy) * width +
              (column + dx)
            ];

          if (
            !Number.isFinite(
              neighbourValue
            )
          ) {
            isLocalMaximum = false;

            continue;
          }

          if (neighbourValue > centerValue) {
            isLocalMaximum = false;
          }

          if (
            Math.max(
              Math.abs(dx),
              Math.abs(dy)
            ) === radius
          ) {
            edgeRingValues.push(
              neighbourValue
            );
          }
        }
      }

      if (
        !isLocalMaximum ||
        edgeRingValues.length < MIN_VALID_NEIGHBOURS
      ) {
        continue;
      }

      const edgeMedian =
        calculateMedian(
          edgeRingValues
        );

      if (
        centerValue - edgeMedian >
        prominenceThresholdMeters
      ) {
        peaks.push({
          row,
          column
        });
      }
    }
  }

  return peaks;
}

function fillPeakFootprint(
  target,
  source,
  width,
  height,
  peakRow,
  peakColumn,
  radius
) {
  const anchors = [];

  for (
    let dy = -radius;
    dy <= radius;
    dy += 1
  ) {
    for (
      let dx = -radius;
      dx <= radius;
      dx += 1
    ) {
      if (
        Math.round(
          Math.hypot(dx, dy)
        ) !== radius
      ) {
        continue;
      }

      const row = peakRow + dy;
      const column = peakColumn + dx;

      if (
        row < 0 ||
        row >= height ||
        column < 0 ||
        column >= width
      ) {
        continue;
      }

      const value =
        source[row * width + column];

      if (!Number.isFinite(value)) {
        continue;
      }

      anchors.push({
        dx,
        dy,
        value
      });
    }
  }

  if (anchors.length < MIN_VALID_NEIGHBOURS) {
    return 0;
  }

  let filledCount = 0;

  for (
    let dy = -radius;
    dy <= radius;
    dy += 1
  ) {
    for (
      let dx = -radius;
      dx <= radius;
      dx += 1
    ) {
      const distance =
        Math.hypot(dx, dy);

      if (distance > radius) {
        continue;
      }

      const row = peakRow + dy;
      const column = peakColumn + dx;

      if (
        row < 0 ||
        row >= height ||
        column < 0 ||
        column >= width
      ) {
        continue;
      }

      let weightSum = 0;
      let valueSum = 0;

      for (
        const anchor of
        anchors
      ) {
        const anchorDistance =
          Math.max(
            Math.hypot(
              dx - anchor.dx,
              dy - anchor.dy
            ),
            0.5
          );

        const weight =
          1 /
          (anchorDistance * anchorDistance);

        weightSum += weight;
        valueSum += weight * anchor.value;
      }

      target[row * width + column] =
        valueSum / weightSum;

      filledCount += 1;
    }
  }

  return filledCount;
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

  // 座標軸線每個方向的長度＝2（建構時的基準長度）× 這個縮放值，
  // 固定成每個方向 6 公里，不再跟著地形大小按比例縮放。
  axesHelper.scale.setScalar(
    3
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

  terrainCenterLatitudeDegrees =
    centerGeographic.latitudeDegrees;

  terrainCenterLongitudeDegrees =
    normalizeLongitude(
      centerGeographic.longitudeDegrees
    );

  moonOverview.updateCenterMarker(
    terrainCenterLatitudeDegrees,
    terrainCenterLongitudeDegrees
  );

  setViewGizmoGlobalAxisOrientation(
    viewHelper,
    terrainCenterLatitudeDegrees,
    terrainCenterLongitudeDegrees
  );

  // AxesHelper 是直接加進 scene 的一般物件（不像 ViewHelper 每幀
  // 會覆寫自己的 quaternion），所以可以直接設定旋轉，不需要額外的
  // 可旋轉子群組。
  axesHelper.quaternion.copy(
    computeGlobalAxisOrientationQuaternion(
      terrainCenterLatitudeDegrees,
      terrainCenterLongitudeDegrees
    )
  );

  statusPanel.innerHTML = wrapBilingualText(`
    <strong>
      Artemis III／Nobile Rim 2 數位高程模型
      (Digital Elevation Model, DEM)
    </strong><br>

    <span style="color:#9db3c8;font-size:12px;">
      資料來源 (Data Source)：NASA GSFC PGDA, site DM2 — Barker, M. K.,
      et al., 2021, "Improved LOLA Elevation Maps for South Pole
      Landing Sites: Error Estimates and Their Impact on
      Illumination Conditions,"
      <em>Planetary and Space Science</em>, Vol. 203, 105119
      (DOI:
      <a
        href="https://doi.org/10.1016/j.pss.2020.105119"
        target="_blank"
        rel="noopener noreferrer"
        style="color:#7ec8ff;"
      >10.1016/j.pss.2020.105119</a>)
    </span><br>

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

    ｜孤立突起填平 (Prominent Peaks Filled)：
    ${demCleaningStatistics.prominentPeaksFilled}

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

  if (action === "waypoint") {
    const isFirstPoint =
      waypoints.length === 0;

    addWaypointFromCoordinate(
      point
    );

    showCoordinateInformation();

    showCoordinateSearchMessage(
      isFirstPoint
        ? `已設定起點 (Start Point Set)：` +
          `${point.latitudeDegrees.toFixed(6)}°, ` +
          `${point.longitudeDegrees.toFixed(6)}°`
        : `路徑點 (Waypoint) ${waypoints.length - 1} ` +
          `已新增 (Added)：` +
          `${point.latitudeDegrees.toFixed(6)}°, ` +
          `${point.longitudeDegrees.toFixed(6)}°`,
      isFirstPoint
        ? "#42ff78"
        : "#ffcc55"
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
  waypoints = [point];
  selectedWaypointIndex = null;

  rebuildWaypointMarkers();

  removeRouteLine();
  routeSamples = [];

  clearEnhancedHazardMarkers();
  resetEnhancedRouteProfile();

  updateMissionWaitingPanel();
}

function addWaypointFromCoordinate(
  point
) {
  if (waypoints.length === 0) {
    setStartPointFromCoordinate(point);

    return;
  }

  if (selectedWaypointIndex !== null) {
    waypoints.splice(
      selectedWaypointIndex + 1,
      0,
      point
    );

    selectedWaypointIndex = null;
  } else {
    waypoints.push(point);
  }

  rebuildWaypointMarkers();

  buildAndAnalyzeRoute();
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

    const hitIndex =
      pickWaypointMarkerIndex(
        event
      );

    if (hitIndex === null) {
      return;
    }

    activeWaypointPointerId =
      event.pointerId;

    activeWaypointIndex =
      hitIndex;

    waypointDragMoved = false;

    controls.enabled = false;

    renderer.domElement.setPointerCapture(
      event.pointerId
    );
  }
);

renderer.domElement.addEventListener(
  "pointermove",
  (event) => {
    if (
      activeWaypointIndex === null ||
      event.pointerId !==
        activeWaypointPointerId
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

    if (movement <= 5) {
      return;
    }

    waypointDragMoved = true;

    const point =
      pickTerrainPoint(event);

    if (!point) {
      return;
    }

    placeMarkerOnSurface(
      waypointMarkers[
        activeWaypointIndex
      ],
      rebuildPointUsingDemHeight(
        point
      )
    );
  }
);

function finishWaypointPointerInteraction(
  event
) {
  const index =
    activeWaypointIndex;

  const moved =
    waypointDragMoved;

  controls.enabled = true;

  if (
    renderer.domElement.hasPointerCapture(
      event.pointerId
    )
  ) {
    renderer.domElement.releasePointerCapture(
      event.pointerId
    );
  }

  activeWaypointPointerId = null;
  activeWaypointIndex = null;
  waypointDragMoved = false;

  if (!moved) {
    toggleWaypointSelection(index);

    return;
  }

  const point =
    pickTerrainPoint(event);

  if (point) {
    waypoints[index] =
      rebuildPointUsingDemHeight(
        point
      );
  }

  rebuildWaypointMarkers();
  showCoordinateInformation();

  if (waypoints.length >= 2) {
    buildAndAnalyzeRoute();
  } else {
    updateMissionWaitingPanel();
  }
}

renderer.domElement.addEventListener(
  "pointerup",
  (event) => {
    if (
      activeWaypointIndex !== null &&
      event.pointerId ===
        activeWaypointPointerId
    ) {
      finishWaypointPointerInteraction(
        event
      );

      return;
    }

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

renderer.domElement.addEventListener(
  "pointercancel",
  (event) => {
    if (
      activeWaypointIndex === null ||
      event.pointerId !==
        activeWaypointPointerId
    ) {
      return;
    }

    controls.enabled = true;

    if (
      renderer.domElement.hasPointerCapture(
        event.pointerId
      )
    ) {
      renderer.domElement.releasePointerCapture(
        event.pointerId
      );
    }

    activeWaypointPointerId = null;
    activeWaypointIndex = null;
    waypointDragMoved = false;

    rebuildWaypointMarkers();
  }
);

function pickWaypointMarkerIndex(
  event
) {
  if (waypointMarkers.length === 0) {
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
      waypointMarkers,
      true
    );

  if (
    intersections.length === 0
  ) {
    return null;
  }

  let hitObject =
    intersections[0].object;

  while (
    hitObject &&
    !waypointMarkers.includes(
      hitObject
    )
  ) {
    hitObject =
      hitObject.parent;
  }

  if (!hitObject) {
    return null;
  }

  return waypointMarkers.indexOf(
    hitObject
  );
}

function toggleWaypointSelection(
  index
) {
  selectedWaypointIndex =
    selectedWaypointIndex === index
      ? null
      : index;

  rebuildWaypointMarkers();

  if (selectedWaypointIndex === null) {
    showCoordinateInformation();

    return;
  }

  const label =
    getWaypointDisplayLabelParts(
      selectedWaypointIndex
    );

  showCoordinateSearchMessage(
    `<span class="lang-zh">${label.zh} 已選取，拖曳可移動、點擊地形可在其後插入新點、按刪除鍵移除</span>` +
    `<span class="lang-en">${label.en} Selected — Drag to Move, Click Terrain to Insert After, Press Delete to Remove</span>`,
    "#ffcc55"
  );
}

function deleteSelectedWaypoint() {
  if (selectedWaypointIndex === null) {
    return;
  }

  waypoints.splice(
    selectedWaypointIndex,
    1
  );

  selectedWaypointIndex = null;

  rebuildWaypointMarkers();
  showCoordinateInformation();

  if (waypoints.length >= 2) {
    buildAndAnalyzeRoute();

    return;
  }

  removeRouteLine();
  routeSamples = [];

  clearEnhancedHazardMarkers();
  resetEnhancedRouteProfile();

  if (waypoints.length === 1) {
    updateMissionWaitingPanel();
  } else {
    showMissionInstructions();
  }
}

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

function buildWaypointPanelSections() {
  if (waypoints.length === 0) {
    return (
      formatCoordinatePanelPoint(
        "起點 (Start Point)",
        null
      ) +
      formatCoordinatePanelPoint(
        "終點 (Destination Point)",
        null
      )
    );
  }

  if (waypoints.length === 1) {
    return (
      formatCoordinatePanelPoint(
        "起點 (Start Point)",
        waypoints[0]
      ) +
      formatCoordinatePanelPoint(
        "終點 (Destination Point)",
        null
      )
    );
  }

  const sections = [
    formatCoordinatePanelPoint(
      "起點 (Start Point)",
      waypoints[0]
    )
  ];

  for (
    let index = 1;
    index < waypoints.length - 1;
    index += 1
  ) {
    sections.push(
      formatCoordinatePanelPoint(
        `路徑點 (Waypoint) ${index}`,
        waypoints[index]
      )
    );
  }

  sections.push(
    formatCoordinatePanelPoint(
      "終點 (Destination Point)",
      waypoints[waypoints.length - 1]
    )
  );

  return sections.join(
    '<hr class="panel-divider">'
  );
}

function showCoordinateInformation() {
  coordinatePanel.innerHTML = wrapBilingualText(`
    <strong>
      月面實際座標
      (Lunar Surface Coordinates)
    </strong><br>

    ${buildWaypointPanelSections()}

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

    路徑點數量
    (Waypoint Count)：
    <strong>
      ${waypoints.length}
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

function updateMissionWaitingPanel() {
  missionPanel.innerHTML = wrapBilingualText(`
    <strong>
      月球車任務路線
      (Rover Mission Traverse)
    </strong><br>

    <span style="color:#00ff66">
      起點已設定 (Start Point Set)
    </span>

    <br><br>

    請繼續點擊地形以新增路徑點，或設定終點。
    (Continue Clicking the Terrain to Add Waypoints, or Set the Destination Point.)
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

    後續每次點擊 (Every Click After)：
    新增路徑點 (Add a Waypoint)<br>

    R：
    清除路線重新開始 (Clear Traverse and Start Over)<br>

    <br>

    點擊路徑點旗子 (Click a Waypoint Flag)：
    選取該點 (Select It)<br>

    拖曳路徑點旗子 (Drag a Waypoint Flag)：
    移動位置 (Move Its Position)<br>

    選取後點擊地形 (Click Terrain After Selecting)：
    在其後插入新點 (Insert a New Point After It)<br>

    選取後按刪除鍵 (Press Delete After Selecting)：
    移除該點 (Remove It)<br>

    <br>

    也可以輸入經緯度後選擇 (Or Enter Latitude/Longitude and Choose)：

    <br>

    設定點 (Set a Point)<br>
    設為起點 (Set as Start)<br>
    新增路徑點 (Add Waypoint)<br>
    儲存路線 (Save Route)<br>
    載入路線 (Load Route)<br>
    匯出 (Export) CSV / GeoJSON<br>

    <br>

    <span style="color:#aaaaaa">
      綠色標記 (Green Marker)：起點 (Start)<br>
      琥珀色標記 (Amber Marker)：路徑點 (Waypoint)<br>
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
// 35. 工具函式（Utility Functions）— 定義移至 utils.js
// ======================================================

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

    if (
      (
        key === "delete" ||
        key === "backspace"
      ) &&
      selectedWaypointIndex !== null
    ) {
      deleteSelectedWaypoint();
    }

    if (
      key === "escape" &&
      selectedWaypointIndex !== null
    ) {
      selectedWaypointIndex = null;

      rebuildWaypointMarkers();
      showCoordinateInformation();
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

    keepAllDraggablePanelsInsideWindow();
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
    !moonOverview.panel.classList.contains(
      "interface-panel-hidden"
    )
  ) {
    moonOverview.render();
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
const ENHANCED_ROUTE_COLOR_DEFAULT = 0x000000;

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
    max-width: 100%;
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
    overflowX: "hidden",
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

  <div class="layer-header">
    <strong>
      坡度安全分色
      (Slope Safety Coloring)
    </strong>

    <label class="layer-switch">
      <input id="route-slope-color-toggle" type="checkbox">
      <span class="layer-slider"></span>
    </label>
  </div>

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

const routeSlopeColorToggle =
  document.querySelector(
    "#route-slope-color-toggle"
  );

routeSlopeColorToggle.addEventListener(
  "change",
  () => {
    routeSlopeColoringEnabled =
      routeSlopeColorToggle.checked;

    if (routeSamples.length >= 2) {
      removeRouteLine();

      createEnhancedColoredRoute(
        routeSamples
      );
    }
  }
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
  let horizontalDistanceMeters = 0;
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

    const segmentHorizontalDistanceMeters =
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

    horizontalDistanceMeters +=
      segmentHorizontalDistanceMeters;

    const elevationDifferenceMeters =
      current.elevationMeters -
      previous.elevationMeters;

    const surfaceSegmentDistanceMeters =
      Math.hypot(
        segmentHorizontalDistanceMeters,
        elevationDifferenceMeters
      );

    surfaceDistanceMeters +=
      surfaceSegmentDistanceMeters;

    current.cumulativeDistanceMeters =
      surfaceDistanceMeters;

    current.horizontalDistanceMeters =
      segmentHorizontalDistanceMeters;

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
      segmentHorizontalDistanceMeters > 0
    ) {
      signedSlopeDegrees =
        THREE.MathUtils.radToDeg(
          Math.atan2(
            elevationDifferenceMeters,
            segmentHorizontalDistanceMeters
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
    horizontalDistanceMeters,

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
          routeSlopeColoringEnabled
            ? getEnhancedRouteSlopeColorHex(
                current.slopeDegrees
              )
            : ENHANCED_ROUTE_COLOR_DEFAULT,

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

  focusCameraOnPoint(
    point
  );

  // 點擊命名標記點直接設為起點（原本只會填入搜尋面板的經緯度，
  // 還要另外去按「設為起點」才生效，如果搜尋面板剛好被關掉，
  // 使用者會看不到任何回饋、以為選取沒有作用）。
  setStartPointFromCoordinate(
    point
  );

  showCoordinateInformation();

  showCoordinateSearchMessage(
    `已將標記點設為起點 (Start Point Set to Marked Point)：` +
    `${point.latitudeDegrees.toFixed(6)}°, ` +
    `${point.longitudeDegrees.toFixed(6)}°`,
    "#42ff78"
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
  highlightedIndex = null,
  highlightedDistanceMeters = null
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

    // 白線本身用滑鼠對應的連續距離（而非吸附後的取樣點距離）
    // 定位，才會跟滑鼠水平位置完全同步、不會有吸附感；曲線上
    // 的圓點仍用最近取樣點的高程，兩者相差不到半個取樣間距
    // （5 公尺），視覺上不會有落差。
    const selectedX =
      xFromDistance(
        Number.isFinite(
          highlightedDistanceMeters
        )
          ? highlightedDistanceMeters
          : selectedSample
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

let pendingProfilePointerEvent = null;
let profilePointerFrameScheduled = false;

// 剖面圖懸停時，滑鼠原生 pointermove 事件頻率可能遠高於畫面更新
// 頻率，這裡改成只記住最新的事件，每個動畫影格最多重新計算／
// 重畫一次，避免滑鼠一晃就整套（線性掃描＋重建面板＋重畫 canvas）
// 跑好幾次造成卡頓。
function handleEnhancedProfilePointerMove(
  event
) {
  pendingProfilePointerEvent =
    event;

  if (
    profilePointerFrameScheduled
  ) {
    return;
  }

  profilePointerFrameScheduled =
    true;

  requestAnimationFrame(() => {
    profilePointerFrameScheduled =
      false;

    processEnhancedProfilePointerMove(
      pendingProfilePointerEvent
    );
  });
}

function processEnhancedProfilePointerMove(
  event
) {
  if (
    !event ||
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
    nearestIndex,
    targetDistanceMeters
  );
}

// 監聽整個面板而不是只監聽 canvas 本身：canvas 貼齊面板邊緣，
// 滑鼠只要移出 canvas 一點點（哪怕還在面板內的留白／邊框上）
// pointermove 就會停止觸發，白色追蹤線因此卡住走不到最右／
// 最左。改成監聽面板後，只要滑鼠還在面板範圍內，就會持續依照
// 下面既有的 clamp 邏輯貼齊圖表最近的一端。
enhancedRouteProfilePanel.addEventListener(
  "pointermove",
  handleEnhancedProfilePointerMove
);

enhancedRouteProfilePanel.addEventListener(
  "pointerleave",
  () => {
    pendingProfilePointerEvent =
      null;

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
  if (waypoints.length < 2) {
    return;
  }

  removeRouteLine();

  clearEnhancedHazardMarkers();

  routeSamples = [];

  for (
    let segment = 0;
    segment < waypoints.length - 1;
    segment += 1
  ) {
    const segmentStart =
      waypoints[segment];

    const segmentEnd =
      waypoints[segment + 1];

    const segmentHorizontalDistanceMeters =
      Math.hypot(
        (
          segmentEnd.localXKm -
          segmentStart.localXKm
        ) *
        1000,

        (
          segmentEnd.localZKm -
          segmentStart.localZKm
        ) *
        1000
      );

    const segmentCount =
      Math.max(
        2,
        Math.ceil(
          segmentHorizontalDistanceMeters /
          ROUTE_SAMPLE_INTERVAL_METERS
        )
      );

    const startIndex =
      segment === 0
        ? 0
        : 1;

    for (
      let index = startIndex;
      index <= segmentCount;
      index += 1
    ) {
      const t =
        index /
        segmentCount;

      const localXKm =
        THREE.MathUtils.lerp(
          segmentStart.localXKm,
          segmentEnd.localXKm,
          t
        );

      const localZKm =
        THREE.MathUtils.lerp(
          segmentStart.localZKm,
          segmentEnd.localZKm,
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
  waypoints = [];
  selectedWaypointIndex = null;

  rebuildWaypointMarkers();

  clickMarker.visible = false;

  routeSamples = [];

  enhancedRouteAnalysis =
    null;

  removeRouteLine();

  clearEnhancedHazardMarkers();

  resetEnhancedRouteProfile();

  showMissionInstructions();

  showCoordinateInformation();
}

// ======================================================
// 52A. 路線匯出（Route Export）
// ======================================================

function downloadTextFile(
  filename,
  mimeType,
  content
) {
  const blob =
    new Blob(
      [content],
      { type: mimeType }
    );

  const url =
    URL.createObjectURL(blob);

  const link =
    document.createElement("a");

  link.href = url;
  link.download = filename;

  document.body.appendChild(link);

  link.click();

  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}

function buildRouteExportSamples() {
  if (routeSamples.length > 1) {
    return routeSamples;
  }

  return waypoints;
}

function exportRouteAsCsv() {
  if (waypoints.length < 2) {
    showCoordinateSearchMessage(
      '<span class="lang-zh">至少需要 2 個路徑點才能匯出路線</span>' +
      '<span class="lang-en">At Least 2 Waypoints Are Required to Export a Traverse</span>',
      "#ff6b6b"
    );

    return;
  }

  const samples =
    buildRouteExportSamples();

  const lines = [
    "Index,Latitude_deg,Longitude_deg,Elevation_m,CumulativeDistance_m,Slope_deg"
  ];

  samples.forEach(
    (sample, index) => {
      lines.push(
        [
          index,
          sample.latitudeDegrees.toFixed(6),
          sample.longitudeDegrees.toFixed(6),
          sample.elevationMeters.toFixed(2),
          (
            sample.cumulativeDistanceMeters ??
            0
          ).toFixed(2),
          (
            sample.slopeDegrees ??
            0
          ).toFixed(2)
        ].join(",")
      );
    }
  );

  downloadTextFile(
    `lunar-rover-traverse-${Date.now()}.csv`,
    "text/csv;charset=utf-8;",
    lines.join("\n")
  );

  showCoordinateSearchMessage(
    '<span class="lang-zh">路線已匯出為 CSV</span>' +
    '<span class="lang-en">Traverse Exported as CSV</span>',
    "#42ff78"
  );
}

function exportRouteAsGeoJson() {
  if (waypoints.length < 2) {
    showCoordinateSearchMessage(
      '<span class="lang-zh">至少需要 2 個路徑點才能匯出路線</span>' +
      '<span class="lang-en">At Least 2 Waypoints Are Required to Export a Traverse</span>',
      "#ff6b6b"
    );

    return;
  }

  const samples =
    buildRouteExportSamples();

  const geoJson = {
    type: "Feature",

    properties: {
      name:
        "Lunar Rover Traverse - Nobile Rim 2",

      waypointCount:
        waypoints.length,

      sampleCount:
        samples.length,

      surfaceDistanceMeters:
        enhancedRouteAnalysis?.surfaceDistanceMeters ??
        null,

      maximumSlopeDegrees:
        enhancedRouteAnalysis?.maximumSlopeDegrees ??
        null
    },

    geometry: {
      type: "LineString",

      coordinates:
        samples.map(
          (sample) => [
            Number(
              sample.longitudeDegrees.toFixed(6)
            ),

            Number(
              sample.latitudeDegrees.toFixed(6)
            ),

            Number(
              sample.elevationMeters.toFixed(2)
            )
          ]
        )
    }
  };

  downloadTextFile(
    `lunar-rover-traverse-${Date.now()}.geojson`,
    "application/geo+json;charset=utf-8;",
    JSON.stringify(
      geoJson,
      null,
      2
    )
  );

  showCoordinateSearchMessage(
    '<span class="lang-zh">路線已匯出為 GeoJSON</span>' +
    '<span class="lang-en">Traverse Exported as GeoJSON</span>',
    "#42ff78"
  );
}

// ======================================================
// 52B. 路線儲存與讀取（Route Save and Load）
// ======================================================

const SAVED_ROUTE_STORAGE_KEY =
  "lunar-terrain-saved-route-v1";

function saveRouteToLocalStorage() {
  if (waypoints.length === 0) {
    showCoordinateSearchMessage(
      '<span class="lang-zh">尚未設定任何路徑點，無法儲存</span>' +
      '<span class="lang-en">No Waypoints Set — Nothing to Save</span>',
      "#ff6b6b"
    );

    return;
  }

  const payload = {
    savedAt: Date.now(),

    points:
      waypoints.map(
        (point) => ({
          latitudeDegrees:
            point.latitudeDegrees,

          longitudeDegrees:
            point.longitudeDegrees
        })
      )
  };

  try {
    window.localStorage.setItem(
      SAVED_ROUTE_STORAGE_KEY,
      JSON.stringify(payload)
    );

    showCoordinateSearchMessage(
      '<span class="lang-zh">路線已儲存至本機瀏覽器</span>' +
      '<span class="lang-en">Traverse Saved to This Browser</span>',
      "#42ff78"
    );
  } catch (error) {
    showCoordinateSearchMessage(
      '<span class="lang-zh">儲存失敗，瀏覽器儲存空間可能已滿</span>' +
      '<span class="lang-en">Save Failed — Browser Storage May Be Full</span>',
      "#ff6b6b"
    );
  }
}

function loadRouteFromLocalStorage() {
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

  let payload = null;

  try {
    const raw =
      window.localStorage.getItem(
        SAVED_ROUTE_STORAGE_KEY
      );

    payload =
      raw
        ? JSON.parse(raw)
        : null;
  } catch (error) {
    payload = null;
  }

  if (
    !payload ||
    !Array.isArray(payload.points) ||
    payload.points.length === 0
  ) {
    showCoordinateSearchMessage(
      '<span class="lang-zh">沒有已儲存的路線</span>' +
      '<span class="lang-en">No Saved Traverse Found</span>',
      "#ff6b6b"
    );

    return;
  }

  const restoredPoints =
    payload.points
      .map(
        (entry) =>
          createPointDataFromGeographicCoordinates(
            entry.latitudeDegrees,
            entry.longitudeDegrees
          )
      )
      .filter(
        (point) => point !== null
      );

  if (restoredPoints.length === 0) {
    showCoordinateSearchMessage(
      '<span class="lang-zh">已儲存的路線座標超出目前地形範圍</span>' +
      '<span class="lang-en">Saved Traverse Coordinates Are Outside the Current Terrain</span>',
      "#ff6b6b"
    );

    return;
  }

  waypoints = restoredPoints;
  selectedWaypointIndex = null;

  rebuildWaypointMarkers();
  showCoordinateInformation();

  if (waypoints.length >= 2) {
    buildAndAnalyzeRoute();
  } else {
    updateMissionWaitingPanel();
  }

  const isPartial =
    restoredPoints.length <
    payload.points.length;

  showCoordinateSearchMessage(
    isPartial
      ? '<span class="lang-zh">路線已載入（部分座標超出範圍已略過）</span>' +
        '<span class="lang-en">Traverse Loaded (Some Points Outside Range Were Skipped)</span>'
      : '<span class="lang-zh">路線已載入</span>' +
        '<span class="lang-en">Traverse Loaded</span>',
    isPartial
      ? "#ffcc55"
      : "#42ff78"
  );
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

  if (selectedWaypointIndex !== null) {
    waypoints.splice(
      selectedWaypointIndex + 1,
      0,
      correctedPoint
    );

    selectedWaypointIndex = null;
  } else {
    waypoints.push(
      correctedPoint
    );
  }

  rebuildWaypointMarkers();

  showCoordinateInformation();

  if (waypoints.length >= 2) {
    buildAndAnalyzeRoute();
  } else {
    updateMissionWaitingPanel();
  }
}

// 初始顯示空白剖面圖
resetEnhancedRouteProfile();

profileCanvasReady = true;

setAllPanelsVisible(false);