// orthogonal_wires.js
// ComfyUI extension: replaces Bezier curves with orthogonal L-bend wire routing.
// Strategy: exit the source node horizontally, travel to the destination's X, then turn vertical.
//
// Install: drop this file into ComfyUI/web/extensions/
// No restart needed if you use the "Load" button in ComfyUI, otherwise restart the server.

import { app } from "../../scripts/app.js";

app.registerExtension({
    name: "orthogonal_wires",

    async setup() {
        // Store the original renderLink in case we need to fall back
        const originalRenderLink = LGraphCanvas.prototype.renderLink;

        LGraphCanvas.prototype.renderLink = function (
            ctx,
            a,          // [x, y] start point (output slot position)
            b,          // [x, y] end point   (input slot position)
            link,       // link data object
            skip_border,
            flow,
            color,
            start_dir,
            end_dir,
            num_sublines
        ) {
            // If either endpoint is missing, fall back to default
            if (!a || !b) {
                return originalRenderLink.apply(this, arguments);
            }

            const ax = a[0], ay = a[1];
            const bx = b[0], by = b[1];

            // Bend point: travel horizontally from source to destination's X, then turn vertical
            const bendX = bx;
            const bendY = ay;

            // --- Resolve wire color the same way LiteGraph does ---
            if (!color && link) {
                color = LGraphCanvas.link_type_colors[link.type] || this.default_link_color;
            }
            if (!color) {
                color = this.default_link_color;
            }

            // --- Draw the border/shadow pass if needed ---
            if (!skip_border && this.render_connections_border && this.ds.scale > 0.6) {
                ctx.save();
                ctx.strokeStyle = "rgba(0,0,0,0.5)";
                ctx.lineWidth = (num_sublines || 1) * (this.connections_width + 2);
                ctx.lineJoin = "miter";
                ctx.lineCap = "butt";
                ctx.beginPath();
                ctx.moveTo(ax, ay);
                ctx.lineTo(bendX, bendY);
                ctx.lineTo(bx, by);
                ctx.stroke();
                ctx.restore();
            }

            // --- Draw the wire ---
            ctx.save();
            ctx.strokeStyle = color;
            ctx.lineWidth = (num_sublines || 1) * this.connections_width;
            ctx.lineJoin = "miter";
            ctx.lineCap = "butt";

            // Highlight selected link
            if (this.highlighted_links && link && this.highlighted_links[link.id]) {
                ctx.strokeStyle = "#FFF";
                ctx.lineWidth = (num_sublines || 1) * (this.connections_width * 2);
            }

            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(bendX, bendY);   // horizontal segment
            ctx.lineTo(bx, by);          // vertical segment
            ctx.stroke();

            // --- Draw animated flow dots if requested ---
            if (flow) {
                ctx.fillStyle = color;
                const speed = 5;
                const t = (Date.now() / 1000 * speed) % 1;

                // Total path length (Manhattan distance through the bend)
                const seg1 = Math.abs(bendX - ax);
                const seg2 = Math.abs(by - bendY);
                const total = seg1 + seg2 || 1;

                // Place a dot along the L-path at position t
                const dist = t * total;
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
            }

            ctx.restore();
        };

        console.log("[orthogonal_wires] Wire rendering patched — L-bend routing active.");
    },
});
