import { useRef, useState, useEffect } from 'react';

/**
 * SignaturePad — canvas-based finger/mouse signature capture.
 *
 * No external library. Uses the Pointer Events API (works on iOS 13+ Safari,
 * Android Chrome, and desktop). `touch-action: none` on the canvas element
 * prevents page scroll while drawing, which is the critical iOS gotcha.
 *
 * Props:
 *   onSave(dataURL)  – called with PNG dataURL when the trader taps Save
 *   onCancel()       – called when the trader taps Cancel (no save)
 *   width            – canvas logical width in CSS px (default 300)
 *   height           – canvas logical height in CSS px (default 180)
 */
export default function SignaturePad({ onSave, onCancel, width = 300, height = 180 }) {
  const canvasRef = useRef(null);
  // strokes: array of arrays of {x, y} — one inner array per pointer-down/up gesture
  const strokesRef = useRef([]);
  const drawingRef = useRef(false);
  const [hasStrokes, setHasStrokes] = useState(false);

  // ── Canvas setup: scale for device pixel ratio so lines are crisp on retina ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#000';
  }, [width, height]);

  // ── Coordinate helper: map pointer client coords → canvas logical coords ──
  function getPos(e) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    // For touch-sourced pointer events, clientX/Y is the correct property
    const scaleX = width / rect.width;
    const scaleY = height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  // ── Pointer event handlers ────────────────────────────────────────────────
  const handlePointerDown = (e) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    canvas.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    const pos = getPos(e);
    strokesRef.current.push([pos]);
    setHasStrokes(true);
  };

  const handlePointerMove = (e) => {
    e.preventDefault();
    if (!drawingRef.current) return;
    const pos = getPos(e);
    const strokes = strokesRef.current;
    strokes[strokes.length - 1].push(pos);
    // Draw the incremental segment only (no full redraw on each move — fast)
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const stroke = strokes[strokes.length - 1];
    if (stroke.length < 2) return;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#000';
    ctx.beginPath();
    ctx.moveTo(stroke[stroke.length - 2].x, stroke[stroke.length - 2].y);
    ctx.lineTo(stroke[stroke.length - 1].x, stroke[stroke.length - 1].y);
    ctx.stroke();
  };

  const handlePointerUp = (e) => {
    e.preventDefault();
    drawingRef.current = false;
  };

  // ── Clear ─────────────────────────────────────────────────────────────────
  const handleClear = () => {
    strokesRef.current = [];
    setHasStrokes(false);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, width, height);
  };

  // ── Save ─────────────────────────────────────────────────────────────────
  const handleSave = () => {
    if (!hasStrokes) return;
    const canvas = canvasRef.current;
    // Export at full device-pixel-ratio resolution so the saved PNG is crisp
    onSave(canvas.toDataURL('image/png'));
  };

  return (
    <div className="sig-pad-container" role="dialog" aria-modal="true" aria-label="Customer signature pad">
      <div className="sig-pad-instruction">Sign with your finger</div>

      <div className="sig-pad-canvas-wrapper">
        {/* touch-action: none is set in CSS (.sig-pad-canvas) — prevents iOS scroll */}
        <canvas
          ref={canvasRef}
          className="sig-pad-canvas"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          aria-label="Signature canvas — draw with finger or mouse"
        />
        {!hasStrokes && (
          <div className="sig-pad-placeholder" aria-hidden="true">
            Sign here
          </div>
        )}
      </div>

      <div className="sig-pad-actions">
        <button
          type="button"
          className="btn-ghost sig-pad-btn-clear"
          onClick={handleClear}
          disabled={!hasStrokes}
        >
          Clear
        </button>
        <button
          type="button"
          className="btn-ghost sig-pad-btn-cancel"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn-convert sig-pad-btn-save"
          onClick={handleSave}
          disabled={!hasStrokes}
        >
          Save signature
        </button>
      </div>
    </div>
  );
}
