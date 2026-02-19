export interface MasteringPreset {
  name: string;
  description: string;
  targetLUFS: number;
  eqAdjustments: EQBand[];
  compressionRatio: number;
  compressionThreshold: number; // dBFS
  compressionAttack: number; // ms
  compressionRelease: number; // ms
  limiterCeiling: number; // dBFS
  stereoWidenAmount: number; // 0-100
  highPassFreq: number; // Hz — remove rumble
  deEsserFreq: number; // Hz
  deEsserAmount: number; // dB reduction
}

export interface EQBand {
  frequency: number;
  gain: number; // dB
  q: number;
  type: "lowshelf" | "highshelf" | "peak" | "highpass" | "lowpass";
}

export interface MasteringSettings {
  preset: string;
  targetLUFS: number;
  applyEQ: boolean;
  applyCompression: boolean;
  applyLimiter: boolean;
  applyStereoEnhancement: boolean;
  applyHighPass: boolean;
  outputFormat: "wav" | "mp3" | "flac";
  outputBitrate: number; // kbps, for mp3
  outputSampleRate: number;
}

export interface MasteringResult {
  outputBuffer: Buffer;
  outputFileName: string;
  outputFormat: string;
  chain: string[];
  beforeLUFS: number;
  targetLUFS: number;
}

// Presets tuned for different genres/use cases
export const MASTERING_PRESETS: Record<string, MasteringPreset> = {
  streaming: {
    name: "Streaming (Spotify/Apple)",
    description: "Optimized for -14 LUFS streaming targets with clean limiting",
    targetLUFS: -14,
    eqAdjustments: [
      { frequency: 30, gain: 0, q: 0.7, type: "highpass" },
      { frequency: 60, gain: 1.5, q: 0.8, type: "lowshelf" },
      { frequency: 200, gain: -1.5, q: 1.2, type: "peak" },
      { frequency: 3000, gain: 1.0, q: 0.8, type: "peak" },
      { frequency: 10000, gain: 2.0, q: 0.7, type: "highshelf" },
    ],
    compressionRatio: 2.5,
    compressionThreshold: -18,
    compressionAttack: 10,
    compressionRelease: 150,
    limiterCeiling: -1.0,
    stereoWidenAmount: 15,
    highPassFreq: 30,
    deEsserFreq: 6000,
    deEsserAmount: 3,
  },
  loud: {
    name: "Loud & Punchy",
    description: "Aggressive mastering for maximum impact, higher loudness",
    targetLUFS: -10,
    eqAdjustments: [
      { frequency: 30, gain: 0, q: 0.7, type: "highpass" },
      { frequency: 80, gain: 2.5, q: 0.7, type: "lowshelf" },
      { frequency: 250, gain: -2.0, q: 1.5, type: "peak" },
      { frequency: 2500, gain: 2.0, q: 1.0, type: "peak" },
      { frequency: 5000, gain: 1.5, q: 0.8, type: "peak" },
      { frequency: 12000, gain: 2.5, q: 0.7, type: "highshelf" },
    ],
    compressionRatio: 4,
    compressionThreshold: -14,
    compressionAttack: 5,
    compressionRelease: 100,
    limiterCeiling: -0.3,
    stereoWidenAmount: 20,
    highPassFreq: 30,
    deEsserFreq: 6000,
    deEsserAmount: 4,
  },
  warm: {
    name: "Warm & Smooth",
    description: "Gentle mastering with warmth, great for acoustic/jazz/R&B",
    targetLUFS: -14,
    eqAdjustments: [
      { frequency: 30, gain: 0, q: 0.7, type: "highpass" },
      { frequency: 100, gain: 2.0, q: 0.6, type: "lowshelf" },
      { frequency: 400, gain: 1.0, q: 0.8, type: "peak" },
      { frequency: 2000, gain: -0.5, q: 1.0, type: "peak" },
      { frequency: 8000, gain: -1.0, q: 0.7, type: "highshelf" },
    ],
    compressionRatio: 2,
    compressionThreshold: -20,
    compressionAttack: 20,
    compressionRelease: 200,
    limiterCeiling: -1.0,
    stereoWidenAmount: 10,
    highPassFreq: 25,
    deEsserFreq: 5500,
    deEsserAmount: 2,
  },
  bright: {
    name: "Bright & Airy",
    description: "Open, bright master for pop/electronic with sparkle on top",
    targetLUFS: -13,
    eqAdjustments: [
      { frequency: 30, gain: 0, q: 0.7, type: "highpass" },
      { frequency: 60, gain: 1.0, q: 0.8, type: "lowshelf" },
      { frequency: 300, gain: -1.5, q: 1.2, type: "peak" },
      { frequency: 4000, gain: 2.0, q: 0.8, type: "peak" },
      { frequency: 8000, gain: 2.5, q: 0.6, type: "peak" },
      { frequency: 14000, gain: 3.0, q: 0.7, type: "highshelf" },
    ],
    compressionRatio: 3,
    compressionThreshold: -16,
    compressionAttack: 8,
    compressionRelease: 120,
    limiterCeiling: -0.5,
    stereoWidenAmount: 25,
    highPassFreq: 30,
    deEsserFreq: 7000,
    deEsserAmount: 4,
  },
  gentle: {
    name: "Gentle Touch",
    description: "Minimal processing — just loudness normalization and light limiting",
    targetLUFS: -14,
    eqAdjustments: [
      { frequency: 25, gain: 0, q: 0.7, type: "highpass" },
    ],
    compressionRatio: 1.5,
    compressionThreshold: -24,
    compressionAttack: 30,
    compressionRelease: 250,
    limiterCeiling: -1.0,
    stereoWidenAmount: 0,
    highPassFreq: 25,
    deEsserFreq: 6000,
    deEsserAmount: 0,
  },
};
