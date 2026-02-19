import type { AudioMetrics } from "./audio-analyzer";

export interface Annotation {
  id: string;
  startTime: number; // seconds
  endTime: number; // seconds
  text: string;
  color: string;
  type: "user" | "generated";
  category?: string; // for generated: "clipping", "silence", "loud", etc.
  createdAt: number;
}

export interface AnalysisSession {
  id: string;
  name: string;
  fileName: string;
  metrics: AudioMetrics;
  waveformData: number[] | null;
  annotations: Annotation[];
  showGeneratedAnnotations: boolean;
  createdAt: number;
  updatedAt: number;
}

const STORAGE_KEY = "pocket-producer-sessions";

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function getSessions(): AnalysisSession[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as AnalysisSession[];
  } catch {
    return [];
  }
}

export function getSession(id: string): AnalysisSession | null {
  return getSessions().find((s) => s.id === id) ?? null;
}

export function saveSession(session: AnalysisSession): void {
  const sessions = getSessions();
  const idx = sessions.findIndex((s) => s.id === session.id);
  session.updatedAt = Date.now();
  if (idx >= 0) {
    sessions[idx] = session;
  } else {
    sessions.unshift(session);
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

export function deleteSession(id: string): void {
  const sessions = getSessions().filter((s) => s.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

export function createSession(
  fileName: string,
  metrics: AudioMetrics,
  waveformData: number[] | null
): AnalysisSession {
  const now = Date.now();
  const session: AnalysisSession = {
    id: generateId(),
    name: fileName.replace(/\.[^.]+$/, ""),
    fileName,
    metrics,
    waveformData,
    annotations: [],
    showGeneratedAnnotations: true,
    createdAt: now,
    updatedAt: now,
  };

  // Auto-generate annotations from analysis
  session.annotations = generateAnnotations(metrics);

  saveSession(session);
  return session;
}

export function generateAnnotations(metrics: AudioMetrics): Annotation[] {
  const annotations: Annotation[] = [];
  const duration = metrics.duration;

  // Clipping annotation
  if (metrics.clippingDetected) {
    annotations.push({
      id: generateId(),
      startTime: 0,
      endTime: duration,
      text: `Clipping detected (${metrics.clippingSamples.toLocaleString()} samples). Reduce gain to eliminate distortion.`,
      color: "#ef4444",
      type: "generated",
      category: "clipping",
      createdAt: Date.now(),
    });
  }

  // Loudness annotation
  if (metrics.estimatedLUFS > -8) {
    annotations.push({
      id: generateId(),
      startTime: 0,
      endTime: duration,
      text: `Extremely loud (${metrics.estimatedLUFS.toFixed(1)} LUFS). Will be turned down on streaming platforms.`,
      color: "#f59e0b",
      type: "generated",
      category: "loudness",
      createdAt: Date.now(),
    });
  } else if (metrics.estimatedLUFS > -11) {
    annotations.push({
      id: generateId(),
      startTime: 0,
      endTime: duration,
      text: `Louder than streaming target (${metrics.estimatedLUFS.toFixed(1)} LUFS vs -14 LUFS target).`,
      color: "#f59e0b",
      type: "generated",
      category: "loudness",
      createdAt: Date.now(),
    });
  }

  // Dynamic range
  if (metrics.dynamicRange < 6) {
    annotations.push({
      id: generateId(),
      startTime: 0,
      endTime: duration,
      text: `Over-compressed (${metrics.dynamicRange.toFixed(1)} dB dynamic range). Mix will sound fatiguing.`,
      color: "#ef4444",
      type: "generated",
      category: "dynamics",
      createdAt: Date.now(),
    });
  }

  // Headroom
  if (metrics.peakLevel > -0.5) {
    annotations.push({
      id: generateId(),
      startTime: 0,
      endTime: duration,
      text: `Low headroom (peak at ${metrics.peakLevel.toFixed(1)} dBFS). Leave -1 to -3 dB for mastering.`,
      color: "#f97316",
      type: "generated",
      category: "headroom",
      createdAt: Date.now(),
    });
  }

  // Phase issues
  if (metrics.phaseCorrelation < 0.3 && metrics.channels >= 2) {
    annotations.push({
      id: generateId(),
      startTime: 0,
      endTime: duration,
      text: `Phase correlation is low (${metrics.phaseCorrelation.toFixed(2)}). Check mono compatibility.`,
      color: "#8b5cf6",
      type: "generated",
      category: "phase",
      createdAt: Date.now(),
    });
  }

  // Frequency issues
  for (const band of metrics.frequencyBands) {
    if (band.rating === "excessive") {
      annotations.push({
        id: generateId(),
        startTime: 0,
        endTime: duration,
        text: `${band.name} (${band.range}) has excessive energy. Consider EQ cut.`,
        color: "#f59e0b",
        type: "generated",
        category: "frequency",
        createdAt: Date.now(),
      });
    }
    if (band.rating === "deficient") {
      annotations.push({
        id: generateId(),
        startTime: 0,
        endTime: duration,
        text: `${band.name} (${band.range}) is deficient. May need a boost.`,
        color: "#3b82f6",
        type: "generated",
        category: "frequency",
        createdAt: Date.now(),
      });
    }
  }

  // Silence
  if (metrics.silenceRatio > 30) {
    annotations.push({
      id: generateId(),
      startTime: 0,
      endTime: duration * 0.05,
      text: `High silence ratio (${metrics.silenceRatio.toFixed(0)}%). Check intro/outro padding.`,
      color: "#6b7280",
      type: "generated",
      category: "silence",
      createdAt: Date.now(),
    });
  }

  // Stereo width
  if (metrics.stereoWidth < 10 && metrics.channels >= 2) {
    annotations.push({
      id: generateId(),
      startTime: 0,
      endTime: duration,
      text: "Very narrow stereo image. Consider stereo widening.",
      color: "#06b6d4",
      type: "generated",
      category: "stereo",
      createdAt: Date.now(),
    });
  }

  return annotations;
}

export function addAnnotation(
  sessionId: string,
  startTime: number,
  endTime: number,
  text: string,
  color: string = "#3b82f6"
): Annotation | null {
  const session = getSession(sessionId);
  if (!session) return null;

  const annotation: Annotation = {
    id: generateId(),
    startTime,
    endTime,
    text,
    color,
    type: "user",
    createdAt: Date.now(),
  };

  session.annotations.push(annotation);
  saveSession(session);
  return annotation;
}

export function updateAnnotation(
  sessionId: string,
  annotationId: string,
  updates: Partial<Pick<Annotation, "text" | "startTime" | "endTime" | "color">>
): void {
  const session = getSession(sessionId);
  if (!session) return;

  const ann = session.annotations.find((a) => a.id === annotationId);
  if (!ann) return;

  Object.assign(ann, updates);
  saveSession(session);
}

export function deleteAnnotation(sessionId: string, annotationId: string): void {
  const session = getSession(sessionId);
  if (!session) return;

  session.annotations = session.annotations.filter((a) => a.id !== annotationId);
  saveSession(session);
}

export function toggleGeneratedAnnotations(sessionId: string): boolean {
  const session = getSession(sessionId);
  if (!session) return true;

  session.showGeneratedAnnotations = !session.showGeneratedAnnotations;
  saveSession(session);
  return session.showGeneratedAnnotations;
}
