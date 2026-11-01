// Shared by a classic worker and Node tests; no model or network access.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.NeckDetector = api;
})(typeof globalThis === "object" ? globalThis : self, function () {
  "use strict";

  const PI = Math.PI;
  const dot = (a, b) => a.x * b.x + a.y * b.y;
  const cross = (a, b) => a.x * b.y - a.y * b.x;
  const difference = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
  const angleDistance = (a, b) => Math.min(Math.abs(a - b), PI - Math.abs(a - b));

  function intersection(a, b) {
    const denominator = cross(a.direction, b.direction);
    if (Math.abs(denominator) < 1e-5) return null;
    const t = cross(difference(b.a, a.a), b.direction) / denominator;
    return { x: a.a.x + t * a.direction.x, y: a.a.y + t * a.direction.y };
  }

  function lineAt(line, axis, position) {
    const along = dot(line.direction, axis);
    if (Math.abs(along) < 1e-5) return null;
    const t = (position - dot(line.a, axis)) / along;
    return { x: line.a.x + t * line.direction.x, y: line.a.y + t * line.direction.y };
  }

  function extent(line, axis) {
    const a = dot(line.a, axis), b = dot(line.b, axis);
    return { min: Math.min(a, b), max: Math.max(a, b) };
  }

  function onSegment(line, point, padding) {
    const t = dot(difference(point, line.a), line.direction);
    return t >= -padding && t <= line.length + padding;
  }

  function median(values) {
    const sorted = values.slice().sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  /**
   * A regular image grid is not evidence of frets. Require a smooth,
   * appreciably shrinking sequence. Perspective can hide that pattern, in
   * which case this conservative detector deliberately declines the frame.
   */
  function fretSequence(wires) {
    if (wires.length < 6 || wires.length > 25) return null;
    let ordered = wires;
    const rawGaps = wires.slice(1).map((wire, i) => wire.t - wires[i].t);
    if (rawGaps[0] < rawGaps[rawGaps.length - 1]) ordered = wires.slice().reverse();
    const gaps = ordered.slice(1).map((wire, i) => Math.abs(wire.t - ordered[i].t));
    if (Math.min(...gaps) < 7) return null;
    const first = (gaps[0] + gaps[1]) / 2;
    const last = (gaps[gaps.length - 1] + gaps[gaps.length - 2]) / 2;
    const contraction = last / first;
    if (contraction > 0.88 || contraction < 0.30) return null;
    const ratios = gaps.slice(1).map((gap, i) => gap / gaps[i]);
    const typical = median(ratios);
    if (typical < 0.74 || typical > 0.995) return null;
    if (ratios.some((ratio) => ratio < 0.68 || ratio > 1.14 || Math.abs(ratio - typical) > 0.16)) return null;
    return ordered;
  }

  function candidateForSides(sideA, sideB, family, lines, axis, normal, width, height) {
    const aExtent = extent(sideA, axis), bExtent = extent(sideB, axis);
    const overlap = Math.min(aExtent.max, bExtent.max) - Math.max(aExtent.min, bExtent.min);
    if (overlap < Math.hypot(width, height) * 0.24) return null;
    // Hough often returns different surviving portions of the same long strings.
    // Their shared support verifies the pair; transverse wires bound the ends.
    const start = Math.min(aExtent.min, bExtent.min), end = Math.max(aExtent.max, bExtent.max);
    const length = end - start;
    if (length < Math.hypot(width, height) * 0.24) return null;
    const middle = (start + end) / 2;
    const aMid = lineAt(sideA, axis, middle), bMid = lineAt(sideB, axis, middle);
    if (!aMid || !bMid) return null;
    const low = dot(aMid, normal), high = dot(bMid, normal), span = high - low;
    if (span < 14 || span > Math.hypot(width, height) * 0.25 || length / span < 3.2) return null;

    const stringOffsets = family.flatMap((line) => {
      const bounds = extent(line, axis);
      if (Math.min(end, bounds.max) - Math.max(start, bounds.min) < length * 0.55) return [];
      const p = lineAt(line, axis, middle);
      const offset = p && dot(p, normal);
      return offset !== null && offset >= low - 1 && offset <= high + 1 ? [offset] : [];
    }).sort((a, b) => a - b);
    // A wood border beside the outer string must not become an extra string.
    // Support the current four- and six-string profiles only, with regular spacing.
    if (stringOffsets.length !== 4 && stringOffsets.length !== 6) return null;
    if (Math.abs(stringOffsets[0] - low) > 2 || Math.abs(stringOffsets[stringOffsets.length - 1] - high) > 2) return null;
    const gaps = stringOffsets.slice(1).map((offset, i) => offset - stringOffsets[i]);
    const typicalGap = median(gaps);
    if (typicalGap < 3 || gaps.some((gap) => gap < typicalGap * 0.72 || gap > typicalGap * 1.3)) return null;
    const continuesOutside = family.some((line) => {
      const bounds = extent(line, axis);
      if (Math.min(end, bounds.max) - Math.max(start, bounds.min) < length * 0.4) return false;
      const point = lineAt(line, axis, middle);
      if (!point) return false;
      const offset = dot(point, normal);
      return Math.abs(offset - (low - typicalGap)) < typicalGap * 0.3
        || Math.abs(offset - (high + typicalGap)) < typicalGap * 0.3;
    });
    // Four central guitar strings are not a four-string neck proposal.
    if (continuesOutside) return null;

    const supports = [];
    for (const line of lines) {
      if (Math.abs(dot(line.direction, axis)) > 0.55) continue;
      const a = intersection(sideA, line), b = intersection(sideB, line);
      if (!a || !b) continue;
      const padding = Math.max(5, span * 0.10);
      if (!onSegment(line, a, padding) || !onSegment(line, b, padding)) continue;
      const t = (dot(a, axis) + dot(b, axis)) / 2;
      if (t < start - 6 || t > end + 6) continue;
      const actualWidth = Math.hypot(a.x - b.x, a.y - b.y);
      if (actualWidth < span * 0.65 || actualWidth > span * 1.45) continue;
      supports.push({ t, a, b, strength: line.length });
    }
    supports.sort((a, b) => a.t - b.t);
    const wires = [];
    let lastSupport = -Infinity;
    for (const support of supports) {
      const previous = wires[wires.length - 1];
      if (previous && support.t - lastSupport < Math.max(5, span * 0.10)) {
        const n = previous.count;
        previous.t = (previous.t * n + support.t) / (n + 1);
        for (const end of ["a", "b"]) {
          previous[end].x = (previous[end].x * n + support[end].x) / (n + 1);
          previous[end].y = (previous[end].y * n + support[end].y) / (n + 1);
        }
        previous.count++;
      } else wires.push({ ...support, a: { ...support.a }, b: { ...support.b }, count: 1 });
      lastSupport = support.t;
    }
    const ordered = fretSequence(wires);
    if (!ordered) return null;
    const first = ordered[0], last = ordered[ordered.length - 1];
    if (Math.abs(last.t - first.t) < length * 0.65) return null;
    const corners = [first.a, first.b, last.a, last.b];
    if (corners.some((p) => p.x < 0 || p.x > width - 1 || p.y < 0 || p.y > height - 1)) return null;
    const polygon = [corners[0], corners[2], corners[3], corners[1]];
    const turns = polygon.map((p, i) => cross(difference(polygon[(i + 1) % 4], p), difference(polygon[(i + 2) % 4], polygon[(i + 1) % 4])));
    if (!turns.every((turn) => turn > 1) && !turns.every((turn) => turn < -1)) return null;
    return {
      points: corners.map((p) => ({ x: p.x / width, y: p.y / height })),
      wireCount: ordered.length,
      score: ordered.length * 3 + stringOffsets.length * 20 + span / length,
    };
  }

  /**
   * Experimental pixel-based outline proposal, not instrument identification.
   * The caller must confirm string side, endpoint fret numbers and alignment.
   * All coordinates are from the unmirrored input. No absolute fret is inferred.
   */
  function detectNeck(cv, rgba, width, height) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 80 || height < 60
      || width > 1280 || height > 1280 || !rgba || rgba.length !== width * height * 4) return null;
    const owned = [];
    const own = (mat) => { owned.push(mat); return mat; };
    try {
      const input = own(new cv.Mat(height, width, cv.CV_8UC4));
      input.data.set(rgba);
      const gray = own(new cv.Mat()), blurred = own(new cv.Mat()), edges = own(new cv.Mat());
      const hough = own(new cv.Mat());
      cv.cvtColor(input, gray, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray, blurred, new cv.Size(3, 3), 0);
      cv.Canny(blurred, edges, 45, 120);
      const edgeFraction = cv.countNonZero(edges) / (width * height);
      if (edgeFraction < 0.002 || edgeFraction > 0.22) return null;
      const diagonal = Math.hypot(width, height);
      cv.HoughLinesP(edges, hough, 1, PI / 720, 20, Math.max(12, diagonal * 0.023), 14);
      const lines = [];
      // Limit parsing as well as candidate search on highly textured scenes.
      for (let i = 0; i < Math.min(hough.rows, 360); i++) {
        const values = hough.data32S;
        const a = { x: values[i * 4], y: values[i * 4 + 1] };
        const b = { x: values[i * 4 + 2], y: values[i * 4 + 3] };
        const delta = difference(b, a), length = Math.hypot(delta.x, delta.y);
        if (!length) continue;
        const angle = (Math.atan2(delta.y, delta.x) + PI) % PI;
        lines.push({ a, b, length, angle, direction: { x: delta.x / length, y: delta.y / length } });
      }
      lines.sort((a, b) => b.length - a.length);
      lines.length = Math.min(lines.length, 180);
      const axes = [];
      for (const line of lines) {
        if (line.length < diagonal * 0.24) break;
        if (axes.every((angle) => angleDistance(line.angle, angle) > PI / 18)) axes.push(line.angle);
        if (axes.length === 5) break;
      }
      let best = null;
      for (const angle of axes) {
        const axis = { x: Math.cos(angle), y: Math.sin(angle) };
        const normal = { x: -axis.y, y: axis.x };
        const parallel = lines.filter((line) => line.length >= diagonal * 0.24 && angleDistance(line.angle, angle) < PI / 22);
        const middle = dot({ x: width / 2, y: height / 2 }, axis);
        const family = [];
        for (const line of parallel) {
          const at = lineAt(line, axis, middle);
          if (!at) continue;
          const offset = dot(at, normal);
          if (family.some((other) => Math.abs(dot(lineAt(other, axis, middle), normal) - offset) < 4.5)) continue;
          family.push(line);
          if (family.length === 14) break;
        }
        family.sort((a, b) => dot(lineAt(a, axis, middle), normal) - dot(lineAt(b, axis, middle), normal));
        let attempts = 0;
        for (let a = 0; a < family.length - 3 && attempts < 60; a++) {
          for (let b = a + 3; b < family.length && attempts < 60; b++) {
            attempts++;
            const candidate = candidateForSides(family[a], family[b], family, lines, axis, normal, width, height);
            if (candidate && (!best || candidate.score > best.score)) best = candidate;
          }
        }
      }
      return best ? { points: best.points, wireCount: best.wireCount } : null;
    } finally {
      for (let index = owned.length - 1; index >= 0; index--) owned[index].delete();
    }
  }

  return { detectNeck };
});
