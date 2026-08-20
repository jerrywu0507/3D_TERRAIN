# Data Sources and Acquisition Guide

This document explains where the terrain data used by this application comes from,
and how to obtain elevation data for a **different** Artemis III candidate landing
region, so students can choose a different descent/landing point and reproduce the
same pipeline.

## 1. Current Dataset

| Property | Value |
|---|---|
| Region | Nobile Rim 2 (Artemis III candidate landing region) |
| Source file | `Nobile_Rim2_MissionArea_10km_5m_v3.tif` |
| Resolution | 5 m / pixel |
| Coverage | approx. 10 km × 10 km |
| Map projection | Moon (2015) South Polar Stereographic |
| Reference sphere | 1737.4 km (adopted lunar radius) |
| Elevation datum | Referenced to the same 1737.4 km sphere (relative to LOLA geodetic reference) |

## 2. Source Dataset (NASA GSFC)

The underlying elevation data is from a NASA Goddard Space Flight Center (GSFC)
Planetary Geodesy Dynamics Archive (PGDA) product that enhances LOLA
(Lunar Orbiter Laser Altimeter) altimetry with LROC NAC (Lunar Reconnaissance
Orbiter Camera, Narrow Angle Camera) imagery using Shape-from-Shading, to produce
5 m/pixel elevation models for **all 13** of the 2022 Artemis III candidate
landing regions (which includes Nobile Rim 2).

- **Product page (NASA GSFC PGDA):**
  https://pgda.gsfc.nasa.gov/products/104
- **Data archive (Zenodo, DOI 10.5281/zenodo.17954508):**
  https://zenodo.org/records/17954508
- **Citation (required when using this data):**
  Bertone, S., McKenna, T. E., Barker, M. K., Mazarico, E., Beyer, R. A., and
  Petro, N., "Enhanced Topography Models for Selected Lunar South Pole Regions
  with Shape-from-Shading," *The Planetary Science Journal*
  (doi: 10.3847/PSJ/ae5b70).
- **Underlying baseline data:** LOLA polar stereographic DEM products, PGDA
  product page: https://pgda.gsfc.nasa.gov/products/90 — "A New View of the
  Lunar South Pole from the Lunar Orbiter Laser Altimeter (LOLA)," Barker et al.,
  2023, *The Planetary Science Journal* (doi: 10.3847/PSJ/acf3e1).

All 13 regions in this archive use the same map projection (Moon (2015) South
Polar Stereographic) and the same 5 m/pixel resolution, so any region can be
substituted into this project's pipeline without changing any coordinate-system
code.

### The 13 available regions

Amundsen Rim · **Nobile Rim 2** · Haworth · Faustini Rim A · deGerlache Rim 2 ·
Connecting Ridge Extension · Connecting Ridge · Nobile Rim 1 · deGerlache Rim ·
Peak Near Shackleton · Leibnitz Beta Plateau · Malapert Massif ·
deGerlache Kocher Massif

## 3. How to Get Data for a Different Landing Site

1. Go to the Zenodo archive: https://zenodo.org/records/17954508
2. Download the file for the desired region. Files follow the naming pattern
   `A3CLR22_[number]_[region_name].zip` (32-bit compressed GeoTIFF rasters).
3. Unzip the archive. It contains the elevation raster (GeoTIFF), plus
   ancillary products (hillshade, orthomosaic, coverage map, slope map,
   roughness map) that are not needed by this pipeline.
4. (Optional, for a smaller mission-area subset like the current 10 km × 10 km
   Nobile Rim 2 extent) Open the elevation raster in QGIS and use
   **Raster → Extraction → Clip Raster by Extent** to crop to the desired
   mission area. Keep the original South Polar Stereographic CRS — do not
   reproject.
5. Point `QGISDEM.py`'s `INPUT_DEM` at the resulting GeoTIFF and run it. The
   script (see `QGISDEM.py` in this repository) will:
   - Read the raster and its CRS/transform with `rasterio`
   - Fill any NoData/NaN cells using nearest-valid-elevation
     (`scipy.ndimage.distance_transform_edt`)
   - Export `public/heightmap_float32.bin` (raw little-endian float32 grid)
     and `public/heightmap_metadata.json` (width/height, pixel size,
     projected bounds, transform, and the CRS WKT)
6. Restart the app (`npm run dev`) — it reads those two files directly; no
   other code changes are required to display a different landing site.

## 4. Coordinate System Notes

The app's local X/Z scene coordinates are simply the DEM's projected
South-Polar-Stereographic X/Y coordinates (in metres) recentred on the
loaded terrain's bounding box (see `main.js`, `localToProjectedCoordinates` /
`projectedToLocalCoordinates`). Latitude/longitude are recovered from those
projected coordinates with the standard polar stereographic inverse formula
(see `forwardSouthPolarStereographic` / `inverseSouthPolarStereographic` in
`main.js`).

Because the projection's central meridian is fixed at 0°, the scene's local
+X/+Z axes only line up with true East/North exactly at longitude 0°. Away
from the central meridian, the "meridian convergence" angle (≈ region
longitude − central meridian) rotates true compass directions away from the
scene's grid axes — the on-screen direction gizmo now corrects for this (see
`TECHNICAL_OVERVIEW.md`, section on coordinate transforms).
