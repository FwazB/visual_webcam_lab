"use client";

import { type MutableRefObject, type RefObject, useEffect, useRef } from "react";
import * as THREE from "three";

export type DistortionMode = "clean" | "overdrive" | "fuzz" | "glitch" | "strobe";

type MaskSizeRef = MutableRefObject<{ width: number; height: number }>;

type CameraDistortionProps = {
  videoRef: RefObject<HTMLVideoElement | null>;
  levelRef: MutableRefObject<number>;
  peakRef: MutableRefObject<number>;
  maskRef?: MutableRefObject<Float32Array | null>;
  maskSizeRef?: MaskSizeRef;
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
  uniform sampler2D uMask;
  uniform vec2 uResolution;
  uniform vec2 uVideoResolution;
  uniform float uTime;
  uniform float uLevel;
  uniform float uPeak;
  uniform float uEnabled;
  uniform float uHasMask;
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

  vec3 distort(vec2 uv, float drive, float body) {
    vec3 color;

    if (uMode == 1) {
      float wave = sin((uv.y + uTime * 0.45) * 55.0) * 0.0035 * drive * body;
      vec2 warped = uv + vec2(wave, 0.0);
      color = sampleVideo(warped);
      color = saturateColor(color, 1.1 + drive * 1.7 * body);
      color = pow(color, vec3(max(0.5, 1.0 - drive * 0.4 * body)));
      color = smoothstep(vec3(0.02), vec3(0.96), color * (1.0 + drive * 0.85 * body));
    } else if (uMode == 2) {
      float grain = hash(floor(uv * uResolution * 0.55) + floor(uTime * 30.0));
      float wobble = (grain - 0.5) * (0.012 + drive * 0.06) * body;
      vec2 warped = uv + vec2(wobble, sin(uv.x * 80.0 + uTime * 18.0) * 0.007 * drive * body);
      vec2 shift = vec2((0.006 + drive * 0.025) * body, 0.0);
      color.r = sampleVideo(warped + shift).r;
      color.g = sampleVideo(warped).g;
      color.b = sampleVideo(warped - shift).b;
      color = saturateColor(color + (grain - 0.5) * (0.16 + drive * 0.55) * body, 1.2 + drive);
      color = floor(color * (7.0 + 10.0 * (1.0 - drive * body))) / (7.0 + 10.0 * (1.0 - drive * body));
    } else if (uMode == 3) {
      float slice = floor(uv.y * (18.0 + drive * 42.0));
      float sliceNoise = hash(vec2(slice, floor(uTime * 12.0)));
      float active = step(0.58 - drive * 0.32, sliceNoise) * body;
      float offset = (sliceNoise - 0.5) * active * (0.035 + drive * 0.14);
      vec2 warped = uv + vec2(offset, 0.0);
      float block = hash(floor(uv * vec2(24.0, 14.0)) + floor(uTime * 16.0));
      vec2 shift = vec2(active * (0.012 + drive * 0.04), 0.0);
      color.r = sampleVideo(warped + shift).r;
      color.g = sampleVideo(warped).g;
      color.b = sampleVideo(warped - shift).b;
      color = mix(color, color.bgr, step(0.88 - drive * 0.18, block) * 0.65 * body);
    } else {
      float flash = smoothstep(0.48, 1.0, sin(uTime * (10.0 + drive * 28.0)) * 0.5 + 0.5);
      float bars = step(0.78 - drive * 0.28, sin((uv.y + uTime * 0.2) * 95.0) * 0.5 + 0.5);
      vec2 pulseUv = (uv - 0.5) * (1.0 - flash * drive * 0.045 * body) + 0.5;
      color = sampleVideo(pulseUv);
      color = mix(color, vec3(1.0) - color, flash * (0.35 + drive * 0.55) * body);
      color += bars * vec3(0.08, 0.12, 0.16) * (0.4 + drive) * body;
    }

    return clamp(color, 0.0, 1.0);
  }

  void main() {
    float level = clamp(uLevel, 0.0, 1.0);
    float peak = clamp(uPeak, 0.0, 1.0);
    float drive = clamp(level * 3.8 + peak * 2.7, 0.0, 1.0);
    if (uEnabled > 0.5) {
      drive = max(drive, 0.18);
    }
    vec2 uv = vUv;
    vec3 base = sampleVideo(uv);
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

    if (uEnabled < 0.5 || uMode == 0) {
      vec3 outlined = base;
      if (uHasMask > 0.5) {
        outlined = mix(base * 0.75, base + vec3(0.08, 0.04, 0.02), body * 0.35);
        outlined += vec3(1.0, 0.72, 0.14) * maskEdge * 0.55;
      }
      gl_FragColor = vec4(clamp(outlined, 0.0, 1.0), 1.0);
      return;
    }

    vec3 effected = distort(uv, drive, body);
    vec3 background = mix(base * 0.62, saturateColor(base, 0.45), 0.72);
    float bodyMix = clamp(body * (0.78 + drive * 0.45) + drive * 0.16, 0.0, 1.0);
    vec3 color = mix(background, effected, bodyMix);

    vec3 pulse = mix(vec3(1.0, 0.18, 0.04), vec3(1.0, 0.9, 0.18), sin(uTime * 12.0) * 0.5 + 0.5);
    color += pulse * body * drive * 0.34;
    color += pulse * maskEdge * (0.35 + drive * 1.35);
    if (uHasMask < 0.5) {
      color = mix(color, vec3(color.r + drive * 0.18, color.g + drive * 0.06, color.b), 0.45);
    }

    gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
  }
`;

export default function CameraDistortion({
  videoRef,
  levelRef,
  peakRef,
  maskRef,
  maskSizeRef,
  enabled,
  mode,
}: CameraDistortionProps) {
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
      maskTexture?.dispose();
      defaultMaskTexture.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [levelRef, maskRef, maskSizeRef, peakRef, videoRef]);

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className="absolute inset-0 z-[1] h-full w-full overflow-hidden pointer-events-none"
    />
  );
}
