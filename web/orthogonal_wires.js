// orthogonal_wires.js
// ComfyUI extension: nearest-neighbor corridor routing with gutter coloring.
//
// Phase 1: L-bend routing.
// Phase 2: Gutter coloring, exit ramps, click-to-highlight.
// Phase 3: Nearest-neighbor corridor routing. Wires snap to the centerline of the
//          real gap between adjacent nodes, keeping them visible in the space between
//          nodes rather than running behind them. Falls back to direct L-bend when
//          no corridor exists between source and destination.
//
// Install: place the containing folder inside ComfyUI/custom_nodes/ and restart.

import { app } from "../../scripts/app.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const GUTTER_COLOR  = "#666666"; // neutral color for shared corridor segments
const RAMP_LENGTH   = 48;        // canvas units near each node that keep signal color
const GUTTER_TOLERANCE = 12;     // tolerance for deciding two wires share a corridor

// ─── Corridor map ─────────────────────────────────────────────────────────────
// Computes the set of vertical and horizontal corridor centerlines from node positions.
// A vertical corridor exists in the gap between two horizontally-adjacent nodes:
//   no other node occupies the horizontal span between them.
// Returns { verticals: [x, ...], horizontals: [y, ...] } sorted ascending.

function buildCorridorMap(graph) {
    const nodes = graph._nodes;
    if (!nodes || nodes.length === 0) return { verticals: [], horizontals: [] };

    // Gather bounding boxes
    const boxes = nodes.map(n => ({
        id:    n.id,
        left:  n.pos[0],
        top:   n.pos[1],
        right: n.pos[0] + (n.size[0] || 100),
        bot:   n.pos[1] + (n.size[1] || 60),
    }));

    const verticals   = new Set();
    const horizontals = new Set();

    // ── Vertical corridors ──
    // For each pair of nodes where one's right edge is left of the other's left edge,
    // check that no third node occupies the horizontal band between them.
    // The corridor X = midpoint of the gap.
    for (let i = 0; i < boxes.length; i++) {
        for (let j = 0; j < boxes.length; j++) {
            if (i === j) continue;
            const a = boxes[i], b = boxes[j];

            // a is to the left of b
            if (a.right >= b.left) continue;

            const gapLeft  = a.right;
            const gapRight = b.left;
            const midX     = (gapLeft + gapRight) / 2;

            // Vertical overlap — they must share some Y range or be close enough
            // that a wire between them would plausibly pass through this gap.
            // We use a generous overlap check: their Y ranges come within 200px.
            const yOverlap = a.top <= b.bot + 200 && b.top <= a.bot + 200;
            if (!yOverlap) continue;

            // Check no other node's horizontal extent covers this gap's X midpoint
            // AND overlaps the Y range of either node
            const blocked = boxes.some((c, k) => {
                if (k === i || k === j) return false;
                return c.left <= midX && c.right >= midX &&
                       c.top  <= Math.max(a.bot, b.bot) &&
                       c.bot  >= Math.min(a.top, b.top);
            });

            if (!blocked) verticals.add(Math.round(midX));
        }
    }

    // ── Horizontal corridors ──
    // Same logic but rotated: a is above b.
    for (let i = 0; i < boxes.length; i++) {
        for (let j = 0; j < boxes.length; j++) {
            if (i === j) continue;
            const a = boxes[i], b = boxes[j];

            // a is above b
            if (a.bot >= b.top) continue;

            const gapTop = a.bot;
            const gapBot = b.top;
            const midY   = (gapTop + gapBot) / 2;

            const xOverlap = a.left <= b.right + 200 && b.left <= a.right + 200;
            if (!xOverlap) continue;

            const blocked = boxes.some((c, k) => {
                if (k === i || k === j) return false;
                return c.top  <= midY && c.bot  >= midY &&
                       c.left <= Math.max(a.right, b.right) &&
                       c.right >= Math.min(a.left, b.left);
            });

            if (!blocked) horizontals.add(Math.round(midY));
        }
    }

    return {
        verticals:   [...verticals].sort((a, b) => a - b),
        horizontals: [...horizontals].sort((a, b) => a - b),
    };
}

// ─── Corridor snap ────────────────────────────────────────────────────────────
// Given a list of corridor positions and a target value,
// return the corridor closest to `target` that lies between `lo` and `hi`,
// or null if none exist in that range.

function nearestCorridor(corridors, lo, hi, target) {
    const inRange = corridors.filter(c => c > lo && c < hi);
    if (inRange.length === 0) return null;
    return inRange.reduce((best, c) =>
        Math.abs(c - target) < Math.abs(best - target) ? c : best
    );
}

// ─── Route computation ────────────────────────────────────────────────────────
// Returns an array of [x,y] waypoints for the wire path.
// Tries to route through a real vertical corridor between source and destination.
// Falls back to a direct L-bend if no corridor is available.
//
// Z-shape route (corridor found):
//   src → (horiz to corridorX) → (vert to dstY) → (horiz to dst)
//
// L-bend fallback (no corridor):
//   src → (horiz to dstX) → (vert to dst)

function computeRoute(ax, ay, bx, by, corridorMap) {
    const lo = Math.min(ax, bx);
    const hi = Math.max(ax, bx);
    const midX = (ax + bx) / 2;

    const corridorX = nearestCorridor(corridorMap.verticals, lo, hi, midX);

    if (corridorX !== null) {
        // Z-shape: exit horizontal → corridor vertical → entry horizontal
        return [
            [ax,        ay],
            [corridorX, ay],
            [corridorX, by],
            [bx,        by],
        ];
    }

    // Direct L-bend fallback
    return [
        [ax, ay],
        [bx, ay],
        [bx, by],
    ];
}

// ─── Shared-gutter detection ──────────────────────────────────────────────────
// Pre-pass: walk all links, compute their routes, bucket each segment,
// return Set of segment keys used by 2+ wires.

function buildSharedGutters(graph, corridorMap) {
    const counts = new Map();
    const links  = graph._links;
    if (!links) return new Set();

    const bkt = (v) => Math.round(v / GUTTER_TOLERANCE) * GUTTER_TOLERANCE;

    for (const link of Object.values(links)) {
        if (!link) continue;
        const srcNode = graph.getNodeById(link.origin_id);
        const dstNode = graph.getNodeById(link.target_id);
        if (!srcNode || !dstNode) continue;
        const srcPos = srcNode.getConnectionPos(false, link.origin_slot);
        const dstPos = dstNode.getConnectionPos(true,  link.target_slot);
        if (!srcPos || !dstPos) continue;

        const pts = computeRoute(srcPos[0], srcPos[1], dstPos[0], dstPos[1], corridorMap);

        for (let i = 0; i < pts.length - 1; i++) {
            const [x1, y1] = pts[i];
            const [x2, y2] = pts[i + 1];
            // Horizontal segment: same Y
            const key = Math.abs(y2 - y1) < 1
                ? `H:${bkt(y1)}`
                : `V:${bkt(x1)}`;
            counts.set(key, (counts.get(key) || 0) + 1);
        }
    }

    const shared = new Set();
    for (const [key, count] of counts) {
        if (count > 1) shared.add(key);
    }
    return shared;
}

// ─── Segment drawing ──────────────────────────────────────────────────────────

function drawSegment(ctx, x1, y1, x2, y2, signalColor, isShared, isSelected, lineWidth) {
    const dx  = x2 - x1, dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);

    if (isSelected || len <= RAMP_LENGTH * 2) {
        ctx.strokeStyle = isSelected ? signalColor : (isShared ? GUTTER_COLOR : signalColor);
        ctx.lineWidth   = lineWidth;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        return;
    }

    const ux = dx / len, uy = dy / len;
    const r1x = x1 + ux * RAMP_LENGTH, r1y = y1 + uy * RAMP_LENGTH;
    const r2x = x2 - ux * RAMP_LENGTH, r2y = y2 - uy * RAMP_LENGTH;

    // Exit ramp — signal color
    ctx.strokeStyle = signalColor;
    ctx.lineWidth   = lineWidth;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(r1x, r1y); ctx.stroke();

    // Corridor middle
    ctx.strokeStyle = isShared ? GUTTER_COLOR : signalColor;
    ctx.beginPath(); ctx.moveTo(r1x, r1y); ctx.lineTo(r2x, r2y); ctx.stroke();

    // Entry ramp — signal color
    ctx.strokeStyle = signalColor;
    ctx.beginPath(); ctx.moveTo(r2x, r2y); ctx.lineTo(x2, y2); ctx.stroke();
}

// ─── Extension ────────────────────────────────────────────────────────────────

app.registerExtension({
    name: "orthogonal_wires",

    async setup() {
        const originalRenderLink = LGraphCanvas.prototype.renderLink;

        let corridorMap  = { verticals: [], horizontals: [] };
        let sharedGutters = new Set();

        // Rebuild corridor map and shared gutters once per frame
        const originalDraw = LGraphCanvas.prototype.draw;
        LGraphCanvas.prototype.draw = function (...args) {
            if (this.graph) {
                corridorMap   = buildCorridorMap(this.graph);
                sharedGutters = buildSharedGutters(this.graph, corridorMap);
            }
            return originalDraw.apply(this, args);
        };

        LGraphCanvas.prototype.renderLink = function (
            ctx, a, b, link,
            skip_border, flow, color,
            start_dir, end_dir, num_sublines
        ) {
            if (!a || !b) return originalRenderLink.apply(this, arguments);

            const ax = a[0], ay = a[1];
            const bx = b[0], by = b[1];

            // Resolve signal color
            if (!color && link) {
                color = LGraphCanvas.link_type_colors[link.type] || this.default_link_color;
            }
            if (!color) color = this.default_link_color;

            const isSelected = !!(link && this.selected_links && this.selected_links[link.id]);
            const lineWidth  = (num_sublines || 1) * this.connections_width;
            const drawWidth  = isSelected ? lineWidth * 2 : lineWidth;

            // Compute waypoints
            const pts = computeRoute(ax, ay, bx, by, corridorMap);

            // ── Border/shadow pass ──
            if (!skip_border && this.render_connections_border && this.ds.scale > 0.6) {
                ctx.save();
                ctx.strokeStyle = "rgba(0,0,0,0.5)";
                ctx.lineWidth   = (num_sublines || 1) * (this.connections_width + 2);
                ctx.lineJoin    = "miter";
                ctx.lineCap     = "butt";
                ctx.beginPath();
                ctx.moveTo(pts[0][0], pts[0][1]);
                for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
                ctx.stroke();
                ctx.restore();
            }

            // ── Wire draw pass ──
            ctx.save();
            ctx.lineJoin = "miter";
            ctx.lineCap  = "butt";

            const bkt = (v) => Math.round(v / GUTTER_TOLERANCE) * GUTTER_TOLERANCE;

            for (let i = 0; i < pts.length - 1; i++) {
                const [x1, y1] = pts[i];
                const [x2, y2] = pts[i + 1];
                const isHoriz  = Math.abs(y2 - y1) < 1;
                const key      = isHoriz ? `H:${bkt(y1)}` : `V:${bkt(x1)}`;
                const isShared = sharedGutters.has(key);

                drawSegment(ctx, x1, y1, x2, y2, color, isShared, isSelected, drawWidth);
            }

            ctx.restore();

            // ── Animated flow dots ──
            if (flow) {
                ctx.save();
                ctx.fillStyle = color;
                const speed = 5;
                const t     = (Date.now() / 1000 * speed) % 1;

                // Total Manhattan length of the route
                let total = 0;
                const segLengths = [];
                for (let i = 0; i < pts.length - 1; i++) {
                    const d = Math.abs(pts[i+1][0] - pts[i][0]) + Math.abs(pts[i+1][1] - pts[i][1]);
                    segLengths.push(d);
                    total += d;
                }

                let dist = t * (total || 1);
                let dotX = pts[0][0], dotY = pts[0][1];
                for (let i = 0; i < segLengths.length; i++) {
                    if (dist <= segLengths[i]) {
                        const frac = dist / (segLengths[i] || 1);
                        dotX = pts[i][0] + (pts[i+1][0] - pts[i][0]) * frac;
                        dotY = pts[i][1] + (pts[i+1][1] - pts[i][1]) * frac;
                        break;
                    }
                    dist -= segLengths[i];
                }

                ctx.beginPath();
                ctx.arc(dotX, dotY, 4, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            }
        };

        console.log("[orthogonal_wires] Phase 3 active — nearest-neighbor corridor routing.");
    },
});
