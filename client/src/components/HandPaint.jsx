import React, { useRef, useEffect, useState } from "react";
import { Hands } from "@mediapipe/hands";
import { Camera } from "@mediapipe/camera_utils";

const COLORS = [
  "#000000",
  "#ff0000",
  "#00a86b",
  "#1e90ff",
  "#ff8c00",
  "#8a2be2",
];
const SMOOTHING = 0.2;
const MIN_BRUSH = 1;
const MAX_BRUSH = 12;

export default function HandPaint() {
  const videoRef = useRef(null);
  const cameraCanvasRef = useRef(null);
  const drawCanvasRef = useRef(null);
  const drawCtxRef = useRef(null);
  const lastPosRef = useRef(null);
  const smoothedPosRef = useRef(null);

  const [colorIndex, setColorIndex] = useState(0);
  const colorRef = useRef(COLORS[0]);
  const cooldownRef = useRef({ lastColor: 0, lastClear: 0, fistStart: 0 });

  // Dynamic canvas sizing
  const setCanvasSize = () => {
    const drawCanvas = drawCanvasRef.current;
    const camCanvas = cameraCanvasRef.current;

    const maxWidth = Math.min(window.innerWidth * 0.95, 640);
    const width = maxWidth;
    const height = (width * 480) / 640;

    drawCanvas.width = width;
    drawCanvas.height = height;
    camCanvas.width = width;
    camCanvas.height = height;

    drawCtxRef.current = drawCanvas.getContext("2d");
    drawCtxRef.current.lineCap = "round";
  };

  useEffect(() => {
    setCanvasSize();
    window.addEventListener("resize", setCanvasSize);

    const hands = new Hands({
      locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
    });

    hands.setOptions({
      maxNumHands: 1,
      modelComplexity: 1,
      minDetectionConfidence: 0.7,
      minTrackingConfidence: 0.6,
    });

    hands.onResults(onResults);

    const camera = new Camera(videoRef.current, {
      onFrame: async () => await hands.send({ image: videoRef.current }),
      width: 640,
      height: 480,
    });
    camera.start();

    return () => {
      camera.stop();
      hands.close();
      window.removeEventListener("resize", setCanvasSize);
    };
  }, []);

  const toPixel = (lm, canvas) => ({
    x: lm.x * canvas.width,
    y: lm.y * canvas.height,
  });
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const lerp = (a, b, t) => a + (b - a) * t;

  const onResults = (results) => {
    const camCanvas = cameraCanvasRef.current;
    const camCtx = camCanvas.getContext("2d");
    camCtx.clearRect(0, 0, camCanvas.width, camCanvas.height);
    camCtx.drawImage(results.image, 0, 0, camCanvas.width, camCanvas.height);

    const hand = results.multiHandLandmarks?.[0];
    if (!hand) {
      lastPosRef.current = null;
      smoothedPosRef.current = null;
      cooldownRef.current.fistStart = 0;
      return;
    }

    const wrist = toPixel(hand[0], camCanvas);
    const tips = [4, 8, 12, 16, 20].map((i) => toPixel(hand[i], camCanvas));
    const thumbTip = tips[0],
      indexTip = tips[1];

    const now = Date.now();
    const fingersExtended = [8, 12, 16, 20].map((tip, i) => {
      const pipIndex = tip - 2;
      return hand[tip].y < hand[pipIndex].y - 0.02;
    });

    // Fist detection
    const isFistNow = tips
      .slice(1)
      .every((t) => distance(t, wrist) < 0.15 * camCanvas.width);
    if (isFistNow) {
      if (!cooldownRef.current.fistStart) cooldownRef.current.fistStart = now;
      else if (
        now - cooldownRef.current.fistStart > 300 &&
        now - cooldownRef.current.lastColor > 800
      ) {
        setColorIndex((i) => {
          const newIndex = (i + 1) % COLORS.length;
          colorRef.current = COLORS[newIndex];
          return newIndex;
        });
        cooldownRef.current.lastColor = now;
        cooldownRef.current.fistStart = null;
      }
    } else cooldownRef.current.fistStart = null;

    // Open palm clear
    const isOpenPalm = fingersExtended.every((f) => f);
    if (isOpenPalm && now - cooldownRef.current.lastClear > 1200) {
      drawCtxRef.current.clearRect(0, 0, camCanvas.width, camCanvas.height);
      lastPosRef.current = null;
      smoothedPosRef.current = null;
      cooldownRef.current.lastClear = now;
    }

    // Draw mode
    const drawMode =
      fingersExtended[0] &&
      !fingersExtended[1] &&
      !fingersExtended[2] &&
      !fingersExtended[3];
    if (drawMode) {
      const ctx = drawCtxRef.current;
      ctx.strokeStyle = colorRef.current;

      const scaleFactor = camCanvas.width / 640;
      let brushSize = Math.max(
        MIN_BRUSH,
        Math.min(MAX_BRUSH, distance(indexTip, thumbTip) * 0.8 * scaleFactor)
      );
      ctx.lineWidth = brushSize;

      if (!smoothedPosRef.current) smoothedPosRef.current = { ...indexTip };
      else
        smoothedPosRef.current = {
          x: lerp(smoothedPosRef.current.x, indexTip.x, SMOOTHING),
          y: lerp(smoothedPosRef.current.y, indexTip.y, SMOOTHING),
        };

      if (lastPosRef.current) {
        ctx.beginPath();
        ctx.moveTo(lastPosRef.current.x, lastPosRef.current.y);
        ctx.lineTo(smoothedPosRef.current.x, smoothedPosRef.current.y);
        ctx.stroke();
      }
      lastPosRef.current = { ...smoothedPosRef.current };
    } else {
      lastPosRef.current = null;
      smoothedPosRef.current = null;
    }
  };

  const saveDrawing = () => {
    const dataURL = drawCanvasRef.current.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = dataURL;
    a.download = "drawing.png";
    a.click();
  };

  return (
    <div className="flex flex-col items-center py-6 space-y-4 w-full max-w-[900px] mx-auto px-2">
      <h1 className="text-2xl font-bold text-center">🖐️ Hand Paint App</h1>

      {/* Canvases */}
      <div className="flex flex-col md:flex-row space-y-4 md:space-y-0 md:space-x-4 w-full justify-center">
        <canvas
          ref={cameraCanvasRef}
          className="border rounded shadow w-full md:w-1/2"
        />
        <canvas
          ref={drawCanvasRef}
          className="border-4 border-black rounded shadow w-full md:w-1/2"
        />
      </div>

      {/* Controls */}
      <div className="flex flex-col md:flex-row items-center space-y-2 md:space-y-0 md:space-x-4 w-full justify-center">
        <button
          className="px-6 py-3 bg-blue-600 text-white rounded hover:bg-blue-700 w-full md:w-auto"
          onClick={saveDrawing}
        >
          Save Drawing
        </button>
        <div
          className="w-8 h-8 border border-black rounded"
          style={{ backgroundColor: COLORS[colorIndex] }}
        />
        <span className="text-sm">Current Color</span>
      </div>

      <p className="text-gray-600 text-sm text-center px-2">
        👉 Point finger = Draw | ✊ Fist = Change color | ✋ Palm = Clear |
        Pinch = Brush size
      </p>

      <video ref={videoRef} className="hidden" playsInline></video>
    </div>
  );
}
