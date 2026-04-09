"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { HandLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

export interface NormalizedLandmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

export interface PoseData {
  landmarks: NormalizedLandmark[];
  // Derived values (0-1 normalized)
  leftPinch: number;  // Left hand pinch (0 = pinched, 1 = spread)
  rightPinch: number; // Right hand pinch (0 = pinched, 1 = spread)
  handX: number; // 0 = left edge, 0.5 = center, 1 = right edge
  handsVisible: boolean;
  leftHandThrow: boolean;   // true when left hand "throw" gesture detected
  rightHandThrow: boolean;  // true when right hand "throw" gesture detected
  leftPinkyTap: number;  // thumb-pinky distance, 0 = touching, 1 = spread
  rightPinkyTap: number;
  leftHandX: number;     // per-hand wrist X (0-1, camera coords)
  rightHandX: number;
}

// Throw detection: velocity-based gesture (flick hand upward to lock)
const THROW_VELOCITY_THRESHOLD = 0.05; // min avg upward velocity (negative y delta per frame)
const THROW_COOLDOWN_MS = 600;         // cooldown between throws
const THROW_ACTIVE_FRAMES = 3;         // frames the throw flag stays true (ensures RAF sync)
const THROW_ANIM_FRAMES = 12;          // visual feedback duration
const VELOCITY_HISTORY_LEN = 4;        // frames of wrist Y to track

// Hand landmark indices
const THUMB_TIP = 4;
const INDEX_TIP = 8;
const PINKY_TIP = 20;
const WRIST = 0;
const MIDDLE_MCP = 9;

export function usePoseTracking(videoRef: React.RefObject<HTMLVideoElement | null>) {
  const [poseData, setPoseData] = useState<PoseData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const handLandmarkerRef = useRef<HandLandmarker | null>(null);
  const animFrameRef = useRef<number>(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const poseDataRef = useRef<PoseData | null>(null);
  const lastStateUpdateRef = useRef<number>(0);

  // Throw detection refs
  const leftWristYHistoryRef = useRef<number[]>([]);
  const rightWristYHistoryRef = useRef<number[]>([]);
  const leftThrowCooldownRef = useRef(0);
  const rightThrowCooldownRef = useRef(0);
  const leftThrowActiveRef = useRef(0);
  const rightThrowActiveRef = useRef(0);
  // Throw visual feedback
  const leftThrowPosRef = useRef<{ x: number; y: number } | null>(null);
  const rightThrowPosRef = useRef<{ x: number; y: number } | null>(null);
  const leftThrowAnimRef = useRef(0);
  const rightThrowAnimRef = useRef(0);

  const setOverlayCanvas = useCallback((canvas: HTMLCanvasElement | null) => {
    canvasRef.current = canvas;
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm"
      );
      if (cancelled) return;

      const handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        numHands: 2,
      });
      if (cancelled) {
        handLandmarker.close();
        return;
      }

      handLandmarkerRef.current = handLandmarker;
      setIsLoading(false);
    }

    init();

    return () => {
      cancelled = true;
      if (handLandmarkerRef.current) {
        handLandmarkerRef.current.close();
        handLandmarkerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (isLoading) return;

    function detect() {
      const video = videoRef.current;
      const handLandmarker = handLandmarkerRef.current;

      if (video && handLandmarker && video.readyState >= 2) {
        const result = handLandmarker.detectForVideo(video, performance.now());

        const canvas = canvasRef.current;
        if (canvas && video.videoWidth > 0) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
          }
        }

        // Draw throw visual feedback
        if (canvas && result.landmarks && result.landmarks.length > 0) {
          const ctx = canvas.getContext("2d");
          if (ctx) {
            // Left hand throw animation
            if (leftThrowAnimRef.current > 0 && leftThrowPosRef.current) {
              const pos = leftThrowPosRef.current;
              const progress = 1 - leftThrowAnimRef.current / THROW_ANIM_FRAMES;
              const alpha = (1 - progress) * 0.8;
              const yOffset = progress * 60;
              const radius = 12 + progress * 20;
              ctx.beginPath();
              ctx.arc(
                pos.x * canvas.width,
                pos.y * canvas.height - yOffset,
                radius,
                0,
                Math.PI * 2
              );
              ctx.fillStyle = `rgba(0, 255, 136, ${alpha * 0.4})`;
              ctx.fill();
              ctx.strokeStyle = `rgba(0, 255, 136, ${alpha})`;
              ctx.lineWidth = 2;
              ctx.stroke();
              leftThrowAnimRef.current--;
            }
            // Right hand throw animation
            if (rightThrowAnimRef.current > 0 && rightThrowPosRef.current) {
              const pos = rightThrowPosRef.current;
              const progress = 1 - rightThrowAnimRef.current / THROW_ANIM_FRAMES;
              const alpha = (1 - progress) * 0.8;
              const yOffset = progress * 60;
              const radius = 12 + progress * 20;
              ctx.beginPath();
              ctx.arc(
                pos.x * canvas.width,
                pos.y * canvas.height - yOffset,
                radius,
                0,
                Math.PI * 2
              );
              ctx.fillStyle = `rgba(255, 136, 0, ${alpha * 0.4})`;
              ctx.fill();
              ctx.strokeStyle = `rgba(255, 136, 0, ${alpha})`;
              ctx.lineWidth = 2;
              ctx.stroke();
              rightThrowAnimRef.current--;
            }
          }
        }

        if (!result.landmarks || result.landmarks.length === 0) {
          // No hands detected — reset to neutral defaults
          leftWristYHistoryRef.current = [];
          rightWristYHistoryRef.current = [];
          const neutralPose: PoseData = {
            landmarks: [],
            leftPinch: 0.5, rightPinch: 0.5,
            handX: 0.5, handsVisible: false,
            leftHandThrow: false, rightHandThrow: false,
            leftPinkyTap: 1, rightPinkyTap: 1,
            leftHandX: 0.5, rightHandX: 0.5,
          };
          poseDataRef.current = neutralPose;
          const now = performance.now();
          if (now - lastStateUpdateRef.current > 100) {
            lastStateUpdateRef.current = now;
            setPoseData(neutralPose);
          }
        } else if (result.landmarks.length > 0) {
          const ctx = canvas?.getContext("2d");
          let leftPinch = 0.5;
          let rightPinch = 0.5;
          let hasLeft = false;
          let hasRight = false;
          let handXSum = 0;
          let handCount = 0;
          let leftPinkyTap = 1;
          let rightPinkyTap = 1;
          let leftHandX = 0.5;
          let rightHandX = 0.5;
          let leftWristY = 1;  // default to bottom (out of save zone)
          let rightWristY = 1;

          for (let i = 0; i < result.landmarks.length; i++) {
            const handLandmarks = result.landmarks[i];
            // MediaPipe returns "Left"/"Right" from camera perspective (mirrored)
            const handedness = result.handednesses?.[i]?.[0]?.categoryName ?? "Right";
            const isLeft = handedness === "Left"; // appears on right side of screen (user's left)

            const thumb = handLandmarks[THUMB_TIP];
            const index = handLandmarks[INDEX_TIP];
            const pinky = handLandmarks[PINKY_TIP];
            const wrist = handLandmarks[WRIST];
            const middleMcp = handLandmarks[MIDDLE_MCP];

            if (!thumb || !index || !wrist || !middleMcp) continue;

            const palmSize = Math.hypot(wrist.x - middleMcp.x, wrist.y - middleMcp.y);
            if (palmSize < 0.01) continue;

            // -- Pinch distance --
            const pinchDist = Math.hypot(thumb.x - index.x, thumb.y - index.y);
            const pinchNorm = Math.max(0, Math.min(1, (pinchDist / palmSize) / 1.2));

            if (isLeft) { leftPinch = pinchNorm; hasLeft = true; }
            else { rightPinch = pinchNorm; hasRight = true; }

            // -- Pinky tap distance --
            if (pinky) {
              const pinkyDist = Math.hypot(thumb.x - pinky.x, thumb.y - pinky.y);
              const pinkyNorm = Math.max(0, Math.min(1, (pinkyDist / palmSize) / 1.2));
              if (isLeft) { leftPinkyTap = pinkyNorm; }
              else { rightPinkyTap = pinkyNorm; }
            }

            // -- Per-hand X position and averaged X for pan --
            if (isLeft) { leftHandX = wrist.x; }
            else { rightHandX = wrist.x; }
            handXSum += wrist.x;
            handCount++;

            // -- Track wrist Y for save zone hysteresis --
            if (isLeft) { leftWristY = wrist.y; }
            else { rightWristY = wrist.y; }

            // -- Drawing --
            if (canvas && ctx) {
              const color = isLeft ? "#00FF88" : "#FF8800";

              // Draw thumb-to-index connection
              ctx.beginPath();
              ctx.moveTo(thumb.x * canvas.width, thumb.y * canvas.height);
              ctx.lineTo(index.x * canvas.width, index.y * canvas.height);
              ctx.strokeStyle = color;
              ctx.lineWidth = 2;
              ctx.stroke();

              // Draw dots on thumb and index
              for (const pt of [thumb, index]) {
                ctx.beginPath();
                ctx.arc(pt.x * canvas.width, pt.y * canvas.height, 8, 0, Math.PI * 2);
                ctx.fillStyle = color + "88";
                ctx.fill();
                ctx.strokeStyle = color;
                ctx.lineWidth = 2;
                ctx.stroke();
              }

            }
          }

          // Average hand X position (0=left, 1=right in camera coords)
          const handX = handCount > 0 ? handXSum / handCount : 0.5;

          // Throw detection: track wrist Y velocity and detect fast upward flicks
          const now = performance.now();

          // Update wrist Y histories
          if (hasLeft) {
            leftWristYHistoryRef.current.push(leftWristY);
            if (leftWristYHistoryRef.current.length > VELOCITY_HISTORY_LEN)
              leftWristYHistoryRef.current.shift();
          } else {
            leftWristYHistoryRef.current = [];
          }
          if (hasRight) {
            rightWristYHistoryRef.current.push(rightWristY);
            if (rightWristYHistoryRef.current.length > VELOCITY_HISTORY_LEN)
              rightWristYHistoryRef.current.shift();
          } else {
            rightWristYHistoryRef.current = [];
          }

          // Detect left hand throw
          let leftThrow = false;
          if (leftThrowActiveRef.current > 0) {
            leftThrowActiveRef.current--;
            leftThrow = true;
          } else if (hasLeft && leftWristYHistoryRef.current.length >= VELOCITY_HISTORY_LEN) {
            const hist = leftWristYHistoryRef.current;
            const vel = (hist[hist.length - 1] - hist[0]) / (hist.length - 1);
            if (vel < -THROW_VELOCITY_THRESHOLD && now - leftThrowCooldownRef.current > THROW_COOLDOWN_MS) {
              leftThrow = true;
              leftThrowActiveRef.current = THROW_ACTIVE_FRAMES;
              leftThrowCooldownRef.current = now;
              leftThrowPosRef.current = { x: leftHandX, y: leftWristY };
              leftThrowAnimRef.current = THROW_ANIM_FRAMES;
            }
          }

          // Detect right hand throw
          let rightThrow = false;
          if (rightThrowActiveRef.current > 0) {
            rightThrowActiveRef.current--;
            rightThrow = true;
          } else if (hasRight && rightWristYHistoryRef.current.length >= VELOCITY_HISTORY_LEN) {
            const hist = rightWristYHistoryRef.current;
            const vel = (hist[hist.length - 1] - hist[0]) / (hist.length - 1);
            if (vel < -THROW_VELOCITY_THRESHOLD && now - rightThrowCooldownRef.current > THROW_COOLDOWN_MS) {
              rightThrow = true;
              rightThrowActiveRef.current = THROW_ACTIVE_FRAMES;
              rightThrowCooldownRef.current = now;
              rightThrowPosRef.current = { x: rightHandX, y: rightWristY };
              rightThrowAnimRef.current = THROW_ANIM_FRAMES;
            }
          }

          const newPoseData: PoseData = {
            landmarks: result.landmarks[0],
            leftPinch: hasLeft ? leftPinch : 0.5,
            rightPinch: hasRight ? rightPinch : 0.5,
            handX,
            handsVisible: true,
            leftHandThrow: leftThrow,
            rightHandThrow: rightThrow,
            leftPinkyTap: hasLeft ? leftPinkyTap : 1,
            rightPinkyTap: hasRight ? rightPinkyTap : 1,
            leftHandX: hasLeft ? leftHandX : 0.5,
            rightHandX: hasRight ? rightHandX : 0.5,
          };

          poseDataRef.current = newPoseData;
          if (now - lastStateUpdateRef.current > 100) {
            lastStateUpdateRef.current = now;
            setPoseData(newPoseData);
          }
        }
      }

      animFrameRef.current = requestAnimationFrame(detect);
    }

    animFrameRef.current = requestAnimationFrame(detect);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [isLoading, videoRef]);

  return { poseData, poseDataRef, isLoading, setOverlayCanvas };
}
