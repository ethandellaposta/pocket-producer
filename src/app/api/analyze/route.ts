import { NextRequest, NextResponse } from "next/server";
import { analyzeAudio } from "@/lib/audio-analyzer";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!file.name.toLowerCase().endsWith(".mp3") && !file.type.includes("audio")) {
      return NextResponse.json(
        { error: "Please upload an MP3 audio file" },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const metrics = await analyzeAudio(buffer, file.name);

    return NextResponse.json(metrics);
  } catch (error) {
    console.error("Analysis error:", error);
    return NextResponse.json(
      { error: "Failed to analyze audio file" },
      { status: 500 }
    );
  }
}
