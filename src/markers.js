import * as THREE from "three";

// ======================================================
// 標記建構工具（Marker Construction Utilities）
//
// initMarkers() 必須在使用其他任何 export 之前呼叫一次，
// 用來注入場景（用於 disposeMarkerObject 從場景移除物件）
// 與旗子/圓點標記的尺寸設定（半徑、旗子縮放倍率）。
//
// 這裡只放「純幾何建構」與「共用色彩」，跟路徑點/命名標記
// 狀態相關的邏輯（rebuildWaypointMarkers、createNamedPointMarker
// 等）留在 main.js，因為它們牽涉到路線與地形的共用狀態。
// ======================================================

let markerScene = null;
let markerRadiusKm = 0.008;
let flagMarkerScale = 1;

export function initMarkers({
  scene,
  markerRadiusKm: radiusKm,
  flagMarkerScale: scale
}) {
  markerScene = scene;
  markerRadiusKm = radiusKm;
  flagMarkerScale = scale;
}

export const WAYPOINT_START_COLOR = 0x00ff66;
export const WAYPOINT_DESTINATION_COLOR = 0xff3333;
export const WAYPOINT_INTERMEDIATE_COLOR = 0xffcc33;

export function getWaypointMarkerColor(index, total) {
  if (index === 0) {
    return WAYPOINT_START_COLOR;
  }

  if (index === total - 1) {
    return WAYPOINT_DESTINATION_COLOR;
  }

  return WAYPOINT_INTERMEDIATE_COLOR;
}

export function disposeMarkerObject(marker) {
  markerScene.remove(marker);

  marker.traverse((child) => {
    child.geometry?.dispose();

    if (Array.isArray(child.material)) {
      for (const material of child.material) {
        material.dispose();
      }
    } else {
      child.material?.dispose();
    }
  });
}

export function createSphereMarker(color) {
  const geometry =
    new THREE.SphereGeometry(
      markerRadiusKm,
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

export function createFlagMarker(color) {
  const group = new THREE.Group();

  const poleHeightKm =
    markerRadiusKm * 3 * flagMarkerScale;

  const poleRadiusKm =
    markerRadiusKm * 0.12 * flagMarkerScale;

  const poleGeometry =
    new THREE.CylinderGeometry(
      poleRadiusKm,
      poleRadiusKm,
      poleHeightKm,
      8
    );

  const poleMaterial =
    new THREE.MeshBasicMaterial({
      color: 0x000000,
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
    markerRadiusKm * 1.8 * flagMarkerScale;

  const bannerHeightKm =
    markerRadiusKm * 1.1 * flagMarkerScale;

  const bannerThicknessKm =
    markerRadiusKm * 0.25 * flagMarkerScale;

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
