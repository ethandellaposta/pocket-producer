'use client'

import { useState, useCallback } from 'react'
import { UploadZone } from '@/components/upload-zone'
import { AnalysisDashboard } from '@/components/analysis-dashboard'
import { SavedSessions } from '@/components/saved-sessions'
import { Button } from '@/components/ui/button'
import { Music, RotateCcw, Save } from 'lucide-react'
import type { AudioMetrics } from '@/lib/audio-analyzer'
import {
  createSession,
  saveSession,
  addAnnotation,
  deleteAnnotation,
  updateAnnotation,
  toggleGeneratedAnnotations,
  type AnalysisSession,
  type Annotation
} from '@/lib/session-store'

export default function Home() {
  const [session, setSession] = useState<AnalysisSession | null>(null)
  const [originalFile, setOriginalFile] = useState<File | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)

  const fetchWaveform = useCallback(async (file: File): Promise<number[] | null> => {
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/waveform', { method: 'POST', body: formData })
      if (!res.ok) return null
      const data = await res.json()
      return data.waveform ?? null
    } catch {
      return null
    }
  }, [])

  const handleAnalysisComplete = useCallback(
    async (data: unknown, file?: File) => {
      const metrics = data as AudioMetrics | null
      if (!metrics) {
        setIsAnalyzing(false)
        return
      }

      if (file) setOriginalFile(file)

      // Fetch waveform in parallel
      const waveformData = file ? await fetchWaveform(file) : null

      // Create and save session
      const newSession = createSession(metrics.fileName, metrics, waveformData)
      setSession(newSession)
      setIsAnalyzing(false)
    },
    [fetchWaveform]
  )

  const handleReset = () => {
    setSession(null)
    setOriginalFile(null)
    setIsAnalyzing(false)
  }

  const handleLoadSession = (loaded: AnalysisSession) => {
    setSession(loaded)
    setOriginalFile(null) // file not available for loaded sessions (mastering won't work without re-upload)
  }

  // Annotation handlers — mutate session store and refresh local state
  const handleAddAnnotation = useCallback(
    (startTime: number, endTime: number, text: string, color: string) => {
      if (!session) return
      addAnnotation(session.id, startTime, endTime, text, color)
      // Refresh session from store
      setSession((prev) => {
        if (!prev) return prev
        const ann: Annotation = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          startTime,
          endTime,
          text,
          color,
          type: 'user',
          createdAt: Date.now()
        }
        return { ...prev, annotations: [...prev.annotations, ann], updatedAt: Date.now() }
      })
    },
    [session]
  )

  const handleDeleteAnnotation = useCallback(
    (annotationId: string) => {
      if (!session) return
      deleteAnnotation(session.id, annotationId)
      setSession((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          annotations: prev.annotations.filter((a) => a.id !== annotationId),
          updatedAt: Date.now()
        }
      })
    },
    [session]
  )

  const handleUpdateAnnotation = useCallback(
    (annotationId: string, updates: Partial<Pick<Annotation, 'text' | 'color'>>) => {
      if (!session) return
      updateAnnotation(session.id, annotationId, updates)
      setSession((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          annotations: prev.annotations.map((a) => (a.id === annotationId ? { ...a, ...updates } : a)),
          updatedAt: Date.now()
        }
      })
    },
    [session]
  )

  const handleToggleGenerated = useCallback(() => {
    if (!session) return
    const newVal = toggleGeneratedAnnotations(session.id)
    setSession((prev) => {
      if (!prev) return prev
      return { ...prev, showGeneratedAnnotations: newVal, updatedAt: Date.now() }
    })
  }, [session])

  const handleSaveSession = useCallback(() => {
    if (!session) return
    saveSession(session)
  }, [session])

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <Music className="h-4 w-4 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-sm font-bold leading-none">Pocket Producer</h1>
              <p className="text-[10px] text-muted-foreground">Song Profiler</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {session && (
              <>
                <Button variant="ghost" size="sm" onClick={handleSaveSession} className="gap-1.5">
                  <Save className="h-3.5 w-3.5" />
                  Save
                </Button>
                <Button variant="ghost" size="sm" onClick={handleReset} className="gap-1.5">
                  <RotateCcw className="h-3.5 w-3.5" />
                  New Analysis
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-5xl px-4 py-8">
        {!session ? (
          <div className="mx-auto max-w-2xl space-y-8">
            {/* Hero */}
            <div className="text-center space-y-3">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Profile Your Mix</h2>
              <p className="text-muted-foreground max-w-lg mx-auto">
                Upload an MP3 from Logic Pro and get instant analysis on loudness, dynamics, frequency
                balance, stereo image, and mastering readiness.
              </p>
            </div>

            <UploadZone
              onAnalysisComplete={handleAnalysisComplete}
              onAnalysisStart={() => setIsAnalyzing(true)}
              isAnalyzing={isAnalyzing}
            />

            {/* Feature highlights */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[
                { title: 'Loudness', desc: 'LUFS & peak levels' },
                { title: 'Dynamics', desc: 'Range & headroom' },
                { title: 'Frequency', desc: 'Spectral balance' },
                { title: 'Stereo', desc: 'Width & phase' }
              ].map((f) => (
                <div key={f.title} className="rounded-lg border bg-card p-4 text-center">
                  <p className="text-sm font-semibold">{f.title}</p>
                  <p className="text-xs text-muted-foreground">{f.desc}</p>
                </div>
              ))}
            </div>

            {/* Saved Sessions */}
            <SavedSessions onLoadSession={handleLoadSession} />
          </div>
        ) : (
          <AnalysisDashboard
            metrics={session.metrics}
            originalFile={originalFile}
            session={session}
            onAddAnnotation={handleAddAnnotation}
            onDeleteAnnotation={handleDeleteAnnotation}
            onUpdateAnnotation={handleUpdateAnnotation}
            onToggleGenerated={handleToggleGenerated}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t py-6 text-center text-xs text-muted-foreground">
        Pocket Producer &mdash; Built for Logic Pro producers
      </footer>
    </div>
  )
}
