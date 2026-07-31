from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import rasterio
from scipy.ndimage import distance_transform_edt


# ======================================================
# 1. 檔案設定 (File Settings)
# ======================================================

# 輸入 DEM
# 修改成你的實際 GeoTIFF 路徑
INPUT_DEM = Path(
    r"D:\ArtemisIII_Shackleton_DEM.tif\Nobile_Rim2_MissionArea_10km_5m_v3.tif"
)

# 輸出到 Vite 專案 public 資料夾
PROJECT_ROOT = Path(__file__).resolve().parent
OUTPUT_DIRECTORY = PROJECT_ROOT / "public"

OUTPUT_BINARY = OUTPUT_DIRECTORY / "heightmap_float32.bin"
OUTPUT_METADATA = OUTPUT_DIRECTORY / "heightmap_metadata.json"

# 月球平均半徑，單位公尺
# Lunar Mean Radius in Metres
MOON_RADIUS_METERS = 1_737_400.0


# ======================================================
# 2. 檢查輸入檔案 (Validate Input File)
# ======================================================

if not INPUT_DEM.exists():
    raise FileNotFoundError(
        f"找不到輸入 DEM：\n{INPUT_DEM}\n\n"
        "請確認 INPUT_DEM 路徑是否正確。"
    )

OUTPUT_DIRECTORY.mkdir(
    parents=True,
    exist_ok=True
)


# ======================================================
# 3. 讀取 GeoTIFF (Read GeoTIFF)
# ======================================================

with rasterio.open(INPUT_DEM) as dataset:
    dem = dataset.read(
        1,
        masked=True
    ).astype(np.float64)

    source_width = dataset.width
    source_height = dataset.height

    transform = dataset.transform
    bounds = dataset.bounds
    crs = dataset.crs
    nodata_value = dataset.nodata

    pixel_size_x_meters = abs(
        float(transform.a)
    )

    pixel_size_y_meters = abs(
        float(transform.e)
    )

    crs_wkt = (
        crs.to_wkt()
        if crs is not None
        else ""
    )


# ======================================================
# 4. 轉成一般 NumPy 陣列 (Convert to NumPy Array)
# ======================================================

# Masked 值先轉成 NaN
# Convert Masked Values to NaN
if np.ma.isMaskedArray(dem):
    dem = dem.filled(np.nan)

dem = np.asarray(
    dem,
    dtype=np.float64
)

# 將無限值轉為 NaN
# Convert Infinite Values to NaN
dem[~np.isfinite(dem)] = np.nan


# ======================================================
# 5. 處理 NoData / NaN
#    Fill Invalid Elevation Cells
# ======================================================

invalid_mask = ~np.isfinite(dem)
invalid_count = int(
    np.count_nonzero(invalid_mask)
)

valid_count = int(
    dem.size - invalid_count
)

if valid_count == 0:
    raise ValueError(
        "DEM 中沒有任何有效高程資料。"
    )

if invalid_count > 0:
    print(
        f"偵測到 {invalid_count:,} 個 "
        "NoData / NaN 像素。"
    )

    print(
        "正在使用最近有效高程補值，"
        "避免產生 0 m 平台與垂直斷崖..."
    )

    # 對每個無效像素尋找最近的有效像素
    # Find Nearest Valid Pixel for Every Invalid Pixel
    nearest_indices = distance_transform_edt(
        invalid_mask,
        return_distances=False,
        return_indices=True
    )

    dem = dem[
        tuple(nearest_indices)
    ]


# ======================================================
# 6. 驗證處理結果 (Validate Processed DEM)
# ======================================================

if not np.all(np.isfinite(dem)):
    raise ValueError(
        "補值後 DEM 仍包含 NaN 或 Infinity。"
    )

# 不進行 844 × 844 重採樣
# Preserve Original 2000 × 2000 Resolution
output_width = source_width
output_height = source_height

min_height_meters = float(
    np.min(dem)
)

max_height_meters = float(
    np.max(dem)
)

mean_height_meters = float(
    np.mean(dem)
)

standard_deviation_meters = float(
    np.std(dem)
)


# ======================================================
# 7. 輸出 Float32 Binary
#    Export Float32 Binary
# ======================================================

# 使用 little-endian Float32
# Use Little-Endian Float32
dem_float32 = np.asarray(
    dem,
    dtype="<f4"
)

expected_value_count = (
    output_width *
    output_height
)

if dem_float32.size != expected_value_count:
    raise ValueError(
        "輸出資料數量不正確："
        f"預期 {expected_value_count:,}，"
        f"實際 {dem_float32.size:,}"
    )

dem_float32.tofile(
    OUTPUT_BINARY
)


# ======================================================
# 8. 建立 Metadata JSON
#    Create Metadata JSON
# ======================================================

metadata = {
    "width": output_width,
    "height": output_height,

    "originalWidth": source_width,
    "originalHeight": source_height,

    "minHeightMeters": min_height_meters,
    "maxHeightMeters": max_height_meters,
    "meanHeightMeters": mean_height_meters,
    "standardDeviationMeters": standard_deviation_meters,

    "pixelSizeXMeters": pixel_size_x_meters,
    "pixelSizeYMeters": pixel_size_y_meters,

    "west": float(bounds.left),
    "east": float(bounds.right),
    "south": float(bounds.bottom),
    "north": float(bounds.top),

    "terrainWidthMeters": float(
        bounds.right -
        bounds.left
    ),

    "terrainHeightMeters": float(
        bounds.top -
        bounds.bottom
    ),

    "moonRadiusMeters": MOON_RADIUS_METERS,

    "crsWkt": crs_wkt,

    "transform": {
        "a": float(transform.a),
        "b": float(transform.b),
        "c": float(transform.c),
        "d": float(transform.d),
        "e": float(transform.e),
        "f": float(transform.f)
    },

    "dataType": "float32",
    "byteOrder": "little-endian",

    "sourceFile": INPUT_DEM.name,

    # 保留原始 DEM，不做插值重採樣
    "resampling": "none",

    "sourceNoDataValue": (
        float(nodata_value)
        if nodata_value is not None
        and np.isfinite(nodata_value)
        else None
    ),

    "invalidPixelsFilled": invalid_count,

    "invalidPixelFillMethod":
        "nearest-valid-elevation"
}

with OUTPUT_METADATA.open(
    "w",
    encoding="utf-8"
) as metadata_file:
    json.dump(
        metadata,
        metadata_file,
        ensure_ascii=False,
        indent=2
    )


# ======================================================
# 9. 輸出檢查資訊 (Print Output Summary)
# ======================================================

binary_size_bytes = (
    OUTPUT_BINARY.stat().st_size
)

expected_binary_size_bytes = (
    output_width *
    output_height *
    4
)

print()
print("=" * 60)
print("DEM 轉換完成 (DEM Conversion Completed)")
print("=" * 60)

print(
    f"輸入檔案：{INPUT_DEM}"
)

print(
    f"輸出尺寸："
    f"{output_width} × {output_height}"
)

print(
    f"像素尺寸："
    f"{pixel_size_x_meters:.6f} × "
    f"{pixel_size_y_meters:.6f} m"
)

print(
    f"地形範圍："
    f"{bounds.right - bounds.left:.3f} × "
    f"{bounds.top - bounds.bottom:.3f} m"
)

print(
    f"最低高程："
    f"{min_height_meters:.3f} m"
)

print(
    f"最高高程："
    f"{max_height_meters:.3f} m"
)

print(
    f"平均高程："
    f"{mean_height_meters:.3f} m"
)

print(
    f"填補無效像素："
    f"{invalid_count:,}"
)

print(
    f"Binary 實際大小："
    f"{binary_size_bytes:,} bytes"
)

print(
    f"Binary 預期大小："
    f"{expected_binary_size_bytes:,} bytes"
)

print(
    f"Float32 Binary："
    f"{OUTPUT_BINARY}"
)

print(
    f"Metadata JSON："
    f"{OUTPUT_METADATA}"
)

if (
    binary_size_bytes !=
    expected_binary_size_bytes
):
    raise ValueError(
        "Binary 檔案大小與預期不一致。"
    )

print()
print(
    "資料數量與 Binary 大小檢查通過。"
)