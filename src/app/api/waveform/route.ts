import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, unlink, mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

const execFileAsync = promisify(execFile);

export async function POST(request: NextRequest) {
  const tempDir = await mkdtemp(join(tmpdir(), "pp-waveform-"));
  const inputPath = join(tempDir, "input.mp3");
  const outputPath = join(tempDir, "output.raw");

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    await writeFile(inputPath, Buffer.from(arrayBuffer));

    // Use ffmpeg to downsample to mono 8kHz 16-bit PCM — gives us ~8000 samples/sec
    // For a 3-min song that's ~1.4M samples, we'll further downsample to ~800 points
    await execFileAsync("ffmpeg", [
      "-y",
      "-i", inputPath,
      "-ac", "1",
      "-ar", "8000",
      "-f", "s16le",
      "-acodec", "pcm_s16le",
      outputPath,
    ], { timeout: 60_000, maxBuffer: 50 * 1024 * 1024 });

    const rawBuffer = await readFile(outputPath);

    // Convert raw PCM to float samples
    const sampleCount = rawBuffer.length / 2;
    const samples = new Float32Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      samples[i] = rawBuffer.readInt16LE(i * 2) / 32768;
    }

    // Downsample to ~800 bars for the waveform display
    const targetBars = 800;
    const samplesPerBar = Math.max(1, Math.floor(sampleCount / targetBars));
    const waveform: number[] = [];

    for (let i = 0; i < targetBars && i * samplesPerBar < sampleCount; i++) {
      const start = i * samplesPerBar;
      const end = Math.min(start + samplesPerBar, sampleCount);
      let peak = 0;
      for (let j = start; j < end; j++) {
        const abs = Math.abs(samples[j]);
        if (abs > peak) peak = abs;
      }
      waveform.push(Math.round(peak * 10000) / 10000);
    }

    return NextResponse.json({ waveform });
  } catch (error) {
    console.error("Waveform extraction error:", error);
    return NextResponse.json(
      { error: "Failed to extract waveform" },
      { status: 500 }
    );
  } finally {
    try { await unlink(inputPath); } catch {}
    try { await unlink(outputPath); } catch {}
  }
}
