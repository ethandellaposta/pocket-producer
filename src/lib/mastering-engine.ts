import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, unlink, mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { AudioMetrics } from "./audio-analyzer";
import { MASTERING_PRESETS, type MasteringPreset, type MasteringSettings, type MasteringResult } from "./mastering-types";

const execFileAsync = promisify(execFile);

export { MASTERING_PRESETS };
export type { MasteringPreset, MasteringSettings, MasteringResult };

function buildAdaptivePreset(
  basePreset: MasteringPreset,
  metrics: AudioMetrics
): MasteringPreset {
  const preset = JSON.parse(JSON.stringify(basePreset)) as MasteringPreset;

  const centerFreqs: Record<string, number> = {
    "Sub Bass": 60,
    "Low Mids": 400,
    "Mids": 2000,
    "High Mids": 6000,
    "Highs": 12000,
  };

  // Adapt EQ based on frequency analysis — scale correction by severity
  for (const band of metrics.frequencyBands) {
    const freq = centerFreqs[band.name];
    if (!freq) continue;

    let gainAdj = 0;
    let q = 1.0;

    if (band.rating === "excessive") {
      // Scale cut by how far over balanced the energy is
      const severity = Math.min(3.5, (band.energy - 65) / 15);
      gainAdj = -Math.max(1, severity);
      q = 1.2; // narrower Q for surgical cuts
    } else if (band.rating === "elevated") {
      gainAdj = -0.8;
      q = 0.8;
    } else if (band.rating === "deficient") {
      const severity = Math.min(2.5, (35 - band.energy) / 15);
      gainAdj = Math.max(0.5, severity);
      q = 0.7; // wider Q for gentle boosts
    } else if (band.rating === "low") {
      gainAdj = 0.5;
      q = 0.6;
    }

    if (gainAdj !== 0) {
      const existing = preset.eqAdjustments.find(
        (eq) => Math.abs(eq.frequency - freq) < freq * 0.3 && eq.type === "peak"
      );
      if (existing) {
        existing.gain += gainAdj;
        existing.q = q;
      } else {
        preset.eqAdjustments.push({ frequency: freq, gain: Math.round(gainAdj * 10) / 10, q, type: "peak" });
      }
    }
  }

  // Adapt compression based on dynamic range
  if (metrics.dynamicRange < 6) {
    // Already crushed — barely compress, just limit
    preset.compressionRatio = 1.1;
    preset.compressionThreshold = -30;
    preset.compressionAttack = Math.max(30, preset.compressionAttack);
    preset.compressionRelease = Math.max(250, preset.compressionRelease);
  } else if (metrics.dynamicRange < 8) {
    preset.compressionRatio = Math.max(1.2, preset.compressionRatio - 1);
    preset.compressionThreshold -= 4;
    preset.compressionAttack = Math.max(20, preset.compressionAttack);
  } else if (metrics.dynamicRange > 20) {
    // Very dynamic — compress more to tame peaks
    preset.compressionRatio = Math.min(5, preset.compressionRatio + 1);
    preset.compressionThreshold = Math.min(-12, preset.compressionThreshold + 3);
    preset.compressionAttack = Math.min(8, preset.compressionAttack);
  }

  // Adapt stereo widening
  if (metrics.stereoWidth < 15 && metrics.channels >= 2) {
    preset.stereoWidenAmount = Math.min(40, preset.stereoWidenAmount + 20);
  } else if (metrics.stereoWidth > 75 && metrics.channels >= 2) {
    // Too wide — reduce or disable widening
    preset.stereoWidenAmount = 0;
  }

  // If DC offset detected, ensure high pass is active
  if (Math.abs(metrics.dcOffset) > 0.01) {
    preset.highPassFreq = Math.max(preset.highPassFreq, 30);
  }

  // If noise floor is high, bump up the high-pass
  if (metrics.noiseFloor > -45) {
    preset.highPassFreq = Math.max(preset.highPassFreq, 40);
  }

  // Adapt limiter ceiling based on true peak
  if (metrics.truePeak > -0.5) {
    // Already very hot — use a more conservative ceiling
    preset.limiterCeiling = Math.min(preset.limiterCeiling, -1.5);
  }

  return preset;
}

function buildFFmpegFilterChain(
  preset: MasteringPreset,
  settings: MasteringSettings,
  metrics: AudioMetrics
): { filter: string; chain: string[] } {
  const filters: string[] = [];
  const chain: string[] = [];

  // 1. High-pass filter to remove rumble/DC offset
  if (settings.applyHighPass && preset.highPassFreq > 0) {
    filters.push(`highpass=f=${preset.highPassFreq}:p=2`);
    chain.push(`High-pass filter at ${preset.highPassFreq} Hz`);
  }

  // 2. EQ adjustments
  if (settings.applyEQ) {
    for (const eq of preset.eqAdjustments) {
      if (eq.type === "highpass") continue; // handled above
      if (eq.gain === 0) continue;

      switch (eq.type) {
        case "lowshelf":
          filters.push(`lowshelf=f=${eq.frequency}:g=${eq.gain}:t=s:w=${eq.q}`);
          chain.push(`Low shelf: ${eq.gain > 0 ? "+" : ""}${eq.gain} dB at ${eq.frequency} Hz`);
          break;
        case "highshelf":
          filters.push(`highshelf=f=${eq.frequency}:g=${eq.gain}:t=s:w=${eq.q}`);
          chain.push(`High shelf: ${eq.gain > 0 ? "+" : ""}${eq.gain} dB at ${eq.frequency} Hz`);
          break;
        case "peak":
          filters.push(`equalizer=f=${eq.frequency}:g=${eq.gain}:t=h:w=${eq.q * 100}`);
          chain.push(`EQ: ${eq.gain > 0 ? "+" : ""}${eq.gain} dB at ${eq.frequency} Hz (Q=${eq.q})`);
          break;
      }
    }
  }

  // 3. De-esser (band-pass EQ cut on sibilance range)
  if (settings.applyEQ && preset.deEsserAmount > 0) {
    filters.push(
      `equalizer=f=${preset.deEsserFreq}:g=-${preset.deEsserAmount}:t=h:w=200`
    );
    chain.push(`De-esser: -${preset.deEsserAmount} dB at ${preset.deEsserFreq} Hz`);
  }

  // 4. Stereo enhancement
  if (settings.applyStereoEnhancement && preset.stereoWidenAmount > 0 && metrics.channels >= 2) {
    // Use extrastereo filter: 1.0 = normal, >1 = wider
    const widthFactor = 1 + preset.stereoWidenAmount / 50;
    filters.push(`extrastereo=m=${widthFactor.toFixed(2)}:c=1`);
    chain.push(`Stereo enhancement: ${preset.stereoWidenAmount}% wider`);
  }

  // 5. Compression
  if (settings.applyCompression) {
    const threshold = preset.compressionThreshold;
    const ratio = preset.compressionRatio;
    const attack = preset.compressionAttack;
    const release = preset.compressionRelease;
    const knee = 6;
    const makeup = Math.round((Math.abs(threshold) * (1 - 1 / ratio)) / 3);

    filters.push(
      `acompressor=threshold=${threshold}dB:ratio=${ratio}:attack=${attack}:release=${release}:knee=${knee}:makeup=${makeup}dB`
    );
    chain.push(
      `Compression: ${ratio}:1 ratio, ${threshold} dB threshold, ${attack}ms attack, ${release}ms release, +${makeup} dB makeup`
    );
  }

  // 6. Limiter
  if (settings.applyLimiter) {
    const ceiling = preset.limiterCeiling; // dBFS, e.g. -1
    // alimiter 'limit' expects linear amplitude 0.0625–1.0, convert from dBFS
    const limitLinear = Math.max(0.0625, Math.min(1, Math.pow(10, ceiling / 20)));
    filters.push(`alimiter=limit=${limitLinear.toFixed(4)}:level=0:asc=1:asc_level=0.5`);
    chain.push(`Brick-wall limiter at ${ceiling} dBFS`);
  }

  // 7. Loudness normalization (loudnorm is the gold standard in ffmpeg)
  filters.push(
    `loudnorm=I=${settings.targetLUFS}:TP=${preset.limiterCeiling}:LRA=11:print_format=summary`
  );
  chain.push(`Loudness normalization to ${settings.targetLUFS} LUFS`);

  return {
    filter: filters.join(","),
    chain,
  };
}

// Two-pass loudnorm: measure first, then apply with measured values for best quality
async function measureLoudnormPass(
  inputPath: string,
  targetLUFS: number,
  targetTP: number
): Promise<{ measured_I: string; measured_TP: string; measured_LRA: string; measured_thresh: string; offset: string } | null> {
  try {
    const { stderr } = await execFileAsync("ffmpeg", [
      "-y", "-i", inputPath,
      "-af", `loudnorm=I=${targetLUFS}:TP=${targetTP}:LRA=11:print_format=json`,
      "-f", "null", "-",
    ], { timeout: 120_000, maxBuffer: 50 * 1024 * 1024 });

    const jsonMatch = stderr.match(/\{[\s\S]*"input_i"[\s\S]*\}/);
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[0]);
      return {
        measured_I: data.input_i,
        measured_TP: data.input_tp,
        measured_LRA: data.input_lra,
        measured_thresh: data.input_thresh,
        offset: data.target_offset,
      };
    }
  } catch {
    // fall through to null
  }
  return null;
}

export async function masterAudio(
  inputBuffer: Buffer,
  fileName: string,
  metrics: AudioMetrics,
  settings: MasteringSettings
): Promise<MasteringResult> {
  const basePreset = MASTERING_PRESETS[settings.preset] || MASTERING_PRESETS.streaming;
  const adaptedPreset = buildAdaptivePreset(basePreset, metrics);

  // Override target LUFS from settings
  adaptedPreset.targetLUFS = settings.targetLUFS;

  const { filter: processingFilter, chain } = buildFFmpegFilterChain(adaptedPreset, settings, metrics);

  // Create temp directory
  const tempDir = await mkdtemp(join(tmpdir(), "pocket-producer-"));
  const inputPath = join(tempDir, "input.mp3");
  const intermediatePath = join(tempDir, "intermediate.wav");

  const ext = settings.outputFormat;
  const outputPath = join(tempDir, `output.${ext}`);

  try {
    // Write input file
    await writeFile(inputPath, inputBuffer);

    // --- Pass 1: Apply EQ/compression/limiting (everything except loudnorm) ---
    // Build a filter chain WITHOUT the loudnorm step
    const filtersWithoutLoudnorm = processingFilter
      .split(",")
      .filter((f) => !f.startsWith("loudnorm="))
      .join(",");

    if (filtersWithoutLoudnorm) {
      await execFileAsync("ffmpeg", [
        "-y", "-i", inputPath,
        "-af", filtersWithoutLoudnorm,
        "-c:a", "pcm_s24le",
        "-ar", String(settings.outputSampleRate),
        intermediatePath,
      ], { timeout: 120_000, maxBuffer: 50 * 1024 * 1024 });
    } else {
      // No processing filters — just copy to intermediate
      await execFileAsync("ffmpeg", [
        "-y", "-i", inputPath,
        "-c:a", "pcm_s24le",
        "-ar", String(settings.outputSampleRate),
        intermediatePath,
      ], { timeout: 120_000, maxBuffer: 50 * 1024 * 1024 });
    }

    // --- Pass 2: Two-pass loudnorm on the processed audio ---
    const targetTP = adaptedPreset.limiterCeiling;
    const measured = await measureLoudnormPass(intermediatePath, settings.targetLUFS, targetTP);

    let loudnormFilter: string;
    if (measured) {
      // Use measured values for linear mode (highest quality)
      loudnormFilter = `loudnorm=I=${settings.targetLUFS}:TP=${targetTP}:LRA=11:measured_I=${measured.measured_I}:measured_TP=${measured.measured_TP}:measured_LRA=${measured.measured_LRA}:measured_thresh=${measured.measured_thresh}:offset=${measured.offset}:linear=true:print_format=summary`;
      chain.push(`Loudness normalization to ${settings.targetLUFS} LUFS (two-pass, linear mode)`);
    } else {
      // Fallback to single-pass
      loudnormFilter = `loudnorm=I=${settings.targetLUFS}:TP=${targetTP}:LRA=11:print_format=summary`;
      chain.push(`Loudness normalization to ${settings.targetLUFS} LUFS (single-pass fallback)`);
    }

    // Build final output args
    const args: string[] = [
      "-y", "-i", intermediatePath,
      "-af", loudnormFilter,
    ];

    // Output format settings
    switch (settings.outputFormat) {
      case "wav":
        args.push("-c:a", "pcm_s24le");
        args.push("-ar", String(settings.outputSampleRate));
        break;
      case "flac":
        args.push("-c:a", "flac");
        args.push("-ar", String(settings.outputSampleRate));
        break;
      case "mp3":
        args.push("-c:a", "libmp3lame");
        args.push("-b:a", `${settings.outputBitrate}k`);
        args.push("-ar", String(settings.outputSampleRate));
        break;
    }

    args.push(outputPath);

    // Run final pass
    await execFileAsync("ffmpeg", args, {
      timeout: 120_000,
      maxBuffer: 50 * 1024 * 1024,
    });

    // Read output
    const outputBuffer = await readFile(outputPath);

    // Build output filename
    const baseName = fileName.replace(/\.[^.]+$/, "");
    const outputFileName = `${baseName}_mastered.${ext}`;

    return {
      outputBuffer,
      outputFileName,
      outputFormat: ext,
      chain,
      beforeLUFS: metrics.estimatedLUFS,
      targetLUFS: settings.targetLUFS,
    };
  } finally {
    // Cleanup temp files
    try { await unlink(inputPath); } catch { }
    try { await unlink(intermediatePath); } catch { }
    try { await unlink(outputPath); } catch { }
  }
}

export function getDefaultSettings(metrics: AudioMetrics): MasteringSettings {
  // Pick a sensible default preset based on the analysis
  let preset = "streaming";

  if (metrics.dynamicRange < 8) {
    preset = "gentle"; // already compressed, don't crush further
  } else if (metrics.spectralCentroid > 3500) {
    preset = "warm"; // already bright, warm it up
  } else if (metrics.spectralCentroid < 1200) {
    preset = "bright"; // dark mix, brighten it
  }

  return {
    preset,
    targetLUFS: -14,
    applyEQ: true,
    applyCompression: true,
    applyLimiter: true,
    applyStereoEnhancement: metrics.channels >= 2 && metrics.stereoWidth < 50,
    applyHighPass: true,
    outputFormat: "wav",
    outputBitrate: 320,
    outputSampleRate: metrics.sampleRate >= 44100 ? metrics.sampleRate : 44100,
  };
}
