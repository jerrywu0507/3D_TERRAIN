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

const SCENE_AXIS_CONFIGS = [
  {
    direction: new THREE.Vector3(1, 0, 0),
    color: "#ff4466",
    positiveText: "+X",
    negativeText: "-X"
  },
  {
    direction: new THREE.Vector3(0, 1, 0),
    color: "#88ff44",
    positiveText: "+Y",
    negativeText: "-Y"
  },
  {
    direction: new THREE.Vector3(0, 0, 1),
    color: "#4488ff",
    positiveText: "+Z",
    negativeText: "-Z"
  }
];

/**
 * 直接放進 3D 場景裡的座標軸輔助物件，取代 THREE.AxesHelper（原本
 * 內建的版本只畫 +X/+Y/+Z 三條線、沒有負方向、也沒有文字標籤）。
 * 這裡改成畫六個方向（正方向實線＋負方向較淡的線），並在每個
 * 端點放上跟角落方向指標一樣風格的文字標籤，方便直接對照。
 *
 * @param {number} size - 從原點到每個端點的長度（場景本地單位）。
 * @returns {THREE.Group} 可直接 scene.add()，之後可用 .scale／
 *   .quaternion／.visible 調整大小、旋轉、顯示與否。
 */
export function createSceneAxisHelper(
  size = 2
) {
  const group = new THREE.Group();

  const labelScale =
    size * 0.14;

  for (const config of SCENE_AXIS_CONFIGS) {
    const positiveEnd =
      config.direction
        .clone()
        .multiplyScalar(size);

    const negativeEnd =
      config.direction
        .clone()
        .multiplyScalar(-size);

    const positiveLine =
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, 0, 0),
          positiveEnd
        ]),
        new THREE.LineBasicMaterial({
          color: config.color
        })
      );

    const negativeLine =
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, 0, 0),
          negativeEnd
        ]),
        new THREE.LineBasicMaterial({
          color: config.color,
          transparent: true,
          opacity: 0.4
        })
      );

    group.add(positiveLine);
    group.add(negativeLine);

    const positiveLabel =
      new THREE.Sprite(
        createDirectionLabelSpriteMaterial(
          config.color,
          config.positiveText,
          1
        )
      );

    positiveLabel.position.copy(
      positiveEnd
    );

    positiveLabel.scale.setScalar(
      labelScale
    );

    const negativeLabel =
      new THREE.Sprite(
        createDirectionLabelSpriteMaterial(
          config.color,
          config.negativeText,
          0.55
        )
      );

    negativeLabel.position.copy(
      negativeEnd
    );

    negativeLabel.scale.setScalar(
      labelScale
    );

    group.add(positiveLabel);
    group.add(negativeLabel);
  }

  return group;
}

export function createViewGizmo(
  camera,
  renderer
) {
  const viewHelper = new ViewHelper(
    camera,
    renderer.domElement
  );

  // 這裡標示的不是場景本地的 X/Y/Z，而是月球慣用的全域本體固定
  // 坐標系 MOON_ME（Mean Earth/Polar Axis）：
  // +Z＝月球平均自轉極軸（指向平均北極）
  // +X＝指向平均地球方向／本初子午線（經度 0°）方向
  // +Y＝與 X、Z 皆垂直，依右手定則補足（Y = Z × X）
  // 顏色沿用 three.js 慣例：X＝紅、Y＝綠、Z＝藍。
  //
  // 只標示正方向的 X/Y/Z（不加 + 號、也不標負方向的 -X/-Y/-Z），
  // 讓畫面單純一些；負方向沿用 ViewHelper 內建的無字黑點樣式。
  // 三個正方位球改用自訂繪製（不用 ViewHelper 內建的 setLabels()），
  // 統一放大貼圖／圓點／字型，並依實際地形中心經緯度旋轉整組標籤
  // （見 setViewGizmoGlobalAxisOrientation()），讓箭頭真的指向對應
  // 的全域座標方向，而不是場景本地座標的方向。
  const LABEL_CANVAS_SIZE_PX = 96;
  const LABEL_CIRCLE_RADIUS_PX = 20;
  const LABEL_FONT_SIZE_PX = 20;
  const LABEL_SPRITE_SCALE = 1.6;

  const labelConfigs = [
    {
      type: "posX",
      color: "#ff4466",
      text: "X",
      opacity: 1
    },
    {
      type: "posY",
      color: "#88ff44",
      text: "Y",
      opacity: 1
    },
    {
      type: "posZ",
      color: "#4488ff",
      text: "Z",
      opacity: 1
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
        LABEL_FONT_SIZE_PX,
        LABEL_CANVAS_SIZE_PX,
        LABEL_CIRCLE_RADIUS_PX
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

function getOrCreateOrientationGroup(
  viewHelper
) {
  let orientationGroup =
    viewHelper.userData.axisOrientationGroup;

  if (!orientationGroup) {
    orientationGroup = new THREE.Group();

    for (const child of [...viewHelper.children]) {
      orientationGroup.add(child);
    }

    viewHelper.add(orientationGroup);

    viewHelper.userData.axisOrientationGroup =
      orientationGroup;
  }

  return orientationGroup;
}

/**
 * 場景的本地 X/Y/Z（東／上／南）在月球慣用的全域本體固定坐標系
 * MOON_ME 裡，是一組會隨地形所在經緯度而變化的傾斜方向：
 * +Z（自轉極軸）在地形所在緯度附近，幾乎垂直指向地底；+X／+Y
 * （分別對應本初子午線與東經 90° 方向）在地表附近則是接近水平、
 * 但跟東西南北沒有直接關係的方向。
 *
 * 這裡直接算出「把場景本地座標旋轉成全域 MOON_ME 座標」所需的
 * 旋轉，是標準的大地測量學公式（局部東-北-上／ENU 坐標，表示成
 * 本體固定坐標系裡的分量），對任意緯度／經度都適用：
 *   East  = (-sin(lon),            cos(lon),           0)
 *   North = (-sin(lat)*cos(lon),  -sin(lat)*sin(lon),  cos(lat))
 *   Up    = ( cos(lat)*cos(lon),   cos(lat)*sin(lon),  sin(lat))
 * （South = -North，場景本地 Z 軸方向）
 *
 * @param {number} latitudeDegrees - 地形中心點緯度。
 * @param {number} longitudeDegrees - 地形中心點經度。
 * @returns {THREE.Quaternion} 套用在場景本地座標系物件上，能讓
 *   該物件的 +X/+Y/+Z 軸分別指向全域 MOON_ME 的 +X/+Y/+Z 方向。
 */
export function computeGlobalAxisOrientationQuaternion(
  latitudeDegrees,
  longitudeDegrees
) {
  const phi =
    THREE.MathUtils.degToRad(
      latitudeDegrees
    );

  const lambda =
    THREE.MathUtils.degToRad(
      longitudeDegrees
    );

  const east = new THREE.Vector3(
    -Math.sin(lambda),
    Math.cos(lambda),
    0
  );

  const north = new THREE.Vector3(
    -Math.sin(phi) * Math.cos(lambda),
    -Math.sin(phi) * Math.sin(lambda),
    Math.cos(phi)
  );

  const up = new THREE.Vector3(
    Math.cos(phi) * Math.cos(lambda),
    Math.cos(phi) * Math.sin(lambda),
    Math.sin(phi)
  );

  const south =
    north.clone().negate();

  // 場景本地座標下，全域 +X／+Y／+Z 各自指向哪個方向：把每個全域
  // 軸拆解到（East, Up, South）這組本地正交基底上的分量。
  const globalXInScene = new THREE.Vector3(
    east.x,
    up.x,
    south.x
  );

  const globalYInScene = new THREE.Vector3(
    east.y,
    up.y,
    south.y
  );

  const globalZInScene = new THREE.Vector3(
    east.z,
    up.z,
    south.z
  );

  const orientationMatrix =
    new THREE.Matrix4().makeBasis(
      globalXInScene,
      globalYInScene,
      globalZInScene
    );

  return new THREE.Quaternion().setFromRotationMatrix(
    orientationMatrix
  );
}

/**
 * 更新角落方向指標，讓它的箭頭對齊全域 MOON_ME 座標系。
 *
 * ViewHelper 每一幀的 render() 都會用相機方向覆寫自己的 quaternion
 * （three.js 內部行為），所以沒辦法直接旋轉 viewHelper 本身來校正；
 * 但子物件（三個軸臂與六個方位球）的本地旋轉不會被覆寫，因此把
 * 它們一次性地移進一個可旋轉的子群組，之後只要改子群組的旋轉即可。
 *
 * @param {ViewHelper} viewHelper - createViewGizmo() 回傳的 viewHelper。
 * @param {number} latitudeDegrees - 地形中心點緯度。
 * @param {number} longitudeDegrees - 地形中心點經度。
 */
export function setViewGizmoGlobalAxisOrientation(
  viewHelper,
  latitudeDegrees,
  longitudeDegrees
) {
  const orientationGroup =
    getOrCreateOrientationGroup(
      viewHelper
    );

  orientationGroup.quaternion.copy(
    computeGlobalAxisOrientationQuaternion(
      latitudeDegrees,
      longitudeDegrees
    )
  );
}
