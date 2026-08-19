import * as THREE from "three";
import { ViewHelper } from "three/addons/helpers/ViewHelper.js";

// ======================================================
// 方向指標（View Orientation Gizmo）
// ======================================================

// 依背景色亮度自動選擇黑／白文字，確保對比度足夠清晰
// （例如亮綠色背景配黑字、深紅／深藍背景配白字）。
function getReadableTextColor(hexColor) {
  const hex = hexColor.replace("#", "");

  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);

  const relativeLuminance =
    (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  return relativeLuminance > 0.6
    ? "#000000"
    : "#ffffff";
}

function createDirectionLabelSpriteMaterial(
  fillColor,
  text,
  opacity,
  fontSizePx = 24,
  canvasSizePx = 64,
  radiusXPx = 14,
  radiusYPx = radiusXPx
) {
  const canvas =
    document.createElement("canvas");

  canvas.width = canvasSizePx;
  canvas.height = canvasSizePx;

  const center = canvasSizePx / 2;

  const context =
    canvas.getContext("2d");

  context.beginPath();
  context.ellipse(
    center,
    center,
    radiusXPx,
    radiusYPx,
    0,
    0,
    Math.PI * 2
  );
  context.closePath();
  context.fillStyle = fillColor;
  context.fill();

  context.font = `${fontSizePx}px Arial`;
  context.textAlign = "center";
  context.fillStyle =
    getReadableTextColor(fillColor);
  context.fillText(
    text,
    center,
    center + fontSizePx * 0.36
  );

  const texture =
    new THREE.CanvasTexture(canvas);

  texture.colorSpace =
    THREE.SRGBColorSpace;

  const material =
    new THREE.SpriteMaterial({
      map: texture,
      toneMapped: false
    });

  material.opacity = opacity;

  return material;
}

export function createViewGizmo(
  camera,
  renderer
) {
  const viewHelper = new ViewHelper(
    camera,
    renderer.domElement
  );

  // 場景座標對應實際方位：
  // +X＝東（East）／-X＝西（West）
  // +Z＝南（South，朝向極點）／-Z＝北（North，遠離極點）
  // +Y／-Y 不是方位角，用天文/大地測量學用語 Zenith（天頂）標示，
  // 對應 NASA JPL SPICE 工具箱對本地座標系垂直軸的正式用詞。
  //
  // 全部五個有文字的方位球都改用自訂繪製（不用 ViewHelper 內建的
  // setLabels()），統一放大貼圖／圓點／字型，「Zenith」這種完整
  // 單字才不會擠在原本給單一字母用的小圓點裡看不清楚。
  const LABEL_CANVAS_SIZE_PX = 96;
  const LABEL_CIRCLE_RADIUS_PX = 20;
  const LABEL_FONT_SIZE_PX = 20;
  const LABEL_SPRITE_SCALE = 1.6;

  const labelConfigs = [
    {
      type: "posX",
      color: "#ff4466",
      text: "E",
      opacity: 1,
      fontSizePx: LABEL_FONT_SIZE_PX,
      radiusXPx: LABEL_CIRCLE_RADIUS_PX,
      radiusYPx: LABEL_CIRCLE_RADIUS_PX
    },
    {
      type: "negX",
      color: "#ff4466",
      text: "W",
      opacity: 0.55,
      fontSizePx: LABEL_FONT_SIZE_PX,
      radiusXPx: LABEL_CIRCLE_RADIUS_PX,
      radiusYPx: LABEL_CIRCLE_RADIUS_PX
    },
    {
      type: "posZ",
      color: "#4488ff",
      text: "S",
      opacity: 1,
      fontSizePx: LABEL_FONT_SIZE_PX,
      radiusXPx: LABEL_CIRCLE_RADIUS_PX,
      radiusYPx: LABEL_CIRCLE_RADIUS_PX
    },
    {
      type: "negZ",
      color: "#4488ff",
      text: "N",
      opacity: 0.55,
      fontSizePx: LABEL_FONT_SIZE_PX,
      radiusXPx: LABEL_CIRCLE_RADIUS_PX,
      radiusYPx: LABEL_CIRCLE_RADIUS_PX
    },
    {
      // "Zenith" 是完整單字，圓形放大也裝不下，改用比較寬的
      // 橢圓（藥丸形）背景，讓文字剛好被包住、不會溢出。
      type: "posY",
      color: "#88ff44",
      text: "Zenith",
      opacity: 1,
      fontSizePx: 22,
      radiusXPx: 42,
      radiusYPx: 20
    }
  ];

  for (const config of labelConfigs) {
    const axisHelper =
      viewHelper.children.find(
        (child) =>
          child.userData?.type === config.type
      );

    if (!axisHelper) {
      continue;
    }

    axisHelper.material =
      createDirectionLabelSpriteMaterial(
        config.color,
        config.text,
        config.opacity,
        config.fontSizePx,
        LABEL_CANVAS_SIZE_PX,
        config.radiusXPx,
        config.radiusYPx
      );

    axisHelper.scale.setScalar(
      LABEL_SPRITE_SCALE
    );
  }

  const viewHelperTimer = new THREE.Timer();

  renderer.autoClear = false;

  return {
    viewHelper,
    viewHelperTimer
  };
}

/**
 * 場景的 +X／+Z 軸只有在地形中心點剛好落在投影的中央經線上時，
 * 才會精準對齊真正的東／南方向；離中央經線越遠，會因為「子午線
 * 收斂」而產生偏移角（等於地形中心經度－中央經線）。
 *
 * ViewHelper 每一幀的 render() 都會用相機方向覆寫自己的 quaternion
 * （three.js 內部行為），所以沒辦法直接旋轉 viewHelper 本身來校正；
 * 但子物件（三個軸臂與六個方位球）的本地旋轉不會被覆寫，因此把
 * 它們一次性地移進一個可旋轉的子群組，之後只要改子群組的角度即可。
 *
 * @param {ViewHelper} viewHelper - createViewGizmo() 回傳的 viewHelper。
 * @param {number} convergenceAngleDegrees - 地形中心經度－中央經線。
 */
export function setViewGizmoCompassCorrection(
  viewHelper,
  convergenceAngleDegrees
) {
  let correctionGroup =
    viewHelper.userData.compassCorrectionGroup;

  if (!correctionGroup) {
    correctionGroup = new THREE.Group();

    for (const child of [...viewHelper.children]) {
      correctionGroup.add(child);
    }

    viewHelper.add(correctionGroup);

    viewHelper.userData.compassCorrectionGroup =
      correctionGroup;
  }

  correctionGroup.rotation.y =
    -THREE.MathUtils.degToRad(
      convergenceAngleDegrees
    );
}
