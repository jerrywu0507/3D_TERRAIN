import * as THREE from "three";

// ======================================================
// 坐標轉換（Coordinate Transforms）
// 見 TECHNICAL_OVERVIEW.md 第 4 節，這裡是實作。
// ======================================================

/**
 * 場景本地 X/Z（公里，以地形中心為原點）轉成 DEM 的南極立體投影
 * X/Y（公尺）。
 *
 * @param {number} localXKm
 * @param {number} localZKm
 * @param {{ west: number, east: number, south: number, north: number }}
 *   boundingBox - 地形的投影範圍（例如 `terrainMetadata`，只會讀取這
 *   四個欄位）。
 */
export function localToProjectedCoordinates(
  localXKm,
  localZKm,
  boundingBox
) {
  const west =
    Number(
      boundingBox.west
    );

  const east =
    Number(
      boundingBox.east
    );

  const south =
    Number(
      boundingBox.south
    );

  const north =
    Number(
      boundingBox.north
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

/**
 * `localToProjectedCoordinates` 的反函式：南極立體投影 X/Y（公尺）
 * 轉回場景本地 X/Z（公里）。
 *
 * @param {number} projectedX
 * @param {number} projectedY
 * @param {{ west: number, east: number, south: number, north: number }}
 *   boundingBox
 */
export function projectedToLocalCoordinates(
  projectedX,
  projectedY,
  boundingBox
) {
  const west =
    Number(
      boundingBox.west
    );

  const east =
    Number(
      boundingBox.east
    );

  const south =
    Number(
      boundingBox.south
    );

  const north =
    Number(
      boundingBox.north
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

/**
 * 經緯度（度）轉南極立體投影 X/Y（公尺）。標準 Moon (2015) South
 * Polar Stereographic 公式，見 TECHNICAL_OVERVIEW.md 第 4.2 節。
 */
export function forwardSouthPolarStereographic(
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

/**
 * `forwardSouthPolarStereographic` 的反函式：南極立體投影 X/Y
 * （公尺）轉回經緯度（度）。
 */
export function inverseSouthPolarStereographic(
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

/**
 * 把經度正規化到 (-180, 180] 範圍內。
 */
export function normalizeLongitude(
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
