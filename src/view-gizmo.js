import * as THREE from "three";
import { ViewHelper } from "three/addons/helpers/ViewHelper.js";

// ======================================================
// 方向指標（View Orientation Gizmo）
// ======================================================

function createDirectionLabelSpriteMaterial(
  fillColor,
  text,
  opacity
) {
  const canvas =
    document.createElement("canvas");

  canvas.width = 64;
  canvas.height = 64;

  const context =
    canvas.getContext("2d");

  context.beginPath();
  context.arc(
    32,
    32,
    14,
    0,
    Math.PI * 2
  );
  context.closePath();
  context.fillStyle = fillColor;
  context.fill();

  context.font = "24px Arial";
  context.textAlign = "center";
  context.fillStyle = "#ffffff";
  context.fillText(text, 32, 41);

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
  viewHelper.setLabels(
    "E",
    "Up",
    "S"
  );

  const negativeXAxisHelper =
    viewHelper.children.find(
      (child) =>
        child.userData?.type === "negX"
    );

  const negativeZAxisHelper =
    viewHelper.children.find(
      (child) =>
        child.userData?.type === "negZ"
    );

  if (negativeXAxisHelper) {
    negativeXAxisHelper.material =
      createDirectionLabelSpriteMaterial(
        "#ff4466",
        "W",
        0.55
      );
  }

  if (negativeZAxisHelper) {
    negativeZAxisHelper.material =
      createDirectionLabelSpriteMaterial(
        "#4488ff",
        "N",
        0.55
      );
  }

  const viewHelperTimer = new THREE.Timer();

  renderer.autoClear = false;

  return {
    viewHelper,
    viewHelperTimer
  };
}
