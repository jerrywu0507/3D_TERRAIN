# Technical Overview: Code and Logic

This document explains how the application turns a lunar DEM into the 3D terrain,
coordinate readouts, and rover-route safety analysis shown on screen — for anyone
reviewing the code (e.g., for a JPL/NASA collaboration) who needs to understand the
logic without reading all ~9,800 lines of source.

## 1. Project Structure

```
src/
  main.js             Application entry point: scene/camera/renderer setup,
                       DEM loading and cleaning, coordinate transforms, terrain
                       picking, route planning/analysis, animation loop
  loading-overlay.js   Full-screen "Loading Map" overlay with live download %
  view-gizmo.js        3D direction indicator (compass gizmo), see section 4
  ui-core.js           Shared panel UI (draggable/resizable panels, bilingual
                       text helpers, language toggle, interface scaling)
  moon-overview.js     Small globe inset showing the mission area's location
                       on the full Moon; renders on-demand, not every frame
  markers.js           Reusable 3D marker geometry (sphere markers, flag
                       markers) shared by waypoints and the named point
  utils.js             Small formatting helpers (formatKm, escapeHtml, ...)
QGISDEM.py             Offline pre-processing script: GeoTIFF -> the two
                       files the web app actually loads (see section 2)
```

The app was originally a single ~9,250-line `main.js`; it is being split into
the modules above incrementally, verified with a production build after each
extraction, since there is no automated test suite.

## 2. Data Pipeline (source GeoTIFF -> browser)

`QGISDEM.py` runs once, offline, per landing site (see `DATA_SOURCES.md` for
where to get the source GeoTIFF). It reads the DEM with `rasterio`, fills any
NoData/NaN cells with the nearest valid elevation, and writes two files into
`public/`:

- **`heightmap_float32.bin`** — the raw elevation grid as little-endian
  float32, no header, row-major.
- **`heightmap_metadata.json`** — width/height, pixel size in metres, the
  projected bounding box (`west`/`east`/`south`/`north`), the raster's affine
  transform, the lunar reference radius, and the CRS as WKT.

At runtime, `main.js`'s `loadTerrainData()` fetches both files (streaming the
binary with progress reporting for the loading overlay), then
`createTerrain()` builds a `THREE.PlaneGeometry`, sets each vertex's height
from the DEM, and rotates it so elevation maps to world **Y**.

## 3. DEM Cleaning (`cleanDemElevations`, `main.js:1725`)

Real DEM rasters, especially near the lunar south pole (permanently-shadowed,
photogrammetrically difficult terrain), contain isolated bad pixels. Cleaning
runs in three stages, each tracked in `demCleaningStatistics` and shown in the
DEM Status panel:

1. **Invalid-value repair** — NoData/NaN cells are filled from the median of
   their valid neighbours.
2. **Iterative single/small-cluster spike removal** — for each pixel, compare
   it to the median of its immediate 8 neighbours; if the difference exceeds
   `LOCAL_SPIKE_THRESHOLD_METERS` (8 m), replace it with that median. This
   runs for up to `MAX_SPIKE_CLEANUP_PASSES` (4) passes, stopping early once a
   pass corrects nothing — a 2–3 pixel noise cluster needs more than one pass,
   because each pixel's immediate neighbours partially include the *other*
   noisy pixels in the same cluster, which keeps the local median artificially
   high on the first pass.
3. **Prominent isolated-peak fill** (`findProminentPeaks` /
   `fillPeakFootprint`, `main.js:1958`/`2065`) — some artifacts are smooth,
   radially-symmetric "cones" a few pixels wide that step (2) cannot catch,
   because neighbours *inside* the cone are mutually consistent with each
   other. This stage finds any pixel that is a strict local maximum within an
   11×11-pixel (`PROMINENT_PEAK_SEARCH_RADIUS_PIXELS` = 6, i.e. ±30 m) window
   *and* rises more than `PROMINENT_PEAK_THRESHOLD_METERS` (35 m) above that
   window's edge — a slope/height combination implausible for regolith-covered
   terrain (angle of repose tops out around 35–40°) — and replaces the whole
   disk-shaped footprint with an inverse-distance-weighted interpolation from
   the disk's boundary ring, producing a smooth, physically plausible surface
   instead of a spike.

This was validated against the actual Nobile Rim 2 raster (not just
synthetic data) before being adopted: it corrects on the order of 30–150
pixels out of 4,000,000 (well under 0.01% of the grid), leaving the overall
min/max/mean elevation statistics essentially unchanged.

## 4. Coordinate Transforms

### 4.1 Projected <-> local scene coordinates

The DEM's projected South Polar Stereographic X/Y (metres) is simply
recentred on the loaded terrain's bounding box to get the scene's local
X/Z (km): `localToProjectedCoordinates` / `projectedToLocalCoordinates`.
Elevation maps directly to world Y (with `VERTICAL_EXAGGERATION`, currently
1 — no exaggeration).

### 4.2 Projected <-> geographic (lat/lon)

Standard polar stereographic forward/inverse formulas
(`forwardSouthPolarStereographic` / `inverseSouthPolarStereographic`,
`main.js:4379`/`4424`), parameterised by the adopted lunar sphere radius
(1737.4 km) and the projection's central meridian (`CENTRAL_MERIDIAN_DEGREES`
= 0°). These match the Moon (2015) South Polar Stereographic definition used
by the source dataset.

### 4.3 Meridian convergence (direction-gizmo correction)

The scene's local +X/+Z axes only line up with true East/South at longitude
0° (the central meridian). Away from it, true compass directions are rotated
relative to the grid by the **convergence angle** = region longitude −
central meridian — a standard property of polar stereographic projections. For
Nobile Rim 2 (≈58.24°E) this is a ≈58° offset, verified numerically by
projecting a point one step due-geographic-north/east and comparing it to the
scene's raw +X/+Z axes.

`view-gizmo.js`'s `setViewGizmoCompassCorrection(viewHelper,
convergenceAngleDegrees)` (`view-gizmo.js:209`) applies this correction. The
underlying `ViewHelper` (three.js addon) overwrites its own world rotation
from the camera every frame, so the correction cannot be applied to the
gizmo object itself — instead, its axis-arm and label children are regrouped
into a rotatable sub-group once, and that sub-group's Y rotation is set to
`-convergenceAngle` (sign verified numerically against the measured true
bearings). `main.js` calls this once the terrain's centre longitude is known
(inside `updateStatusPanel()`).

## 5. Route Planning and Slope-Safety Analysis

- Users click the terrain to add waypoints (`waypoints` array); the route is
  sampled at `ROUTE_SAMPLE_INTERVAL_METERS` (5 m) intervals with DEM
  bilinear interpolation for elevation.
- `analyzeRoute()` (`main.js:5162`) computes, per sample, the **segment**
  slope — `atan2(elevationDifference, thatSegment'sOwnHorizontalDistance)` —
  along with cumulative ascent/descent, horizontal and surface-path distance,
  and the location of maximum slope/ascent/descent/sudden elevation change.
  (An earlier version of this function divided by the *cumulative* distance
  from the route start instead of each segment's own distance, which made
  slope readings shrink toward 0° as the route got longer; this has been
  fixed and re-verified.)
- `classifySlope()` (`main.js:4565`) buckets slope into Safe (≤10°) /
  Warning (>10° and ≤15°) / Unsafe (>15°) — a **terrain-slope-only**
  preliminary classification. It does not yet account for rocks, small
  craters, cross-slope, rover geometry/centre of gravity, soil conditions,
  energy budget, illumination, or Earth-communication visibility (see
  the Progress Report's "Future Features" section for the full list).
- The 3D route line can optionally colour each segment by this slope
  classification (a per-segment `THREE.TubeGeometry`/`MeshBasicMaterial`),
  toggled from the Cross Section panel; by default it renders as a single
  flat colour.

## 6. On-Screen Data Attribution

The DEM Status panel now cites the source dataset (region name, NASA GSFC
PGDA product, DOI, and citation) directly in the running app — see
`DATA_SOURCES.md` for the full reference list.
