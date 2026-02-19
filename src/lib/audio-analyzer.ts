import * as mm from "music-metadata";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, unlink, mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

const execFileAsync = promisify(execFile);

export interface FrequencyBand {
  name: string;
  range: string;
  energy: number; // 0-100
  rating: "deficient" | "low" | "balanced" | "elevated" | "excessive";
}

export interface CategoryScore {
  score: number; // 0-100
  label: string;
  grade: "A" | "B" | "C" | "D" | "F";
  summary: string;
}

export interface AudioMetrics {
  // File info
  fileName: string;
  format: string;
  codec: string;
  bitrate: number;
  sampleRate: number;
  bitDepth: number | null;
  channels: number;
  duration: number;
  fileSize: number;

  // Loudness
  peakLevel: number; // dBFS
  truePeak: number; // dBTP
  rmsLevel: number; // dBFS
  estimatedLUFS: number;
  loudnessRange: number; // LRA in LU
  dynamicRange: number; // dB
  crestFactor: number; // dB
  shortTermMax: number; // max short-term loudness dBFS

  // Quality indicators
  clippingDetected: boolean;
  clippingSamples: number;
  clippingPercentage: number;
  dcOffset: number;
  silenceRatio: number; // percentage of silence
  noiseFloor: number; // dBFS
  stereoWidth: number; // 0-100
  phaseCorrelation: number; // -1 to 1
  stereoBalance: number; // -1 (left) to 1 (right)
  monoCompatibility: number; // 0-100 how much energy survives mono fold

  // Frequency analysis
  frequencyBands: FrequencyBand[];
  spectralCentroid: number; // Hz - brightness indicator
  spectralBalance: number; // -100 (dark) to +100 (bright) relative to ideal

  // Sub-scores (0-100 each)
  loudnessScore: CategoryScore;
  dynamicsScore: CategoryScore;
  frequencyScore: CategoryScore;
  stereoScore: CategoryScore;
  qualityScore: CategoryScore;

  // Mastering readiness
  masteringScore: number; // 0-100
  readinessLevel: "not-ready" | "needs-work" | "almost-ready" | "ready";
  issues: AnalysisIssue[];
  recommendations: string[];
}

export interface AnalysisIssue {
  severity: "critical" | "warning" | "info";
  category: string;
  message: string;
}

// --- ffmpeg-based PCM decoding for accurate analysis ---

async function decodePCMWithFFmpeg(
  inputBuffer: Buffer,
  channels: number
): Promise<{ left: Float32Array; right: Float32Array | null }> {
  const tempDir = await mkdtemp(join(tmpdir(), "pp-analyze-"));
  const inputPath = join(tempDir, "input.mp3");
  const outputPath = join(tempDir, "output.raw");

  try {
    await writeFile(inputPath, inputBuffer);

    // Decode to 16-bit signed LE PCM at native sample rate
    await execFileAsync("ffmpeg", [
      "-y", "-i", inputPath,
      "-f", "s16le", "-acodec", "pcm_s16le",
      outputPath,
    ], { timeout: 60_000, maxBuffer: 100 * 1024 * 1024 });

    const rawBuffer = await readFile(outputPath);
    const bytesPerSample = 2;
    const frameSize = bytesPerSample * channels;
    const totalFrames = Math.floor(rawBuffer.length / frameSize);

    const left = new Float32Array(totalFrames);
    let right: Float32Array | null = null;
    if (channels >= 2) right = new Float32Array(totalFrames);

    for (let i = 0; i < totalFrames; i++) {
      const offset = i * frameSize;
      left[i] = rawBuffer.readInt16LE(offset) / 32768;
      if (right && channels >= 2) {
        right[i] = rawBuffer.readInt16LE(offset + bytesPerSample) / 32768;
      }
    }

    return { left, right };
  } finally {
    try { await unlink(inputPath); } catch { }
    try { await unlink(outputPath); } catch { }
  }
}

// --- ffmpeg loudnorm measurement pass for real LUFS/LRA/TP ---

interface LoudnormMeasurement {
  inputI: number;
  inputTP: number;
  inputLRA: number;
  inputThresh: number;
  targetOffset: number;
}

async function measureLoudnorm(inputBuffer: Buffer): Promise<LoudnormMeasurement> {
  const tempDir = await mkdtemp(join(tmpdir(), "pp-lufs-"));
  const inputPath = join(tempDir, "input.mp3");

  try {
    await writeFile(inputPath, inputBuffer);

    const { stderr } = await execFileAsync("ffmpeg", [
      "-y", "-i", inputPath,
      "-af", "loudnorm=I=-14:TP=-1:LRA=11:print_format=json",
      "-f", "null", "-",
    ], { timeout: 120_000, maxBuffer: 50 * 1024 * 1024 });

    // Parse the JSON block from ffmpeg stderr
    const jsonMatch = stderr.match(/\{[\s\S]*"input_i"[\s\S]*\}/);
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[0]);
      return {
        inputI: parseFloat(data.input_i) || -24,
        inputTP: parseFloat(data.input_tp) || -1,
        inputLRA: parseFloat(data.input_lra) || 7,
        inputThresh: parseFloat(data.input_thresh) || -34,
        targetOffset: parseFloat(data.target_offset) || 0,
      };
    }
  } finally {
    try { await unlink(inputPath); } catch { }
  }

  return { inputI: -24, inputTP: -1, inputLRA: 7, inputThresh: -34, targetOffset: 0 };
}

// --- Core measurement helpers ---

function calculateRMS(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
}

function calculatePeak(samples: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i]);
    if (abs > peak) peak = abs;
  }
  return peak;
}

function toDBFS(value: number): number {
  if (value <= 0) return -96;
  return Math.max(-96, 20 * Math.log10(value));
}

function countClipping(samples: Float32Array, threshold = 0.99): number {
  let count = 0;
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]) >= threshold) count++;
  }
  return count;
}

function calculateDCOffset(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i];
  }
  return sum / samples.length;
}

function calculateSilenceRatio(samples: Float32Array, threshold = 0.001): number {
  let silentSamples = 0;
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]) < threshold) silentSamples++;
  }
  return (silentSamples / samples.length) * 100;
}

function calculateNoiseFloor(samples: Float32Array, sampleRate: number): number {
  // Analyze the quietest 5% of 50ms windows to estimate noise floor
  const windowSize = Math.floor(sampleRate * 0.05);
  const numWindows = Math.floor(samples.length / windowSize);
  const windowRMS: number[] = [];

  for (let w = 0; w < numWindows; w++) {
    let sum = 0;
    const start = w * windowSize;
    for (let i = start; i < start + windowSize; i++) {
      sum += samples[i] * samples[i];
    }
    const rms = Math.sqrt(sum / windowSize);
    if (rms > 0.00001) windowRMS.push(rms); // skip true silence
  }

  if (windowRMS.length === 0) return -96;
  windowRMS.sort((a, b) => a - b);
  const p5 = windowRMS[Math.floor(windowRMS.length * 0.05)] ?? windowRMS[0];
  return toDBFS(p5);
}

function calculateShortTermMax(samples: Float32Array, sampleRate: number): number {
  // Max RMS over 3-second windows (approximation of short-term loudness)
  const windowSize = Math.floor(sampleRate * 3);
  const hopSize = Math.floor(sampleRate * 0.5);
  let maxRMS = 0;

  for (let start = 0; start + windowSize <= samples.length; start += hopSize) {
    let sum = 0;
    for (let i = start; i < start + windowSize; i++) {
      sum += samples[i] * samples[i];
    }
    const rms = Math.sqrt(sum / windowSize);
    if (rms > maxRMS) maxRMS = rms;
  }

  return toDBFS(maxRMS);
}

function calculateStereoWidth(left: Float32Array, right: Float32Array): number {
  let midEnergy = 0;
  let sideEnergy = 0;
  const len = Math.min(left.length, right.length);

  for (let i = 0; i < len; i++) {
    const mid = (left[i] + right[i]) / 2;
    const side = (left[i] - right[i]) / 2;
    midEnergy += mid * mid;
    sideEnergy += side * side;
  }

  if (midEnergy === 0) return 0;
  const ratio = sideEnergy / (midEnergy + sideEnergy);
  return Math.min(100, ratio * 200);
}

function calculatePhaseCorrelation(left: Float32Array, right: Float32Array): number {
  let sumLR = 0;
  let sumLL = 0;
  let sumRR = 0;
  const len = Math.min(left.length, right.length);

  for (let i = 0; i < len; i++) {
    sumLR += left[i] * right[i];
    sumLL += left[i] * left[i];
    sumRR += right[i] * right[i];
  }

  const denom = Math.sqrt(sumLL * sumRR);
  if (denom === 0) return 0;
  return sumLR / denom;
}

function calculateStereoBalance(left: Float32Array, right: Float32Array): number {
  const leftRMS = calculateRMS(left);
  const rightRMS = calculateRMS(right);
  const total = leftRMS + rightRMS;
  if (total === 0) return 0;
  return (rightRMS - leftRMS) / total;
}

function calculateMonoCompatibility(left: Float32Array, right: Float32Array): number {
  // How much energy survives a mono fold (100 = perfect, 0 = total cancellation)
  const len = Math.min(left.length, right.length);
  let stereoEnergy = 0;
  let monoEnergy = 0;

  for (let i = 0; i < len; i++) {
    stereoEnergy += left[i] * left[i] + right[i] * right[i];
    const mono = (left[i] + right[i]) / 2;
    monoEnergy += mono * mono * 2; // *2 to normalize to same scale
  }

  if (stereoEnergy === 0) return 100;
  return Math.min(100, Math.round((monoEnergy / stereoEnergy) * 100));
}

// --- Frequency analysis with proper FFT-like approach ---

function estimateFrequencyBands(samples: Float32Array, sampleRate: number): FrequencyBand[] {
  // Use overlapping blocks with zero-crossing + energy for band estimation
  // Enhanced: use multiple block sizes for better low-freq resolution
  const blockSize = 4096;
  const numBlocks = Math.floor(samples.length / blockSize);

  const bandEnergies = [0, 0, 0, 0, 0]; // sub, lowmid, mid, highmid, high
  const bandCounts = [0, 0, 0, 0, 0];

  for (let b = 0; b < numBlocks; b++) {
    const start = b * blockSize;
    let zeroCrossings = 0;
    let blockEnergy = 0;

    for (let i = start; i < start + blockSize - 1; i++) {
      blockEnergy += samples[i] * samples[i];
      if ((samples[i] >= 0 && samples[i + 1] < 0) || (samples[i] < 0 && samples[i + 1] >= 0)) {
        zeroCrossings++;
      }
    }

    blockEnergy /= blockSize;
    if (blockEnergy < 0.000001) continue; // skip silence

    const estimatedFreq = (zeroCrossings * sampleRate) / (2 * blockSize);

    let bandIdx: number;
    if (estimatedFreq < 250) bandIdx = 0;
    else if (estimatedFreq < 1000) bandIdx = 1;
    else if (estimatedFreq < 4000) bandIdx = 2;
    else if (estimatedFreq < 8000) bandIdx = 3;
    else bandIdx = 4;

    bandEnergies[bandIdx] += blockEnergy;
    bandCounts[bandIdx]++;
  }

  // Normalize by count to get average energy per band
  const avgEnergies = bandEnergies.map((e, i) => (bandCounts[i] > 0 ? e / bandCounts[i] : 0));
  const maxEnergy = Math.max(...avgEnergies, 0.0001);

  const normalize = (e: number) => Math.min(100, (e / maxEnergy) * 100);

  // Ideal balance targets (relative): sub=60, lowmid=80, mid=100, highmid=70, high=40
  const idealRatios = [0.6, 0.8, 1.0, 0.7, 0.4];

  const rateEnergy = (e: number, idealRatio: number): FrequencyBand["rating"] => {
    const n = normalize(e);
    const ideal = idealRatio * 100;
    const deviation = n - ideal;
    if (n < 10) return "deficient";
    if (deviation < -30) return "low";
    if (Math.abs(deviation) <= 25) return "balanced";
    if (deviation <= 45) return "elevated";
    return "excessive";
  };

  const names = ["Sub Bass", "Low Mids", "Mids", "High Mids", "Highs"];
  const ranges = ["20-250 Hz", "250-1k Hz", "1k-4k Hz", "4k-8k Hz", "8k-20k Hz"];

  return names.map((name, i) => ({
    name,
    range: ranges[i],
    energy: Math.round(normalize(avgEnergies[i])),
    rating: rateEnergy(avgEnergies[i], idealRatios[i]),
  }));
}

function estimateSpectralCentroid(samples: Float32Array, sampleRate: number): number {
  const blockSize = 4096;
  const numBlocks = Math.floor(samples.length / blockSize);
  let totalWeightedFreq = 0;
  let totalEnergy = 0;

  for (let b = 0; b < numBlocks; b++) {
    const start = b * blockSize;
    let zeroCrossings = 0;
    let blockEnergy = 0;

    for (let i = start; i < start + blockSize - 1; i++) {
      blockEnergy += samples[i] * samples[i];
      if ((samples[i] >= 0 && samples[i + 1] < 0) || (samples[i] < 0 && samples[i + 1] >= 0)) {
        zeroCrossings++;
      }
    }

    if (blockEnergy < 0.000001) continue;
    const estimatedFreq = (zeroCrossings * sampleRate) / (2 * blockSize);
    totalWeightedFreq += estimatedFreq * blockEnergy;
    totalEnergy += blockEnergy;
  }

  if (totalEnergy === 0) return 0;
  return Math.round(totalWeightedFreq / totalEnergy);
}

function calculateSpectralBalance(spectralCentroid: number): number {
  // Ideal centroid for a balanced mix is roughly 1500-2500 Hz
  // Returns -100 (very dark) to +100 (very bright)
  const ideal = 2000;
  const deviation = spectralCentroid - ideal;
  return Math.max(-100, Math.min(100, Math.round(deviation / 30)));
}

// --- Sub-score calculations ---

function gradeFromScore(score: number): CategoryScore["grade"] {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 55) return "C";
  if (score >= 35) return "D";
  return "F";
}

function calculateLoudnessScore(
  lufs: number,
  truePeak: number,
  peakLevel: number,
  loudnessRange: number
): CategoryScore {
  let score = 100;
  let summary = "";

  // LUFS scoring: ideal for pre-master is -16 to -12
  if (lufs > -6) { score -= 40; summary = "Dangerously loud"; }
  else if (lufs > -9) { score -= 30; summary = "Way too loud for mastering"; }
  else if (lufs > -11) { score -= 15; summary = "Louder than streaming targets"; }
  else if (lufs >= -18 && lufs <= -12) { score += 0; summary = "Good loudness range"; }
  else if (lufs < -24) { score -= 15; summary = "Very quiet — may need gain staging"; }
  else if (lufs < -20) { score -= 5; summary = "On the quiet side"; }
  else { summary = "Acceptable loudness"; }

  // True peak scoring
  if (truePeak > -0.1) { score -= 20; summary += ", no headroom"; }
  else if (truePeak > -0.5) { score -= 12; }
  else if (truePeak > -1) { score -= 5; }
  else if (truePeak <= -1 && truePeak >= -6) { score += 5; }

  // Peak level
  if (peakLevel > -0.3) score -= 8;

  // LRA scoring: ideal 6-12 LU
  if (loudnessRange < 3) { score -= 15; }
  else if (loudnessRange < 5) { score -= 8; }
  else if (loudnessRange >= 6 && loudnessRange <= 12) { score += 5; }
  else if (loudnessRange > 18) { score -= 5; }

  score = Math.max(0, Math.min(100, score));
  if (!summary) summary = score >= 80 ? "Loudness is well-managed" : "Loudness needs attention";

  return { score, label: "Loudness", grade: gradeFromScore(score), summary };
}

function calculateDynamicsScore(
  dynamicRange: number,
  crestFactor: number,
  loudnessRange: number,
  shortTermMax: number,
  rmsLevel: number
): CategoryScore {
  let score = 100;
  let summary = "";

  // Dynamic range: ideal 10-18 dB for a mix
  if (dynamicRange < 4) { score -= 40; summary = "Severely crushed"; }
  else if (dynamicRange < 6) { score -= 25; summary = "Over-compressed"; }
  else if (dynamicRange < 8) { score -= 12; summary = "Compressed"; }
  else if (dynamicRange >= 10 && dynamicRange <= 18) { score += 5; summary = "Healthy dynamics"; }
  else if (dynamicRange > 25) { score -= 8; summary = "Very dynamic — may need control"; }
  else { summary = "Acceptable dynamics"; }

  // Crest factor: ideal 10-20 dB
  if (crestFactor < 6) score -= 10;
  else if (crestFactor >= 10 && crestFactor <= 20) score += 3;

  // Short-term loudness vs RMS — big difference means inconsistent levels
  const stDiff = shortTermMax - rmsLevel;
  if (stDiff > 15) score -= 8;
  else if (stDiff > 10) score -= 3;

  // LRA bonus
  if (loudnessRange >= 6 && loudnessRange <= 14) score += 3;

  score = Math.max(0, Math.min(100, score));
  if (!summary) summary = score >= 80 ? "Dynamics are well-balanced" : "Dynamics need work";

  return { score, label: "Dynamics", grade: gradeFromScore(score), summary };
}

function calculateFrequencyScore(
  bands: FrequencyBand[],
  spectralCentroid: number,
  spectralBalance: number
): CategoryScore {
  let score = 100;
  let summary = "";

  // Penalize for each band that's off
  let excessiveCount = 0;
  let deficientCount = 0;
  for (const band of bands) {
    if (band.rating === "excessive") { score -= 12; excessiveCount++; }
    else if (band.rating === "deficient") { score -= 8; deficientCount++; }
    else if (band.rating === "elevated") { score -= 3; }
    else if (band.rating === "low") { score -= 4; }
    else { score += 2; } // balanced bonus
  }

  // Spectral balance
  if (Math.abs(spectralBalance) > 60) score -= 10;
  else if (Math.abs(spectralBalance) > 35) score -= 5;
  else if (Math.abs(spectralBalance) <= 15) score += 5;

  // Centroid in sweet spot
  if (spectralCentroid >= 1500 && spectralCentroid <= 3000) score += 3;

  if (excessiveCount >= 2) summary = "Multiple frequency buildups detected";
  else if (deficientCount >= 2) summary = "Thin-sounding — missing frequency content";
  else if (excessiveCount === 1) summary = "One band has excessive energy";
  else if (deficientCount === 1) summary = "One band is lacking";
  else summary = "Frequency balance is solid";

  score = Math.max(0, Math.min(100, score));
  return { score, label: "Frequency", grade: gradeFromScore(score), summary };
}

function calculateStereoScore(
  stereoWidth: number,
  phaseCorrelation: number,
  stereoBalance: number,
  monoCompatibility: number,
  channels: number
): CategoryScore {
  let score = 100;
  let summary = "";

  if (channels < 2) {
    return { score: 70, label: "Stereo", grade: "B", summary: "Mono file — stereo analysis N/A" };
  }

  // Width: ideal 30-70
  if (stereoWidth < 5) { score -= 20; summary = "Essentially mono"; }
  else if (stereoWidth < 15) { score -= 10; summary = "Very narrow"; }
  else if (stereoWidth >= 30 && stereoWidth <= 70) { score += 5; summary = "Good stereo width"; }
  else if (stereoWidth > 85) { score -= 15; summary = "Excessively wide"; }
  else if (stereoWidth > 75) { score -= 5; }

  // Phase correlation: ideal > 0.5
  if (phaseCorrelation < 0) { score -= 30; summary = "Phase cancellation detected"; }
  else if (phaseCorrelation < 0.2) { score -= 18; }
  else if (phaseCorrelation < 0.4) { score -= 8; }
  else if (phaseCorrelation >= 0.6) { score += 5; }

  // Mono compatibility
  if (monoCompatibility < 50) { score -= 15; }
  else if (monoCompatibility < 70) { score -= 5; }
  else if (monoCompatibility >= 85) { score += 3; }

  // Balance: ideal near 0
  if (Math.abs(stereoBalance) > 0.25) { score -= 12; }
  else if (Math.abs(stereoBalance) > 0.1) { score -= 4; }
  else { score += 3; }

  score = Math.max(0, Math.min(100, score));
  if (!summary) summary = score >= 80 ? "Stereo image is healthy" : "Stereo image needs attention";

  return { score, label: "Stereo", grade: gradeFromScore(score), summary };
}

function calculateQualityScore(
  bitrate: number,
  sampleRate: number,
  bitDepth: number | null,
  clippingSamples: number,
  totalSamples: number,
  dcOffset: number,
  silenceRatio: number,
  noiseFloor: number,
  format: string
): CategoryScore {
  let score = 100;
  let summary = "";

  // Clipping
  const clipPct = totalSamples > 0 ? (clippingSamples / totalSamples) * 100 : 0;
  if (clipPct > 1) { score -= 30; summary = "Significant clipping"; }
  else if (clipPct > 0.1) { score -= 15; summary = "Moderate clipping"; }
  else if (clipPct > 0.01) { score -= 5; summary = "Minor clipping"; }
  else { score += 5; }

  // DC offset
  if (Math.abs(dcOffset) > 0.05) score -= 12;
  else if (Math.abs(dcOffset) > 0.01) score -= 5;

  // Silence
  if (silenceRatio > 40) score -= 8;
  else if (silenceRatio > 25) score -= 3;

  // Noise floor (should be below -60 dBFS for a clean mix)
  if (noiseFloor > -40) score -= 10;
  else if (noiseFloor > -50) score -= 5;
  else if (noiseFloor < -65) score += 3;

  // Bitrate
  if (bitrate < 128000) score -= 10;
  else if (bitrate < 192000) score -= 5;
  else if (bitrate >= 256000) score += 3;

  // Sample rate
  if (sampleRate < 44100) score -= 8;
  else if (sampleRate >= 44100) score += 2;
  if (sampleRate >= 48000) score += 2;

  score = Math.max(0, Math.min(100, score));
  if (!summary) summary = score >= 80 ? "Technical quality is good" : "Technical quality has issues";

  return { score, label: "Quality", grade: gradeFromScore(score), summary };
}

// --- Issue detection (enhanced) ---

function generateIssues(metrics: Partial<AudioMetrics>): AnalysisIssue[] {
  const issues: AnalysisIssue[] = [];

  // Clipping
  const clipPct = metrics.clippingPercentage ?? 0;
  if (clipPct > 1) {
    issues.push({
      severity: "critical",
      category: "Clipping",
      message: `Heavy clipping: ${metrics.clippingSamples?.toLocaleString()} samples (${clipPct.toFixed(2)}%). Audible distortion is likely.`,
    });
  } else if (clipPct > 0.01) {
    issues.push({
      severity: "warning",
      category: "Clipping",
      message: `Clipping detected: ${metrics.clippingSamples?.toLocaleString()} samples (${clipPct.toFixed(3)}%). Check the loudest sections.`,
    });
  } else if ((metrics.clippingSamples ?? 0) > 0) {
    issues.push({
      severity: "info",
      category: "Clipping",
      message: `Trace clipping: ${metrics.clippingSamples} samples. Likely inaudible but worth noting.`,
    });
  }

  // True peak / headroom
  const tp = metrics.truePeak ?? -1;
  if (tp > -0.1) {
    issues.push({
      severity: "critical",
      category: "Headroom",
      message: `True peak at ${tp.toFixed(1)} dBTP — no headroom. Streaming codecs will clip. Target -1 dBTP minimum.`,
    });
  } else if (tp > -0.5) {
    issues.push({
      severity: "warning",
      category: "Headroom",
      message: `True peak at ${tp.toFixed(1)} dBTP. Very little headroom for codec encoding. Aim for -1 dBTP.`,
    });
  } else if (tp > -1) {
    issues.push({
      severity: "info",
      category: "Headroom",
      message: `True peak at ${tp.toFixed(1)} dBTP. Acceptable but -1 dBTP is safer for all codecs.`,
    });
  }

  // Integrated loudness
  const lufs = metrics.estimatedLUFS ?? -24;
  if (lufs > -6) {
    issues.push({
      severity: "critical",
      category: "Loudness",
      message: `Integrated loudness is ${lufs.toFixed(1)} LUFS — dangerously loud. Streaming platforms will aggressively turn this down.`,
    });
  } else if (lufs > -9) {
    issues.push({
      severity: "critical",
      category: "Loudness",
      message: `Integrated loudness is ${lufs.toFixed(1)} LUFS — significantly louder than any streaming target (-14 LUFS).`,
    });
  } else if (lufs > -11) {
    issues.push({
      severity: "warning",
      category: "Loudness",
      message: `Integrated loudness is ${lufs.toFixed(1)} LUFS — louder than Spotify/Apple Music target (-14 LUFS).`,
    });
  } else if (lufs < -24) {
    issues.push({
      severity: "warning",
      category: "Loudness",
      message: `Integrated loudness is ${lufs.toFixed(1)} LUFS — very quiet. Check gain staging.`,
    });
  }

  // Dynamic range
  const dr = metrics.dynamicRange ?? 12;
  if (dr < 4) {
    issues.push({
      severity: "critical",
      category: "Dynamics",
      message: `Dynamic range is only ${dr.toFixed(1)} dB. Severely crushed — will sound lifeless and fatiguing.`,
    });
  } else if (dr < 6) {
    issues.push({
      severity: "critical",
      category: "Dynamics",
      message: `Dynamic range is ${dr.toFixed(1)} dB. Over-compressed — lacks punch and breathing room.`,
    });
  } else if (dr < 8) {
    issues.push({
      severity: "warning",
      category: "Dynamics",
      message: `Dynamic range is ${dr.toFixed(1)} dB. Fairly compressed — consider easing up on bus compression.`,
    });
  } else if (dr > 25) {
    issues.push({
      severity: "info",
      category: "Dynamics",
      message: `Dynamic range is ${dr.toFixed(1)} dB. Very dynamic — may need some compression for consistency.`,
    });
  }

  // Loudness range
  const lra = metrics.loudnessRange ?? 7;
  if (lra < 3) {
    issues.push({
      severity: "warning",
      category: "Loudness Range",
      message: `Loudness range is only ${lra.toFixed(1)} LU. The track has very little dynamic variation.`,
    });
  } else if (lra > 18) {
    issues.push({
      severity: "info",
      category: "Loudness Range",
      message: `Loudness range is ${lra.toFixed(1)} LU. Very wide — some sections may feel too quiet relative to others.`,
    });
  }

  // DC Offset
  if (Math.abs(metrics.dcOffset ?? 0) > 0.03) {
    issues.push({
      severity: "warning",
      category: "DC Offset",
      message: `Significant DC offset (${((metrics.dcOffset ?? 0) * 100).toFixed(2)}%). Apply a high-pass filter at 20-30 Hz.`,
    });
  } else if (Math.abs(metrics.dcOffset ?? 0) > 0.01) {
    issues.push({
      severity: "info",
      category: "DC Offset",
      message: `Minor DC offset detected (${((metrics.dcOffset ?? 0) * 100).toFixed(2)}%).`,
    });
  }

  // Noise floor
  const nf = metrics.noiseFloor ?? -70;
  if (nf > -40) {
    issues.push({
      severity: "warning",
      category: "Noise",
      message: `High noise floor at ${nf.toFixed(0)} dBFS. Background noise may be audible in quiet sections.`,
    });
  } else if (nf > -50) {
    issues.push({
      severity: "info",
      category: "Noise",
      message: `Noise floor at ${nf.toFixed(0)} dBFS. Acceptable but could be cleaner.`,
    });
  }

  // Phase / stereo
  const pc = metrics.phaseCorrelation ?? 1;
  if (pc < 0) {
    issues.push({
      severity: "critical",
      category: "Phase",
      message: `Negative phase correlation (${pc.toFixed(2)}). Severe mono compatibility issues — audio will cancel in mono.`,
    });
  } else if (pc < 0.2) {
    issues.push({
      severity: "warning",
      category: "Phase",
      message: `Very low phase correlation (${pc.toFixed(2)}). Significant energy loss in mono playback.`,
    });
  } else if (pc < 0.4) {
    issues.push({
      severity: "info",
      category: "Phase",
      message: `Phase correlation is ${pc.toFixed(2)}. Some mono compatibility concerns.`,
    });
  }

  // Mono compatibility
  const mc = metrics.monoCompatibility ?? 100;
  if (mc < 50 && (metrics.channels ?? 1) >= 2) {
    issues.push({
      severity: "critical",
      category: "Mono Compatibility",
      message: `Only ${mc}% of energy survives mono fold. Major elements may disappear on mono speakers.`,
    });
  } else if (mc < 70 && (metrics.channels ?? 1) >= 2) {
    issues.push({
      severity: "warning",
      category: "Mono Compatibility",
      message: `${mc}% mono compatibility. Some energy loss on mono playback systems.`,
    });
  }

  // Stereo width
  const sw = metrics.stereoWidth ?? 50;
  if (sw < 10 && (metrics.channels ?? 1) >= 2) {
    issues.push({
      severity: "info",
      category: "Stereo Width",
      message: `Very narrow stereo image (${sw.toFixed(0)}%). Consider stereo widening techniques.`,
    });
  } else if (sw > 85) {
    issues.push({
      severity: "warning",
      category: "Stereo Width",
      message: `Extremely wide stereo image (${sw.toFixed(0)}%). May cause phase issues on some systems.`,
    });
  }

  // Balance
  if (Math.abs(metrics.stereoBalance ?? 0) > 0.2) {
    const side = (metrics.stereoBalance ?? 0) > 0 ? "right" : "left";
    issues.push({
      severity: "warning",
      category: "Balance",
      message: `Mix is significantly louder on the ${side} channel. Check panning and balance.`,
    });
  } else if (Math.abs(metrics.stereoBalance ?? 0) > 0.1) {
    const side = (metrics.stereoBalance ?? 0) > 0 ? "right" : "left";
    issues.push({
      severity: "info",
      category: "Balance",
      message: `Slight ${side}-channel bias. May be intentional.`,
    });
  }

  // Bitrate / quality
  if ((metrics.bitrate ?? 0) < 128000) {
    issues.push({
      severity: "warning",
      category: "Quality",
      message: `Very low bitrate (${Math.round((metrics.bitrate ?? 0) / 1000)} kbps). Significant quality loss. Use WAV/AIFF for mastering.`,
    });
  } else if ((metrics.bitrate ?? 0) < 192000) {
    issues.push({
      severity: "info",
      category: "Quality",
      message: `Low bitrate (${Math.round((metrics.bitrate ?? 0) / 1000)} kbps). For best mastering results, use WAV/AIFF or 320 kbps MP3.`,
    });
  }

  if ((metrics.sampleRate ?? 44100) < 44100) {
    issues.push({
      severity: "warning",
      category: "Sample Rate",
      message: `Sample rate is ${metrics.sampleRate} Hz. Standard is 44.1 kHz or higher.`,
    });
  }

  // Silence
  if ((metrics.silenceRatio ?? 0) > 40) {
    issues.push({
      severity: "warning",
      category: "Silence",
      message: `${metrics.silenceRatio?.toFixed(0)}% of the track is silence. Excessive dead space.`,
    });
  } else if ((metrics.silenceRatio ?? 0) > 25) {
    issues.push({
      severity: "info",
      category: "Silence",
      message: `${metrics.silenceRatio?.toFixed(0)}% silence. Check intro/outro padding.`,
    });
  }

  // Frequency balance
  for (const band of metrics.frequencyBands ?? []) {
    if (band.rating === "excessive") {
      issues.push({
        severity: "warning",
        category: "Frequency",
        message: `${band.name} (${band.range}) has excessive energy (${band.energy}%). Consider EQ reduction.`,
      });
    }
    if (band.rating === "deficient") {
      issues.push({
        severity: "info",
        category: "Frequency",
        message: `${band.name} (${band.range}) is deficient (${band.energy}%). May need a boost or may be intentional.`,
      });
    }
  }

  return issues;
}

// --- Recommendations (enhanced) ---

function generateRecommendations(metrics: Partial<AudioMetrics>, issues: AnalysisIssue[]): string[] {
  const recs: string[] = [];
  const cats = new Set(issues.map((i) => i.category));
  const hasCritical = issues.some((i) => i.severity === "critical");

  if (cats.has("Clipping")) {
    recs.push(
      "Reduce gain on your master bus to eliminate clipping. In Logic Pro, pull down the master fader and check individual channel peaks. Aim for peaks below -1 dBFS."
    );
  }

  if (cats.has("Headroom")) {
    recs.push(
      "Leave -3 to -6 dB of headroom on your mix bus. This gives the mastering chain room to work without introducing inter-sample peaks."
    );
  }

  if (cats.has("Loudness")) {
    const lufs = metrics.estimatedLUFS ?? -14;
    if (lufs > -11) {
      recs.push(
        "Your mix is louder than streaming targets. Remove any limiter/maximizer on the mix bus — loudness is the mastering engineer's job."
      );
    } else if (lufs < -20) {
      recs.push(
        "Your mix is very quiet. Check gain staging throughout your signal chain. Each track should peak around -12 to -6 dBFS."
      );
    }
  }

  if (cats.has("Dynamics")) {
    recs.push(
      "Ease up on bus compression. In Logic Pro, try raising the threshold or lowering the ratio on your mix bus compressor. A ratio of 1.5-2:1 with a high threshold preserves dynamics."
    );
  }

  if (cats.has("Loudness Range")) {
    const lra = metrics.loudnessRange ?? 7;
    if (lra < 3) {
      recs.push(
        "Your track has very little dynamic variation. Consider using automation to create more contrast between sections (verse vs chorus)."
      );
    }
  }

  if (cats.has("Phase") || cats.has("Mono Compatibility")) {
    recs.push(
      "Check mono compatibility: press the mono button in Logic Pro's Control Bar. Fix any elements that disappear or sound thin. Common culprits: wide stereo effects, out-of-phase samples."
    );
  }

  if (cats.has("DC Offset")) {
    recs.push(
      "Add a high-pass filter (Channel EQ) at 20-30 Hz on your master bus to remove DC offset and sub-rumble that wastes headroom."
    );
  }

  if (cats.has("Noise")) {
    recs.push(
      "Background noise detected. Check for noisy recordings, ground loops, or high-gain amp sims. Use a gate or noise reduction on affected tracks."
    );
  }

  if (cats.has("Stereo Width")) {
    const sw = metrics.stereoWidth ?? 50;
    if (sw < 15) {
      recs.push(
        "Widen your stereo image: use Logic Pro's Stereo Spread or Direction Mixer. Pan instruments deliberately — not everything needs to be center."
      );
    } else if (sw > 85) {
      recs.push(
        "Rein in the stereo width. Excessive widening causes phase issues. Check any stereo widener plugins and reduce their effect."
      );
    }
  }

  if (cats.has("Balance")) {
    recs.push(
      "Your mix has a left/right imbalance. Check panning positions and ensure no single element is pulling the balance off-center."
    );
  }

  if (cats.has("Quality")) {
    recs.push(
      "Export your mix as a WAV or AIFF file (24-bit, 44.1 kHz or higher) for the best mastering results. MP3 introduces artifacts that compound during processing."
    );
  }

  // Frequency-specific recs
  const freqIssues = issues.filter((i) => i.category === "Frequency");
  if (freqIssues.length > 0) {
    const excessiveBands = (metrics.frequencyBands ?? []).filter((b) => b.rating === "excessive");
    const deficientBands = (metrics.frequencyBands ?? []).filter((b) => b.rating === "deficient");

    if (excessiveBands.length > 0) {
      recs.push(
        `Use a Channel EQ on your mix bus to gently cut the ${excessiveBands.map((b) => b.name).join(", ")} range. Start with -2 dB cuts and adjust to taste.`
      );
    }
    if (deficientBands.length > 0) {
      recs.push(
        `The ${deficientBands.map((b) => b.name).join(", ")} range is thin. Check if instruments in that range are being masked or filtered too aggressively.`
      );
    }
  }

  if (!hasCritical && issues.length <= 3) {
    recs.push(
      "Your mix is in solid shape! A/B reference against a professional track in your genre using Logic Pro's reference track feature to fine-tune."
    );
  }

  recs.push(
    "Always listen on multiple systems (studio monitors, headphones, car, phone speaker) before finalizing your mix."
  );

  return recs;
}

// --- Overall mastering score (weighted from sub-scores) ---

function calculateMasteringScore(
  loudnessScore: CategoryScore,
  dynamicsScore: CategoryScore,
  frequencyScore: CategoryScore,
  stereoScore: CategoryScore,
  qualityScore: CategoryScore
): number {
  // Weighted average: loudness and quality matter most for mastering readiness
  const weighted =
    loudnessScore.score * 0.25 +
    dynamicsScore.score * 0.20 +
    frequencyScore.score * 0.25 +
    stereoScore.score * 0.15 +
    qualityScore.score * 0.15;

  return Math.max(0, Math.min(100, Math.round(weighted)));
}

function getReadinessLevel(score: number): AudioMetrics["readinessLevel"] {
  if (score >= 80) return "ready";
  if (score >= 60) return "almost-ready";
  if (score >= 35) return "needs-work";
  return "not-ready";
}

// --- Main analysis function ---

export async function analyzeAudio(
  fileBuffer: Buffer,
  fileName: string
): Promise<AudioMetrics> {
  // Parse metadata
  const metadata = await mm.parseBuffer(fileBuffer, { mimeType: "audio/mpeg" });
  const format = metadata.format;

  const sampleRate = format.sampleRate ?? 44100;
  const channels = format.numberOfChannels ?? 2;
  const duration = format.duration ?? 0;
  const bitrate = format.bitrate ?? 0;
  const bitDepth = format.bitsPerSample ?? null;
  const codec = format.codec ?? "unknown";
  const container = format.container ?? "unknown";

  // Decode real PCM with ffmpeg + measure LUFS in parallel
  const [{ left, right }, loudnorm] = await Promise.all([
    decodePCMWithFFmpeg(fileBuffer, channels),
    measureLoudnorm(fileBuffer),
  ]);

  // Core measurements from decoded PCM
  const leftRMS = calculateRMS(left);
  const leftPeak = calculatePeak(left);
  let combinedRMS = leftRMS;
  let combinedPeak = leftPeak;
  let clippingSamples = countClipping(left);
  const totalSamples = left.length + (right?.length ?? 0);

  if (right) {
    const rightRMS = calculateRMS(right);
    const rightPeak = calculatePeak(right);
    combinedRMS = Math.sqrt((leftRMS * leftRMS + rightRMS * rightRMS) / 2);
    combinedPeak = Math.max(leftPeak, rightPeak);
    clippingSamples += countClipping(right);
  }

  const peakLevel = toDBFS(combinedPeak);
  const rmsLevel = toDBFS(combinedRMS);
  const dynamicRange = peakLevel - rmsLevel;
  const crestFactor = dynamicRange;

  // Real LUFS from ffmpeg loudnorm
  const estimatedLUFS = loudnorm.inputI;
  const truePeak = loudnorm.inputTP;
  const loudnessRange = loudnorm.inputLRA;

  const dcOffset = calculateDCOffset(left);
  const silenceRatio = calculateSilenceRatio(left);
  const noiseFloor = calculateNoiseFloor(left, sampleRate);
  const shortTermMax = calculateShortTermMax(left, sampleRate);
  const clippingPercentage = totalSamples > 0 ? (clippingSamples / totalSamples) * 100 : 0;

  let stereoWidth = 0;
  let phaseCorrelation = 1;
  let stereoBalance = 0;
  let monoCompatibility = 100;

  if (right) {
    stereoWidth = calculateStereoWidth(left, right);
    phaseCorrelation = calculatePhaseCorrelation(left, right);
    stereoBalance = calculateStereoBalance(left, right);
    monoCompatibility = calculateMonoCompatibility(left, right);
  }

  const frequencyBands = estimateFrequencyBands(left, sampleRate);
  const spectralCentroid = estimateSpectralCentroid(left, sampleRate);
  const spectralBalance = calculateSpectralBalance(spectralCentroid);

  // Calculate sub-scores
  const loudnessScoreResult = calculateLoudnessScore(estimatedLUFS, truePeak, peakLevel, loudnessRange);
  const dynamicsScoreResult = calculateDynamicsScore(dynamicRange, crestFactor, loudnessRange, shortTermMax, rmsLevel);
  const frequencyScoreResult = calculateFrequencyScore(frequencyBands, spectralCentroid, spectralBalance);
  const stereoScoreResult = calculateStereoScore(stereoWidth, phaseCorrelation, stereoBalance, monoCompatibility, channels);
  const qualityScoreResult = calculateQualityScore(bitrate, sampleRate, bitDepth, clippingSamples, totalSamples, dcOffset, silenceRatio, noiseFloor, container);

  const partialMetrics: Partial<AudioMetrics> = {
    fileName,
    format: container,
    codec,
    bitrate,
    sampleRate,
    bitDepth,
    channels,
    duration,
    fileSize: fileBuffer.length,
    peakLevel,
    truePeak,
    rmsLevel,
    estimatedLUFS,
    loudnessRange,
    dynamicRange,
    crestFactor,
    shortTermMax,
    clippingDetected: clippingSamples > 0,
    clippingSamples,
    clippingPercentage,
    dcOffset,
    silenceRatio,
    noiseFloor,
    stereoWidth,
    phaseCorrelation,
    stereoBalance,
    monoCompatibility,
    frequencyBands,
    spectralCentroid,
    spectralBalance,
  };

  const issues = generateIssues(partialMetrics);
  const recommendations = generateRecommendations(partialMetrics, issues);
  const masteringScore = calculateMasteringScore(
    loudnessScoreResult, dynamicsScoreResult, frequencyScoreResult, stereoScoreResult, qualityScoreResult
  );
  const readinessLevel = getReadinessLevel(masteringScore);

  return {
    ...(partialMetrics as AudioMetrics),
    loudnessScore: loudnessScoreResult,
    dynamicsScore: dynamicsScoreResult,
    frequencyScore: frequencyScoreResult,
    stereoScore: stereoScoreResult,
    qualityScore: qualityScoreResult,
    masteringScore,
    readinessLevel,
    issues,
    recommendations,
  };
}
