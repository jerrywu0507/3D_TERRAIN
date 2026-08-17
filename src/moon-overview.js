import * as THREE from "three";

import {
  createPanel,
  makePanelDraggable,
  makePanelResizable,
  stopPanelEvents
} from "./ui-core.js";

// ======================================================
// 月球全貌小視窗（Moon Overview Inset）
//
// createMoonOverview() 建立獨立的 scene/camera/renderer，
// 回傳 { panel, render, updateCenterMarker } 供 main.js 使用：
// - panel：要加進 managedPanels 的面板元素
// - render()：畫面需要更新時呼叫（render-on-demand）
// - updateCenterMarker(latitudeDegrees, longitudeDegrees)：
//   地形中心點座標改變時呼叫，更新小地球上的紅旗標記
// ======================================================

function convertLatLonToMoonOverviewPosition(
  latitudeDegrees,
  longitudeDegrees,
  radius
) {
  const theta =
    THREE.MathUtils.degToRad(
      90 - latitudeDegrees
    );

  const phi =
    THREE.MathUtils.degToRad(
      longitudeDegrees + 180
    );

  const y =
    radius *
    Math.cos(theta);

  const ringRadius =
    Math.sqrt(
      radius * radius -
      y * y
    );

  return new THREE.Vector3(
    -ringRadius * Math.cos(phi),
    y,
    ringRadius * Math.sin(phi)
  );
}

function createMoonOverviewFlagMarker(
  color
) {
  const group =
    new THREE.Group();

  const poleHeight = 0.22;
  const poleRadius = 0.008;

  const pole =
    new THREE.Mesh(
      new THREE.CylinderGeometry(
        poleRadius,
        poleRadius,
        poleHeight,
        8
      ),
      new THREE.MeshBasicMaterial({
        color: 0xdddddd
      })
    );

  pole.position.y =
    poleHeight / 2;

  group.add(pole);

  const bannerWidth = 0.13;
  const bannerHeight = 0.08;
  const bannerThickness = 0.015;

  const bannerShape =
    new THREE.Shape();

  bannerShape.moveTo(
    0,
    bannerHeight / 2
  );

  bannerShape.lineTo(
    bannerWidth,
    0
  );

  bannerShape.lineTo(
    0,
    -bannerHeight / 2
  );

  bannerShape.lineTo(
    0,
    bannerHeight / 2
  );

  const banner =
    new THREE.Mesh(
      new THREE.ExtrudeGeometry(
        bannerShape,
        {
          depth: bannerThickness,
          bevelEnabled: false
        }
      ),
      new THREE.MeshBasicMaterial({
        color,
        side: THREE.DoubleSide
      })
    );

  banner.position.set(
    poleRadius,
    poleHeight * 0.62,
    -bannerThickness / 2
  );

  group.add(banner);

  return group;
}

const MOON_OVERVIEW_UP =
  new THREE.Vector3(
    0,
    1,
    0
  );

export function createMoonOverview({
  colorMapUrl,
  bumpMapUrl
}) {
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
    colorMapUrl,
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
    bumpMapUrl,
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

  const moonOverviewCenterMarker =
    createMoonOverviewFlagMarker(
      0xff3333
    );

  moonOverviewCenterMarker.visible = false;

  moonOverviewGroup.add(
    moonOverviewCenterMarker
  );

  let moonOverviewNeedsRender = true;

  function markMoonOverviewDirty() {
    moonOverviewNeedsRender = true;
  }

  function updateMoonOverviewCenterMarker(
    latitudeDegrees,
    longitudeDegrees
  ) {
    if (
      latitudeDegrees === null ||
      longitudeDegrees === null
    ) {
      return;
    }

    const surfacePosition =
      convertLatLonToMoonOverviewPosition(
        latitudeDegrees,
        longitudeDegrees,
        1
      );

    const outwardDirection =
      surfacePosition
        .clone()
        .normalize();

    moonOverviewCenterMarker.position.copy(
      surfacePosition
    );

    moonOverviewCenterMarker.quaternion.setFromUnitVectors(
      MOON_OVERVIEW_UP,
      outwardDirection
    );

    moonOverviewCenterMarker.visible = true;

    markMoonOverviewDirty();
  }

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

      markMoonOverviewDirty();
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

    const sizeChanged =
      width !== moonOverviewLastWidth ||
      height !== moonOverviewLastHeight;

    if (
      !sizeChanged &&
      !moonOverviewNeedsRender
    ) {
      return;
    }

    if (sizeChanged) {
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

    moonOverviewNeedsRender = false;
  }

  return {
    panel: moonOverviewPanel,
    render: renderMoonOverview,
    updateCenterMarker: updateMoonOverviewCenterMarker
  };
}
