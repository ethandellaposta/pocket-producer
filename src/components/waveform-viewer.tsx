"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AudioWaveform,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  MessageSquare,
  X,
  Pencil,
  Check,
} from "lucide-react";
import type { Annotation, AnalysisSession } from "@/lib/session-store";

interface WaveformViewerProps {
  session: AnalysisSession;
  onAddAnnotation: (startTime: number, endTime: number, text: string, color: string) => void;
  onDeleteAnnotation: (annotationId: string) => void;
  onUpdateAnnotation: (annotationId: string, updates: Partial<Pick<Annotation, "text" | "color">>) => void;
  onToggleGenerated: () => void;
}

const ANNOTATION_COLORS = [
  { value: "#3b82f6", label: "Blue" },
  { value: "#10b981", label: "Green" },
  { value: "#f59e0b", label: "Amber" },
  { value: "#ef4444", label: "Red" },
  { value: "#8b5cf6", label: "Purple" },
  { value: "#ec4899", label: "Pink" },
  { value: "#06b6d4", label: "Cyan" },
];

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function WaveformViewer({
  session,
  onAddAnnotation,
  onDeleteAnnotation,
  onUpdateAnnotation,
  onToggleGenerated,
}: WaveformViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState<number | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<number | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newNoteText, setNewNoteText] = useState("");
  const [newNoteColor, setNewNoteColor] = useState("#3b82f6");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [hoveredAnnotation, setHoveredAnnotation] = useState<string | null>(null);

  const { waveformData, metrics, annotations, showGeneratedAnnotations } = session;
  const duration = metrics.duration;

  const visibleAnnotations = annotations.filter(
    (a) => a.type === "user" || showGeneratedAnnotations
  );

  // Draw waveform
  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !waveformData || waveformData.length === 0) return;

    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = 160 * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = "160px";

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.scale(dpr, dpr);
    const w = rect.width;
    const h = 160;
    const midY = h / 2;

    // Clear
    ctx.clearRect(0, 0, w, h);

    // Draw annotation regions behind waveform
    for (const ann of visibleAnnotations) {
      const x1 = (ann.startTime / duration) * w;
      const x2 = (ann.endTime / duration) * w;
      ctx.fillStyle = ann.color + "15";
      ctx.fillRect(x1, 0, x2 - x1, h);

      // Top border
      ctx.fillStyle = ann.color + "40";
      ctx.fillRect(x1, 0, x2 - x1, 3);
    }

    // Draw selection region
    if (selectionStart !== null && selectionEnd !== null) {
      const x1 = (Math.min(selectionStart, selectionEnd) / duration) * w;
      const x2 = (Math.max(selectionStart, selectionEnd) / duration) * w;
      ctx.fillStyle = "#3b82f620";
      ctx.fillRect(x1, 0, x2 - x1, h);
      ctx.strokeStyle = "#3b82f680";
      ctx.lineWidth = 1;
      ctx.strokeRect(x1, 0, x2 - x1, h);
    }

    // Draw waveform bars
    const barCount = waveformData.length;
    const barWidth = Math.max(1, w / barCount - 0.5);
    const gap = w / barCount;

    for (let i = 0; i < barCount; i++) {
      const x = i * gap;
      const amplitude = waveformData[i];
      const barH = Math.max(1, amplitude * midY * 0.9);

      // Check if this bar is in a hovered annotation
      const barTime = (i / barCount) * duration;
      let barColor = "oklch(0.6 0 0)"; // default gray

      // Color bars by annotation
      for (const ann of visibleAnnotations) {
        if (barTime >= ann.startTime && barTime <= ann.endTime) {
          if (hoveredAnnotation === ann.id) {
            barColor = ann.color;
          } else {
            barColor = ann.color + "80";
          }
          break;
        }
      }

      // Hover highlight
      if (hoverTime !== null) {
        const hoverBar = Math.floor((hoverTime / duration) * barCount);
        if (Math.abs(i - hoverBar) < 3) {
          barColor = "oklch(0.7 0.2 250)";
        }
      }

      ctx.fillStyle = barColor;
      // Mirror bars (top + bottom like SoundCloud)
      ctx.fillRect(x, midY - barH, barWidth, barH);
      ctx.fillStyle = barColor + "60";
      ctx.fillRect(x, midY, barWidth, barH * 0.6);
    }

    // Center line
    ctx.fillStyle = "oklch(0.5 0 0 / 0.2)";
    ctx.fillRect(0, midY - 0.5, w, 1);

    // Hover cursor line
    if (hoverX !== null) {
      ctx.strokeStyle = "oklch(0.7 0 0 / 0.6)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(hoverX, 0);
      ctx.lineTo(hoverX, h);
      ctx.stroke();
      ctx.setLineDash([]);

      // Time label
      if (hoverTime !== null) {
        ctx.fillStyle = "oklch(0.9 0 0)";
        ctx.font = "11px system-ui, sans-serif";
        const label = formatTime(hoverTime);
        const textW = ctx.measureText(label).width;
        const labelX = Math.min(hoverX + 6, w - textW - 8);
        ctx.fillStyle = "oklch(0.2 0 0 / 0.8)";
        ctx.fillRect(labelX - 4, 4, textW + 8, 18);
        ctx.fillStyle = "oklch(0.95 0 0)";
        ctx.fillText(label, labelX, 16);
      }
    }
  }, [waveformData, duration, visibleAnnotations, hoverTime, hoverX, selectionStart, selectionEnd, hoveredAnnotation]);

  useEffect(() => {
    drawWaveform();
  }, [drawWaveform]);

  useEffect(() => {
    const handleResize = () => drawWaveform();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [drawWaveform]);

  const getTimeFromX = useCallback(
    (clientX: number) => {
      const container = containerRef.current;
      if (!container) return 0;
      const rect = container.getBoundingClientRect();
      const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
      return (x / rect.width) * duration;
    },
    [duration]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      setHoverX(x);
      setHoverTime(getTimeFromX(e.clientX));

      if (selecting) {
        setSelectionEnd(getTimeFromX(e.clientX));
      }
    },
    [getTimeFromX, selecting]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const time = getTimeFromX(e.clientX);
      setSelecting(true);
      setSelectionStart(time);
      setSelectionEnd(time);
      setShowAddForm(false);
    },
    [getTimeFromX]
  );

  const handleMouseUp = useCallback(() => {
    if (selecting && selectionStart !== null && selectionEnd !== null) {
      const diff = Math.abs(selectionEnd - selectionStart);
      if (diff > 0.5) {
        setShowAddForm(true);
      } else {
        setSelectionStart(null);
        setSelectionEnd(null);
      }
    }
    setSelecting(false);
  }, [selecting, selectionStart, selectionEnd]);

  const handleAddNote = () => {
    if (!newNoteText.trim() || selectionStart === null || selectionEnd === null) return;
    const start = Math.min(selectionStart, selectionEnd);
    const end = Math.max(selectionStart, selectionEnd);
    onAddAnnotation(start, end, newNoteText.trim(), newNoteColor);
    setNewNoteText("");
    setNewNoteColor("#3b82f6");
    setShowAddForm(false);
    setSelectionStart(null);
    setSelectionEnd(null);
  };

  const handleStartEdit = (ann: Annotation) => {
    setEditingId(ann.id);
    setEditText(ann.text);
  };

  const handleSaveEdit = (annId: string) => {
    if (editText.trim()) {
      onUpdateAnnotation(annId, { text: editText.trim() });
    }
    setEditingId(null);
    setEditText("");
  };

  const userAnnotations = annotations.filter((a) => a.type === "user");
  const generatedAnnotations = annotations.filter((a) => a.type === "generated");

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AudioWaveform className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Waveform</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onToggleGenerated}
              className="gap-1.5 text-xs"
            >
              {showGeneratedAnnotations ? (
                <Eye className="h-3.5 w-3.5" />
              ) : (
                <EyeOff className="h-3.5 w-3.5" />
              )}
              {showGeneratedAnnotations ? "Hide" : "Show"} Auto-Notes
            </Button>
          </div>
        </div>
        <CardDescription>
          Click and drag on the waveform to select a region and add notes
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Waveform Canvas */}
        {waveformData && waveformData.length > 0 ? (
          <div
            ref={containerRef}
            className="relative cursor-crosshair select-none rounded-lg border bg-muted/30 overflow-hidden"
            onMouseMove={handleMouseMove}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onMouseLeave={() => {
              setHoverX(null);
              setHoverTime(null);
              if (selecting) handleMouseUp();
            }}
          >
            <canvas ref={canvasRef} className="block w-full" />
            {/* Time axis */}
            <div className="flex justify-between px-2 py-1 text-[10px] text-muted-foreground">
              <span>0:00</span>
              <span>{formatTime(duration / 4)}</span>
              <span>{formatTime(duration / 2)}</span>
              <span>{formatTime((duration * 3) / 4)}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>
        ) : (
          <div className="flex h-40 items-center justify-center rounded-lg border bg-muted/30">
            <p className="text-sm text-muted-foreground">
              Waveform data not available
            </p>
          </div>
        )}

        {/* Add Note Form */}
        {showAddForm && selectionStart !== null && selectionEnd !== null && (
          <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Plus className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">Add Note</span>
                <Badge variant="outline" className="text-[10px]">
                  {formatTime(Math.min(selectionStart, selectionEnd))} –{" "}
                  {formatTime(Math.max(selectionStart, selectionEnd))}
                </Badge>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowAddForm(false);
                  setSelectionStart(null);
                  setSelectionEnd(null);
                }}
                className="h-6 w-6 p-0"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
            <textarea
              value={newNoteText}
              onChange={(e) => setNewNoteText(e.target.value)}
              placeholder="Add a note about this section..."
              className="w-full rounded-md border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary"
              rows={2}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleAddNote();
                }
              }}
            />
            <div className="flex items-center justify-between">
              <div className="flex gap-1.5">
                {ANNOTATION_COLORS.map((c) => (
                  <button
                    key={c.value}
                    onClick={() => setNewNoteColor(c.value)}
                    className={`h-5 w-5 rounded-full border-2 transition-all ${
                      newNoteColor === c.value
                        ? "border-foreground scale-110"
                        : "border-transparent"
                    }`}
                    style={{ backgroundColor: c.value }}
                    title={c.label}
                  />
                ))}
              </div>
              <Button size="sm" onClick={handleAddNote} disabled={!newNoteText.trim()}>
                Add Note
              </Button>
            </div>
          </div>
        )}

        {/* Annotations List */}
        {(userAnnotations.length > 0 || (showGeneratedAnnotations && generatedAnnotations.length > 0)) && (
          <div className="space-y-2">
            {/* User annotations */}
            {userAnnotations.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <MessageSquare className="h-3 w-3" />
                  Your Notes ({userAnnotations.length})
                </p>
                {userAnnotations.map((ann) => (
                  <div
                    key={ann.id}
                    className="group flex items-start gap-2 rounded-md border p-2.5 transition-colors hover:bg-muted/30"
                    onMouseEnter={() => setHoveredAnnotation(ann.id)}
                    onMouseLeave={() => setHoveredAnnotation(null)}
                  >
                    <div
                      className="mt-1 h-3 w-3 shrink-0 rounded-full"
                      style={{ backgroundColor: ann.color }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          {formatTime(ann.startTime)} – {formatTime(ann.endTime)}
                        </Badge>
                      </div>
                      {editingId === ann.id ? (
                        <div className="flex gap-1.5 mt-1">
                          <input
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            className="flex-1 rounded border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSaveEdit(ann.id);
                              if (e.key === "Escape") setEditingId(null);
                            }}
                          />
                          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => handleSaveEdit(ann.id)}>
                            <Check className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">{ann.text}</p>
                      )}
                    </div>
                    <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                        onClick={() => handleStartEdit(ann)}
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                        onClick={() => onDeleteAnnotation(ann.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Generated annotations */}
            {showGeneratedAnnotations && generatedAnnotations.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <AudioWaveform className="h-3 w-3" />
                  Auto-Generated Notes ({generatedAnnotations.length})
                </p>
                {generatedAnnotations.map((ann) => (
                  <div
                    key={ann.id}
                    className="flex items-start gap-2 rounded-md border border-dashed p-2.5 transition-colors hover:bg-muted/30"
                    onMouseEnter={() => setHoveredAnnotation(ann.id)}
                    onMouseLeave={() => setHoveredAnnotation(null)}
                  >
                    <div
                      className="mt-1 h-3 w-3 shrink-0 rounded-full"
                      style={{ backgroundColor: ann.color }}
                    />
                    <div className="flex-1 min-w-0">
                      {ann.category && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 mb-0.5">
                          {ann.category}
                        </Badge>
                      )}
                      <p className="text-xs text-muted-foreground">{ann.text}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
