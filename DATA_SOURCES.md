# Data Sources and Acquisition Guide

This document explains where the terrain data used by this application comes from,
and how to obtain elevation data for a **different** lunar south pole landing site,
so students can choose a different descent/landing point and reproduce the same
pipeline.

## 1. Current Dataset

| Property | Value |
|---|---|
| Region | Nobile Rim 2 (Artemis III candidate landing region) |
| Site code in source archive | `DM2` |
| Local file name | `Nobile_Rim2_MissionArea_10km_5m_v3.tif` (a cropped ~10 km × 10 km subset of the full-site file, see section 3) |
| Resolution | 5 m / pixel |
| Coverage | approx. 10 km × 10 km |
| Map projection | South Polar Stereographic (metres) |
| Reference frame | MOON_ME (JPL DE421 ephemeris) |
| Reference sphere | 1737.4 km (adopted lunar radius) |

## 2. Source Dataset (NASA GSFC PGDA)

The elevation data is from a NASA Goddard Space Flight Center (GSFC) Planetary
Geodesy Dynamics Archive (PGDA) product built **exclusively from LOLA (Lunar
Orbiter Laser Altimeter) laser-altimetry data**, produced by iteratively
co-adjusting LOLA ground tracks against each other (reducing orbital errors by
more than a factor of 10) to reach ~10–20 cm horizontal and ~2–4 cm vertical
geolocation accuracy, then gridding the result to 5 m/pixel.

- **PI:** Michael Kenneth Barker
- **Product page (NASA GSFC PGDA):**
  https://pgda.gsfc.nasa.gov/products/78 — "High-Resolution LOLA Topography
  for Lunar South Pole Sites"
- **Data directory (per-site GeoTIFFs and ancillary files):**
  https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/
- **README (citation, file-naming convention, coordinate system):**
  https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/README
- **Required citation:**
  Barker, M. K., et al., 2021, "Improved LOLA Elevation Maps for South Pole
  Landing Sites: Error Estimates and Their Impact on Illumination
  Conditions," *Planetary and Space Science*, Vol. 203, 105119.
  DOI: [10.1016/j.pss.2020.105119](https://doi.org/10.1016/j.pss.2020.105119)
- **Site-naming reference:** site numbering follows Mazarico, E., et al.,
  2011, "Illumination Conditions of the Lunar Polar Regions Using LOLA
  Topography," *Journal of Geophysical Research: Planets*.

Every site in this archive uses the same map projection (South Polar
Stereographic, MOON_ME/DE421) and the same 5 m/pixel resolution, so any site
can be substituted into this project's pipeline without changing any
coordinate-system code.

### Available sites (code — name)

| Code | Site name | Code | Site name |
|---|---|---|---|
| Site01 | Connecting ridge | NPA | Cabeus exterior wall 1 |
| Site04 | Shackleton rim | NPB | Amundsen 1 |
| Site06 | Nobile rim 1 | NPC | Idel'son L crater 1 |
| Site07 | Peak near Shackleton | NPD | Malapert crater 1 |
| Site11 | de Gerlache rim | LM1 | Shackleton Rim B |
| Site20 | Leibnitz beta plateau | LM2 | Shoemaker Rim A |
| Site20v2 | Leibnitz beta plateau (extended) | LM3 | Shoemaker Rim B |
| Site23 | Malapert massif | LM4 | Shoemaker Rim C |
| Site42 | de Gerlache-Kocher massif | LM5 | Shoemaker Rim D |
| Haworth | Haworth | LM6 | Shoemaker Rim E |
| Shoemaker | Shoemaker | LM7 | Faustini Rim A |
| DM1 | Amundsen rim | LM8 | Shoemaker Rim F |
| **DM2** | **Nobile rim 2 (current dataset)** | SL2 | de Gerlache rim |
| SL3 | Connecting ridge extension | | |

This project's coverage area (Artemis III's official candidate landing
regions) is available under: Nobile Rim 1 (`Site06`), Nobile Rim 2 (`DM2`),
Peak Near Shackleton (`Site07`), de Gerlache Rim (`Site11` / `SL2`),
Connecting Ridge (`Site01`), Connecting Ridge Extension (`SL3`), Leibnitz
Beta Plateau (`Site20`/`Site20v2`), Malapert Massif (`Site23`), de
Gerlache-Kocher Massif (`Site42`), Faustini Rim A (`LM7`), Amundsen Rim
(`DM1`), Haworth, and Shackleton-/Shoemaker-rim variants (`LM1`–`LM8`).

## 3. How to Get Data for a Different Landing Site

1. Read the README first: https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/README
   — it has the authoritative file-naming convention and citation.
2. Go to the data directory: https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/
3. Under the desired site code's section (e.g. `DM2` for Nobile Rim 2),
   download the **`*_surf.tif`** file — this is "surface height Z (metres)
   with interpolation filling empty pixels," i.e. the elevation raster this
   project needs. (The other files per site — `*.xyzi` point cloud, `*_ldec.tif`
   return-count map, `*_toterr.tif` / `*_slperr.tif` uncertainty maps, `*_slp.tif`
   slope map, and the 100 numbered "clone" files for uncertainty analysis —
   are not needed by this pipeline.)
4. (Optional, to crop a smaller mission-area subset like the current
   ~10 km × 10 km Nobile Rim 2 extent) Open the raster in QGIS and use
   **Raster → Extraction → Clip Raster by Extent**. Keep the original South
   Polar Stereographic CRS — do not reproject.
5. Point `QGISDEM.py`'s `INPUT_DEM` at the resulting GeoTIFF and run it. The
   script (see `QGISDEM.py` in this repository) will:
   - Read the raster and its CRS/transform with `rasterio`
   - Fill any remaining NoData/NaN cells using nearest-valid-elevation
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

## 5. Verification Note

This source (PGDA product #78 / `LOLA_5mpp`, site code `DM2`) was confirmed
by matching the actual downloaded file name pattern
(`DM2_final_adj_5mpp_surf.tif`) against the README's file-naming convention
and site-code table, which explicitly maps `DM2` to "Nobile rim 2" — this is
a direct match, not an inference from specifications alone. If you re-download
to verify, compare pixel dimensions / bounding box against
`public/heightmap_metadata.json` in this repository.
