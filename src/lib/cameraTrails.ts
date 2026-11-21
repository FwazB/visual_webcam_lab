/** Blend successive camera frames with a decay time controlled by head tilt. */
export async function renderCameraTrails(canvas: HTMLCanvasElement, signal: AbortSignal,
  tiltAmount: () => number, onEnded: () => void) {
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Canvas unavailable");
  const player = canvas.ownerDocument.createElement("video");
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false, video: { facingMode: "user", width: { ideal: 960 }, height: { ideal: 540 } },
  });
  const track = stream.getVideoTracks()[0];
  let frame = 0;
  function cleanup() {
    signal.removeEventListener("abort", cleanup);
    track?.removeEventListener("ended", onEnded);
    cancelAnimationFrame(frame);
    stream.getTracks().forEach((item) => item.stop());
    player.srcObject = null;
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
  }
  if (signal.aborted) { stream.getTracks().forEach((item) => item.stop()); return; }
  signal.addEventListener("abort", cleanup, { once: true });
  track?.addEventListener("ended", onEnded, { once: true });
  try {
    player.muted = true;
    player.playsInline = true;
    player.srcObject = stream;
    await player.play();
    if (signal.aborted) return;
    canvas.width = Math.min(960, player.videoWidth || 640);
    canvas.height = Math.round(canvas.width * (player.videoHeight || 360) / (player.videoWidth || 640));
    ctx.setTransform(-1, 0, 0, 1, canvas.width, 0);
    let lastTime = -1;
    const draw = () => {
      if (signal.aborted) return;
      if (player.readyState >= 2 && player.currentTime !== lastTime) {
        const elapsed = player.currentTime - lastTime;
        ctx.globalAlpha = lastTime < 0 || elapsed <= 0 ? 1 : 1 - Math.exp(-elapsed / (0.04 + 0.72 * tiltAmount()));
        ctx.drawImage(player, 0, 0, canvas.width, canvas.height);
        lastTime = player.currentTime;
      }
      frame = requestAnimationFrame(draw);
    };
    draw();
  } catch (error) {
    if (!signal.aborted) cleanup();
    throw error;
  }
}
