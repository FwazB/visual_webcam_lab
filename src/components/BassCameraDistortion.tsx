"use client";

import { type MutableRefObject, type RefObject, useEffect, useRef } from "react";
import * as THREE from "three";

export type DistortionMode = "clean" | "overdrive" | "fuzz" | "glitch" | "strobe";

type BassCameraDistortionProps = {
  videoRef: RefObject<HTMLVideoElement | null>;
  levelRef: MutableRefObject<number>;
  peakRef: MutableRefObject<number>;
  enabled: boolean;
  mode: DistortionMode;
};

const MODE_INDEX: Record<DistortionMode, number> = {
  clean: 0,
  overdrive: 1,
  fuzz: 2,
  glitch: 3,
  strobe: 4,
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
  uniform vec2 uResolution;
  uniform vec2 uVideoResolution;
  uniform float uTime;
  uniform float uLevel;
  uniform float uPeak;
  uniform float uEnabled;
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

  vec3 saturateColor(vec3 color, float amount) {
    float gray = dot(color, vec3(0.299, 0.587, 0.114));
    return mix(vec3(gray), color, amount);
  }

  void main() {
    float level = clamp(uLevel, 0.0, 1.0);
    float peak = clamp(uPeak, 0.0, 1.0);
    vec2 uv = vUv;

    if (uEnabled < 0.5 || uMode == 0) {
      gl_FragColor = vec4(sampleVideo(uv), 1.0);
      return;
    }

    float drive = level * 0.75 + peak * 0.55;
    vec3 color;

    if (uMode == 1) {
      float wave = sin((uv.y + uTime * 0.45) * 55.0) * 0.0025 * drive;
      vec2 warped = uv + vec2(wave, 0.0);
      color = sampleVideo(warped);
      color = saturateColor(color, 1.2 + drive * 1.4);
      color = pow(color, vec3(max(0.55, 1.0 - drive * 0.35)));
      color = smoothstep(vec3(0.02), vec3(0.96), color * (1.0 + drive * 0.65));
    } else if (uMode == 2) {
      float grain = hash(floor(uv * uResolution * 0.55) + floor(uTime * 30.0));
      float wobble = (grain - 0.5) * (0.012 + drive * 0.045);
      vec2 warped = uv + vec2(wobble, sin(uv.x * 80.0 + uTime * 18.0) * 0.004 * drive);
      vec2 shift = vec2(0.006 + drive * 0.018, 0.0);
      color.r = sampleVideo(warped + shift).r;
      color.g = sampleVideo(warped).g;
      color.b = sampleVideo(warped - shift).b;
      color = saturateColor(color + (grain - 0.5) * (0.18 + drive * 0.4), 1.5 + peak);
      color = floor(color * (7.0 + 10.0 * (1.0 - peak))) / (7.0 + 10.0 * (1.0 - peak));
    } else if (uMode == 3) {
      float slice = floor(uv.y * (18.0 + peak * 42.0));
      float sliceNoise = hash(vec2(slice, floor(uTime * 12.0)));
      float active = step(0.58 - peak * 0.32, sliceNoise);
      float offset = (sliceNoise - 0.5) * active * (0.035 + drive * 0.12);
      vec2 warped = uv + vec2(offset, 0.0);
      float block = hash(floor(uv * vec2(24.0, 14.0)) + floor(uTime * 16.0));
      vec2 shift = vec2(active * (0.012 + drive * 0.03), 0.0);
      color.r = sampleVideo(warped + shift).r;
      color.g = sampleVideo(warped).g;
      color.b = sampleVideo(warped - shift).b;
      color = mix(color, color.bgr, step(0.88 - peak * 0.18, block) * 0.65);
    } else {
      float flash = smoothstep(0.48, 1.0, sin(uTime * (10.0 + peak * 28.0)) * 0.5 + 0.5);
      float bars = step(0.78 - peak * 0.28, sin((uv.y + uTime * 0.2) * 95.0) * 0.5 + 0.5);
      vec2 pulseUv = (uv - 0.5) * (1.0 - flash * drive * 0.035) + 0.5;
      color = sampleVideo(pulseUv);
      color = mix(color * 0.2, vec3(1.0) - color, flash * (0.35 + peak * 0.5));
      color += bars * vec3(0.08, 0.12, 0.16) * (0.4 + drive);
    }

    gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
  }
`;

export default function BassCameraDistortion({
  videoRef,
  levelRef,
  peakRef,
  enabled,
  mode,
}: BassCameraDistortionProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const enabledRef = useRef(enabled);
  const modeRef = useRef(mode);

  useEffect(() => {
    enabledRef.current = enabled;
    modeRef.current = mode;
  }, [enabled, mode]);

  useEffect(() => {
    const container = containerRef.current;
    const video = videoRef.current;

    if (!container || !video) {
      return;
    }

    let animationFrame = 0;
    let lastFrameTime = 0;
    let disposed = false;

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: false,
      powerPreference: "high-performance",
    });
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const geometry = new THREE.PlaneGeometry(2, 2);
    const texture = new THREE.VideoTexture(video);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;

    const uniforms = {
      uVideo: { value: texture },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uVideoResolution: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uLevel: { value: 0 },
      uPeak: { value: 0 },
      uEnabled: { value: enabledRef.current ? 1 : 0 },
      uMode: { value: MODE_INDEX[modeRef.current] },
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

    const render = (time: number) => {
      if (disposed) {
        return;
      }

      animationFrame = requestAnimationFrame(render);

      if (time - lastFrameTime < TARGET_FRAME_MS) {
        return;
      }
      lastFrameTime = time;

      if (video.videoWidth > 0 && video.videoHeight > 0) {
        uniforms.uVideoResolution.value.set(video.videoWidth, video.videoHeight);
      }

      uniforms.uTime.value = time * 0.001;
      uniforms.uLevel.value = Number.isFinite(levelRef.current) ? levelRef.current : 0;
      uniforms.uPeak.value = Number.isFinite(peakRef.current) ? peakRef.current : 0;
      uniforms.uEnabled.value = enabledRef.current ? 1 : 0;
      uniforms.uMode.value = MODE_INDEX[modeRef.current];

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
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [levelRef, peakRef, videoRef]);

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className="absolute inset-0 h-full w-full overflow-hidden pointer-events-none"
    />
  );
}
