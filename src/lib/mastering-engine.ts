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

  // Adapt EQ based on frequency analysis
  for (const band of metrics.frequencyBands) {
    if (band.rating === "excessive") {
      const centerFreqs: Record<string, number> = {
        "Sub Bass": 60,
        "Low Mids": 400,
        "Mids": 2000,
        "High Mids": 6000,
        "Highs": 12000,
      };
      const freq = centerFreqs[band.name];
      if (freq) {
        const existing = preset.eqAdjustments.find(
          (eq) => Math.abs(eq.frequency - freq) < freq * 0.3 && eq.type === "peak"
        );
        if (existing) {
          existing.gain -= 2;
        } else {
          preset.eqAdjustments.push({ frequency: freq, gain: -2, q: 1.0, type: "peak" });
        }
      }
    }
    if (band.rating === "deficient") {
      const centerFreqs: Record<string, number> = {
        "Sub Bass": 60,
        "Low Mids": 400,
        "Mids": 2000,
        "High Mids": 6000,
        "Highs": 12000,
      };
      const freq = centerFreqs[band.name];
      if (freq) {
        const existing = preset.eqAdjustments.find(
          (eq) => Math.abs(eq.frequency - freq) < freq * 0.3 && eq.type === "peak"
        );
        if (existing) {
          existing.gain += 1.5;
        } else {
          preset.eqAdjustments.push({ frequency: freq, gain: 1.5, q: 0.8, type: "peak" });
        }
      }
    }
  }

  // If dynamic range is already low, reduce compression
  if (metrics.dynamicRange < 8) {
    preset.compressionRatio = Math.max(1.2, preset.compressionRatio - 1);
    preset.compressionThreshold -= 4;
  }

  // If stereo width is very narrow, increase widening
  if (metrics.stereoWidth < 20 && metrics.channels >= 2) {
    preset.stereoWidenAmount = Math.min(40, preset.stereoWidenAmount + 15);
  }

  // If DC offset detected, ensure high pass is active
  if (Math.abs(metrics.dcOffset) > 0.01) {
    preset.highPassFreq = Math.max(preset.highPassFreq, 30);
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
    const ceiling = preset.limiterCeiling;
    filters.push(`alimiter=limit=${Math.abs(ceiling)}:level=0:asc=1:asc_level=0.5`);
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

  const { filter, chain } = buildFFmpegFilterChain(adaptedPreset, settings, metrics);

  // Create temp directory
  const tempDir = await mkdtemp(join(tmpdir(), "pocket-producer-"));
  const inputPath = join(tempDir, "input.mp3");

  const ext = settings.outputFormat;
  const outputPath = join(tempDir, `output.${ext}`);

  try {
    // Write input file
    await writeFile(inputPath, inputBuffer);

    // Build ffmpeg args
    const args: string[] = [
      "-y",
      "-i", inputPath,
      "-af", filter,
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

    // Run ffmpeg
    await execFileAsync("ffmpeg", args, {
      timeout: 120_000, // 2 minute timeout
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
    try {
      await unlink(inputPath);
      await unlink(outputPath);
    } catch {
      // ignore cleanup errors
    }
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
