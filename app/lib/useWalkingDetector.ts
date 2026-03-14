import { useRef } from 'react';
import { IMUFrame } from './IMUClient';

export type WalkingState = 'walking' | 'still' | 'unknown';

// --- Tuning ---
const ACCEL_SCALE          = 9.81 / 16384.0;
const SAMPLE_RATE          = 50;          // Hz
const SMOOTHING_ALPHA      = 0.15;        // low-pass: lower = smoother signal
const PEAK_THRESHOLD       = 0.18;        // m/s² above baseline to count as a step peak
const MIN_STEP_INTERVAL_MS = 300;         // ms — debounce, max ~3 steps/sec
const STEP_WINDOW_MS       = 3000;        // ms — count steps within this window
const MIN_STEPS_WALKING    = 3;           // steps in window to confirm walking
const HYSTERESIS_COUNT     = 4;           // consecutive agreeing classifications to flip

export function useWalkingDetector() {
  // Low-pass filtered magnitude
  const smoothed    = useRef<number | null>(null);
  // Baseline (very slow low-pass — tracks gravity)
  const baseline    = useRef<number | null>(null);
  // Peak detection state
  const lastPeakMs  = useRef<number>(0);
  const inPeak      = useRef(false);
  // Step timestamps ring buffer
  const stepTimes   = useRef<number[]>([]);
  // Hysteresis
  const confirmed   = useRef<WalkingState>('unknown');
  const candidate   = useRef<WalkingState>('unknown');
  const streak      = useRef(0);

  function detect(frame: IMUFrame, nowMs: number = Date.now()): WalkingState {
    const ax = frame.ax * ACCEL_SCALE;
    const ay = frame.ay * ACCEL_SCALE;
    const az = frame.az * ACCEL_SCALE;
    const mag = Math.sqrt(ax * ax + ay * ay + az * az);

    // Low-pass filter for step signal
    smoothed.current = smoothed.current === null
      ? mag
      : SMOOTHING_ALPHA * mag + (1 - SMOOTHING_ALPHA) * smoothed.current;

    // Very slow low-pass for baseline (gravity + slow drift)
    const baseAlpha = 0.01;
    baseline.current = baseline.current === null
      ? smoothed.current
      : baseAlpha * smoothed.current + (1 - baseAlpha) * baseline.current;

    // Deviation from baseline = actual motion signal
    const signal = smoothed.current - baseline.current;

    // Peak detection with debounce
    const timeSinceLastPeak = nowMs - lastPeakMs.current;
    if (!inPeak.current && signal > PEAK_THRESHOLD && timeSinceLastPeak > MIN_STEP_INTERVAL_MS) {
      inPeak.current = true;
      lastPeakMs.current = nowMs;
      stepTimes.current.push(nowMs);
    } else if (signal < PEAK_THRESHOLD * 0.5) {
      inPeak.current = false;
    }

    // Evict steps outside the window
    const cutoff = nowMs - STEP_WINDOW_MS;
    stepTimes.current = stepTimes.current.filter(t => t > cutoff);

    // Need at least one full window before deciding
    if (baseline.current === null || nowMs < STEP_WINDOW_MS) return 'unknown';

    const raw: WalkingState = stepTimes.current.length >= MIN_STEPS_WALKING ? 'walking' : 'still';

    // Hysteresis — only flip confirmed state after streak
    if (raw === candidate.current) {
      streak.current++;
    } else {
      candidate.current = raw;
      streak.current = 1;
    }
    if (streak.current >= HYSTERESIS_COUNT) {
      confirmed.current = candidate.current;
    }

    return confirmed.current;
  }

  function reset() {
    smoothed.current  = null;
    baseline.current  = null;
    lastPeakMs.current = 0;
    inPeak.current    = false;
    stepTimes.current = [];
    confirmed.current = 'unknown';
    candidate.current = 'unknown';
    streak.current    = 0;
  }

  return { detect, reset };
}