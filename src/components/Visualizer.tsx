"use client";

import { useRef, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { AudioParams } from "@/hooks/useAudioEngine";
import type { PoseData } from "@/hooks/usePoseTracking";

interface ParticleFieldProps {
  audioParams: AudioParams;
  poseData: PoseData | null;
  getWaveformData: () => Float32Array;
}

const PARTICLE_COUNT = 800;

function ParticleField({ audioParams, poseData, getWaveformData }: ParticleFieldProps) {
  const meshRef = useRef<THREE.Points>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  const { positions, velocities } = useMemo(() => {
    const pos = new Float32Array(PARTICLE_COUNT * 3);
    const vel = new Float32Array(PARTICLE_COUNT * 3);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 10;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 6;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 4;
      vel[i * 3] = (Math.random() - 0.5) * 0.02;
      vel[i * 3 + 1] = (Math.random() - 0.5) * 0.02;
      vel[i * 3 + 2] = (Math.random() - 0.5) * 0.01;
    }
    return { positions: pos, velocities: vel };
  }, []);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uFilterFreq: { value: 2000 },
      uReverbWet: { value: 0 },
      uDistortion: { value: 0 },
      uColor1: { value: new THREE.Color("#00ff88") },
      uColor2: { value: new THREE.Color("#ff0088") },
    }),
    []
  );

  useFrame((state) => {
    if (!meshRef.current) return;

    const waveform = getWaveformData();
    const geometry = meshRef.current.geometry;
    const posAttr = geometry.getAttribute("position") as THREE.BufferAttribute;
    const posArray = posAttr.array as Float32Array;

    // Update uniforms
    uniforms.uTime.value = state.clock.elapsedTime;
    uniforms.uFilterFreq.value = audioParams.filterFreq;
    uniforms.uReverbWet.value = audioParams.reverbWet;
    uniforms.uDistortion.value = audioParams.distortion;

    // Audio-reactive particle movement
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const waveIdx = i % waveform.length;
      const waveVal = waveform[waveIdx] || 0;

      posArray[i * 3] += velocities[i * 3] + waveVal * 0.03;
      posArray[i * 3 + 1] += velocities[i * 3 + 1] + waveVal * 0.02;
      posArray[i * 3 + 2] += velocities[i * 3 + 2];

      // Attract toward hand positions if pose data exists
      if (poseData) {
        const targetX = (poseData.landmarks[15].x - 0.5) * 10; // left wrist
        const targetY = (0.5 - poseData.landmarks[15].y) * 6;
        const dx = targetX - posArray[i * 3];
        const dy = targetY - posArray[i * 3 + 1];
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 3) {
          const force = (3 - dist) / 3 * 0.005;
          posArray[i * 3] += dx * force;
          posArray[i * 3 + 1] += dy * force;
        }
      }

      // Wrap around bounds
      if (posArray[i * 3] > 5) posArray[i * 3] = -5;
      if (posArray[i * 3] < -5) posArray[i * 3] = 5;
      if (posArray[i * 3 + 1] > 3) posArray[i * 3 + 1] = -3;
      if (posArray[i * 3 + 1] < -3) posArray[i * 3 + 1] = 3;
      if (posArray[i * 3 + 2] > 2) posArray[i * 3 + 2] = -2;
      if (posArray[i * 3 + 2] < -2) posArray[i * 3 + 2] = 2;
    }

    posAttr.needsUpdate = true;
  });

  const positionAttr = useMemo(
    () => new THREE.BufferAttribute(positions, 3),
    [positions]
  );

  return (
    <points ref={meshRef}>
      <bufferGeometry>
        <primitive object={positionAttr} attach="attributes-position" />
      </bufferGeometry>
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        vertexShader={`
          uniform float uTime;
          uniform float uFilterFreq;
          uniform float uDistortion;
          varying float vIntensity;

          void main() {
            vIntensity = uFilterFreq / 8000.0;
            vec3 pos = position;
            pos.y += sin(uTime * 2.0 + position.x) * uDistortion * 0.3;
            vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
            gl_PointSize = (3.0 + uDistortion * 5.0) * (300.0 / -mvPosition.z);
            gl_Position = projectionMatrix * mvPosition;
          }
        `}
        fragmentShader={`
          uniform vec3 uColor1;
          uniform vec3 uColor2;
          uniform float uReverbWet;
          varying float vIntensity;

          void main() {
            float d = length(gl_PointCoord - vec2(0.5));
            if (d > 0.5) discard;
            float alpha = smoothstep(0.5, 0.0, d);
            vec3 color = mix(uColor1, uColor2, vIntensity + uReverbWet);
            gl_FragColor = vec4(color, alpha * 0.8);
          }
        `}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

interface VisualizerProps {
  audioParams: AudioParams;
  poseData: PoseData | null;
  getWaveformData: () => Float32Array;
}

export default function Visualizer({ audioParams, poseData, getWaveformData }: VisualizerProps) {
  return (
    <Canvas
      camera={{ position: [0, 0, 5], fov: 60 }}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
      }}
      gl={{ alpha: true }}
    >
      <ParticleField
        audioParams={audioParams}
        poseData={poseData}
        getWaveformData={getWaveformData}
      />
    </Canvas>
  );
}
