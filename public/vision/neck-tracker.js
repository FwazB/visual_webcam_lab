/* global module */
(function (root, factory) {
  const exported = factory();
  if (typeof module === "object" && module.exports) module.exports = exported;
  root.NeckTracker = exported.NeckTracker;
})(typeof globalThis !== "undefined" ? globalThis : self, function () {
  "use strict";

  const MIN_FEATURES = 18;
  const MIN_MATCHES = 12;
  const MIN_INLIERS = 10;
  const RATIO = 0.74;
  const lost = () => ({ status: "lost", points: null, inliers: 0 });
  const ordered = (points) => [points[0], points[2], points[3], points[1]];
  const area = (points) => ordered(points).reduce((sum, p, i, polygon) => {
    const next = polygon[(i + 1) % 4];
    return sum + p.x * next.y - next.x * p.y;
  }, 0) / 2;
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  function validQuad(points) {
    if (!Array.isArray(points) || points.length !== 4 || points.some((p) => !p
      || !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)) return false;
    const polygon = ordered(points);
    const turns = polygon.map((p, i) => {
      const n = polygon[(i + 1) % 4], after = polygon[(i + 2) % 4];
      return (n.x - p.x) * (after.y - n.y) - (n.y - p.y) * (after.x - n.x);
    });
    return Math.abs(area(points)) >= 0.002
      && (turns.every((turn) => turn > 1e-7) || turns.every((turn) => turn < -1e-7));
  }

  function project(matrix, point) {
    const d = matrix[6] * point.x + matrix[7] * point.y + matrix[8];
    if (!Number.isFinite(d) || Math.abs(d) < 1e-8) return null;
    const x = (matrix[0] * point.x + matrix[1] * point.y + matrix[2]) / d;
    const y = (matrix[3] * point.x + matrix[4] * point.y + matrix[5]) / d;
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  }

  function validFrame(rgba, width, height) {
    return rgba instanceof Uint8ClampedArray && Number.isInteger(width) && Number.isInteger(height)
      && width >= 32 && height >= 32 && width <= 4096 && height <= 4096 && rgba.length === width * height * 4;
  }

  function spread(points, imageToUnit) {
    const mapped = points.map((point) => project(imageToUnit, point)).filter(Boolean);
    if (mapped.length < MIN_INLIERS) return false;
    const us = mapped.map((p) => p.x), vs = mapped.map((p) => p.y);
    const lengthBins = new Set(mapped.map((p) => Math.max(0, Math.min(3, Math.floor(p.x * 4)))));
    return Math.max(...us) - Math.min(...us) >= 0.45 && Math.max(...vs) - Math.min(...vs) >= 0.35 && lengthBins.size >= 3;
  }

  // Each reference owns immutable descriptors and coordinates. Updates never
  // replace it with a current crop or chain frame-to-frame transformations.
  class NeckTracker {
    constructor(cv) {
      this.cv = cv;
      this.reference = null;
      this.lastPose = null;
      this.wasLost = true;
      this.disposed = false;
      this.orb = null;
      this.matcher = null;
      try {
        // The neck is narrow: default ORB's 31px border discards useful detail.
        // Keep a bounded allowance for faint upper-neck detail when dense
        // lower frets compete for features; spatial confidence stays unchanged.
        this.orb = new cv.ORB(1800, 1.2, 8, 8, 0, 2, cv.ORB_HARRIS_SCORE, 21, 10);
        this.matcher = new cv.BFMatcher(cv.NORM_HAMMING, false);
      } catch (error) {
        this.orb?.delete();
        this.matcher?.delete();
        throw error;
      }
    }

    mask(width, height, points, exclusions) {
      const cv = this.cv;
      const mask = new cv.Mat(height, width, cv.CV_8UC1, new cv.Scalar(points ? 0 : 255));
      try {
        if (points) {
          const polygon = ordered(points).map((p) => ({ x: p.x * width, y: p.y * height }));
          const sign = Math.sign(area(points));
          const minX = Math.max(0, Math.floor(Math.min(...polygon.map((p) => p.x))));
          const maxX = Math.min(width - 1, Math.ceil(Math.max(...polygon.map((p) => p.x))));
          const minY = Math.max(0, Math.floor(Math.min(...polygon.map((p) => p.y))));
          const maxY = Math.min(height - 1, Math.ceil(Math.max(...polygon.map((p) => p.y))));
          for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
              if (polygon.every((p, i) => {
                const next = polygon[(i + 1) % 4];
                return sign * ((next.x - p.x) * (y - p.y) - (next.y - p.y) * (x - p.x)) >= 0;
              })) mask.data[y * width + x] = 255;
            }
          }
        }
        for (const box of exclusions) {
          if (!box || ![box.x, box.y, box.width, box.height].every(Number.isFinite) || box.width <= 0 || box.height <= 0) continue;
          // Exclude descriptor neighborhoods too, not just a keypoint's center.
          const left = Math.max(0, Math.min(width, Math.floor(box.x * width) - 12));
          const right = Math.max(0, Math.min(width, Math.ceil((box.x + box.width) * width) + 12));
          const top = Math.max(0, Math.min(height, Math.floor(box.y * height) - 12));
          const bottom = Math.max(0, Math.min(height, Math.ceil((box.y + box.height) * height) + 12));
          if (left >= right || top >= bottom) continue;
          for (let y = top; y < bottom; y++) mask.data.fill(0, y * width + left, y * width + right);
        }
        return mask;
      } catch (error) {
        mask.delete();
        throw error;
      }
    }

    features(rgba, width, height, points, exclusions) {
      const cv = this.cv;
      let image, gray, mask, keypoints, descriptors;
      let retained = false;
      try {
        image = new cv.Mat(height, width, cv.CV_8UC4);
        image.data.set(rgba);
        gray = new cv.Mat();
        cv.cvtColor(image, gray, cv.COLOR_RGBA2GRAY);
        mask = this.mask(width, height, points, exclusions);
        keypoints = new cv.KeyPointVector();
        descriptors = new cv.Mat();
        this.orb.detectAndCompute(gray, mask, keypoints, descriptors);
        const coordinates = [];
        for (let i = 0; i < keypoints.size(); i++) {
          const point = keypoints.get(i).pt;
          coordinates.push({ x: point.x, y: point.y });
        }
        retained = true;
        return { coordinates, descriptors };
      } finally {
        image?.delete(); gray?.delete(); mask?.delete(); keypoints?.delete();
        if (!retained) descriptors?.delete();
      }
    }

    seed(rgba, width, height, pointsNormalized, exclusions = []) {
      this.reset();
      if (this.disposed || !validFrame(rgba, width, height) || !validQuad(pointsNormalized)) return lost();
      const cv = this.cv;
      let found, source, destination, mapping;
      let retained = false;
      try {
        found = this.features(rgba, width, height, pointsNormalized, exclusions);
        if (found.coordinates.length < MIN_FEATURES || found.descriptors.empty()) return lost();
        const corners = pointsNormalized.map((p) => ({ x: p.x * width, y: p.y * height }));
        source = cv.matFromArray(4, 1, cv.CV_32FC2, corners.flatMap((p) => [p.x, p.y]));
        destination = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, 0, 1, 1, 0, 1, 1]);
        mapping = cv.getPerspectiveTransform(source, destination);
        const imageToUnit = Array.from(mapping.data64F);
        if (!spread(found.coordinates, imageToUnit)) return lost();
        this.reference = {
          width, height, corners, imageToUnit,
          points: pointsNormalized.map((p) => ({ x: p.x, y: p.y })),
          coordinates: found.coordinates, descriptors: found.descriptors,
        };
        retained = true;
        this.wasLost = false;
        this.lastPose = pointsNormalized.map((p) => ({ ...p }));
        return { status: "tracking", points: this.reference.points.map((p) => ({ ...p })), inliers: found.coordinates.length };
      } finally {
        source?.delete(); destination?.delete(); mapping?.delete();
        if (!retained) found?.descriptors.delete();
      }
    }

    ratioMatches(query, train) {
      const cv = this.cv;
      const pairs = new cv.DMatchVectorVector();
      const accepted = new Map();
      try {
        this.matcher.knnMatch(query, train, pairs, 2);
        for (let i = 0; i < pairs.size(); i++) {
          const matches = pairs.get(i);
          try {
            if (matches.size() < 2) continue;
            const best = matches.get(0), second = matches.get(1);
            if (best.distance < second.distance * RATIO && best.distance <= 64) accepted.set(best.queryIdx, best.trainIdx);
          } finally { matches.delete(); }
        }
        return accepted;
      } finally { pairs.delete(); }
    }

    update(rgba, width, height, exclusions = []) {
      // Whole-frame ORB can spend its feature budget on a textured room rather
      // than the narrow neck. Search near the last verified pose first, while
      // continuing to match against the immutable original descriptors.
      if (this.lastPose) {
        // A diagonal neck's axis-aligned box also covers the player's face and
        // room. Keep the local feature budget in a padded neck-shaped corridor.
        const pixels = this.lastPose.map((p) => ({ x: p.x * width, y: p.y * height }));
        const along = { x: (pixels[2].x + pixels[3].x - pixels[0].x - pixels[1].x) / 2,
          y: (pixels[2].y + pixels[3].y - pixels[0].y - pixels[1].y) / 2 };
        const across = { x: (pixels[1].x + pixels[3].x - pixels[0].x - pixels[2].x) / 2,
          y: (pixels[1].y + pixels[3].y - pixels[0].y - pixels[2].y) / 2 };
        const length = Math.hypot(along.x, along.y), span = Math.hypot(across.x, across.y);
        const padding = Math.max(16, Math.min(width, height) * 0.06);
        const region = pixels.map((point, i) => ({
          x: Math.max(0, Math.min(1, (point.x + (i < 2 ? -1 : 1) * along.x / length * padding
            + (i % 2 ? 1 : -1) * across.x / span * padding) / width)),
          y: Math.max(0, Math.min(1, (point.y + (i < 2 ? -1 : 1) * along.y / length * padding
            + (i % 2 ? 1 : -1) * across.y / span * padding) / height)),
        }));
        const previouslyLost = this.wasLost;
        const nearby = this.matchFrame(rgba, width, height, exclusions, region);
        if (nearby.status !== "lost") {
          this.lastPose = nearby.points.map((p) => ({ ...p }));
          return nearby;
        }
        // A failed local search is internal to this frame, not a published
        // tracking loss. A large move can still match anywhere in the image.
        this.wasLost = previouslyLost;
      }
      const anywhere = this.matchFrame(rgba, width, height, exclusions, null);
      if (anywhere.status !== "lost") this.lastPose = anywhere.points.map((p) => ({ ...p }));
      return anywhere;
    }

    matchFrame(rgba, width, height, exclusions, searchRegion) {
      const reference = this.reference;
      if (this.disposed || !reference || !validFrame(rgba, width, height) || reference.width !== width || reference.height !== height) {
        this.wasLost = true;
        return lost();
      }
      const cv = this.cv;
      let current, source, destination, inlierMask, homography;
      let accepted = false;
      try {
        current = this.features(rgba, width, height, searchRegion, exclusions);
        if (current.coordinates.length < MIN_MATCHES || current.descriptors.empty()) return lost();
        const forward = this.ratioMatches(reference.descriptors, current.descriptors);
        const reverse = this.ratioMatches(current.descriptors, reference.descriptors);
        const matches = [...forward].filter(([ref, cur]) => reverse.get(cur) === ref);
        if (matches.length < MIN_MATCHES) return lost();
        const refPoints = matches.map(([ref]) => reference.coordinates[ref]);
        const curPoints = matches.map(([, cur]) => current.coordinates[cur]);
        source = cv.matFromArray(matches.length, 1, cv.CV_32FC2, refPoints.flatMap((p) => [p.x, p.y]));
        destination = cv.matFromArray(matches.length, 1, cv.CV_32FC2, curPoints.flatMap((p) => [p.x, p.y]));
        inlierMask = new cv.Mat();
        const threshold = Math.max(1.5, width / 640 * 2.5);
        homography = cv.findHomography(source, destination, cv.RANSAC, threshold, inlierMask, 2000, 0.995);
        if (homography.empty()) return lost();
        const matrix = Array.from(homography.data64F);
        if (matrix.length !== 9 || matrix.some((n) => !Number.isFinite(n))) return lost();
        const refInliers = [], errors = [];
        for (let i = 0; i < matches.length; i++) {
          if (!inlierMask.data[i]) continue;
          const projected = project(matrix, refPoints[i]);
          if (!projected) return lost();
          refInliers.push(refPoints[i]);
          errors.push(distance(projected, curPoints[i]));
        }
        if (refInliers.length < MIN_INLIERS || refInliers.length / matches.length < 0.6 || !spread(refInliers, reference.imageToUnit)) return lost();
        errors.sort((a, b) => a - b);
        if (errors[Math.floor(errors.length / 2)] > threshold * 0.65) return lost();
        const projected = reference.corners.map((point) => project(matrix, point));
        if (projected.some((p) => !p)) return lost();
        const points = projected.map((p) => ({ x: p.x / width, y: p.y / height }));
        if (!validQuad(points) || Math.sign(area(points)) !== Math.sign(area(reference.points))) return lost();
        const areaRatio = Math.abs(area(points) / area(reference.points));
        if (areaRatio < 0.2 || areaRatio > 4) return lost();
        const denominators = reference.corners.map((p) => matrix[6] * p.x + matrix[7] * p.y + matrix[8]);
        if (!denominators.every((d) => d > 1e-8) && !denominators.every((d) => d < -1e-8)) return lost();
        for (const [a, b] of [[0, 1], [0, 2], [1, 3], [2, 3]]) {
          const ratio = distance(projected[a], projected[b]) / distance(reference.corners[a], reference.corners[b]);
          if (ratio < 0.25 || ratio > 3) return lost();
        }
        const status = this.wasLost ? "reacquired" : "tracking";
        this.wasLost = false;
        accepted = true;
        return { status, points, inliers: refInliers.length };
      } finally {
        current?.descriptors.delete(); source?.delete(); destination?.delete(); inlierMask?.delete(); homography?.delete();
        if (!accepted) this.wasLost = true;
      }
    }

    reset() {
      this.reference?.descriptors.delete();
      this.reference = null;
      this.lastPose = null;
      this.wasLost = true;
    }

    dispose() {
      if (this.disposed) return;
      this.reset();
      this.orb?.delete(); this.matcher?.delete();
      this.orb = this.matcher = null;
      this.disposed = true;
    }
  }

  return { NeckTracker };
});
