// ======================================================
// 共用工具函式（Shared Utility Functions）
// ======================================================

export function formatKm(
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

// 緯度／經度的顯示格式：數值取絕對值，方向由半球標示表達
// （例如 84.053178° 南緯 (S)），避免「-84° S」這種負號與方位重複的寫法。
// 座標搜尋輸入框仍收 -90～90 與 -180～180 的帶號值，南緯、西經要輸入負數。
// 括號寫法會被 wrapBilingualText() 拆成中英雙語。
export function formatLatitudeWithHemisphere(
  latitudeDegrees,
  digits = 6
) {
  if (
    !Number.isFinite(latitudeDegrees)
  ) {
    return "—";
  }

  const hemisphere =
    latitudeDegrees >= 0
      ? "北緯 (N)"
      : "南緯 (S)";

  return `${Math.abs(latitudeDegrees).toFixed(digits)}° ${hemisphere}`;
}

export function formatLongitudeWithHemisphere(
  longitudeDegrees,
  digits = 6
) {
  if (
    !Number.isFinite(longitudeDegrees)
  ) {
    return "—";
  }

  const hemisphere =
    longitudeDegrees >= 0
      ? "東經 (E)"
      : "西經 (W)";

  return `${Math.abs(longitudeDegrees).toFixed(digits)}° ${hemisphere}`;
}

export function formatSignedNumber(
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

export function isValidElevation(value) {
  return (
    Number.isFinite(value) &&
    Math.abs(value) <
    1_000_000
  );
}

export function escapeHtml(value) {
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
