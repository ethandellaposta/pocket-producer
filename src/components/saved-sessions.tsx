"use client";

import { useEffect, useState } from "react";
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
  FolderOpen,
  Trash2,
  Clock,
  FileAudio,
  MessageSquare,
  ChevronRight,
} from "lucide-react";
import {
  getSessions,
  deleteSession,
  type AnalysisSession,
} from "@/lib/session-store";

interface SavedSessionsProps {
  onLoadSession: (session: AnalysisSession) => void;
  currentSessionId?: string | null;
}

function timeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

export function SavedSessions({ onLoadSession, currentSessionId }: SavedSessionsProps) {
  const [sessions, setSessions] = useState<AnalysisSession[]>([]);

  useEffect(() => {
    setSessions(getSessions());
  }, [currentSessionId]);

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    deleteSession(id);
    setSessions(getSessions());
  };

  if (sessions.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <FolderOpen className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">Saved Sessions</CardTitle>
        </div>
        <CardDescription>
          Pick up where you left off
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {sessions.map((session) => {
            const isCurrent = session.id === currentSessionId;
            const userNotes = session.annotations.filter((a) => a.type === "user").length;
            const score = session.metrics.masteringScore;

            return (
              <button
                key={session.id}
                onClick={() => onLoadSession(session)}
                disabled={isCurrent}
                className={`w-full text-left rounded-lg border p-3 transition-all ${
                  isCurrent
                    ? "border-primary bg-primary/5 cursor-default"
                    : "hover:border-muted-foreground/30 hover:bg-muted/30 cursor-pointer"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileAudio className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {session.name}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                          <Clock className="h-2.5 w-2.5" />
                          {timeAgo(session.updatedAt)}
                        </span>
                        {userNotes > 0 && (
                          <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                            <MessageSquare className="h-2.5 w-2.5" />
                            {userNotes} note{userNotes !== 1 ? "s" : ""}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${
                        score >= 80
                          ? "border-emerald-500/50 text-emerald-600"
                          : score >= 60
                          ? "border-amber-500/50 text-amber-600"
                          : "border-red-500/50 text-red-600"
                      }`}
                    >
                      {score}/100
                    </Badge>
                    {!isCurrent && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                        onClick={(e) => handleDelete(session.id, e)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                    {!isCurrent && (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                    {isCurrent && (
                      <Badge variant="outline" className="text-[10px]">
                        Current
                      </Badge>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
