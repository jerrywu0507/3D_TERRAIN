# Data Sources and Acquisition Guide

This document explains where the terrain data used by this application comes from,
and how to obtain elevation data for a **different** lunar south pole landing site,
so students can choose a different descent/landing point and reproduce the same
pipeline.

*Last verified: 2026-08-25 — all URLs, citations, and site-code mappings below
were checked against the live NASA GSFC PGDA pages on this date. If a link is
broken or a citation looks outdated, re-verify against the README linked in
section 2 before relying on it.*

**Contents**

1. [Current Dataset](#1-current-dataset)
2. [Source Dataset (NASA GSFC PGDA)](#2-source-dataset-nasa-gsfc-pgda)
3. [Data Quality and Limitations](#3-data-quality-and-limitations)
4. [License and Usage Rights](#4-license-and-usage-rights)
5. [Related / Alternative Datasets](#5-related--alternative-datasets)
6. [How to Get Data for a Different Landing Site](#6-how-to-get-data-for-a-different-landing-site)
7. [Coordinate System Notes](#7-coordinate-system-notes)
8. [Verification Note](#8-verification-note)

## 1. Current Dataset

| Property | Value |
|---|---|
| Region | Nobile Rim 2 (Artemis III candidate landing region) |
| Site code in source archive | `DM2` |
| Local file name | `Nobile_Rim2_MissionArea_10km_5m_v3.tif` (a cropped ~10 km × 10 km subset of the full-site file, see section 6) |
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

## 3. Data Quality and Limitations

This is real measured topography, not a synthetic or fully-interpolated
surface — but it is important to understand how much of it is direct
measurement versus interpolation before treating fine detail as reliable:

- **LOLA ground-track spacing is sparse near a 5 m grid.** Per the PGDA
  product description, **approximately 90% of pixels in the 5 m/pixel grid
  require interpolation** between actual LOLA laser shots, because LOLA's
  cross-track spacing is coarser than 5 m almost everywhere except very close
  to the pole. Only a minority of pixels are directly measured returns —
  the rest are filled in by the co-adjustment/gridding process. Small,
  isolated features narrower than the local LOLA track spacing may be
  smoothed out or represent interpolation, not necessarily a real feature at
  that exact location.
- **Per-pixel uncertainty is quantified and available**, but not currently
  used by this application:
  - `*_toterr.tif` — total vertical (Z) uncertainty per pixel, in metres
  - `*_slperr.tif` — slope uncertainty per pixel, in degrees
  - `*_ldec.tif` — number of actual LOLA returns per pixel (a direct proxy
    for how "real" vs. "interpolated" a given pixel is)
  - 100 numbered statistical "clone" rasters per site, generated to let users
    propagate elevation uncertainty (including its fractal/spatially-correlated
    structure) through downstream analysis (e.g., Monte Carlo route-safety
    analysis) rather than treating each pixel's error as independent
- **Practical implication for route planning:** the current rover-route
  safety classification (see `TECHNICAL_OVERVIEW.md`, section 5) uses slope
  computed from the elevation grid alone, with no uncertainty margin. A
  documented, worthwhile future improvement is to pull in `*_toterr.tif` /
  `*_slperr.tif` (or the clone rasters) so a route can be flagged as "unsafe"
  or "needs review" specifically where the underlying elevation itself is
  poorly constrained, not only where the interpolated slope is steep.
- **Interpolated NoData cells get filled twice, independently:** the source
  GeoTIFF already fills most gaps as part of the LOLA gridding process
  described above; on top of that, `QGISDEM.py` independently fills any
  remaining NoData/NaN cells in the exported subset using nearest-valid-elevation.
  Both fills are visible in the app's DEM Status panel (invalid pixel counts).

## 4. License and Usage Rights

This data originates from NASA (a U.S. Government agency); NASA-produced data
and PGDA data products are generally distributed for unrestricted public use.
As with any NASA data product, **cite the source paper (section 2) and NASA
GSFC/PGDA as the data provider** in any publication, presentation, or
downstream product (including this project and any student competition
submissions). This project does not modify the underlying elevation values
beyond gap-filling and format conversion (see `QGISDEM.py`); it does not
redistribute the raw NASA GeoTIFF itself, only the small derived
mission-area subset needed for the web viewer.

## 5. Related / Alternative Datasets

For future work needing finer local detail than pure LOLA altimetry can
provide (e.g., boulders, small crater rims, or other features narrower than
LOLA's track spacing), NASA GSFC PGDA also publishes a complementary product
that enhances the same underlying LOLA data with LROC NAC (Narrow Angle
Camera) imagery via Shape-from-Shading, covering the 2022 Artemis III
candidate landing regions (Nobile Rim 2 included) at the same 5 m/pixel grid
spacing:

- **Product page:** https://pgda.gsfc.nasa.gov/products/104 — "Enhanced
  Topography Models for Selected Lunar South Pole Regions with
  Shape-from-Shading"
- **Data archive (Zenodo):** https://zenodo.org/records/17954508 (DOI
  10.5281/zenodo.17954508)
- **Citation:** Bertone, S., McKenna, T. E., Barker, M. K., Mazarico, E.,
  Beyer, R. A., and Petro, N., "Enhanced Topography Models for Selected
  Lunar South Pole Regions with Shape-from-Shading," *The Planetary Science
  Journal* (DOI: 10.3847/PSJ/ae5b70)

This is a separate, independently citable product from the one actually used
by this project (section 2) — do not cite it as this project's data source,
but it is worth knowing about since Shape-from-Shading can resolve
finer-scale slopes and small features that pure laser-altimetry interpolation
smooths over, at the cost of being a derived/model-dependent product rather
than direct altimetry.

## 6. How to Get Data for a Different Landing Site

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

**Expect a large download.** File sizes are not listed on the PGDA pages, but
they can be estimated: an uncompressed 5 m/pixel float32 GeoTIFF needs
`(width_km × 1000 / 5) × (height_km × 1000 / 5) × 4` bytes. For reference,
this project's own cropped ~10 km × 10 km Nobile Rim 2 subset
(`heightmap_float32.bin`) is 2000×2000 pixels ≈ **16 MB** uncompressed. A
full site's `*_surf.tif` covers a larger extent than this 10 km subset (see
step 4), so expect a noticeably bigger download — check the reported file
size before downloading if you are on a limited connection, and budget disk
space accordingly if fetching several sites for comparison.

## 7. Coordinate System Notes

The app's local X/Z scene coordinates are simply the DEM's projected
South-Polar-Stereographic X/Y coordinates (in metres) recentred on the
loaded terrain's bounding box (see `src/coordinate-transforms.js`,
`localToProjectedCoordinates` / `projectedToLocalCoordinates`).
Latitude/longitude are recovered from those projected coordinates with the
standard polar stereographic inverse formula (see
`forwardSouthPolarStereographic` / `inverseSouthPolarStereographic`, same
file).

Because the projection's central meridian is fixed at 0°, the scene's local
+X/+Z axes only line up with true East/North exactly at longitude 0°. Away
from the central meridian, the "meridian convergence" angle (≈ region
longitude − central meridian) rotates true compass directions away from the
scene's grid axes. The on-screen direction gizmo and the in-scene axis
helper (`A` key) no longer show local compass directions at all — they show
the Moon's global body-fixed reference frame, **MOON_ME** (Z = mean
rotational pole, X = toward the prime meridian, Y completes a right-handed
system), rotated to indicate where each global axis actually points from
the terrain's location. See `TECHNICAL_OVERVIEW.md`, section 4.3, for the
exact derivation.

**Vertical scale:** the app renders elevation with `VERTICAL_EXAGGERATION = 1`
in `main.js` — i.e. **no vertical exaggeration**. Horizontal and vertical axes
use the same real-world scale (metres = metres), so slopes and relief shown
in the 3D view represent true, physical steepness, not an exaggerated
"dramatic terrain" rendering. This matters for anyone assessing slope safety
visually rather than from the numeric slope readout.

## 8. Verification Note

This source (PGDA product #78 / `LOLA_5mpp`, site code `DM2`) was confirmed
by matching the actual downloaded file name pattern
(`DM2_final_adj_5mpp_surf.tif`) against the README's file-naming convention
and site-code table, which explicitly maps `DM2` to "Nobile rim 2" — this is
a direct match, not an inference from specifications alone. If you re-download
to verify, compare pixel dimensions / bounding box against
`public/heightmap_metadata.json` in this repository.
