// orthogonal_wires.js
// ComfyUI extension: orthogonal L-bend wire routing with gutter coloring.
//
// Phase 1: L-bend routing — wires exit horizontally, bend at destination X, drop vertically.
// Phase 2: Gutter coloring — wires sharing a corridor render neutral gray.
//          Exit ramps near each node keep the original signal color so slot types stay visible.
//          Clicking a wire highlights its full path in its original signal color.
//
// Install: place the containing folder inside ComfyUI/custom_nodes/ and restart.

import { app } from "../../scripts/app.js";

// ─── Constants ────────────────────────────────────────────────────────────────

// Neutral color for shared gutter segments
const GUTTER_COLOR = "#666666";

// How many canvas units from each endpoint keep the signal color (the "exit ramp")
const RAMP_LENGTH = 48;

// How many canvas units of tolerance when deciding if two segments share a corridor.
// Two horizontal segments at y=100 and y=103 are considered the same gutter row.
const GUTTER_TOLERANCE = 12;

// ─── Gutter pre-pass ──────────────────────────────────────────────────────────
// Called once per frame before any links are drawn.
// Walks every link in the graph, computes its two segment keys, and counts
// how many wires share each corridor. Returns a Set of keys that are shared.

function buildSharedGutters(graph) {
    // key → count of wires using that corridor this frame
    const counts = new Map();

    const links = graph._links;
    if (!links) return new Set();

    // Round a coordinate to the nearest GUTTER_TOLERANCE bucket
    const bucket = (v) => Math.round(v / GUTTER_TOLERANCE) * GUTTER_TOLERANCE;

    for (const link of Object.values(links)) {
        if (!link) continue;

        const srcNode = graph.getNodeById(link.origin_id);
        const dstNode = graph.getNodeById(link.target_id);
        if (!srcNode || !dstNode) continue;

        const srcPos = srcNode.getConnectionPos(false, link.origin_slot);
        const dstPos = dstNode.getConnectionPos(true,  link.target_slot);
        if (!srcPos || !dstPos) continue;

        const ay = srcPos[1];
        const bx = dstPos[0];

        // Horizontal segment key: "H:<bucketedY>:<minX>:<maxX>"
        // We only care about the Y row for sharing purposes.
        const hKey = `H:${bucket(ay)}`;

        // Vertical segment key: "V:<bucketedX>:<minY>:<maxY>"
        const vKey = `V:${bucket(bx)}`;

        counts.set(hKey, (counts.get(hKey) || 0) + 1);
        counts.set(vKey, (counts.get(vKey) || 0) + 1);
    }

    // Return only the keys where more than one wire shares the corridor
    const shared = new Set();
    for (const [key, count] of counts) {
        if (count > 1) shared.add(key);
    }
    return shared;
}

// ─── Segment drawing helpers ──────────────────────────────────────────────────

// Draw a single straight segment, split into three zones:
//   [ramp out] [gutter middle] [ramp in]
// The middle zone uses gutterColor if the segment is shared, signal color otherwise.
// The ramp zones always use signal color so slot types stay readable at the node.
function drawSegment(ctx, x1, y1, x2, y2, signalColor, gutterColor, isShared, isSelected, lineWidth) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);

    // If the segment is shorter than two ramps, or the wire is selected,
    // just draw the whole thing in signal color — no point splitting it.
    if (isSelected || len <= RAMP_LENGTH * 2) {
        ctx.strokeStyle = signalColor;
        ctx.lineWidth = lineWidth;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        return;
    }

    const ux = dx / len; // unit vector x
    const uy = dy / len; // unit vector y

    // Ramp endpoints
    const r1x = x1 + ux * RAMP_LENGTH;
    const r1y = y1 + uy * RAMP_LENGTH;
    const r2x = x2 - ux * RAMP_LENGTH;
    const r2y = y2 - uy * RAMP_LENGTH;

    const midColor = isShared ? gutterColor : signalColor;

    // Exit ramp (signal color)
    ctx.strokeStyle = signalColor;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(r1x, r1y);
    ctx.stroke();

    // Gutter middle
    ctx.strokeStyle = midColor;
    ctx.beginPath();
    ctx.moveTo(r1x, r1y);
    ctx.lineTo(r2x, r2y);
    ctx.stroke();

    // Entry ramp (signal color)
    ctx.strokeStyle = signalColor;
    ctx.beginPath();
    ctx.moveTo(r2x, r2y);
    ctx.lineTo(x2, y2);
    ctx.stroke();
}

// ─── Extension ────────────────────────────────────────────────────────────────

app.registerExtension({
    name: "orthogonal_wires",

    async setup() {
        const originalRenderLink = LGraphCanvas.prototype.renderLink;

        // Cache the shared-gutter set so we rebuild it once per rendered frame,
        // not once per wire. We invalidate it whenever the canvas draws a new frame
        // by hooking into the draw cycle.
        let sharedGutters = new Set();
        let lastFrameTime = -1;

        const originalDraw = LGraphCanvas.prototype.draw;
        LGraphCanvas.prototype.draw = function (...args) {
            // Rebuild gutter map at the start of each frame
            if (this.graph) {
                sharedGutters = buildSharedGutters(this.graph);
            }
            lastFrameTime = performance.now();
            return originalDraw.apply(this, args);
        };

        LGraphCanvas.prototype.renderLink = function (
            ctx,
            a,            // [x, y] start point
            b,            // [x, y] end point
            link,
            skip_border,
            flow,
            color,
            start_dir,
            end_dir,
            num_sublines
        ) {
            if (!a || !b) {
                return originalRenderLink.apply(this, arguments);
            }

            const ax = a[0], ay = a[1];
            const bx = b[0], by = b[1];

            // Bend point
            const bendX = bx;
            const bendY = ay;

            // Resolve signal color
            if (!color && link) {
                color = LGraphCanvas.link_type_colors[link.type] || this.default_link_color;
            }
            if (!color) color = this.default_link_color;

            // Is this wire selected/clicked?
            const isSelected = !!(link && this.selected_links && this.selected_links[link.id]);

            // Which corridors does this wire use?
            const bucket = (v) => Math.round(v / GUTTER_TOLERANCE) * GUTTER_TOLERANCE;
            const hShared = sharedGutters.has(`H:${bucket(ay)}`);
            const vShared = sharedGutters.has(`V:${bucket(bx)}`);

            const lineWidth = (num_sublines || 1) * this.connections_width;
            const boldWidth  = lineWidth * 2;

            // ── Border/shadow pass ──
            if (!skip_border && this.render_connections_border && this.ds.scale > 0.6) {
                ctx.save();
                ctx.strokeStyle = "rgba(0,0,0,0.5)";
                ctx.lineWidth = (num_sublines || 1) * (this.connections_width + 2);
                ctx.lineJoin = "miter";
                ctx.lineCap  = "butt";
                ctx.beginPath();
                ctx.moveTo(ax, ay);
                ctx.lineTo(bendX, bendY);
                ctx.lineTo(bx, by);
                ctx.stroke();
                ctx.restore();
            }

            // ── Wire draw pass ──
            ctx.save();
            ctx.lineJoin = "miter";
            ctx.lineCap  = "butt";

            // Selected wires render bold on top of everything in full signal color
            const drawWidth = isSelected ? boldWidth : lineWidth;

            // Horizontal segment
            drawSegment(
                ctx,
                ax, ay, bendX, bendY,
                color, GUTTER_COLOR,
                hShared, isSelected, drawWidth
            );

            // Vertical segment
            drawSegment(
                ctx,
                bendX, bendY, bx, by,
                color, GUTTER_COLOR,
                vShared, isSelected, drawWidth
            );

            ctx.restore();

            // ── Animated flow dots ──
            if (flow) {
                ctx.save();
                // Flow dot always uses signal color so it's visible against the gray gutter
                ctx.fillStyle = color;
                const speed = 5;
                const t = (Date.now() / 1000 * speed) % 1;

                const seg1  = Math.abs(bendX - ax);
                const seg2  = Math.abs(by - bendY);
                const total = seg1 + seg2 || 1;
                const dist  = t * total;

                let dotX, dotY;
                if (dist <= seg1) {
                    const frac = dist / (seg1 || 1);
                    dotX = ax + (bendX - ax) * frac;
                    dotY = ay;
                } else {
                    const frac = (dist - seg1) / (seg2 || 1);
                    dotX = bendX;
                    dotY = bendY + (by - bendY) * frac;
                }

                ctx.beginPath();
                ctx.arc(dotX, dotY, 4, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            }
        };

        console.log("[orthogonal_wires] Phase 2 active — gutter coloring + exit ramps + click-to-highlight.");
    },
});
