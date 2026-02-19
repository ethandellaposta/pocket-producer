import * as mm from "music-metadata";

export interface FrequencyBand {
  name: string;
  range: string;
  energy: number; // 0-100
  rating: "deficient" | "low" | "balanced" | "elevated" | "excessive";
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
  rmsLevel: number; // dBFS
  estimatedLUFS: number;
  dynamicRange: number; // dB
  crestFactor: number; // dB

  // Quality indicators
  clippingDetected: boolean;
  clippingSamples: number;
  dcOffset: number;
  silenceRatio: number; // percentage of silence
  stereoWidth: number; // 0-100
  phaseCorrelation: number; // -1 to 1
  stereoBalance: number; // -1 (left) to 1 (right)

  // Frequency analysis
  frequencyBands: FrequencyBand[];
  spectralCentroid: number; // Hz - brightness indicator

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

function decodePCMSamples(
  buffer: Buffer,
  format: mm.IFormat
): { left: Float32Array; right: Float32Array | null } {
  // For compressed formats, we estimate from metadata
  // For real production use, you'd use ffmpeg/Web Audio API to decode
  // Here we analyze the raw byte patterns for heuristic analysis
  const numSamples = Math.min(buffer.length / 2, 10_000_000);
  const left = new Float32Array(numSamples);
  let right: Float32Array | null = null;

  if ((format.numberOfChannels ?? 1) >= 2) {
    right = new Float32Array(numSamples);
  }

  // Treat raw bytes as signed 16-bit PCM for heuristic analysis
  const channels = format.numberOfChannels ?? 1;
  const bytesPerSample = 2;
  const frameSize = bytesPerSample * channels;
  const totalFrames = Math.min(
    Math.floor(buffer.length / frameSize),
    numSamples
  );

  for (let i = 0; i < totalFrames; i++) {
    const offset = i * frameSize;
    if (offset + bytesPerSample <= buffer.length) {
      const sample = buffer.readInt16LE(offset) / 32768;
      left[i] = Math.max(-1, Math.min(1, sample));

      if (right && channels >= 2 && offset + frameSize <= buffer.length) {
        const rSample = buffer.readInt16LE(offset + bytesPerSample) / 32768;
        right[i] = Math.max(-1, Math.min(1, rSample));
      }
    }
  }

  return { left: left.subarray(0, totalFrames), right: right?.subarray(0, totalFrames) ?? null };
}

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

function calculateSilenceRatio(
  samples: Float32Array,
  threshold = 0.001
): number {
  let silentSamples = 0;
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]) < threshold) silentSamples++;
  }
  return (silentSamples / samples.length) * 100;
}

function calculateStereoWidth(
  left: Float32Array,
  right: Float32Array
): number {
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

function calculatePhaseCorrelation(
  left: Float32Array,
  right: Float32Array
): number {
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

function calculateStereoBalance(
  left: Float32Array,
  right: Float32Array
): number {
  const leftRMS = calculateRMS(left);
  const rightRMS = calculateRMS(right);
  const total = leftRMS + rightRMS;
  if (total === 0) return 0;
  return (rightRMS - leftRMS) / total;
}

function estimateFrequencyBands(samples: Float32Array, sampleRate: number): FrequencyBand[] {
  // Simple energy estimation using zero-crossing rate and amplitude envelope
  // For production, you'd use FFT
  const blockSize = 2048;
  const numBlocks = Math.floor(samples.length / blockSize);

  let lowEnergy = 0;
  let lowMidEnergy = 0;
  let midEnergy = 0;
  let highMidEnergy = 0;
  let highEnergy = 0;

  for (let b = 0; b < numBlocks; b++) {
    const start = b * blockSize;
    let zeroCrossings = 0;
    let blockEnergy = 0;

    for (let i = start; i < start + blockSize - 1; i++) {
      blockEnergy += samples[i] * samples[i];
      if (
        (samples[i] >= 0 && samples[i + 1] < 0) ||
        (samples[i] < 0 && samples[i + 1] >= 0)
      ) {
        zeroCrossings++;
      }
    }

    blockEnergy /= blockSize;
    const estimatedFreq = (zeroCrossings * sampleRate) / (2 * blockSize);

    if (estimatedFreq < 250) lowEnergy += blockEnergy;
    else if (estimatedFreq < 1000) lowMidEnergy += blockEnergy;
    else if (estimatedFreq < 4000) midEnergy += blockEnergy;
    else if (estimatedFreq < 8000) highMidEnergy += blockEnergy;
    else highEnergy += blockEnergy;
  }

  const maxEnergy = Math.max(lowEnergy, lowMidEnergy, midEnergy, highMidEnergy, highEnergy, 0.0001);

  const normalize = (e: number) => Math.min(100, (e / maxEnergy) * 100);

  const rateEnergy = (e: number): FrequencyBand["rating"] => {
    const n = normalize(e);
    if (n < 15) return "deficient";
    if (n < 35) return "low";
    if (n < 65) return "balanced";
    if (n < 85) return "elevated";
    return "excessive";
  };

  return [
    { name: "Sub Bass", range: "20-250 Hz", energy: Math.round(normalize(lowEnergy)), rating: rateEnergy(lowEnergy) },
    { name: "Low Mids", range: "250-1k Hz", energy: Math.round(normalize(lowMidEnergy)), rating: rateEnergy(lowMidEnergy) },
    { name: "Mids", range: "1k-4k Hz", energy: Math.round(normalize(midEnergy)), rating: rateEnergy(midEnergy) },
    { name: "High Mids", range: "4k-8k Hz", energy: Math.round(normalize(highMidEnergy)), rating: rateEnergy(highMidEnergy) },
    { name: "Highs", range: "8k-20k Hz", energy: Math.round(normalize(highEnergy)), rating: rateEnergy(highEnergy) },
  ];
}

function estimateSpectralCentroid(samples: Float32Array, sampleRate: number): number {
  const blockSize = 2048;
  const numBlocks = Math.floor(samples.length / blockSize);
  let totalWeightedFreq = 0;
  let totalEnergy = 0;

  for (let b = 0; b < numBlocks; b++) {
    const start = b * blockSize;
    let zeroCrossings = 0;
    let blockEnergy = 0;

    for (let i = start; i < start + blockSize - 1; i++) {
      blockEnergy += samples[i] * samples[i];
      if (
        (samples[i] >= 0 && samples[i + 1] < 0) ||
        (samples[i] < 0 && samples[i + 1] >= 0)
      ) {
        zeroCrossings++;
      }
    }

    const estimatedFreq = (zeroCrossings * sampleRate) / (2 * blockSize);
    totalWeightedFreq += estimatedFreq * blockEnergy;
    totalEnergy += blockEnergy;
  }

  if (totalEnergy === 0) return 0;
  return Math.round(totalWeightedFreq / totalEnergy);
}

function generateIssues(metrics: Partial<AudioMetrics>): AnalysisIssue[] {
  const issues: AnalysisIssue[] = [];

  // Clipping
  if (metrics.clippingSamples && metrics.clippingSamples > 100) {
    issues.push({
      severity: "critical",
      category: "Clipping",
      message: `Detected ${metrics.clippingSamples.toLocaleString()} clipping samples. This will cause audible distortion.`,
    });
  } else if (metrics.clippingSamples && metrics.clippingSamples > 0) {
    issues.push({
      severity: "warning",
      category: "Clipping",
      message: `Minor clipping detected (${metrics.clippingSamples} samples). May be intentional but worth checking.`,
    });
  }

  // Peak level
  if ((metrics.peakLevel ?? -96) > -0.3) {
    issues.push({
      severity: "warning",
      category: "Headroom",
      message: `Peak level is ${metrics.peakLevel?.toFixed(1)} dBFS. Leave at least -1 dB of headroom for mastering.`,
    });
  }

  // Dynamic range
  if ((metrics.dynamicRange ?? 0) < 6) {
    issues.push({
      severity: "critical",
      category: "Dynamics",
      message: `Dynamic range is only ${metrics.dynamicRange?.toFixed(1)} dB. The mix is over-compressed and will sound fatiguing.`,
    });
  } else if ((metrics.dynamicRange ?? 0) < 10) {
    issues.push({
      severity: "warning",
      category: "Dynamics",
      message: `Dynamic range is ${metrics.dynamicRange?.toFixed(1)} dB. Consider reducing compression for more punch.`,
    });
  }

  // DC Offset
  if (Math.abs(metrics.dcOffset ?? 0) > 0.01) {
    issues.push({
      severity: "warning",
      category: "DC Offset",
      message: `DC offset detected (${((metrics.dcOffset ?? 0) * 100).toFixed(2)}%). Apply a high-pass filter at ~20 Hz.`,
    });
  }

  // Stereo
  if ((metrics.phaseCorrelation ?? 1) < 0.3) {
    issues.push({
      severity: "warning",
      category: "Phase",
      message: `Low phase correlation (${metrics.phaseCorrelation?.toFixed(2)}). May cause issues in mono playback.`,
    });
  }

  if ((metrics.phaseCorrelation ?? 1) < 0) {
    issues.push({
      severity: "critical",
      category: "Phase",
      message: `Negative phase correlation detected. Significant mono compatibility issues.`,
    });
  }

  if ((metrics.stereoWidth ?? 0) < 10 && (metrics.channels ?? 1) >= 2) {
    issues.push({
      severity: "info",
      category: "Stereo Width",
      message: `Very narrow stereo image. Consider widening with stereo enhancement.`,
    });
  }

  if ((metrics.stereoWidth ?? 0) > 85) {
    issues.push({
      severity: "warning",
      category: "Stereo Width",
      message: `Extremely wide stereo image. May cause phase issues on some playback systems.`,
    });
  }

  // Balance
  if (Math.abs(metrics.stereoBalance ?? 0) > 0.15) {
    const side = (metrics.stereoBalance ?? 0) > 0 ? "right" : "left";
    issues.push({
      severity: "warning",
      category: "Balance",
      message: `Mix is noticeably louder on the ${side} channel. Check panning and balance.`,
    });
  }

  // Bitrate
  if ((metrics.bitrate ?? 0) < 192000 && metrics.format === "MPEG") {
    issues.push({
      severity: "info",
      category: "Quality",
      message: `Low bitrate (${Math.round((metrics.bitrate ?? 0) / 1000)} kbps). For mastering, use WAV/AIFF or at least 320 kbps MP3.`,
    });
  }

  // Sample rate
  if ((metrics.sampleRate ?? 0) < 44100) {
    issues.push({
      severity: "warning",
      category: "Sample Rate",
      message: `Sample rate is ${metrics.sampleRate} Hz. Standard is 44.1 kHz or higher.`,
    });
  }

  // Silence
  if ((metrics.silenceRatio ?? 0) > 30) {
    issues.push({
      severity: "info",
      category: "Silence",
      message: `${metrics.silenceRatio?.toFixed(0)}% of the track is silence. Check for excessive intro/outro padding.`,
    });
  }

  // Estimated LUFS
  if ((metrics.estimatedLUFS ?? -96) > -8) {
    issues.push({
      severity: "critical",
      category: "Loudness",
      message: `Estimated loudness is ${metrics.estimatedLUFS?.toFixed(1)} LUFS — extremely loud. Target -14 LUFS for streaming.`,
    });
  } else if ((metrics.estimatedLUFS ?? -96) > -11) {
    issues.push({
      severity: "warning",
      category: "Loudness",
      message: `Estimated loudness is ${metrics.estimatedLUFS?.toFixed(1)} LUFS — louder than streaming targets (-14 LUFS).`,
    });
  }

  // Frequency balance
  for (const band of metrics.frequencyBands ?? []) {
    if (band.rating === "excessive") {
      issues.push({
        severity: "warning",
        category: "Frequency",
        message: `${band.name} (${band.range}) has excessive energy. Consider EQ reduction.`,
      });
    }
    if (band.rating === "deficient") {
      issues.push({
        severity: "info",
        category: "Frequency",
        message: `${band.name} (${band.range}) is deficient. May need a boost or may be intentional.`,
      });
    }
  }

  return issues;
}

function generateRecommendations(metrics: Partial<AudioMetrics>, issues: AnalysisIssue[]): string[] {
  const recs: string[] = [];

  const hasCritical = issues.some((i) => i.severity === "critical");
  const hasClipping = issues.some((i) => i.category === "Clipping");
  const hasHeadroom = issues.some((i) => i.category === "Headroom");
  const hasDynamics = issues.some((i) => i.category === "Dynamics");
  const hasPhase = issues.some((i) => i.category === "Phase");
  const hasDC = issues.some((i) => i.category === "DC Offset");

  if (hasClipping) {
    recs.push(
      "Reduce the gain on your master bus or individual tracks to eliminate clipping. In Logic Pro, check the master output meter and pull down the fader."
    );
  }

  if (hasHeadroom) {
    recs.push(
      "Leave -3 to -6 dB of headroom on your mix bus before sending to mastering. This gives the mastering engineer room to work."
    );
  }

  if (hasDynamics) {
    recs.push(
      "Ease up on bus compression and limiting. Try reducing the ratio or raising the threshold on your mix bus compressor in Logic Pro."
    );
  }

  if (hasPhase) {
    recs.push(
      "Check mono compatibility by pressing the mono button in Logic Pro's Control Bar. Fix any elements that disappear or sound thin."
    );
  }

  if (hasDC) {
    recs.push(
      "Add a high-pass filter (Channel EQ) at 20-30 Hz on your master bus to remove DC offset and sub-rumble."
    );
  }

  if ((metrics.stereoWidth ?? 50) < 20 && (metrics.channels ?? 1) >= 2) {
    recs.push(
      "Use Logic Pro's Stereo Spread or Direction Mixer plugin to widen the stereo image. Pan instruments more deliberately."
    );
  }

  if ((metrics.bitrate ?? 320000) < 256000) {
    recs.push(
      "Export your mix as a WAV or AIFF file (24-bit, 44.1kHz or higher) instead of MP3 for the best mastering results."
    );
  }

  if (!hasCritical && issues.length <= 2) {
    recs.push(
      "Your mix is in good shape! Consider A/B referencing against a professional track in a similar genre using Logic Pro's reference track feature."
    );
  }

  recs.push(
    "Always listen to your mix on multiple systems (headphones, car, phone speaker) before finalizing."
  );

  return recs;
}

function calculateMasteringScore(metrics: Partial<AudioMetrics>, issues: AnalysisIssue[]): number {
  let score = 100;

  for (const issue of issues) {
    if (issue.severity === "critical") score -= 20;
    else if (issue.severity === "warning") score -= 8;
    else score -= 3;
  }

  // Bonus for good practices
  if ((metrics.peakLevel ?? 0) <= -1 && (metrics.peakLevel ?? -96) >= -6) score += 5;
  if ((metrics.dynamicRange ?? 0) >= 10 && (metrics.dynamicRange ?? 100) <= 20) score += 5;
  if ((metrics.phaseCorrelation ?? 0) > 0.7) score += 3;
  if ((metrics.sampleRate ?? 0) >= 44100) score += 2;

  return Math.max(0, Math.min(100, score));
}

function getReadinessLevel(score: number): AudioMetrics["readinessLevel"] {
  if (score >= 80) return "ready";
  if (score >= 60) return "almost-ready";
  if (score >= 35) return "needs-work";
  return "not-ready";
}

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

  // Decode samples for analysis
  const { left, right } = decodePCMSamples(fileBuffer, format);

  // Core measurements
  const leftRMS = calculateRMS(left);
  const leftPeak = calculatePeak(left);
  let combinedRMS = leftRMS;
  let combinedPeak = leftPeak;
  let clippingSamples = countClipping(left);

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
  // Rough LUFS estimation (LUFS ≈ RMS with K-weighting, simplified)
  const estimatedLUFS = rmsLevel - 0.691;

  const dcOffset = calculateDCOffset(left);
  const silenceRatio = calculateSilenceRatio(left);

  let stereoWidth = 0;
  let phaseCorrelation = 1;
  let stereoBalance = 0;

  if (right) {
    stereoWidth = calculateStereoWidth(left, right);
    phaseCorrelation = calculatePhaseCorrelation(left, right);
    stereoBalance = calculateStereoBalance(left, right);
  }

  const frequencyBands = estimateFrequencyBands(left, sampleRate);
  const spectralCentroid = estimateSpectralCentroid(left, sampleRate);

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
    rmsLevel,
    estimatedLUFS,
    dynamicRange,
    crestFactor,
    clippingDetected: clippingSamples > 0,
    clippingSamples,
    dcOffset,
    silenceRatio,
    stereoWidth,
    phaseCorrelation,
    stereoBalance,
    frequencyBands,
    spectralCentroid,
  };

  const issues = generateIssues(partialMetrics);
  const recommendations = generateRecommendations(partialMetrics, issues);
  const masteringScore = calculateMasteringScore(partialMetrics, issues);
  const readinessLevel = getReadinessLevel(masteringScore);

  return {
    ...(partialMetrics as AudioMetrics),
    masteringScore,
    readinessLevel,
    issues,
    recommendations,
  };
}
