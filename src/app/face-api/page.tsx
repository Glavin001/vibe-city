"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as faceapi from "face-api.js";
type DetectionWithExpressions = faceapi.WithFaceExpressions<faceapi.WithFaceDetection<unknown>>;


export default function FaceApiDemoPage() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const modelsLoadedRef = useRef<boolean>(false);

  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState<string>("Idle");

  // Controls
  const [detectionThreshold, setDetectionThreshold] = useState<number>(0.3);
  const [expressionThreshold, setExpressionThreshold] = useState<number>(0.5);
  const [inputSize, setInputSize] = useState<number>(224);
  const [detector, setDetector] = useState<"tiny" | "ssd">("tiny");
  const [hideBoxes, setHideBoxes] = useState<boolean>(false);
  const [avgTimeMs, setAvgTimeMs] = useState<number>(-1);
  const [fps, setFps] = useState<number>(-1);
  const forwardTimesRef = useRef<number[]>([]);
  const lastMetricsAtRef = useRef<number>(0);
  const [metrics, setMetrics] = useState<{
    videoIntrinsic: { w: number; h: number };
    videoCss: { w: number; h: number };
    canvasAttr: { w: number; h: number };
    canvasCss: { w: number; h: number };
    dims: { w: number; h: number };
  } | null>(null);

  // Keep latest control values in refs to avoid restarting the loop on every change
  const detectionThresholdRef = useRef<number>(detectionThreshold);
  const expressionThresholdRef = useRef<number>(expressionThreshold);
  const inputSizeRef = useRef<number>(inputSize);
  useEffect(() => {
    detectionThresholdRef.current = detectionThreshold;
  }, [detectionThreshold]);
  useEffect(() => {
    expressionThresholdRef.current = expressionThreshold;
  }, [expressionThreshold]);
  useEffect(() => {
    inputSizeRef.current = inputSize;
  }, [inputSize]);

  const MODEL_BASE_URL = useMemo(() => {
    // Use official GitHub Pages weights as in the demos/docs
    // return "https://justadudewhohacks.github.io/face-api.js/weights";
    // return "https://github.com/justadudewhohacks/face-api.js/raw/refs/heads/master/weights/";
    return "https://justadudewhohacks.github.io/face-api.js/models/"
  }, []);

  const ensureModelsLoaded = useCallback(async () => {
    if (modelsLoadedRef.current) return;
    // Prefer WebGL backend for better performance and accuracy
    try {
      if (faceapi.tf) {
        await faceapi.tf.setBackend("webgl");
        await faceapi.tf.ready();
      }
    } catch {}
    setStatus("Loading models...");
    const tasks: Array<Promise<void>> = [
      faceapi.nets.faceExpressionNet.loadFromUri(MODEL_BASE_URL),
    ];
    // Load default detector (tiny) initially for quick startup
    tasks.push(faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_BASE_URL));
    await Promise.all(tasks);
    modelsLoadedRef.current = true;
  }, [MODEL_BASE_URL]);

  // Lazy-load SSD Mobilenet if user switches detector
  useEffect(() => {
    const loadSsdIfNeeded = async () => {
      if (detector !== "ssd") return;
      try {
        setStatus("Loading SSD Mobilenet model...");
        await faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_BASE_URL);
        setStatus("SSD Mobilenet ready");
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error(e);
        setStatus("Failed to load SSD Mobilenet");
      }
    };
    loadSsdIfNeeded();
  }, [detector, MODEL_BASE_URL]);

  const stopLoop = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { willReadFrequently: true } as CanvasRenderingContext2DSettings);
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }, []);

  const stopCamera = useCallback(() => {
    stopLoop();
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => {
        t.stop();
      });
      streamRef.current = null;
    }
    const video = videoRef.current;
    if (video) {
      video.srcObject = null;
    }
  }, [stopLoop]);

  const startCamera = useCallback(async () => {
    setStatus("Requesting camera...");
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
    streamRef.current = stream;
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    await new Promise<void>((resolve) => {
      video.onloadedmetadata = () => resolve();
    });
    await video.play();

    const width = video.videoWidth;
    const height = video.videoHeight;
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = width;
      canvas.height = height;
    }
  }, []);

  const drawDetections = useCallback((
    detections: Array<DetectionWithExpressions>,
    _displayWidth: number,
    _displayHeight: number,
  ) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d", { willReadFrequently: true } as CanvasRenderingContext2DSettings);
    if (!canvas || !ctx) return;

    const video = videoRef.current;
    if (!video) return;

    // Compute draw dimensions based on actual media box, accounting for letterboxing
    let dims = faceapi.matchDimensions(canvas, video, true) as { width: number; height: number };
    if (!dims || !dims.width || !dims.height) {
      // Fallback to displayed CSS size or intrinsic size if matchDimensions returned zero
      const fallbackWidth = video.clientWidth || canvas.clientWidth || video.videoWidth || canvas.width || 1;
      const fallbackHeight = video.clientHeight || canvas.clientHeight || video.videoHeight || canvas.height || 1;
      const displaySize = { width: fallbackWidth, height: fallbackHeight };
      faceapi.matchDimensions(canvas, displaySize);
      dims = displaySize;
    }
    const resized = faceapi.resizeResults<DetectionWithExpressions[]>(detections, dims);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const filtered = (Array.isArray(resized) ? resized : [resized]).filter((d: DetectionWithExpressions) => {
      return d.detection.score >= detectionThresholdRef.current;
    });

    if (!hideBoxes) {
      faceapi.draw.drawDetections(canvas, filtered);
    }

    // Draw a compact expression label near the face, instead of the large bottom chart
    ctx.font = "14px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto";
    for (const det of filtered) {
      const best = det.expressions.asSortedArray()[0];
      if (!best || best.probability < expressionThresholdRef.current) continue;
      const label = `${best.expression} (${best.probability.toFixed(2)})`;
      const { x, y } = det.detection.box;
      const padding = 4;
      const textWidth = ctx.measureText(label).width;
      const textX = Math.max(0, Math.min(x, canvas.width - textWidth - padding * 2));
      const textY = Math.max(14, y - 6);
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(textX - padding, textY - 14, textWidth + padding * 2, 18);
      ctx.fillStyle = "#fff";
      ctx.fillText(label, textX, textY);
    }
  }, [hideBoxes]);

  const runLoop = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    const step = async () => {
      if (!modelsLoadedRef.current) return;
      if (video.readyState < 2) return; // not enough data

      const width = video.videoWidth;
      const height = video.videoHeight;

      try {
        const ts = performance.now();
        let detections: DetectionWithExpressions[] = [];
        if (detector === "tiny") {
          const options = new faceapi.TinyFaceDetectorOptions({
            inputSize: inputSizeRef.current,
            scoreThreshold: Math.min(Math.max(detectionThresholdRef.current, 0.01), 0.99),
          });
          detections = await faceapi.detectAllFaces(video, options).withFaceExpressions();
        } else {
          const options = new faceapi.SsdMobilenetv1Options({
            minConfidence: Math.min(Math.max(detectionThresholdRef.current, 0.01), 0.99),
          });
          detections = await faceapi.detectAllFaces(video, options).withFaceExpressions();
        }
        const elapsed = performance.now() - ts;
        const arr = [elapsed, ...forwardTimesRef.current].slice(0, 30);
        forwardTimesRef.current = arr;
        const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
        setAvgTimeMs(avg);
        setFps(avg > 0 ? Math.round(1000 / avg) : -1);

        drawDetections(detections, width, height);

        // Update debug metrics occasionally
        const now = performance.now();
        if (now - lastMetricsAtRef.current > 600) {
          const canvas = canvasRef.current;
          if (canvas) {
            setMetrics({
              videoIntrinsic: { w: video.videoWidth, h: video.videoHeight },
              videoCss: { w: video.clientWidth, h: video.clientHeight },
              canvasAttr: { w: canvas.width, h: canvas.height },
              canvasCss: { w: canvas.clientWidth, h: canvas.clientHeight },
              dims: { w: canvas.width, h: canvas.height },
            });
          }
          lastMetricsAtRef.current = now;
        }
        setStatus(`${detections.length} face(s).`);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(err);
        setStatus("Detection error. Check console.");
      }

      rafRef.current = requestAnimationFrame(step);
    };

    rafRef.current = requestAnimationFrame(step);
  }, [detector, drawDetections]);

  const start = useCallback(async () => {
    try {
      await ensureModelsLoaded();
      await startCamera();
      setIsRunning(true);
      setStatus("Running");
      runLoop();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      setStatus("Failed to start. Check console.");
    }
  }, [ensureModelsLoaded, runLoop, startCamera]);

  const stop = useCallback(() => {
    setIsRunning(false);
    stopLoop();
    stopCamera();
    clearCanvas();
    setStatus("Stopped");
  }, [clearCanvas, stopCamera, stopLoop]);

  useEffect(() => {
    // Auto-start on mount
    start();
    return () => {
      stop();
    };
  }, [start, stop]);

  return (
    <div className="max-w-[960px] mx-auto p-4">
      <header className="flex items-center gap-3 mb-3">
        <h1 className="text-2xl m-0">face-api.js Webcam Demo</h1>
        <span className="text-neutral-600">{status}</span>
        <div className="ml-auto flex gap-2">
          {!isRunning ? (
            <button type="button" onClick={start} className="px-3 py-2 border rounded">Start</button>
          ) : (
            <button type="button" onClick={stop} className="px-3 py-2 border rounded">Stop</button>
          )}
        </div>
      </header>

      <section className="grid items-start gap-3 grid-cols-[1fr_280px]">
        <div className="relative w-full bg-black rounded-lg overflow-hidden">
          <video ref={videoRef} autoPlay muted playsInline className="w-full h-auto block" />
          <canvas ref={canvasRef} className="absolute left-0 top-0 w-full h-full" />
        </div>

        <aside className="border rounded-lg p-3">
          <h2 className="text-lg mt-0">Controls</h2>
          <div className="flex items-center gap-3 mb-3 text-xs text-neutral-600">
            <div>Time: {avgTimeMs >= 0 ? `${Math.round(avgTimeMs)} ms` : "-"}</div>
            <div>FPS: {fps >= 0 ? fps : "-"}</div>
          </div>

          {metrics && (
            <div className="text-[11px] text-neutral-600 mb-3 leading-tight">
              <div>video: {metrics.videoIntrinsic.w}×{metrics.videoIntrinsic.h} (intrinsic)</div>
              <div>video CSS: {metrics.videoCss.w}×{metrics.videoCss.h}</div>
              <div>canvas attr: {metrics.canvasAttr.w}×{metrics.canvasAttr.h}</div>
              <div>canvas CSS: {metrics.canvasCss.w}×{metrics.canvasCss.h}</div>
            </div>
          )}

          <div className="mb-3">
            <label htmlFor="det-th" className="block text-[13px] text-neutral-700 mb-1">
              Detection confidence threshold: {detectionThreshold.toFixed(2)}
            </label>
            <input
              id="det-th"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={detectionThreshold}
              onChange={(e) => setDetectionThreshold(parseFloat(e.target.value))}
              className="w-full"
            />
          </div>

          <div className="mb-3">
            <label htmlFor="exp-th" className="block text-[13px] text-neutral-700 mb-1">
              Expression confidence threshold: {expressionThreshold.toFixed(2)}
            </label>
            <input
              id="exp-th"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={expressionThreshold}
              onChange={(e) => setExpressionThreshold(parseFloat(e.target.value))}
              className="w-full"
            />
          </div>

          <div className="mb-3">
            <label htmlFor="input-size" className="block text-[13px] text-neutral-700 mb-1">
              TinyFaceDetector input size (trade speed/accuracy)
            </label>
            <select
              id="input-size"
              value={inputSize}
              onChange={(e) => setInputSize(parseInt(e.target.value))}
              className="w-full px-2 py-1 border rounded"
            >
              <option value={128}>128</option>
              <option value={160}>160</option>
              <option value={224}>224</option>
              <option value={320}>320</option>
            </select>
          </div>

          <div className="mb-3">
            <label htmlFor="detector" className="block text-[13px] text-neutral-700 mb-1">
              Detector
            </label>
            <select
              id="detector"
              value={detector}
              onChange={(e) => setDetector(e.target.value as typeof detector)}
              className="w-full px-2 py-1 border rounded"
            >
              <option value="tiny">TinyFaceDetector (faster)</option>
              <option value="ssd">SSD Mobilenet V1 (more accurate)</option>
            </select>
          </div>

          <div className="mb-3">
            <label htmlFor="hide-boxes" className="inline-flex items-center gap-2">
              <input
                id="hide-boxes"
                type="checkbox"
                checked={hideBoxes}
                onChange={(e) => setHideBoxes(e.target.checked)}
                className="size-4"
              />
              <span>Hide bounding boxes</span>
            </label>
          </div>

          <div className="text-xs text-neutral-600">
            <p className="mt-0">Models loaded from: <code>{MODEL_BASE_URL}</code></p>
            <p>This demo uses TinyFaceDetector and FaceExpressionNet from <code>face-api.js</code>.</p>
          </div>
        </aside>
      </section>
    </div>
  );
}


