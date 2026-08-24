# Technical Overview: Code and Logic

This document explains how the application turns a lunar DEM into the 3D terrain,
coordinate readouts, and rover-route safety analysis shown on screen — for anyone
reviewing the code (e.g., for a JPL/NASA collaboration) who needs to understand the
logic without reading all ~9,900 lines of source.

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

### 1.1 How the extracted modules communicate

The extracted modules do **not** import mutable state from `main.js`, since
ES modules cannot let one file freely reassign another file's exported `let`
binding. Instead, each module (`ui-core.js`, `markers.js`, `moon-overview.js`,
`view-gizmo.js`) exposes an `initX({ ... })` function that `main.js` calls
once at startup, passing in whatever the module needs — either a live
reference (e.g. the `THREE.Scene`), or a small getter function for state that
changes over time (e.g. `getCurrentLanguage: () => currentLanguage`). After
that one-time wiring, each module's other exports are pure functions or
factories that the module itself is free to call internally without needing
anything more from `main.js`.

Core application state — `waypoints`, `terrain`/`terrainMetadata`,
`routeSamples`, `currentLanguage`, and similar — still lives directly in
`main.js` as top-level mutable variables; it has not yet been extracted into
its own module. The larger, more state-coupled subsystems (DEM
loading/terrain building, route planning/analysis, terrain-click picking)
remain in `main.js` for this reason — splitting them safely requires first
deciding how that shared state should be centralised (e.g. a single
`appState` object with getter/setter access), which has been deferred rather
than attempted as part of a large, high-risk, untested refactor.

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
min/max/mean elevation statistics essentially unchanged. See section 7 for
how this validation was actually done.

**Threshold caveat:** `LOCAL_SPIKE_THRESHOLD_METERS` (8 m),
`PROMINENT_PEAK_SEARCH_RADIUS_PIXELS` (6 px), and
`PROMINENT_PEAK_THRESHOLD_METERS` (35 m) were hand-tuned and verified
specifically against the Nobile Rim 2 (`DM2`) raster's actual noise
characteristics. If a different landing site's data is loaded (see
`DATA_SOURCES.md`, section 6), these same constants are used, but they have
not been re-verified against that site's own noise profile — a site with
different terrain roughness or a different LOLA track-density pattern could
need different thresholds. Re-running the same kind of before/after
inspection described in section 7 is recommended when switching sites.

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
`main.js:4394`/`4439`), parameterised by the adopted lunar sphere radius
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
- `analyzeRoute()` (`main.js:5179`) computes, per sample, the **segment**
  slope — `atan2(elevationDifference, thatSegment'sOwnHorizontalDistance)` —
  along with cumulative ascent/descent, horizontal and surface-path distance,
  and the location of maximum slope/ascent/descent/sudden elevation change.
  (An earlier version of this function divided by the *cumulative* distance
  from the route start instead of each segment's own distance, which made
  slope readings shrink toward 0° as the route got longer; this has been
  fixed and re-verified.)
- `classifySlope()` (`main.js:4580`) buckets slope into Safe (≤10°) /
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

## 7. Validation Methodology

There is no automated test suite (section 1), so each logic change described
above was checked directly against the real Nobile Rim 2 data before being
adopted, not just reasoned about in the abstract:

- **DEM cleaning (section 3):** a standalone Node.js script read the actual
  `public/heightmap_float32.bin`, ran the exact same detection logic proposed
  for `main.js`, and printed the specific pixels it would flag along with
  their surrounding value grid, so each candidate fix could be visually
  sanity-checked against real terrain before being written into the app.
  This is how the multi-pass spike removal and the prominent-peak detector's
  parameters (search radius, prominence threshold) were chosen — by checking,
  for the actual dataset, how many pixels each candidate threshold flagged
  and whether known-legitimate terrain (e.g. broad crater rims) was ever
  caught by mistake.
- **Meridian convergence correction (section 4.3):** the true geographic
  north/east bearings at the terrain's centre point were computed directly
  from the app's own coordinate-transform formulas (stepping one small
  distance due north and due east in lat/lon, then projecting that back into
  local scene coordinates), then compared numerically against the scene's
  raw +X/+Z axes to derive and verify the convergence angle and the sign of
  the correction rotation — rather than assuming the correction direction
  from first principles alone.
- **Route slope fix (section 5):** the corrected segment-slope formula was
  re-derived and cross-checked against sample route data before being
  shipped.
- **UI/rendering changes** (panel layout, gizmo label sizing, marker scale,
  etc.) were verified by running a production build (`npm run build`) after
  each change to catch integration errors, since there is currently no way
  to capture and inspect the live rendered page from outside a browser in
  this environment — such changes rely on manual visual confirmation in the
  browser rather than automated screenshot testing.

## 8. Tech Stack and Deployment

- **Rendering:** [three.js](https://threejs.org/) (WebGL), including the
  `OrbitControls` and `ViewHelper` addons.
- **Build tool:** [Vite](https://vitejs.dev/); `npm run dev` for local
  development, `npm run build` produces a static `dist/` bundle.
- **Runtime:** pure client-side static site — no backend server, no
  database, no build-time or runtime API keys. The only server-side
  component is the offline `QGISDEM.py` pre-processing script (Python,
  `rasterio` + `scipy` + `numpy`), which is run once per landing site to
  produce the two static data files the app fetches at runtime.
- **Browser requirements:** any modern browser with WebGL support (the app
  targets desktop Chromium/Firefox; it has not been specifically tuned for
  mobile/touch input).
- **Deployment:** since it is a static site, `dist/` can be hosted from any
  static file host (e.g. GitHub Pages, S3, a plain web server) as long as
  `public/heightmap_float32.bin` and `public/heightmap_metadata.json` are
  served alongside it.
