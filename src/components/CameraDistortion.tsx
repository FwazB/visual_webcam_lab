"use client";

import { type MutableRefObject, type RefObject, useEffect, useRef } from "react";
import * as THREE from "three";
import type { ToneProfile } from "@/hooks/useAudioReactiveInput";

export type DistortionMode = "aura" | "echo" | "rift" | "shatter" | "pulse";

type MaskSizeRef = MutableRefObject<{ width: number; height: number }>;

type CameraDistortionProps = {
  videoRef: RefObject<HTMLVideoElement | null>;
  levelRef: MutableRefObject<number>;
  peakRef: MutableRefObject<number>;
  toneRef: MutableRefObject<ToneProfile>;
  maskRef?: MutableRefObject<Float32Array | null>;
  maskSizeRef?: MaskSizeRef;
  enabled: boolean;
  modes: DistortionMode[];
  intensity: number;
  baseColor: string;
};

const MODE_INDEX: Record<DistortionMode, number> = {
  aura: 0,
  echo: 1,
  rift: 2,
  shatter: 3,
  pulse: 4,
};

const TARGET_FRAME_MS = 1000 / 30;
const MAX_DPR = 1.5;

const vertexShader = `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const fragmentShader = `
  precision mediump float;

  uniform sampler2D uVideo;
  uniform sampler2D uMask;
  uniform vec2 uResolution;
  uniform vec2 uVideoResolution;
  uniform float uTime;
  uniform float uLevel;
  uniform float uPeak;
  uniform float uEnabled;
  uniform float uHasMask;
  uniform float uIntensity;
  uniform vec3 uTone;
  uniform vec3 uBaseColor;
  uniform vec4 uModeWeights;
  uniform float uPulseWeight;
  uniform int uMode;

  varying vec2 vUv;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  vec2 coverUv(vec2 uv) {
    vec2 videoResolution = max(uVideoResolution, vec2(1.0));
    vec2 resolution = max(uResolution, vec2(1.0));
    float planeAspect = resolution.x / resolution.y;
    float videoAspect = videoResolution.x / videoResolution.y;
    vec2 scale = vec2(1.0);

    if (planeAspect > videoAspect) {
      scale.y = videoAspect / planeAspect;
    } else {
      scale.x = planeAspect / videoAspect;
    }

    vec2 covered = (uv - 0.5) * scale + 0.5;
    covered.x = 1.0 - covered.x;
    return clamp(covered, vec2(0.0), vec2(1.0));
  }

  vec3 sampleVideo(vec2 uv) {
    return texture2D(uVideo, coverUv(uv)).rgb;
  }

  float sampleBody(vec2 uv) {
    if (uHasMask < 0.5) return 1.0;
    float mask = texture2D(uMask, coverUv(uv)).r;
    return smoothstep(0.38, 0.72, mask);
  }

  vec3 saturateColor(vec3 color, float amount) {
    float gray = dot(color, vec3(0.299, 0.587, 0.114));
    return mix(vec3(gray), color, amount);
  }

  vec3 toneColor() {
    float depth = clamp(uTone.x, 0.0, 1.0);
    float mids = clamp(uTone.y, 0.0, 1.0);
    float highs = clamp(uTone.z, 0.0, 1.0);
    vec3 lowColor = mix(uBaseColor, vec3(1.0, 0.08, 0.02), 0.16 + depth * 0.22);
    vec3 midColor = mix(uBaseColor, vec3(1.0, 0.78, 0.08), 0.12 + mids * 0.18);
    vec3 highColor = mix(uBaseColor, vec3(0.1, 0.82, 1.0), 0.2 + highs * 0.24);
    vec3 warm = mix(midColor, lowColor, depth);
    return clamp(mix(warm, highColor, clamp(highs * 1.2, 0.0, 1.0)) + uBaseColor * 0.22, 0.0, 1.0);
  }

  vec3 project(vec2 uv, float drive, float body, float room, float edge) {
    vec3 base = sampleVideo(uv);
    vec3 palette = toneColor();
    vec3 color;
    float depth = clamp(uTone.x, 0.0, 1.0);
    float mids = clamp(uTone.y, 0.0, 1.0);
    float highs = clamp(uTone.z, 0.0, 1.0);

    if (uMode == 0) {
      float breath = sin(uTime * 1.6 + depth * 4.0) * 0.5 + 0.5;
      float wave = sin((uv.y + uTime * 0.12) * 18.0 + depth * 5.0) * 0.0025 * drive * (0.45 + body);
      vec2 warped = uv + vec2(wave, sin((uv.x + uTime * 0.08) * 12.0) * 0.0015 * drive);
      color = sampleVideo(warped);
      color = mix(color, color * 0.78 + palette * (0.34 + breath * 0.18), room * drive);
      color += palette * body * (0.18 + drive * 0.5);
      color += palette * edge * (0.3 + drive * 0.8);
      color = saturateColor(color, 1.0 + drive * (0.7 + depth * 0.6));
    } else if (uMode == 1) {
      float lag = 0.01 + drive * (0.025 + mids * 0.02);
      vec2 slow = vec2(sin(uTime * 0.35 + uv.y * 4.0), cos(uTime * 0.28 + uv.x * 5.0)) * lag;
      vec3 echoA = sampleVideo(uv - slow * (0.7 + depth));
      vec3 echoB = sampleVideo(uv + slow * (0.55 + highs));
      color = mix(base, echoA * (0.8 + palette * 0.55), clamp(room * 0.65 + body * 0.45, 0.0, 1.0));
      color = mix(color, echoB * (0.55 + palette * 0.7), drive * (0.18 + body * 0.28));
      color += palette * edge * (0.25 + drive);
    } else if (uMode == 2) {
      vec2 center = uv - 0.5;
      float radius = length(center);
      float ripple = sin(radius * (28.0 + depth * 24.0) - uTime * (5.0 + mids * 8.0));
      float wave = ripple * (0.009 + drive * 0.06) * (0.32 + body * 0.9 + room * 0.35);
      vec2 warped = uv + normalize(center + vec2(0.001)) * wave;
      color = sampleVideo(warped);
      color.r = sampleVideo(warped + vec2(wave * 0.45, 0.0)).r;
      color.b = sampleVideo(warped - vec2(wave * 0.45, 0.0)).b;
      color = mix(color, color * (0.75 + palette * 1.25), clamp(body * 0.75 + room * drive * 0.6, 0.0, 1.0));
      color += palette * abs(ripple) * drive * (0.08 + body * 0.24);
    } else if (uMode == 3) {
      float slice = floor(uv.y * (16.0 + drive * 48.0 + highs * 24.0));
      float sliceNoise = hash(vec2(slice, floor(uTime * 12.0)));
      float active = step(0.64 - drive * 0.42 - highs * 0.18, sliceNoise);
      float offset = (sliceNoise - 0.5) * active * (0.018 + drive * 0.12) * (0.35 + body + room * 0.45);
      vec2 warped = uv + vec2(offset, 0.0);
      float block = hash(floor(uv * vec2(24.0, 14.0)) + floor(uTime * (12.0 + highs * 26.0)));
      vec2 shift = vec2(active * (0.006 + drive * 0.04), 0.0);
      color.r = sampleVideo(warped + shift).r;
      color.g = sampleVideo(warped).g;
      color.b = sampleVideo(warped - shift).b;
      color = mix(color, palette, step(0.82 - drive * 0.2, block) * (0.15 + highs * 0.55));
      color = mix(color, color.bgr, step(0.88 - drive * 0.18, block) * (0.3 + highs * 0.5));
      color += palette * edge * (0.22 + highs * 0.9);
    } else {
      float flash = smoothstep(0.42, 1.0, sin(uTime * (7.0 + drive * 32.0 + highs * 16.0)) * 0.5 + 0.5);
      float bars = step(0.76 - drive * 0.34, sin((uv.y + uTime * 0.2) * (70.0 + highs * 90.0)) * 0.5 + 0.5);
      vec2 pulseUv = (uv - 0.5) * (1.0 - flash * drive * (0.025 + body * 0.055)) + 0.5;
      color = sampleVideo(pulseUv);
      color = mix(color, vec3(1.0) - color, flash * drive * (0.16 + body * 0.55 + room * 0.16));
      color += bars * palette * (0.12 + drive * 0.7) * (0.35 + body + room * 0.5);
      color += palette * edge * (0.45 + drive * 1.15);
    }

    return clamp(color, 0.0, 1.0);
  }

  void main() {
    float level = clamp(uLevel, 0.0, 1.0);
    float peak = clamp(uPeak, 0.0, 1.0);
    float active = step(0.5, uEnabled);
    float intensity = clamp(uIntensity, 0.0, 1.0);
    float drive = clamp((level * 3.8 + peak * 2.7) * intensity, 0.0, 1.0) * active;
    drive = max(drive, 0.06 * active * intensity);
    vec2 uv = vUv;
    vec3 base = sampleVideo(uv);
    vec3 palette = toneColor();
    float body = sampleBody(uv);
    float maskEdge = 0.0;

    if (uHasMask > 0.5) {
      vec2 px = 1.5 / max(uResolution, vec2(1.0));
      float mx1 = sampleBody(uv + vec2(px.x, 0.0));
      float mx2 = sampleBody(uv - vec2(px.x, 0.0));
      float my1 = sampleBody(uv + vec2(0.0, px.y));
      float my2 = sampleBody(uv - vec2(0.0, px.y));
      maskEdge = smoothstep(0.12, 0.45, abs(mx1 - mx2) + abs(my1 - my2));
    }

    if (uEnabled < 0.5) {
      vec3 outlined = base;
      if (uHasMask > 0.5) {
        outlined = mix(base * 0.75, base + vec3(0.08, 0.04, 0.02), body * 0.35);
        outlined += vec3(1.0, 0.72, 0.14) * maskEdge * 0.55;
      }
      gl_FragColor = vec4(clamp(outlined, 0.0, 1.0), 1.0);
      return;
    }

    float grid = sin((uv.x + uTime * 0.025) * 46.0) * sin((uv.y - uTime * 0.018) * 32.0);
    float room = clamp(0.05 + drive * 0.52 + uTone.z * 0.1 + smoothstep(0.72, 1.0, grid) * 0.1 * intensity, 0.0, 1.0);
    vec3 effected = project(uv, drive, body, room, maskEdge);
    vec3 background = mix(base * 0.72, base * (0.52 + palette * 0.7), room * drive * 0.78);
    background += palette * smoothstep(0.78, 1.0, grid) * drive * 0.12;
    float projectionMix = clamp(room * drive * 0.48 + body * (0.74 + drive * 0.46), 0.0, 1.0);
    effected = mix(effected, effected * (0.7 + palette * 1.25), clamp(body * drive * 0.58 + room * drive * 0.22, 0.0, 1.0));
    vec3 color = mix(background, effected, projectionMix);

    float auraW = uModeWeights.x;
    float echoW = uModeWeights.y;
    float riftW = uModeWeights.z;
    float shatterW = uModeWeights.w;
    float pulseW = uPulseWeight;

    vec2 slow = vec2(sin(uTime * 0.4 + uv.y * 5.0), cos(uTime * 0.3 + uv.x * 4.0)) * drive * 0.018;
    color = mix(color, sampleVideo(uv - slow) * (0.68 + palette * 0.72), echoW * drive * (0.16 + body * 0.2));

    vec2 center = uv - 0.5;
    float radius = length(center);
    float ripple = sin(radius * 42.0 - uTime * 7.0);
    vec2 riftUv = uv + normalize(center + vec2(0.001)) * ripple * drive * 0.028 * (0.4 + body);
    color = mix(color, sampleVideo(riftUv) * (0.72 + palette * 0.85), riftW * drive * (0.18 + room * 0.16));

    float shard = step(0.88 - drive * 0.18, hash(floor(uv * vec2(28.0, 18.0)) + floor(uTime * 18.0)));
    color = mix(color, color.bgr + palette * 0.35, shatterW * shard * drive * (0.16 + uTone.z * 0.35));

    float flash = smoothstep(0.52, 1.0, sin(uTime * (12.0 + drive * 22.0)) * 0.5 + 0.5);
    color += palette * pulseW * flash * drive * (0.08 + room * 0.18 + body * 0.2);

    vec3 pulse = mix(palette, vec3(1.0, 0.9, 0.18), sin(uTime * (8.0 + uTone.z * 18.0)) * 0.5 + 0.5);
    color += pulse * body * drive * (0.22 + auraW * 0.12);
    color += pulse * maskEdge * (0.35 + drive * 1.35);
    color += palette * room * drive * 0.08;

    gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
  }
`;

export default function CameraDistortion({
  videoRef,
  levelRef,
  peakRef,
  toneRef,
  maskRef,
  maskSizeRef,
  enabled,
  modes,
  intensity,
  baseColor,
}: CameraDistortionProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const enabledRef = useRef(enabled);
  const modesRef = useRef(modes);
  const intensityRef = useRef(intensity);
  const baseColorRef = useRef(baseColor);

  useEffect(() => {
    enabledRef.current = enabled;
    modesRef.current = modes;
    intensityRef.current = intensity;
    baseColorRef.current = baseColor;
  }, [baseColor, enabled, intensity, modes]);

  useEffect(() => {
    const container = containerRef.current;
    const video = videoRef.current;

    if (!container || !video) {
      return;
    }

    let animationFrame = 0;
    let lastFrameTime = 0;
    let disposed = false;
    let maskTexture: THREE.DataTexture | null = null;
    let maskBytes: Uint8Array | null = null;

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: false,
      powerPreference: "high-performance",
    });
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.style.position = "absolute";
    renderer.domElement.style.inset = "0";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const geometry = new THREE.PlaneGeometry(2, 2);
    const texture = new THREE.VideoTexture(video);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;

    const emptyMask = new Uint8Array([255, 255, 255, 255]);
    const defaultMaskTexture = new THREE.DataTexture(
      emptyMask,
      1,
      1,
      THREE.RGBAFormat,
    );
    defaultMaskTexture.needsUpdate = true;

    const uniforms = {
      uVideo: { value: texture },
      uMask: { value: defaultMaskTexture },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uVideoResolution: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uLevel: { value: 0 },
      uPeak: { value: 0 },
      uEnabled: { value: enabledRef.current ? 1 : 0 },
      uHasMask: { value: 0 },
      uIntensity: { value: intensityRef.current },
      uTone: { value: new THREE.Vector3(0, 0, 0) },
      uBaseColor: { value: new THREE.Vector3(1, 0.48, 0.09) },
      uModeWeights: { value: new THREE.Vector4(1, 0, 0, 0) },
      uPulseWeight: { value: 0 },
      uMode: { value: MODE_INDEX[modesRef.current[0] ?? "aura"] },
    };

    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    const resize = () => {
      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);

      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));
      renderer.setSize(width, height, false);
      uniforms.uResolution.value.set(width, height);
    };

    const updateMaskTexture = () => {
      const mask = maskRef?.current;
      const width = maskSizeRef?.current.width ?? 0;
      const height = maskSizeRef?.current.height ?? 0;

      if (!mask || width <= 0 || height <= 0 || mask.length < width * height) {
        uniforms.uHasMask.value = 0;
        uniforms.uMask.value = defaultMaskTexture;
        return;
      }

      const requiredLength = width * height * 4;
      if (!maskBytes || maskBytes.length !== requiredLength) {
        maskBytes = new Uint8Array(requiredLength);
        maskTexture?.dispose();
        maskTexture = new THREE.DataTexture(maskBytes, width, height, THREE.RGBAFormat);
        maskTexture.minFilter = THREE.LinearFilter;
        maskTexture.magFilter = THREE.LinearFilter;
        maskTexture.generateMipmaps = false;
      }

      const activeMaskTexture = maskTexture;
      if (!activeMaskTexture) {
        uniforms.uHasMask.value = 0;
        uniforms.uMask.value = defaultMaskTexture;
        return;
      }

      for (let i = 0; i < width * height; i++) {
        const value = Math.max(0, Math.min(255, Math.round(mask[i] * 255)));
        const idx = i * 4;
        maskBytes[idx] = value;
        maskBytes[idx + 1] = value;
        maskBytes[idx + 2] = value;
        maskBytes[idx + 3] = 255;
      }

      activeMaskTexture.needsUpdate = true;
      uniforms.uHasMask.value = 1;
      uniforms.uMask.value = activeMaskTexture;
    };

    const render = (time: number) => {
      if (disposed) return;

      animationFrame = requestAnimationFrame(render);

      if (time - lastFrameTime < TARGET_FRAME_MS) {
        return;
      }
      lastFrameTime = time;

      if (video.videoWidth <= 0 || video.videoHeight <= 0) {
        return;
      }

      uniforms.uVideoResolution.value.set(video.videoWidth, video.videoHeight);

      updateMaskTexture();
      uniforms.uTime.value = time * 0.001;
      uniforms.uLevel.value = Number.isFinite(levelRef.current) ? levelRef.current : 0;
      uniforms.uPeak.value = Number.isFinite(peakRef.current) ? peakRef.current : 0;
      uniforms.uTone.value.set(
        Number.isFinite(toneRef.current.depth) ? toneRef.current.depth : 0,
        Number.isFinite(toneRef.current.mid) ? toneRef.current.mid : 0,
        Number.isFinite(toneRef.current.high) ? toneRef.current.high : 0,
      );
      uniforms.uIntensity.value = Number.isFinite(intensityRef.current)
        ? intensityRef.current
        : 1;
      uniforms.uBaseColor.value.set(...hexToRgb(baseColorRef.current));
      uniforms.uEnabled.value = enabledRef.current ? 1 : 0;
      const activeModes: DistortionMode[] =
        modesRef.current.length > 0 ? modesRef.current : ["aura"];
      uniforms.uMode.value = MODE_INDEX[activeModes[0] ?? "aura"];
      uniforms.uModeWeights.value.set(
        activeModes.includes("aura") ? 1 : 0,
        activeModes.includes("echo") ? 1 : 0,
        activeModes.includes("rift") ? 1 : 0,
        activeModes.includes("shatter") ? 1 : 0,
      );
      uniforms.uPulseWeight.value = activeModes.includes("pulse") ? 1 : 0;

      renderer.render(scene, camera);
    };

    resize();

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    window.addEventListener("resize", resize);
    animationFrame = requestAnimationFrame(render);

    return () => {
      disposed = true;
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      window.removeEventListener("resize", resize);

      scene.remove(mesh);
      geometry.dispose();
      material.dispose();
      texture.dispose();
      maskTexture?.dispose();
      defaultMaskTexture.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [levelRef, maskRef, maskSizeRef, peakRef, toneRef, videoRef]);

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className="absolute inset-0 z-[1] h-full w-full overflow-hidden pointer-events-none"
    />
  );
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.slice(1) : "ff7a18";
  const value = Number.parseInt(normalized, 16);
  return [
    ((value >> 16) & 255) / 255,
    ((value >> 8) & 255) / 255,
    (value & 255) / 255,
  ];
}
