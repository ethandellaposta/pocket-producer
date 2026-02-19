import { NextRequest, NextResponse } from "next/server";
import { masterAudio, type MasteringSettings } from "@/lib/mastering-engine";
import { analyzeAudio, type AudioMetrics } from "@/lib/audio-analyzer";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const settingsJson = formData.get("settings") as string | null;
    const metricsJson = formData.get("metrics") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!settingsJson) {
      return NextResponse.json({ error: "No mastering settings provided" }, { status: 400 });
    }

    const settings: MasteringSettings = JSON.parse(settingsJson);
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Use provided metrics or re-analyze
    let metrics: AudioMetrics;
    if (metricsJson) {
      metrics = JSON.parse(metricsJson);
    } else {
      metrics = await analyzeAudio(buffer, file.name);
    }

    const result = await masterAudio(buffer, file.name, metrics, settings);

    // Return the mastered file as a downloadable response
    const contentType =
      result.outputFormat === "wav"
        ? "audio/wav"
        : result.outputFormat === "flac"
          ? "audio/flac"
          : "audio/mpeg";

    return new NextResponse(new Uint8Array(result.outputBuffer), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${result.outputFileName}"`,
        "X-Mastering-Chain": JSON.stringify(result.chain),
        "X-Before-LUFS": String(result.beforeLUFS),
        "X-Target-LUFS": String(result.targetLUFS),
      },
    });
  } catch (error) {
    console.error("Mastering error:", error);
    const message = error instanceof Error ? error.message : "Mastering failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
