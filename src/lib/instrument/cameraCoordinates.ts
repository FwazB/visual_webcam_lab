import type { NeckPoint } from "./neckMapping";

/** The video and overlay both use object-contain and a horizontal mirror. */
export interface CameraViewport {
  width: number;
  height: number;
  left: number;
  top: number;
}

export function cameraViewport(width: number, height: number, videoWidth: number, videoHeight: number): CameraViewport | null {
  if (![width, height, videoWidth, videoHeight].every(n => Number.isFinite(n) && n > 0)) return null;
  const scale = Math.min(width / videoWidth, height / videoHeight);
  const imageWidth = videoWidth * scale;
  const imageHeight = videoHeight * scale;
  return { width: imageWidth, height: imageHeight, left: (width - imageWidth) / 2, top: (height - imageHeight) / 2 };
}

export function imageToCamera(view: CameraViewport, point: NeckPoint): NeckPoint {
  return { x: view.left + (1 - point.x) * view.width, y: view.top + point.y * view.height };
}

export function cameraToImage(view: CameraViewport, point: NeckPoint): NeckPoint | null {
  const x = 1 - (point.x - view.left) / view.width;
  const y = (point.y - view.top) / view.height;
  return Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
}
