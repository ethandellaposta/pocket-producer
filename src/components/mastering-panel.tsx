'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Wand2,
  Download,
  Loader2,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Zap,
  Volume2,
  Waves,
  Radio,
  Filter
} from 'lucide-react'
import type { AudioMetrics } from '@/lib/audio-analyzer'
import type { MasteringSettings } from '@/lib/mastering-types'
import { MASTERING_PRESETS } from '@/lib/mastering-types'

interface MasteringPanelProps {
  metrics: AudioMetrics
  originalFile: File
}

type MasteringState = 'idle' | 'processing' | 'done' | 'error'

export function MasteringPanel({ metrics, originalFile }: MasteringPanelProps) {
  const [state, setState] = useState<MasteringState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
  const [downloadName, setDownloadName] = useState<string>('')
  const [chain, setChain] = useState<string[]>([])
  const [showAdvanced, setShowAdvanced] = useState(false)

  // Settings state
  const [preset, setPreset] = useState(() => {
    if (metrics.dynamicRange < 8) return 'gentle'
    if (metrics.spectralCentroid > 3500) return 'warm'
    if (metrics.spectralCentroid < 1200) return 'bright'
    return 'streaming'
  })
  const [targetLUFS, setTargetLUFS] = useState(-14)
  const [applyEQ, setApplyEQ] = useState(true)
  const [applyCompression, setApplyCompression] = useState(true)
  const [applyLimiter, setApplyLimiter] = useState(true)
  const [applyStereoEnhancement, setApplyStereoEnhancement] = useState(
    metrics.channels >= 2 && metrics.stereoWidth < 50
  )
  const [applyHighPass, setApplyHighPass] = useState(true)
  const [outputFormat, setOutputFormat] = useState<'wav' | 'mp3' | 'flac'>('wav')
  const [outputBitrate, setOutputBitrate] = useState(320)

  const handleMaster = async () => {
    setState('processing')
    setError(null)
    setChain([])

    try {
      const settings: MasteringSettings = {
        preset,
        targetLUFS,
        applyEQ,
        applyCompression,
        applyLimiter,
        applyStereoEnhancement,
        applyHighPass,
        outputFormat,
        outputBitrate,
        outputSampleRate: metrics.sampleRate >= 44100 ? metrics.sampleRate : 44100
      }

      const formData = new FormData()
      formData.append('file', originalFile)
      formData.append('settings', JSON.stringify(settings))
      formData.append('metrics', JSON.stringify(metrics))

      const response = await fetch('/api/master', {
        method: 'POST',
        body: formData
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Mastering failed')
      }

      // Parse chain from headers
      const chainHeader = response.headers.get('X-Mastering-Chain')
      if (chainHeader) {
        try {
          setChain(JSON.parse(chainHeader))
        } catch {
          // ignore parse errors
        }
      }

      // Create download URL
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      setDownloadUrl(url)

      const disposition = response.headers.get('Content-Disposition')
      const nameMatch = disposition?.match(/filename="(.+)"/)
      setDownloadName(nameMatch?.[1] || `mastered.${outputFormat}`)

      setState('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Mastering failed')
      setState('error')
    }
  }

  const handleDownload = () => {
    if (!downloadUrl) return
    const a = document.createElement('a')
    a.href = downloadUrl
    a.download = downloadName
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  const handleReset = () => {
    if (downloadUrl) URL.revokeObjectURL(downloadUrl)
    setDownloadUrl(null)
    setChain([])
    setState('idle')
    setError(null)
  }

  const currentPreset = MASTERING_PRESETS[preset]

  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/[0.02] to-transparent">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wand2 className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Auto-Master</CardTitle>
          </div>
          {state === 'done' && (
            <Badge className="bg-emerald-600 hover:bg-emerald-700 gap-1">
              <CheckCircle2 className="h-3 w-3" />
              Complete
            </Badge>
          )}
        </div>
        <CardDescription>Apply an intelligent mastering chain based on your analysis results</CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Preset Selector */}
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Mastering Preset
          </label>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {Object.entries(MASTERING_PRESETS).map(([key, p]) => (
              <button
                key={key}
                onClick={() => setPreset(key)}
                disabled={state === 'processing'}
                className={`rounded-lg border p-3 text-left transition-all ${
                  preset === key
                    ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                    : 'border-border hover:border-muted-foreground/30'
                } ${state === 'processing' ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
              >
                <p className="text-sm font-medium">{p.name}</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground leading-tight">{p.description}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Target LUFS */}
        <div>
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Target Loudness
            </label>
            <span className="text-sm font-mono font-medium">{targetLUFS} LUFS</span>
          </div>
          <input
            type="range"
            min={-20}
            max={-6}
            step={0.5}
            value={targetLUFS}
            onChange={(e) => setTargetLUFS(parseFloat(e.target.value))}
            disabled={state === 'processing'}
            className="mt-2 w-full accent-primary"
          />
          <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
            <span>-20 (quiet)</span>
            <span>-14 (streaming)</span>
            <span>-6 (loud)</span>
          </div>
        </div>

        {/* Output Format */}
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Output Format
          </label>
          <div className="mt-2 flex gap-2">
            {(['wav', 'flac', 'mp3'] as const).map((fmt) => (
              <button
                key={fmt}
                onClick={() => setOutputFormat(fmt)}
                disabled={state === 'processing'}
                className={`rounded-md border px-4 py-2 text-sm font-medium uppercase transition-all ${
                  outputFormat === fmt
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-border text-muted-foreground hover:border-muted-foreground/30'
                } ${state === 'processing' ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
              >
                {fmt}
              </button>
            ))}
            {outputFormat === 'mp3' && (
              <select
                value={outputBitrate}
                onChange={(e) => setOutputBitrate(parseInt(e.target.value))}
                disabled={state === 'processing'}
                className="ml-2 rounded-md border border-border bg-background px-2 py-1 text-sm"
              >
                <option value={192}>192 kbps</option>
                <option value={256}>256 kbps</option>
                <option value={320}>320 kbps</option>
              </select>
            )}
          </div>
        </div>

        {/* Advanced Toggle */}
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          {showAdvanced ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          Processing Chain Controls
        </button>

        {showAdvanced && (
          <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
            {[
              {
                key: 'eq',
                label: 'Adaptive EQ',
                icon: Waves,
                value: applyEQ,
                setter: setApplyEQ,
                desc: 'Corrective EQ based on frequency analysis'
              },
              {
                key: 'comp',
                label: 'Compression',
                icon: Zap,
                value: applyCompression,
                setter: setApplyCompression,
                desc: `${currentPreset.compressionRatio}:1 ratio, ${currentPreset.compressionThreshold} dB threshold`
              },
              {
                key: 'limiter',
                label: 'Brick-wall Limiter',
                icon: Volume2,
                value: applyLimiter,
                setter: setApplyLimiter,
                desc: `Ceiling at ${currentPreset.limiterCeiling} dBFS`
              },
              {
                key: 'stereo',
                label: 'Stereo Enhancement',
                icon: Radio,
                value: applyStereoEnhancement,
                setter: setApplyStereoEnhancement,
                desc: `${currentPreset.stereoWidenAmount}% widening`
              },
              {
                key: 'hp',
                label: 'High-pass Filter',
                icon: Filter,
                value: applyHighPass,
                setter: setApplyHighPass,
                desc: `Remove sub-${currentPreset.highPassFreq} Hz rumble`
              }
            ].map(({ key, label, icon: Icon, value, setter, desc }) => (
              <label
                key={key}
                className={`flex items-center gap-3 cursor-pointer ${state === 'processing' ? 'opacity-50 pointer-events-none' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={value}
                  onChange={(e) => setter(e.target.checked)}
                  className="h-4 w-4 rounded accent-primary"
                />
                <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-sm font-medium">{label}</p>
                  <p className="text-[10px] text-muted-foreground">{desc}</p>
                </div>
              </label>
            ))}
          </div>
        )}

        <Separator />

        {/* Action Buttons */}
        {state === 'idle' && (
          <Button onClick={handleMaster} className="w-full gap-2" size="lg">
            <Wand2 className="h-4 w-4" />
            Master This Track
          </Button>
        )}

        {state === 'processing' && (
          <Button disabled className="w-full gap-2" size="lg">
            <Loader2 className="h-4 w-4 animate-spin" />
            Mastering... (this may take a moment)
          </Button>
        )}

        {state === 'error' && (
          <div className="space-y-3">
            <p className="text-sm text-destructive font-medium">{error}</p>
            <Button onClick={handleReset} variant="outline" className="w-full gap-2">
              Try Again
            </Button>
          </div>
        )}

        {state === 'done' && (
          <div className="space-y-4">
            {/* Processing Chain Summary */}
            {chain.length > 0 && (
              <div className="rounded-lg border bg-muted/30 p-4">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  Processing Chain Applied
                </p>
                <div className="space-y-1.5">
                  {chain.map((step, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-[9px] font-bold text-emerald-600 mt-0.5">
                        {i + 1}
                      </div>
                      <p className="text-xs text-muted-foreground">{step}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <Button onClick={handleDownload} className="flex-1 gap-2" size="lg">
                <Download className="h-4 w-4" />
                Download {downloadName}
              </Button>
              <Button onClick={handleReset} variant="outline" size="lg">
                Re-master
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
