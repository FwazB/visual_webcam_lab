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
      frets: ordered.map((wire) => ({
        a: { x: wire.a.x / width, y: wire.a.y / height },
        b: { x: wire.b.x / width, y: wire.b.y / height },
      })),
      score: ordered.length * 3 + stringOffsets.length * 20 + span / length,
    };
  }

  // Faint strings can disappear at webcam resolution while the metal fret wires
  // remain visible. Extract bright transverse ridges instead of requiring every
  // string to survive an edge detector. This still proposes geometry only.
  function detectFretRidges(cv, gray, width, height) {
    const owned = [];
    const own = (mat) => { owned.push(mat); return mat; };
    const diagonal = Math.hypot(width, height);
    try {
      const edges = own(new cv.Mat()), hough = own(new cv.Mat());
      const ridge = own(new cv.Mat(height, width, cv.CV_8UC1));
      cv.Canny(gray, edges, 35, 100);
      cv.HoughLinesP(edges, hough, 1, PI / 720, 20, diagonal * 0.14, 14);
      const directions = [];
      for (let i = 0; i < Math.min(hough.rows, 1000); i++) {
        const values = hough.data32S;
        const dx = values[i * 4 + 2] - values[i * 4], dy = values[i * 4 + 3] - values[i * 4 + 1];
        directions.push({ angle: (Math.atan2(dy, dx) + PI) % PI, length: Math.hypot(dx, dy) });
      }
      directions.sort((a, b) => b.length - a.length);
      const axes = [];
      for (const line of directions) {
        if (axes.every((angle) => angleDistance(angle, line.angle) > PI / 45)) axes.push(line.angle);
        if (axes.length === 10) break;
      }
      let lines = [];
      const pixels = gray.data;
      for (const angle of axes) {
        const ax = Math.cos(angle), ay = Math.sin(angle), transverse = (angle + PI / 2) % PI;
        ridge.data.fill(0);
        for (let y = 4; y < height - 4; y++) {
          for (let x = 4; x < width - 4; x++) {
            const left = pixels[Math.round(y - ay * 3) * width + Math.round(x - ax * 3)];
            const right = pixels[Math.round(y + ay * 3) * width + Math.round(x + ax * 3)];
            if (pixels[y * width + x] > Math.max(left, right) + 7) ridge.data[y * width + x] = 255;
          }
        }
        cv.HoughLinesP(ridge, hough, 1, PI / 720, 10, 18, 5);
        for (let i = 0; i < Math.min(hough.rows, 2000); i++) {
          const values = hough.data32S;
          const a = { x: values[i * 4], y: values[i * 4 + 1] };
          const b = { x: values[i * 4 + 2], y: values[i * 4 + 3] };
          const length = Math.hypot(b.x - a.x, b.y - a.y);
          const foundAngle = (Math.atan2(b.y - a.y, b.x - a.x) + PI) % PI;
          // Perspective does not preserve right angles. A diagonal neck can
          // have visible frets more than six degrees from the apparent normal.
          // The later cadence, rail-fit and string checks establish the neck.
          if (length < 18 || length > diagonal * 0.14 || angleDistance(foundAngle, transverse) > PI / 12) continue;
          const dx = (b.x - a.x) / length, dy = (b.y - a.y) / length;
          // Hough can stop midway across a fret. Follow its visible ridge to
          // the actual endpoint; reaching the image edge means it is cropped.
          const extend = (point, sign) => {
            let last = { ...point }, missed = 0;
            for (let step = 1; step <= 60; step++) {
              const x = Math.round(point.x + sign * dx * step), y = Math.round(point.y + sign * dy * step);
              if (x < 4 || x >= width - 4 || y < 4 || y >= height - 4) return null;
              let supported = false;
              for (let shift = -1; shift <= 1; shift++) {
                if (ridge.data[Math.round(y + ay * shift) * width + Math.round(x + ax * shift)]) supported = true;
              }
              if (supported) { last = { x, y }; missed = 0; }
              else if (++missed >= 4) break;
            }
            return last;
          };
          const start = extend(a, -1), end = extend(b, 1);
          if (!start || !end) continue;
          const fullLength = Math.hypot(end.x - start.x, end.y - start.y);
          if (fullLength > diagonal * 0.18) continue;
          lines.push({ a: start, b: end, length: fullLength, angle: foundAngle,
            center: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 } });
          // A textured scene must not turn into unbounded candidate searches.
          if (lines.length > 1200) return null;
        }
      }

      // Repeated Hough detections of one physical ridge can have different
      // overhanging endpoints. Merge them before ordering wires, rather than
      // allowing a duplicate to become a tiny extra fret gap.
      const clusters = [];
      for (const line of lines) {
        const cluster = clusters.find(({ representative: other }) => {
          if (angleDistance(line.angle, other.angle) > PI / 36) return false;
          const direction = { x: Math.cos(other.angle), y: Math.sin(other.angle) };
          const delta = difference(line.center, other.center);
          return Math.abs(cross(direction, delta)) < 3.2
            && Math.abs(dot(direction, delta)) < Math.min(line.length, other.length) * 0.4;
        });
        if (cluster) cluster.members.push(line);
        else clusters.push({ representative: line, members: [line] });
      }
      lines = clusters.map(({ representative, members }) => {
        const direction = { x: Math.cos(representative.angle), y: Math.sin(representative.angle) };
        const normal = { x: -direction.y, y: direction.x };
        const offsets = members.map((line) => dot(line.center, normal));
        const starts = members.map((line) => Math.min(dot(line.a, direction), dot(line.b, direction)));
        const ends = members.map((line) => Math.max(dot(line.a, direction), dot(line.b, direction)));
        const n = median(offsets), start = median(starts), end = median(ends);
        const a = { x: direction.x * start + normal.x * n, y: direction.y * start + normal.y * n };
        const b = { x: direction.x * end + normal.x * n, y: direction.y * end + normal.y * n };
        return { a, b, length: end - start, angle: representative.angle,
          center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
      });

      function fit(points) {
        const meanT = points.reduce((sum, p) => sum + p.t, 0) / points.length;
        const meanN = points.reduce((sum, p) => sum + p.n, 0) / points.length;
        const denominator = points.reduce((sum, p) => sum + (p.t - meanT) ** 2, 0);
        if (!denominator) return null;
        const slope = points.reduce((sum, p) => sum + (p.t - meanT) * (p.n - meanN), 0) / denominator;
        const at = (t) => meanN + slope * (t - meanT);
        const residual = Math.sqrt(points.reduce((sum, p) => sum + (p.n - at(p.t)) ** 2, 0) / points.length);
        return { at, slope, residual };
      }

      function runs(wires) {
        const found = new Map();
        for (const ordered of [wires, wires.slice().reverse()]) {
          for (let i = 0; i < ordered.length - 5; i++) {
            for (let j = i + 1; j < Math.min(ordered.length - 4, i + 4); j++) {
              for (let k = j + 1; k < Math.min(ordered.length - 3, j + 4); k++) {
                const firstGap = Math.abs(ordered[j].t - ordered[i].t);
                const secondGap = Math.abs(ordered[k].t - ordered[j].t);
                const observedRatio = secondGap / firstGap;
                if (firstGap < 7 || observedRatio < 0.82 || observedRatio > 1.06) continue;
                // The first three pixel positions are noisy. Also try the
                // equal-temperament spacing as a seed, then adapt it to the
                // observed perspective. No predicted fret is ever emitted.
                for (const initialRatio of [observedRatio, 2 ** (-1 / 12)]) {
                  let ratio = initialRatio;
                  const run = [ordered[i], ordered[j], ordered[k]];
                  let gap = secondGap, at = k, missing = 0, estimates = 1;
                  let pendingStart = -1, confirmations = 0;
                  const fittedGaps = [firstGap, secondGap];
                  while (at < ordered.length - 1) {
                    let match = null, predicted = 0;
                    // Prefer the next actual wire before considering a hand-sized
                    // gap. Ignore unrelated ridges instead of ending the run at
                    // the first outlier. Every accepted bridge needs a separate
                    // three-wire cadence on its far side.
                    const maxSteps = pendingStart >= 0 ? 1 : 6 - missing;
                    for (let steps = 1; steps <= maxSteps && !match; steps++) {
                      predicted += gap * ratio ** steps;
                      const tolerance = steps === 1 ? Math.max(1.8, predicted * 0.12) : Math.max(2.2, predicted * 0.06);
                      let error = Infinity;
                      for (let next = at + 1; next < ordered.length; next++) {
                        const observed = Math.abs(ordered[next].t - ordered[at].t);
                        if (observed > predicted + tolerance) break;
                        if (steps === 1 && (observed / gap < 0.78 || observed / gap > 1.08)) continue;
                        const difference = Math.abs(observed - predicted);
                        if (difference <= tolerance && difference < error) {
                          match = { next, observed, steps, predicted }; error = difference;
                        }
                      }
                    }
                    if (!match) break;
                    const { next, observed, steps } = match;
                    if (steps > 1) {
                      pendingStart = run.length; confirmations = 0; missing += steps - 1;
                      gap = gap * ratio ** steps * observed / match.predicted;
                    } else {
                      const localRatio = observed / gap;
                      gap = observed;
                      ratio = (ratio * estimates + localRatio) / ++estimates;
                      if (pendingStart >= 0 && ++confirmations >= 2) pendingStart = -1;
                    }
                    fittedGaps.push(gap);
                    run.push(ordered[next]); at = next;
                  }
                  if (pendingStart >= 0) { run.length = pendingStart; fittedGaps.length = pendingStart - 1; }
                  if (run.length < 6) continue;
                  const contraction = (fittedGaps.at(-1) + fittedGaps.at(-2)) / (fittedGaps[0] + fittedGaps[1]);
                  if (contraction <= 0.90 && contraction >= 0.30) found.set(run.map((wire) => wire.t).join(","), run);
                }
              }
            }
          }
        }
        return Array.from(found.values()).sort((a, b) => b.length - a.length).slice(0, 12);
      }

      // Transverse fret endpoints describe the wood edges, not string centers.
      // Resolve the two outer string rails from longitudinal bright-ridge
      // evidence inside those edges, with additional interior string support.
      function stringEdges(points) {
        const corners = points.map((p) => ({ x: p.x * width, y: p.y * height }));
        const value = (x, y) => pixels[Math.max(0, Math.min(height - 1, Math.round(y))) * width + Math.max(0, Math.min(width - 1, Math.round(x)))];
        const profile = [];
        for (let index = 0; index <= 100; index++) {
          const fraction = index / 100;
          let contrastSum = 0, supported = 0;
          for (let sample = 0; sample < 80; sample++) {
            const t = 0.05 + 0.90 * sample / 79;
            const low = { x: corners[0].x + (corners[2].x - corners[0].x) * t, y: corners[0].y + (corners[2].y - corners[0].y) * t };
            const high = { x: corners[1].x + (corners[3].x - corners[1].x) * t, y: corners[1].y + (corners[3].y - corners[1].y) * t };
            const dx = high.x - low.x, dy = high.y - low.y, span = Math.hypot(dx, dy);
            const x = low.x + dx * fraction, y = low.y + dy * fraction;
            const contrast = value(x, y) - Math.max(value(x + dx / span * 3, y + dy / span * 3), value(x - dx / span * 3, y - dy / span * 3));
            contrastSum += Math.max(0, contrast);
            if (contrast > 4) supported++;
          }
          profile.push({ fraction, score: contrastSum / 80, coverage: supported / 80 });
        }
        const peak = (min, max) => profile.filter((p) => p.fraction >= min && p.fraction <= max)
          .sort((a, b) => b.score - a.score)[0];
        const low = peak(0, 0.15), high = peak(0.85, 1);
        if (low.score < 1.5 || high.score < 1.5 || low.coverage < 0.10 || high.coverage < 0.10) return null;
        const internal = profile.filter((p, i) => i > 0 && i < profile.length - 1 && p.fraction > low.fraction + 0.10
          && p.fraction < high.fraction - 0.10 && p.score >= 2 && p.coverage >= 0.15
          && p.score > profile[i - 1].score && p.score >= profile[i + 1].score);
        if (!internal.some((a) => internal.some((b) => Math.abs(a.fraction - b.fraction) > 0.10))) return null;
        const between = (a, b, fraction) => ({ x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction });
        return [between(points[0], points[1], low.fraction), between(points[0], points[1], high.fraction),
          between(points[2], points[3], low.fraction), between(points[2], points[3], high.fraction)];
      }

      let best = null, checked = 0;
      for (const seed of lines) {
        for (const adjustment of [-0.06, 0, 0.06]) {
          const angle = seed.angle - PI / 2 + adjustment;
          const axis = { x: Math.cos(angle), y: Math.sin(angle) }, normal = { x: -axis.y, y: axis.x };
          const centerN = dot(seed.center, normal), centerT = dot(seed.center, axis);
          // Keep both visible sides of a hand in the same search family. The
          // fitted rails still have to agree across the complete observed run.
          const family = lines.filter((line) => angleDistance(line.angle, seed.angle) < PI / 18
            && line.length > seed.length * 0.58 && line.length < seed.length * 1.65
            && Math.abs(dot(line.center, normal) - centerN) < seed.length * 0.60
            && Math.abs(dot(line.center, axis) - centerT) < seed.length * 14);
          if (family.length < 6 || family.length > 100) continue;
          const supports = family.map((line) => ({
            t: dot(line.center, axis),
            low: Math.min(dot(line.a, normal), dot(line.b, normal)),
            high: Math.max(dot(line.a, normal), dot(line.b, normal)),
            a: line.a,
            b: line.b,
          })).sort((a, b) => a.t - b.t);
          const wires = [];
          for (const support of supports) {
            const previous = wires.at(-1);
            if (previous && support.t - previous.t < 4) {
              if (support.high - support.low > previous.high - previous.low) Object.assign(previous, support);
            } else wires.push({ ...support });
          }
          if (wires.length < 6 || wires.length > 40) continue;
          for (const run of runs(wires)) {
            if (++checked > 4000) return best;
            const low = fit(run.map((p) => ({ t: p.t, n: p.low })));
            const high = fit(run.map((p) => ({ t: p.t, n: p.high })));
            if (!low || !high) continue;
            const first = run[0], last = run.at(-1), length = Math.abs(first.t - last.t);
            const firstSpan = high.at(first.t) - low.at(first.t), lastSpan = high.at(last.t) - low.at(last.t);
            const span = (firstSpan + lastSpan) / 2;
            if (Math.min(firstSpan, lastSpan) < 14 || length < diagonal * 0.16 || length / span < 3
              || low.residual > span * 0.12 || high.residual > span * 0.12
              || Math.abs(low.slope) > 0.25 || Math.abs(high.slope) > 0.25) continue;
            const from = (t, n) => ({ x: (axis.x * t + normal.x * n) / width, y: (axis.y * t + normal.y * n) / height });
            const points = [from(first.t, low.at(first.t)), from(first.t, high.at(first.t)),
              from(last.t, low.at(last.t)), from(last.t, high.at(last.t))];
            // Cropped wires cannot establish the unseen outer string edge.
            if (points.some((p) => p.x * width < 6 || p.x * width > width - 6 || p.y * height < 6 || p.y * height > height - 6)) continue;
            const score = run.length * 10 + length / span - low.residual - high.residual;
            if (!best || score > best.score) {
              const refined = stringEdges(points);
              if (!refined) continue;
              const pixelCorners = refined.map((p) => ({ x: p.x * width, y: p.y * height }));
              const rails = [0, 1].map((side) => ({ a: pixelCorners[side],
                direction: difference(pixelCorners[side + 2], pixelCorners[side]) }));
              // Preserve each observed wire's position and angle. Only trim its
              // overhanging metal ends to the two supported outer-string rails.
              const frets = run.map((wire) => {
                const line = { a: wire.a, direction: difference(wire.b, wire.a) };
                const ends = rails.map((rail) => intersection(rail, line));
                if (ends.some((p) => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y)
                  || p.x < 0 || p.x >= width || p.y < 0 || p.y >= height)) return null;
                return { a: { x: ends[0].x / width, y: ends[0].y / height },
                  b: { x: ends[1].x / width, y: ends[1].y / height } };
              });
              if (frets.some((wire) => !wire)) continue;
              best = { points: [frets[0].a, frets[0].b, frets.at(-1).a, frets.at(-1).b],
                frets, wireCount: frets.length, score };
            }
          }
        }
      }
      return best;
    } finally {
      for (let index = owned.length - 1; index >= 0; index--) owned[index].delete();
    }
  }

  /**
   * Experimental pixel-based outline proposal, not instrument identification.
   * Returns the observed wires, ordered along the neck, without absolute fret
   * numbers or string identities. Coordinates are from the unmirrored input.
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
      const proposal = best ?? detectFretRidges(cv, gray, width, height);
      return proposal ? { points: proposal.points, wireCount: proposal.wireCount, frets: proposal.frets } : null;
    } finally {
      for (let index = owned.length - 1; index >= 0; index--) owned[index].delete();
    }
  }

  return { detectNeck };
});
