// Generated test imagery only: no camera footage or claims of real-guitar accuracy.
function makeNeckImage({ width = 640, height = 400, lastFret = 10, stringCount = 6, stringColor = [224, 220, 205], texture = true, seed = 12345 } = {}) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  const pixel = (x, y, color) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const offset = (y * width + x) * 4;
    rgba.set([color[0], color[1], color[2], 255], offset);
  };
  let randomState = seed >>> 0;
  const random = () => { randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0; return randomState / 4294967296; };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixel(x, y, [22, 25, 29]);
  const left = width * 0.09375, right = width * 0.90625, top = height * 0.375, bottom = height * 0.625;
  for (let y = Math.floor(top - 10); y <= bottom + 10; y++) {
    for (let x = Math.floor(left - 6); x <= right + 6; x++) {
      const grain = texture ? Math.floor(random() * 17) - 8 : 0;
      pixel(x, y, [78 + grain, 58 + grain, 38 + grain]);
    }
  }
  if (texture) {
    // Local nonrepeating patches prevent tests from depending only on repeated frets.
    for (let i = 0; i < 1300; i++) {
      const x = left + 8 + random() * (right - left - 16), y = top + 3 + random() * (bottom - top - 6);
      const value = 35 + Math.floor(random() * 100), size = 1 + Math.floor(random() * 4);
      for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) pixel(x + dx, y + dy, [value, Math.max(20, value - 15), Math.max(10, value - 28)]);
    }
  }
  const line = (x1, y1, x2, y2, color, thickness = 1) => {
    const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
    for (let i = 0; i <= steps; i++) {
      const t = steps ? i / steps : 0;
      for (let d = 0; d < thickness; d++) pixel(x1 + (x2 - x1) * t + d, y1 + (y2 - y1) * t, color);
    }
  };
  const fretX = (fret) => left + (right - left) * (1 - 2 ** (-fret / 12)) / (1 - 2 ** (-lastFret / 12));
  for (let fret = 0; fret <= lastFret; fret++) {
    line(fretX(fret), top - 9, fretX(fret), bottom + 9, fret === 0 ? [235, 228, 210] : [170, 174, 178], fret === 0 ? 3 : 2);
    if ([3, 5, 7, 9, 12].includes(fret)) {
      const x = (fretX(fret - 1) + fretX(fret)) / 2, y = (top + bottom) / 2;
      for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) if (dx * dx + dy * dy <= 25) pixel(x + dx, y + dy, [180, 174, 150]);
    }
  }
  for (let string = 0; string < stringCount; string++) {
    const y = top + (bottom - top) * string / (stringCount - 1);
    line(left, y, right, y, stringColor);
  }
  const points = [{ x: left, y: top }, { x: left, y: bottom }, { x: right, y: top }, { x: right, y: bottom }];
  return { rgba, width, height, points, normalizedPoints: points.map((p) => ({ x: p.x / width, y: p.y / height })), lastFret };
}

function warpImage(cv, image, destinationPoints) {
  let source, destination, transform, input, output;
  try {
    source = cv.matFromArray(4, 1, cv.CV_32FC2, image.points.flatMap((p) => [p.x, p.y]));
    destination = cv.matFromArray(4, 1, cv.CV_32FC2, destinationPoints.flatMap((p) => [p.x, p.y]));
    transform = cv.getPerspectiveTransform(source, destination);
    input = new cv.Mat(image.height, image.width, cv.CV_8UC4);
    input.data.set(image.rgba);
    output = new cv.Mat();
    cv.warpPerspective(input, output, transform, new cv.Size(image.width, image.height), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(22, 25, 29, 255));
    const points = destinationPoints.map((p) => ({ ...p }));
    return { ...image, rgba: new Uint8ClampedArray(output.data), points, normalizedPoints: points.map((p) => ({ x: p.x / image.width, y: p.y / image.height })) };
  } finally { source?.delete(); destination?.delete(); transform?.delete(); input?.delete(); output?.delete(); }
}

function cover(image, box, color = [120, 78, 56]) {
  const rgba = new Uint8ClampedArray(image.rgba);
  for (let y = Math.max(0, Math.floor(box.y)); y < Math.min(image.height, box.y + box.height); y++) {
    for (let x = Math.max(0, Math.floor(box.x)); x < Math.min(image.width, box.x + box.width); x++) rgba.set([...color, 255], (y * image.width + x) * 4);
  }
  return { ...image, rgba };
}

module.exports = { makeNeckImage, warpImage, cover };
