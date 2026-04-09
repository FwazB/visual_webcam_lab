"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useBodySegmentation } from "@/hooks/useBodySegmentation";

// ASCII style presets
const STYLES = {
  dense:    { name: "Dense",    ramp: " `.-':_,^=;><+!rc*/z?sLTv)J7(|Fi{C}fI31tlu[neoZ5Yxjya]2ESwqkP6h9d4VpOGbUAKXHm8RD#$Bg0MNWQ%&@" },
  simple:   { name: "Simple",   ramp: " .:-=+*#%@" },
  blocks:   { name: "Blocks",   ramp: " ░░▒▒▓▓██" },
  dots:     { name: "Dots",     ramp: " ·∙•●⬤" },
  binary:   { name: "Binary",   ramp: " 01" },
  katakana: { name: "Katakana", ramp: " ｦｱｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ" },
} as const;
type StyleKey = keyof typeof STYLES;
const STYLE_KEYS = Object.keys(STYLES) as StyleKey[];

// Color theme presets
const THEMES = {
  color:  { name: "Color",  fg: null,              bg: null },              // original pixel colors
  matrix: { name: "Matrix", fg: [0, 255, 70],      bg: [0, 255, 70] },     // green
  amber:  { name: "Amber",  fg: [255, 176, 0],     bg: [255, 176, 0] },    // amber
  cyan:   { name: "Cyan",   fg: [0, 255, 255],     bg: [0, 255, 255] },    // cyan
  purple: { name: "Purple", fg: [200, 80, 255],    bg: [200, 80, 255] },   // purple
  white:  { name: "White",  fg: [255, 255, 255],   bg: [255, 255, 255] },  // white
} as const;
type ThemeKey = keyof typeof THEMES;
const THEME_KEYS = Object.keys(THEMES) as ThemeKey[];

const CELL_W = 6;
const CELL_H = 10;
const BG_DIM = 0.3;       // background brightness multiplier
const FG_BOOST = 1.35;    // foreground brightness boost

export default function AsciiCamera() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [webcamReady, setWebcamReady] = useState(false);
  const [theme, setTheme] = useState<ThemeKey>("color");
  const [style, setStyle] = useState<StyleKey>("dense");
  const rafRef = useRef<number>(0);

  const { isLoading, maskRef, maskSizeRef, startSegmentation } =
    useBodySegmentation(videoRef);

  // Start webcam
  useEffect(() => {
    let stream: MediaStream | null = null;

    async function initCamera() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 1280, height: 720, facingMode: "user" },
          audio: false,
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadeddata = () => setWebcamReady(true);
        }
      } catch (err) {
        console.error("Camera access denied:", err);
      }
    }

    initCamera();

    return () => {
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Start segmentation once webcam is ready and model is loaded
  useEffect(() => {
    if (webcamReady && !isLoading) {
      startSegmentation();
    }
  }, [webcamReady, isLoading, startSegmentation]);

  // ASCII render loop
  const renderAscii = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const sampleCanvas = sampleCanvasRef.current;
    if (!video || !canvas || !sampleCanvas || video.readyState < 2) {
      rafRef.current = requestAnimationFrame(renderAscii);
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Calculate grid dimensions from display size
    const displayW = canvas.width;
    const displayH = canvas.height;
    const cols = Math.floor(displayW / CELL_W);
    const rows = Math.floor(displayH / CELL_H);

    // Sample video at grid resolution
    const sCtx = sampleCanvas.getContext("2d", { willReadFrequently: true });
    if (!sCtx) return;
    sampleCanvas.width = cols;
    sampleCanvas.height = rows;

    // Mirror horizontally to match selfie view
    sCtx.save();
    sCtx.scale(-1, 1);
    sCtx.drawImage(video, -cols, 0, cols, rows);
    sCtx.restore();

    const imageData = sCtx.getImageData(0, 0, cols, rows);
    const pixels = imageData.data;

    const mask = maskRef.current;
    const maskW = maskSizeRef.current.width;
    const maskH = maskSizeRef.current.height;

    const ramp = STYLES[style].ramp;
    const themeColors = THEMES[theme];

    // Clear
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, displayW, displayH);

    ctx.font = `${CELL_H}px monospace`;
    ctx.textBaseline = "top";

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const pIdx = (row * cols + col) * 4;
        const r = pixels[pIdx];
        const g = pixels[pIdx + 1];
        const b = pixels[pIdx + 2];

        // Check segmentation mask
        let isPerson = true;
        if (mask && maskW > 0 && maskH > 0) {
          const maskX = Math.floor(((cols - 1 - col) / cols) * maskW);
          const maskY = Math.floor((row / rows) * maskH);
          const maskIdx = maskY * maskW + maskX;
          isPerson = mask[maskIdx] > 0.5;
        }

        // Boost foreground, dim background
        const mult = isPerson ? FG_BOOST : BG_DIM;
        const dr = Math.min(255, r * mult);
        const dg = Math.min(255, g * mult);
        const db = Math.min(255, b * mult);

        // Perceived brightness (luminance)
        const brightness = (0.299 * dr + 0.587 * dg + 0.114 * db) / 255;
        const charIdx = Math.floor(brightness * (ramp.length - 1));
        const char = ramp[charIdx];

        if (char === " ") continue;

        if (themeColors.fg === null) {
          // Color mode — use original (boosted/dimmed) pixel colors
          ctx.fillStyle = `rgb(${Math.round(dr)},${Math.round(dg)},${Math.round(db)})`;
        } else {
          // Mono mode — tint with theme color, scale by brightness
          const intensity = isPerson ? brightness : brightness * BG_DIM;
          const [tr, tg, tb] = themeColors.fg;
          ctx.fillStyle = `rgb(${Math.round(tr * intensity)},${Math.round(tg * intensity)},${Math.round(tb * intensity)})`;
        }

        ctx.fillText(char, col * CELL_W, row * CELL_H);
      }
    }

    rafRef.current = requestAnimationFrame(renderAscii);
  }, [maskRef, maskSizeRef, theme, style]);

  // Start/stop render loop
  useEffect(() => {
    if (webcamReady) {
      rafRef.current = requestAnimationFrame(renderAscii);
    }
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [webcamReady, renderAscii]);

  // Resize canvas to fill window
  useEffect(() => {
    function resize() {
      if (canvasRef.current) {
        canvasRef.current.width = window.innerWidth;
        canvasRef.current.height = window.innerHeight;
      }
    }
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  return (
    <div className="relative w-full h-screen bg-black overflow-hidden">
      {/* Hidden video element */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="absolute opacity-0 pointer-events-none"
      />

      {/* Hidden sampling canvas */}
      <canvas ref={sampleCanvasRef} className="hidden" />

      {/* ASCII output canvas */}
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

      {/* Status overlay */}
      <div className="absolute top-4 left-4 text-white/60 text-sm font-mono select-none">
        {!webcamReady
          ? "Starting webcam..."
          : isLoading
            ? "Loading segmentation model..."
            : ""}
      </div>

      {/* Controls */}
      <div className="absolute bottom-4 right-4 flex gap-3 items-end">
        {/* Style picker */}
        <div className="flex flex-col gap-1">
          <span className="text-white/40 text-[10px] font-mono uppercase tracking-wider">style</span>
          <div className="flex gap-1">
            {STYLE_KEYS.map((k) => (
              <button
                key={k}
                onClick={() => setStyle(k)}
                className={`px-2 py-1 text-xs font-mono rounded transition-colors ${
                  style === k
                    ? "bg-white/25 text-white"
                    : "bg-white/5 text-white/50 hover:bg-white/15 hover:text-white/80"
                }`}
              >
                {STYLES[k].name}
              </button>
            ))}
          </div>
        </div>

        {/* Theme picker */}
        <div className="flex flex-col gap-1">
          <span className="text-white/40 text-[10px] font-mono uppercase tracking-wider">color</span>
          <div className="flex gap-1">
            {THEME_KEYS.map((k) => (
              <button
                key={k}
                onClick={() => setTheme(k)}
                className={`px-2 py-1 text-xs font-mono rounded transition-colors ${
                  theme === k
                    ? "bg-white/25 text-white"
                    : "bg-white/5 text-white/50 hover:bg-white/15 hover:text-white/80"
                }`}
              >
                {THEMES[k].name}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
