# Lunar South Pole Terrain Visualization

A web-based 3D lunar terrain visualization and rover mission route-planning
tool built with [Three.js](https://threejs.org/), using a high-resolution
Digital Elevation Model (DEM) of **Nobile Rim 2**, one of NASA's Artemis III
candidate landing regions. Browse the terrain in real time, query the
elevation at any coordinate, plan a rover route, and analyze slope and
hazardous sections along the way.

## Features

- **Loading screen**: a full-screen overlay shown while terrain data loads,
  with a live download-progress percentage
- **3D terrain rendering**: an interactive terrain mesh built from real DEM
  data, with rotate/zoom/pan controls; no vertical exaggeration (relief is
  shown at true horizontal-to-vertical scale)
- **DEM data cleaning**: automatically detects and repairs invalid pixels,
  removes single-pixel noise through multi-pass neighbor-median comparison,
  and finds/fills isolated cone-shaped terrain artifacts; results (NoData
  count, repaired-pixel count, spike-correction count, etc.) are shown in
  the DEM Status panel
- **Direction gizmo**: a 3D orientation indicator in the bottom-right corner
  plus an in-scene axis helper (`A` key), both labeled X/Y/Z and rotated to
  show the Moon's global body-fixed reference frame (**MOON_ME**: Z = mean
  rotational pole, X = toward the prime meridian, Y completes a right-handed
  system) rather than the scene's local grid axes or a local compass
- **Coordinate query**: click the terrain or enter a latitude/longitude to
  read that point's lunar surface coordinates, projected coordinates, and
  absolute elevation
- **Mission route planning**: click or search to add any number of waypoints
  in sequence; the app automatically generates a terrain-following
  multi-segment route and computes:
  - Horizontal distance and surface-path distance
  - Cumulative ascent/descent and net elevation change
  - Average slope and maximum slope
  - Route safety status (based on slope classification)
- **Waypoint editing**: click a waypoint flag to select it, then drag to
  move it, click the terrain to insert a new point after it, or press
  `Delete` to remove it; you can also drag directly on the route's white
  line to insert a new point exactly where you drop it, without selecting
  anything first
- **Undo**: every waypoint change (add, move, insert, delete, reset, load)
  can be undone with `Ctrl+Z`, up to 50 steps back
- **Live slope-safety preview while dragging**: while dragging a waypoint
  or pulling a new point out of the route line, the marker recolors in
  real time (Safe/Passable/Warning/Unsafe) based on the terrain slope right
  under the cursor, before you release
- **Named route save/load**: save the current route under any name, then
  load or delete any previously saved route from a dropdown — multiple
  routes can be kept side by side in the browser, not just one; export the
  current route as CSV or GeoJSON at any time
- **Route elevation profile**: an elevation-vs-distance chart along the
  route; hover anywhere on the chart to see the distance/elevation/slope/
  lat-lon at that point. A "Slope Safety Coloring" toggle switches the 3D
  route between a single flat color and per-segment coloring (Safe /
  Passable / Warning / Unsafe); the chart also marks the maximum-slope
  location, the steepest ascent/descent sections, and sudden elevation
  changes
- **Overlay layers**: a slope layer (5-tier color scale) and an elevation-band
  layer, toggleable independently
- **Moon overview inset**: a draggable/resizable globe inset showing where
  the mission area sits on the full Moon, textured from the NASA CGI Moon
  Kit; drag to rotate freely, renders on demand rather than every frame
- **Bilingual interface**: instant Chinese/English toggle
- **Freely configurable UI**: every panel can be dragged, resized, shown/
  hidden, with overall interface scaling supported

## Data Source

| Item | Description |
|---|---|
| Terrain DEM | Nobile Rim 2 (Artemis III candidate landing region, site code `DM2`), a ~10 km × 10 km mission-area subset, 5 m/pixel, 2000×2000 grid, South Polar Stereographic projection (MOON_ME/DE421 reference frame) |
| Elevation range | approx. 303 m – 1647 m |
| DEM origin | NASA GSFC PGDA — Barker, M. K., et al., 2021, *Planetary and Space Science*, Vol. 203, 105119 (DOI: [10.1016/j.pss.2020.105119](https://doi.org/10.1016/j.pss.2020.105119)), pure LOLA laser-altimetry data |
| Moon overview texture | [NASA CGI Moon Kit](https://svs.gsfc.nasa.gov/4720) (December 2025 color + elevation maps), credit: NASA's Scientific Visualization Studio |

The source GeoTIFF DEM is converted by `QGISDEM.py` into the files this
project actually loads: `public/heightmap_float32.bin` (float32 elevation
grid) and `public/heightmap_metadata.json` (coordinate transform, extent,
and other metadata).

**For the full data-source explanation, how to obtain other candidate
landing regions, data-quality/limitations notes, and licensing, see
[`DATA_SOURCES.md`](DATA_SOURCES.md).**

## Technical Documentation

| Document | Contents |
|---|---|
| [`DATA_SOURCES.md`](DATA_SOURCES.md) | The verified source and citation for the terrain data, how to obtain other candidate landing regions, data-quality/limitations notes, licensing |
| [`TECHNICAL_OVERVIEW.md`](TECHNICAL_OVERVIEW.md) | Code and logic overview: project architecture, data pipeline, DEM cleaning algorithm, coordinate-transform formulas, route-safety-analysis logic, validation methodology |

## Tech Stack

- [Three.js](https://threejs.org/) (3D rendering, OrbitControls, ViewHelper)
- [Vite](https://vitejs.dev/) (dev server and bundling)
- Vanilla JavaScript ES Modules (no additional frontend framework); a pure
  client-side static site with no backend server
- Python (`QGISDEM.py`, offline DEM pre-processing; requires `rasterio`,
  `numpy`, `scipy`)

## Getting Started

```bash
npm install
npm run dev
```

Once started, the terminal prints a local URL (default
`http://localhost:5173`) — open it in a browser.

Other commands:

```bash
npm run build     # Build for production (output to dist/)
npm run preview   # Preview the production build
```

### Using Your Own DEM Data (e.g. a different candidate landing region)

1. Prepare a GeoTIFF DEM file (to switch to a different lunar south pole
   candidate landing region, [`DATA_SOURCES.md`](DATA_SOURCES.md) has the
   full list of available sites and download steps)
2. Edit the `INPUT_DEM` path in `QGISDEM.py`
3. Run `python QGISDEM.py` — it writes `heightmap_float32.bin` and
   `heightmap_metadata.json` into `public/`
4. Reload the page to load the new terrain

## Controls

| Action | Description |
|---|---|
| Left-click drag | Rotate the view (full 360°, including underneath the terrain) |
| Mouse wheel | Zoom |
| Right-click drag | Pan |
| Click the terrain | First click sets the start point; each click after that adds a waypoint in sequence; press `R` to clear the route and start over |
| Click a waypoint flag | Select/deselect that waypoint |
| Drag a waypoint flag | Move that waypoint's position |
| Click the terrain after selecting a waypoint | Insert a new waypoint after it |
| Drag the route's white line | Insert a new waypoint where you drop it |
| Press `Delete` after selecting a waypoint | Remove that waypoint |

### Keyboard Shortcuts

| Key | Function |
|---|---|
| `G` | Show/hide the grid |
| `A` | Show/hide the coordinate axes |
| `S` | Show/hide the slope layer |
| `E` | Show/hide the elevation-band layer |
| `R` | Clear the current route |
| `Ctrl+Z` | Undo the last waypoint change |
| `Delete` / `Backspace` | Remove the selected waypoint |
| `Esc` | Deselect the selected waypoint |
| `U` | Show/hide the whole interface |
| `[` / `]` | Shrink/enlarge the interface |

## Project Structure

```
├── index.html                 # Entry point
├── src/
│   ├── main.js                 # Main program: scene setup, DEM loading,
│   │                            # terrain picking, route planning/analysis
│   │                            # (incl. undo, drag-to-insert), animation loop
│   ├── dem-cleaning.js         # DEM elevation cleaning (pure functions)
│   ├── coordinate-transforms.js # Projected/local/geographic coordinate math
│   ├── loading-overlay.js      # Full-screen loading overlay (with download %)
│   ├── view-gizmo.js           # 3D direction gizmo, global MOON_ME frame
│   ├── ui-core.js              # Shared panel UI (drag/resize, bilingual text, interface scaling)
│   ├── moon-overview.js        # Moon overview inset
│   ├── markers.js              # Marker (flag/dot) geometry construction utilities
│   └── utils.js                # Shared formatting/validation helper functions
├── public/
│   ├── heightmap_float32.bin   # Terrain elevation data
│   ├── heightmap_metadata.json # Terrain metadata
│   └── moon/                   # Moon overview textures
├── QGISDEM.py                  # GeoTIFF DEM -> project binary format conversion script
├── DATA_SOURCES.md             # Data source and acquisition guide
├── TECHNICAL_OVERVIEW.md       # Code and logic technical overview
└── package.json
```
