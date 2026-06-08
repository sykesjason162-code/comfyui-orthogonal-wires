# ComfyUI Orthogonal Wires

A ComfyUI extension that replaces the default spaghetti Bézier curves with clean orthogonal (L-bend) wire routing. Wires travel horizontally from their source node, then turn 90° and drop vertically into their destination — naturally following the gaps between nodes like roads through a city grid.

![Phase 1 screenshot](screenshot.png)

## Features

- **Clean L-bend routing** — wires exit horizontally, bend at the destination's X, then travel vertically
- **Sharp 90° corners** — no curves, no diagonals
- **Gutter coloring** — wires sharing the same corridor automatically render in a neutral gray, reducing visual clutter
- **Exit ramps** — the last 48px of each segment near a node keeps the original signal color, so slot types are always readable at a glance
- **Nearest-neighbor corridor routing** — wires snap to the centerline of the real gap between adjacent nodes, keeping them visible in the space between nodes rather than behind them. Falls back to a direct L-bend when no corridor exists
- **Click to trace** — clicking any wire highlights its full path in its original signal color at double width, so you can follow it through a busy graph
- **Animated flow dots** — the moving dots that show data flowing through a connection follow the L-path correctly and always render in signal color
- **Non-destructive** — falls back to the original Bézier renderer if anything is missing

## Planned (coming soon)

- Further tuning of corridor detection edge cases (loopback wires, group nodes, very dense graphs)

## Installation

### ComfyUI Desktop (recommended)

1. Find your ComfyUI base path — open **Settings → Server Config** inside the app
2. Navigate to the `custom_nodes` folder inside that path
3. Clone this repo there:
   ```
   git clone https://github.com/sykesjason162-code/comfyui-orthogonal-wires
   ```
4. Restart ComfyUI Desktop

### Manual install

1. Download the zip from the [releases page](../../releases) and extract it
2. Place the `comfyui-orthogonal-wires` folder inside your `custom_nodes` directory
3. Restart ComfyUI

### Manual ComfyUI (portable/server)

Same as above — clone or extract into `ComfyUI/custom_nodes/`.

## Folder structure

```
custom_nodes/
  comfyui-orthogonal-wires/
    __init__.py
    web/
      orthogonal_wires.js
```

## How it works

The extension monkey-patches `LGraphCanvas.prototype.renderLink`, replacing the default cubic Bézier path with a two-segment orthogonal path:

```
source → (horizontal) → bend point → (vertical) → destination
```

The bend point is at `(destination.x, source.y)` — so the wire always exits the source slot straight to the right (or left), travels to align with the destination's X coordinate, then turns and enters the destination slot from above or below.

## Contributing

Issues and PRs welcome. If you find a workflow where the routing looks wrong or breaks, please share a screenshot — edge cases like same-column nodes, loopback connections, and group nodes are all worth ironing out before Phase 2.

## License

MIT
