import { isValidElevation } from "./utils.js";

// ======================================================
// DEM 高程資料清理（DEM Cleaning）
// 見 TECHNICAL_OVERVIEW.md 第 3 節，這裡是實作。
// ======================================================

const LOCAL_SPIKE_THRESHOLD_METERS = 8;
const MIN_VALID_NEIGHBOURS = 5;
const MAX_SPIKE_CLEANUP_PASSES = 4;

const PROMINENT_PEAK_SEARCH_RADIUS_PIXELS = 6;
const PROMINENT_PEAK_THRESHOLD_METERS = 35;

const KNOWN_NODATA_VALUES = [
  -9999,
  -32768,
  32767,
  -3.4028235e38,
  3.4028235e38
];

function isRawDemValueValid(value, noDataValue) {
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
    const knownNoDataValue of
    KNOWN_NODATA_VALUES
  ) {
    const tolerance =
      Math.max(
        0.001,
        Math.abs(
          knownNoDataValue
        ) *
        1e-6
      );

    if (
      Math.abs(
        value -
        knownNoDataValue
      ) <= tolerance
    ) {
      return false;
    }
  }

  if (
    Number.isFinite(
      noDataValue
    ) &&
    Math.abs(
      value -
      noDataValue
    ) <
    0.001
  ) {
    return false;
  }

  return true;
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

export function calculateValidElevationRange(
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

/**
 * 清理原始 DEM 高程資料：修補無效值、去除單點／小群集雜訊尖峰、
 * 填平孤立突起（見 TECHNICAL_OVERVIEW.md 第 3 節的完整說明）。
 *
 * @param {Float32Array} source - 原始高程資料（row-major）。
 * @param {number} width - 每列像素數。
 * @param {number} height - 列數。
 * @param {number} [noDataValue] - 這份 DEM metadata 記載的 NoData 值
 *   （例如 GeoTIFF 的 nodata 欄位），用來輔助判斷無效像素；沒有的話
 *   傳 undefined 即可，仍會用內建的常見 NoData 值清單判斷。
 * @returns {{ cleaned: Float32Array, statistics: object }} 清理後的
 *   高程資料，以及清理過程的統計數字（給 DEM Status 面板顯示用）。
 */
export function cleanDemElevations(
  source,
  width,
  height,
  noDataValue
) {
  const statistics = {
    invalidValues: 0,
    repairedInvalidValues: 0,
    spikeValues: 0,
    prominentPeaksFilled: 0,
    remainingInvalidValues: 0
  };

  const firstPass =
    new Float32Array(
      source.length
    );

  for (
    let index = 0;
    index < source.length;
    index += 1
  ) {
    const value =
      source[index];

    if (
      isRawDemValueValid(value, noDataValue)
    ) {
      firstPass[index] = value;
    } else {
      firstPass[index] = NaN;

      statistics
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

        statistics
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

          statistics
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
    statistics
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
      statistics
        .remainingInvalidValues += 1;
    }
  }

  return {
    cleaned,
    statistics
  };
}
