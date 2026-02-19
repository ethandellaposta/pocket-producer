'use client'

import { useCallback, useState } from 'react'
import { Upload, Music, Loader2 } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

interface UploadZoneProps {
  onAnalysisComplete: (data: unknown, file?: File) => void
  onAnalysisStart: () => void
  isAnalyzing: boolean
}

export function UploadZone({ onAnalysisComplete, onAnalysisStart, isAnalyzing }: UploadZoneProps) {
  const [dragActive, setDragActive] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)

  const handleFile = useCallback(
    async (file: File) => {
      setError(null)

      if (!file.name.toLowerCase().endsWith('.mp3') && !file.type.includes('audio')) {
        setError('Please upload an MP3 file')
        return
      }

      if (file.size > 100 * 1024 * 1024) {
        setError('File too large. Maximum size is 100 MB.')
        return
      }

      setFileName(file.name)
      onAnalysisStart()

      try {
        const formData = new FormData()
        formData.append('file', file)

        const response = await fetch('/api/analyze', {
          method: 'POST',
          body: formData
        })

        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.error || 'Analysis failed')
        }

        const data = await response.json()
        onAnalysisComplete(data, file)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Analysis failed')
        onAnalysisComplete(null, undefined)
      }
    },
    [onAnalysisComplete, onAnalysisStart]
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragActive(false)
      const file = e.dataTransfer.files[0]
      if (file) handleFile(file)
    },
    [handleFile]
  )

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) handleFile(file)
    },
    [handleFile]
  )

  return (
    <Card
      className={`relative border-2 border-dashed transition-all duration-200 ${
        dragActive
          ? 'border-primary bg-primary/5 scale-[1.01]'
          : 'border-muted-foreground/25 hover:border-muted-foreground/50'
      } ${isAnalyzing ? 'pointer-events-none opacity-70' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setDragActive(true)
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={handleDrop}
    >
      <label className="flex cursor-pointer flex-col items-center gap-4 p-12">
        <input
          type="file"
          accept=".mp3,audio/mpeg,audio/*"
          className="hidden"
          onChange={handleChange}
          disabled={isAnalyzing}
        />

        {isAnalyzing ? (
          <>
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
            <div className="text-center">
              <p className="text-lg font-semibold">Analyzing {fileName}...</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Scanning loudness, dynamics, frequency balance, stereo image...
              </p>
            </div>
          </>
        ) : (
          <>
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
              {dragActive ? (
                <Music className="h-8 w-8 text-primary" />
              ) : (
                <Upload className="h-8 w-8 text-primary" />
              )}
            </div>
            <div className="text-center">
              <p className="text-lg font-semibold">
                {dragActive ? 'Drop your track here' : 'Upload your mix'}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">Drag & drop an MP3 file or click to browse</p>
              <p className="mt-0.5 text-xs text-muted-foreground/70">MP3 files up to 100 MB</p>
            </div>
            <Button variant="outline" size="sm" className="mt-2">
              Choose File
            </Button>
          </>
        )}

        {error && <p className="mt-2 text-sm font-medium text-destructive">{error}</p>}
      </label>
    </Card>
  )
}
