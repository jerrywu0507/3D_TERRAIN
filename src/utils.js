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
