// Renders the home page's black prism (public/ascii/black-prism.js) as the site's
// link preview, 1200×630, a seamless loop: public/og-prism.mp4 for og:video
// (iMessage autoplays it, muted and looping) and public/og-prism.gif for og:image.
// Run: bun run og
import type { Frame } from "ascii.rest";
import ffmpeg from "ffmpeg-static";
import sharp from "sharp";
import * as prism from "../public/ascii/black-prism.js";

const WIDTH = 1200;
const HEIGHT = 630;
const CELL = 6; // pixels a cell: 200×100 cells → 1200×600
const FPS = 15;
const LOOP = (2 * Math.PI) / 1.6; // the piece's pulse period, in seconds
const FRAMES = Math.round(LOOP * FPS);
const BG = [0x17, 0x17, 0x17]; // --theme-bg, dark
const DOTS = " ·•●";
const COVER = [0, 0.3, 0.6, 1]; // the piece's dot fill against the largest
const R_MAX = CELL * 0.48;
const SS = 4; // supersamples a pixel side, for antialiased dots

const { cols, rows, palette } = prism.meta;
const top = Math.floor((HEIGHT - rows * CELL) / 2);
const inks = palette.map((hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)));

// One CELL×CELL alpha stamp a dot size, its area following COVER.
const stamps = COVER.map((cover) => {
    const r = R_MAX * Math.sqrt(cover);
    const stamp = new Float32Array(CELL * CELL);
    for (let y = 0; y < CELL; y++)
        for (let x = 0; x < CELL; x++) {
            let hit = 0;
            for (let j = 0; j < SS; j++)
                for (let i = 0; i < SS; i++) {
                    const dx = x + (i + 0.5) / SS - CELL / 2, dy = y + (j + 0.5) / SS - CELL / 2;
                    if (dx * dx + dy * dy <= r * r) hit++;
                }
            stamp[y * CELL + x] = hit / (SS * SS);
        }
    return stamp;
});

// The page's mask on the piece: sides fade over 12%, the bottom over its last 30%.
const smooth = (a: number, b: number, v: number) => {
    const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
    return t * t * (3 - 2 * t);
};

/** The piece at `t` seconds as RGB floats, 0–255. */
function render(frame: Frame, t: number): Float32Array {
    const color = new Uint8Array(cols * rows);
    const text = frame(t, { color }).split("\n");
    const rgb = new Float32Array(WIDTH * HEIGHT * 3);
    for (let p = 0; p < WIDTH * HEIGHT; p++) rgb.set(BG, p * 3);
    for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
            const step = DOTS.indexOf(text[r]![c]!);
            if (step <= 0) continue;
            const ink = inks[color[r * cols + c]!]!;
            const stamp = stamps[step]!;
            for (let y = 0; y < CELL; y++)
                for (let x = 0; x < CELL; x++) {
                    const px = c * CELL + x, py = top + r * CELL + y;
                    const u = (px + 0.5) / WIDTH, v = (py + 0.5 - top) / (rows * CELL);
                    const a = stamp[y * CELL + x]! * smooth(0, 0.12, u) * smooth(0, 0.12, 1 - u) * smooth(1, 0.7, v);
                    if (a <= 0) continue;
                    const k = (py * WIDTH + px) * 3;
                    for (let ch = 0; ch < 3; ch++) rgb[k + ch] = BG[ch]! + (ink[ch]! - BG[ch]!) * a;
                }
        }
    return rgb;
}

// The piece doesn't repeat, so blend each moment with the one a loop earlier:
// at t = 0 it is f(0), and as t nears LOOP it is f(t - LOOP) → f(0) again.
const now = prism.default();
const before = prism.default();
const frames = Buffer.alloc(WIDTH * HEIGHT * 3 * FRAMES);
for (let i = 0; i < FRAMES; i++) {
    const t = i / FPS;
    const w = t / LOOP;
    const a = render(now, t);
    const b = render(before, t - LOOP);
    const off = i * WIDTH * HEIGHT * 3;
    for (let k = 0; k < a.length; k++) frames[off + k] = Math.round(a[k]! * (1 - w) + b[k]! * w);
}

const gif = new URL("../public/og-prism.gif", import.meta.url).pathname;
await sharp(frames, { raw: { width: WIDTH, height: HEIGHT * FRAMES, channels: 3, pageHeight: HEIGHT } })
    // 64 colours and lossy inter-frame deltas keep it near 400 KB, small enough for chat apps' preview fetchers.
    .gif({ loop: 0, delay: Array(FRAMES).fill(Math.round(1000 / FPS)), effort: 10, colours: 64, interFrameMaxError: 6 })
    .toFile(gif);
console.log(`${gif}: ${FRAMES} frames`);

// H.264 in yuv420p with the index up front: what Messages and browsers play inline.
const mp4 = new URL("../public/og-prism.mp4", import.meta.url).pathname;
const encode = Bun.spawn(
    [ffmpeg!, "-y", "-loglevel", "error",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${WIDTH}x${HEIGHT}`, "-r", String(FPS), "-i", "-",
        "-c:v", "libx264", "-preset", "veryslow", "-crf", "20", "-tune", "animation",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", mp4],
    { stdin: frames, stdout: "inherit", stderr: "inherit" },
);
if ((await encode.exited) !== 0) throw new Error(`ffmpeg exited with ${encode.exitCode}`);
console.log(`${mp4}: ${FRAMES} frames`);
