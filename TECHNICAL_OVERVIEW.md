# Technical Overview: Code and Logic

This document explains how the application turns a lunar DEM into the 3D terrain,
coordinate readouts, and rover-route safety analysis shown on screen — for anyone
reviewing the code (e.g., for a JPL/NASA collaboration) who needs to understand the
logic without reading all ~10,200 lines of source.

*Last verified: 2026-08-26 — all file/line references below were checked
against the current state of the repository on this date. If the code has
changed since, re-check line numbers with e.g. `grep -n "function name"
src/main.js` before citing them elsewhere.*

**Contents**

1. [Project Structure](#1-project-structure)
2. [Data Pipeline (source GeoTIFF -> browser)](#2-data-pipeline-source-geotiff---browser)
3. [DEM Cleaning](#3-dem-cleaning-cleandemelevations-mainjs1725)
4. [Coordinate Transforms](#4-coordinate-transforms)
5. [Route Planning and Slope-Safety Analysis](#5-route-planning-and-slope-safety-analysis)
6. [On-Screen Data Attribution](#6-on-screen-data-attribution)
7. [Validation Methodology](#7-validation-methodology)
8. [Tech Stack and Deployment](#8-tech-stack-and-deployment)
9. [Error Handling and Failure Modes](#9-error-handling-and-failure-modes)
10. [Known Limitations and Future Work](#10-known-limitations-and-future-work)

## 1. Project Structure

```
src/
  main.js             Application entry point: scene/camera/renderer setup,
                       DEM loading and cleaning, coordinate transforms, terrain
                       picking, route planning/analysis, animation loop
  loading-overlay.js   Full-screen "Loading Map" overlay with live download %
  view-gizmo.js        3D orientation gizmo + in-scene axis helper, both
                       showing the global MOON_ME frame, see section 4
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

## 3. DEM Cleaning (`cleanDemElevations`, `main.js:1777`)

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
   `fillPeakFootprint`, `main.js:2010`/`2117`) — some artifacts are smooth,
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
`main.js:4459`/`4504`), parameterised by the adopted lunar sphere radius
(1737.4 km) and the projection's central meridian (`CENTRAL_MERIDIAN_DEGREES`
= 0°). These match the Moon (2015) South Polar Stereographic definition used
by the source dataset.

### 4.3 Local scene axes vs. the global MOON_ME frame

The scene's local X/Y/Z (East/Up/South) are **not** the same axes as the
Moon's global body-fixed reference frame, **MOON_ME** (Mean Earth/Polar
Axis — the frame this dataset's coordinates are ultimately defined in; see
`DATA_SOURCES.md`). MOON_ME is defined the same way Earth's ECEF frame is:

- **+Z** = the Moon's mean rotational pole (mean north pole direction)
- **+X** = toward the mean-Earth direction / prime meridian (0° longitude),
  in the equatorial plane
- **+Y** = completes a right-handed system (`Y = Z × X`)

Both the on-screen direction gizmo and the in-scene axis helper (section
below) display these **global MOON_ME directions**, not local compass
directions — an earlier version of this project labeled the gizmo E/S/W/N
+ Zenith (local compass directions, valid only exactly at the central
meridian, requiring a "meridian convergence" correction elsewhere); it was
replaced with the global-frame display below at the user's request.

At the terrain's centre (≈84.05°S, 58.24°E), the relationship between the
scene's local East/North/Up and the global MOON_ME X/Y/Z is computed with
the standard topocentric-frame formula (same construction as Earth's
ECEF<->ENU transform), parameterised by latitude `φ` and longitude `λ`:

```
East  = (-sin(λ),          cos(λ),          0)
North = (-sin(φ)*cos(λ),  -sin(φ)*sin(λ),   cos(φ))
Up    = ( cos(φ)*cos(λ),   cos(φ)*sin(λ),   sin(φ))
```

(all expressed as components in the global MOON_ME frame; South = -North is
the scene's local Z axis). At this latitude, local Up is only ≈5.95°
(co-latitude) from the global -Z (south pole) direction, while global +Z
(the actual rotational pole) points almost straight down through the ground
from here (≈174° from local Up) — because the terrain sits only ~6° of
latitude from the pole itself. This was cross-checked two ways: against the
polar-stereographic projection's known "grid convergence = longitude −
central meridian" property (an earlier, narrower version of this correction
that handled only compass bearing), and via an independent end-to-end test
using the project's actual three.js build (see section 7) — both agree.

`view-gizmo.js`'s `computeGlobalAxisOrientationQuaternion(latitudeDegrees,
longitudeDegrees)` (`view-gizmo.js:330`) builds the rotation matrix whose
columns are the global +X/+Y/+Z axes expressed in the scene's local
East/Up/South basis (via `THREE.Matrix4.makeBasis`), and returns it as a
quaternion. Two call sites apply it:

- `setViewGizmoGlobalAxisOrientation(viewHelper, latitudeDegrees,
  longitudeDegrees)` (`view-gizmo.js:409`) — for the corner gizmo. The
  underlying `ViewHelper` (three.js addon) overwrites its own world rotation
  from the camera every frame, so the rotation can't be applied to the
  gizmo object itself; instead its axis-arm and label children are
  regrouped into a rotatable sub-group once, and that sub-group's
  quaternion is set directly.
- `axesHelper.quaternion.copy(computeGlobalAxisOrientationQuaternion(...))`
  (`main.js:3010`) — for the in-scene axis helper. This object is a plain
  `THREE.Group` added directly to `scene` (not a `ViewHelper`), so its
  quaternion can just be set directly with no extra workaround.

`main.js` calls both once the terrain's centre latitude/longitude are known
(inside `updateStatusPanel()`, `main.js:3001`/`3010`).

### 4.4 In-scene axis helper and gizmo caption

`view-gizmo.js`'s `createSceneAxisHelper(size)` (`view-gizmo.js:117`)
replaces the built-in `THREE.AxesHelper` (which only draws +X/+Y/+Z with no
labels) with a custom `THREE.Group`: a bright line + a dimmed line per axis
(covering both the positive and negative direction), plus six labelled
sprites (+X/-X/+Y/-Y/+Z/-Z, red/green/blue) at the same style as the corner
gizmo. `main.js` toggles it with the `A` key (unchanged) and sizes it so
each arm extends to `0.6 x` the terrain's largest horizontal dimension —
deliberately longer than the terrain extent itself, so the axes are
visually distinguishable from the ground rather than being hidden inside
or barely reaching the terrain's edge.

Because both the corner gizmo and the in-scene axis helper now show the
*global* frame rather than local compass directions, a small fixed caption
("全域坐標系 MOON_ME (Global Frame)" / "MOON_ME Global Frame") is anchored
directly above the corner gizmo (`main.js:263`) so it isn't mistaken for a
compass. It's set via `element.innerHTML` with manually-written
`lang-zh`/`lang-en` spans rather than `wrapBilingualText()`'s automatic
Chinese/English detection, because that regex requires the parenthesised
English text to immediately follow the Chinese run with no intervening
Latin text — the literal identifier "MOON_ME" in the middle of the caption
breaks that pattern.

## 5. Route Planning and Slope-Safety Analysis

- Users click the terrain to add waypoints (`waypoints` array); the route is
  sampled at `ROUTE_SAMPLE_INTERVAL_METERS` (5 m) intervals with DEM
  bilinear interpolation for elevation.
- `analyzeRoute()` (`main.js:5244`) computes, per sample, the **segment**
  slope — `atan2(elevationDifference, thatSegment'sOwnHorizontalDistance)` —
  along with cumulative ascent/descent, horizontal and surface-path distance,
  and the location of maximum slope/ascent/descent/sudden elevation change.
  (An earlier version of this function divided by the *cumulative* distance
  from the route start instead of each segment's own distance, which made
  slope readings shrink toward 0° as the route got longer; this has been
  fixed and re-verified.)
- `classifySlope()` (`main.js:4645`) buckets slope into Safe (≤10°) /
  Warning (>10° and ≤15°) / Unsafe (>15°) — a **terrain-slope-only**
  preliminary classification. It does not yet account for rocks, small
  craters, cross-slope, rover geometry/centre of gravity, soil conditions,
  energy budget, illumination, or Earth-communication visibility (see
  section 10 for the full list).
- The 3D route line can optionally colour each segment by this slope
  classification (a per-segment `THREE.TubeGeometry`/`MeshBasicMaterial`),
  toggled from the Cross Section panel; by default it renders as a single
  flat colour.
- **Route persistence** (`saveRouteToLocalStorage()` /
  `loadRouteFromLocalStorage()`, `main.js:7697`/`7743`): "Save Route" writes
  only the waypoints' latitude/longitude (not elevation, distance, or slope —
  those are recomputed on load by re-sampling the currently-loaded terrain)
  as a single JSON payload under one fixed key (`SAVED_ROUTE_STORAGE_KEY`) in
  the browser's `localStorage`. This means: (a) the save is entirely
  client-side — nothing is sent to a server; (b) there is only **one** save
  slot, so saving again overwrites the previous save; (c) the saved route is
  scoped to that specific browser (and that specific origin/URL) — it will
  not appear on a different device, browser, or hostname; (d) if the
  terrain currently loaded doesn't cover the saved coordinates, loading will
  fail gracefully rather than showing garbage. Exporting to CSV/GeoJSON
  (`exportRouteAsCsv()` / `exportRouteAsGeoJson()`, `main.js:7563`/`7615`)
  is unrelated to this storage and produces a downloadable file with the
  full computed route data instead.

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
- **Global MOON_ME axis orientation (section 4.3):** the topocentric
  East/North/Up-in-global-frame formula was first validated the same way as
  the meridian-convergence approach it replaced — stepping one small
  distance due north/east in lat/lon and comparing the result numerically
  against the scene's raw local axes — confirming both approaches agree.
  The full 3×3 rotation (not just a single compass-bearing angle) was then
  verified end-to-end using the project's own three.js build in a
  standalone Node.js script: constructing the same
  `computeGlobalAxisOrientationQuaternion()` call used in the app, applying
  it to unit vectors representing each gizmo arm, and confirming the
  rotated directions exactly matched the hand-derived expected values
  (including the ≈174° angle between the rotated +Z arm and local Up,
  matching the independently-computed co-latitude).
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

## 9. Error Handling and Failure Modes

- **Terrain data fails to load** (`loadTerrainData()`, `main.js:1436`
  catch block) — e.g. the network request fails, or `heightmap_float32.bin`
  is corrupt/mismatched with its metadata: the error is logged to the
  browser console, the DEM Status panel shows the raw error message, and
  the full-screen loading overlay is switched into an explicit error state
  (`showLoadingOverlayError()`, red "Failed to Load Map" text) rather than
  being hidden — the user is left on a clear failure screen instead of a
  blank or broken 3D scene.
- **Route creation with insufficient elevation data** — if the clicked/added
  waypoints don't yield at least 2 valid terrain samples (e.g. points fall
  outside the loaded DEM's coverage, or land entirely on invalid/NoData
  cells), the Mission panel shows "Traverse Creation Failed / Insufficient
  Valid Elevation Data Along the Traverse" instead of attempting to render a
  route with missing data.
- **`localStorage` unavailable or full** — `saveRouteToLocalStorage()`
  (section 5) wraps the write in a `try`/`catch` and shows an explicit
  "Save Failed — Browser Storage May Be Full" message rather than failing
  silently (this also covers private-browsing modes where `localStorage`
  writes can throw).
- **General pattern:** the app favors showing a specific, human-readable
  bilingual error/status message in the relevant panel over throwing an
  unhandled exception or leaving stale/blank UI state — but this is applied
  per-feature as issues were found, not enforced by a single global
  error-boundary mechanism (there is no top-level `try`/`catch` around the
  whole app; an error outside one of the handled paths above could still
  surface as an uncaught console error with no on-screen indication).

## 10. Known Limitations and Future Work

The slope-safety classification (section 5) is a **terrain-slope-only**
preliminary filter, useful as a first-pass screen but not a complete
traverse-safety assessment on its own. It does not yet account for:

- **Rocks and small craters** below the DEM's resolution (5 m/pixel) — a
  hazard smaller than one pixel is invisible to the elevation model
  entirely, regardless of how the slope threshold is tuned.
- **Cross-slope** (side-to-side tilt across the direction of travel) — only
  slope *along* the direction of travel is currently computed; a route that
  looks safe along-track could still traverse a dangerous side-tilt.
- **Rover geometry and centre of gravity** — there is no vehicle-specific
  tip-over, high-centering, or wheel-clearance model; the 10°/15° thresholds
  are generic, not derived from a specific rover design.
- **Soil/regolith bearing strength and trafficability** — the DEM carries
  only elevation, no information about surface material, so loose regolith
  or bearing-capacity hazards are not distinguished from solid terrain.
- **Energy budget** — no traverse-time or power-consumption estimate is
  computed from the route.
- **Illumination** — no sun-angle/shadow analysis for a specific mission
  date/time, which matters near the south pole where permanently-shadowed
  regions and very low sun angles are common.
- **Earth-communication visibility** — no line-of-sight/Earth-occlusion
  analysis along the route.

These are documented as known scope boundaries of the current prototype —
see section 5 for exactly what the slope analysis does compute today. Beyond
the slope-safety model specifically, section 1.1 also notes the deferred
`main.js` state-centralisation work, and section 1 notes the lack of an
automated test suite, both of which are open engineering items rather than
correctness bugs.
