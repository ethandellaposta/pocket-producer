'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Info,
  Music,
  Activity,
  Radio,
  Gauge,
  Lightbulb,
  FileAudio,
  Clock,
  Zap,
  Wand2,
  AudioWaveform
} from 'lucide-react'
import type { AudioMetrics, AnalysisIssue } from '@/lib/audio-analyzer'
import { FrequencyChart } from './frequency-chart'
import { MasteringPanel } from './mastering-panel'
import { WaveformViewer } from './waveform-viewer'
import type { AnalysisSession, Annotation } from '@/lib/session-store'

interface AnalysisDashboardProps {
  metrics: AudioMetrics
  originalFile: File | null
  session: AnalysisSession
  onAddAnnotation: (startTime: number, endTime: number, text: string, color: string) => void
  onDeleteAnnotation: (annotationId: string) => void
  onUpdateAnnotation: (annotationId: string, updates: Partial<Pick<Annotation, 'text' | 'color'>>) => void
  onToggleGenerated: () => void
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function ScoreBadge({ level }: { level: AudioMetrics['readinessLevel'] }) {
  const config = {
    ready: {
      label: 'Ready for Mastering',
      variant: 'default' as const,
      className: 'bg-emerald-600 hover:bg-emerald-700'
    },
    'almost-ready': {
      label: 'Almost Ready',
      variant: 'default' as const,
      className: 'bg-amber-500 hover:bg-amber-600'
    },
    'needs-work': {
      label: 'Needs Work',
      variant: 'default' as const,
      className: 'bg-orange-500 hover:bg-orange-600'
    },
    'not-ready': { label: 'Not Ready', variant: 'destructive' as const, className: '' }
  }
  const c = config[level]
  return (
    <Badge variant={c.variant} className={`text-sm px-3 py-1 ${c.className}`}>
      {c.label}
    </Badge>
  )
}

function IssueIcon({ severity }: { severity: AnalysisIssue['severity'] }) {
  if (severity === 'critical') return <XCircle className="h-4 w-4 text-red-500 shrink-0" />
  if (severity === 'warning') return <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
  return <Info className="h-4 w-4 text-blue-500 shrink-0" />
}

function ScoreRing({ score }: { score: number }) {
  const radius = 54
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (score / 100) * circumference
  const color =
    score >= 80
      ? 'text-emerald-500'
      : score >= 60
        ? 'text-amber-500'
        : score >= 35
          ? 'text-orange-500'
          : 'text-red-500'

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width="140" height="140" className="-rotate-90">
        <circle
          cx="70"
          cy="70"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="8"
          className="text-muted/50"
        />
        <circle
          cx="70"
          cy="70"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="8"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className={`${color} transition-all duration-1000`}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-3xl font-bold">{score}</span>
        <span className="text-xs text-muted-foreground">/ 100</span>
      </div>
    </div>
  )
}

function MetricRow({ label, value, subtext }: { label: string; value: string; subtext?: string }) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="text-right">
        <span className="text-sm font-medium">{value}</span>
        {subtext && <span className="ml-1 text-xs text-muted-foreground">{subtext}</span>}
      </div>
    </div>
  )
}

export function AnalysisDashboard({
  metrics,
  originalFile,
  session,
  onAddAnnotation,
  onDeleteAnnotation,
  onUpdateAnnotation,
  onToggleGenerated
}: AnalysisDashboardProps) {
  const criticalCount = metrics.issues.filter((i) => i.severity === 'critical').length
  const warningCount = metrics.issues.filter((i) => i.severity === 'warning').length
  const infoCount = metrics.issues.filter((i) => i.severity === 'info').length

  return (
    <div className="space-y-6">
      {/* Header: Score + File Info */}
      <div className="grid gap-6 md:grid-cols-[1fr_auto]">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <FileAudio className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">{metrics.fileName}</CardTitle>
            </div>
            <CardDescription>
              {metrics.codec.toUpperCase()} &middot; {Math.round(metrics.bitrate / 1000)} kbps &middot;{' '}
              {metrics.sampleRate / 1000} kHz &middot; {metrics.channels === 2 ? 'Stereo' : 'Mono'} &middot;{' '}
              {formatFileSize(metrics.fileSize)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-6 text-sm">
              <div className="flex items-center gap-1.5">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span>{formatDuration(metrics.duration)}</span>
              </div>
              {metrics.bitDepth && (
                <div className="flex items-center gap-1.5">
                  <Zap className="h-4 w-4 text-muted-foreground" />
                  <span>{metrics.bitDepth}-bit</span>
                </div>
              )}
              <div className="flex items-center gap-1.5">
                <Activity className="h-4 w-4 text-muted-foreground" />
                <span>{metrics.sampleRate} Hz</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="flex flex-col items-center justify-center px-8 py-6">
          <ScoreRing score={metrics.masteringScore} />
          <div className="mt-3">
            <ScoreBadge level={metrics.readinessLevel} />
          </div>
        </Card>
      </div>

      {/* Issue Summary Bar */}
      <div className="flex flex-wrap gap-3">
        {criticalCount > 0 && (
          <Badge variant="destructive" className="gap-1">
            <XCircle className="h-3 w-3" />
            {criticalCount} Critical
          </Badge>
        )}
        {warningCount > 0 && (
          <Badge variant="outline" className="gap-1 border-amber-500/50 text-amber-600">
            <AlertTriangle className="h-3 w-3" />
            {warningCount} Warning{warningCount > 1 ? 's' : ''}
          </Badge>
        )}
        {infoCount > 0 && (
          <Badge variant="outline" className="gap-1 border-blue-500/50 text-blue-600">
            <Info className="h-3 w-3" />
            {infoCount} Info
          </Badge>
        )}
        {metrics.issues.length === 0 && (
          <Badge variant="outline" className="gap-1 border-emerald-500/50 text-emerald-600">
            <CheckCircle2 className="h-3 w-3" />
            No issues detected
          </Badge>
        )}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="loudness" className="w-full">
        <TabsList className="grid w-full grid-cols-7">
          <TabsTrigger value="loudness" className="gap-1.5 text-xs sm:text-sm">
            <Gauge className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Loudness</span>
          </TabsTrigger>
          <TabsTrigger value="dynamics" className="gap-1.5 text-xs sm:text-sm">
            <Activity className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Dynamics</span>
          </TabsTrigger>
          <TabsTrigger value="frequency" className="gap-1.5 text-xs sm:text-sm">
            <Music className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Frequency</span>
          </TabsTrigger>
          <TabsTrigger value="stereo" className="gap-1.5 text-xs sm:text-sm">
            <Radio className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Stereo</span>
          </TabsTrigger>
          <TabsTrigger value="tips" className="gap-1.5 text-xs sm:text-sm">
            <Lightbulb className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Tips</span>
          </TabsTrigger>
          <TabsTrigger value="waveform" className="gap-1.5 text-xs sm:text-sm">
            <AudioWaveform className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Waveform</span>
          </TabsTrigger>
          <TabsTrigger value="master" className="gap-1.5 text-xs sm:text-sm">
            <Wand2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Master</span>
          </TabsTrigger>
        </TabsList>

        {/* Loudness Tab */}
        <TabsContent value="loudness">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Loudness Analysis</CardTitle>
              <CardDescription>Key loudness metrics for your mix</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1">
              <MetricRow
                label="Peak Level"
                value={`${metrics.peakLevel.toFixed(1)} dBFS`}
                subtext={metrics.peakLevel > -1 ? '(too hot!)' : '(ok)'}
              />
              <Separator />
              <MetricRow label="RMS Level" value={`${metrics.rmsLevel.toFixed(1)} dBFS`} />
              <Separator />
              <MetricRow
                label="Estimated LUFS"
                value={`${metrics.estimatedLUFS.toFixed(1)} LUFS`}
                subtext="(target: -14)"
              />
              <Separator />
              <MetricRow
                label="Clipping Samples"
                value={metrics.clippingSamples > 0 ? metrics.clippingSamples.toLocaleString() : 'None'}
                subtext={metrics.clippingDetected ? '(detected!)' : ''}
              />
              <Separator />

              <div className="pt-4">
                <p className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Loudness vs. Streaming Targets
                </p>
                <div className="space-y-3">
                  {[
                    { name: 'Spotify', target: -14 },
                    { name: 'Apple Music', target: -16 },
                    { name: 'YouTube', target: -14 },
                    { name: 'Tidal', target: -14 }
                  ].map((platform) => {
                    const diff = metrics.estimatedLUFS - platform.target
                    const status = Math.abs(diff) <= 1 ? 'good' : diff > 0 ? 'loud' : 'quiet'
                    return (
                      <div key={platform.name} className="flex items-center gap-3">
                        <span className="w-24 text-sm">{platform.name}</span>
                        <div className="flex-1">
                          <Progress
                            value={Math.min(100, Math.max(0, ((metrics.estimatedLUFS + 30) / 30) * 100))}
                            className="h-2"
                          />
                        </div>
                        <span
                          className={`text-xs font-medium ${
                            status === 'good'
                              ? 'text-emerald-600'
                              : status === 'loud'
                                ? 'text-amber-600'
                                : 'text-blue-600'
                          }`}
                        >
                          {diff > 0 ? '+' : ''}
                          {diff.toFixed(1)} dB
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Dynamics Tab */}
        <TabsContent value="dynamics">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Dynamics & Quality</CardTitle>
              <CardDescription>Dynamic range, headroom, and signal quality</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1">
              <MetricRow
                label="Dynamic Range"
                value={`${metrics.dynamicRange.toFixed(1)} dB`}
                subtext={
                  metrics.dynamicRange < 6
                    ? '(over-compressed)'
                    : metrics.dynamicRange < 10
                      ? '(compressed)'
                      : metrics.dynamicRange < 20
                        ? '(good)'
                        : '(very dynamic)'
                }
              />
              <Separator />
              <MetricRow label="Crest Factor" value={`${metrics.crestFactor.toFixed(1)} dB`} />
              <Separator />
              <MetricRow
                label="Headroom"
                value={`${Math.abs(metrics.peakLevel).toFixed(1)} dB`}
                subtext={
                  Math.abs(metrics.peakLevel) < 1
                    ? '(need more)'
                    : Math.abs(metrics.peakLevel) > 6
                      ? '(plenty)'
                      : '(ok)'
                }
              />
              <Separator />
              <MetricRow
                label="DC Offset"
                value={`${(metrics.dcOffset * 100).toFixed(3)}%`}
                subtext={Math.abs(metrics.dcOffset) > 0.01 ? '(fix this)' : '(ok)'}
              />
              <Separator />
              <MetricRow label="Silence Ratio" value={`${metrics.silenceRatio.toFixed(1)}%`} />

              <div className="pt-4">
                <p className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Dynamic Range Rating
                </p>
                <div className="flex gap-1">
                  {Array.from({ length: 20 }, (_, i) => {
                    const filled = i < Math.round(metrics.dynamicRange)
                    return (
                      <div
                        key={i}
                        className={`h-6 flex-1 rounded-sm transition-colors ${
                          filled
                            ? i < 6
                              ? 'bg-red-500'
                              : i < 10
                                ? 'bg-amber-500'
                                : i < 16
                                  ? 'bg-emerald-500'
                                  : 'bg-blue-500'
                            : 'bg-muted'
                        }`}
                      />
                    )
                  })}
                </div>
                <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                  <span>Crushed</span>
                  <span>Compressed</span>
                  <span>Balanced</span>
                  <span>Dynamic</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Frequency Tab */}
        <TabsContent value="frequency">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Frequency Balance</CardTitle>
              <CardDescription>Energy distribution across the frequency spectrum</CardDescription>
            </CardHeader>
            <CardContent>
              <FrequencyChart bands={metrics.frequencyBands} />

              <Separator className="my-4" />

              <MetricRow
                label="Spectral Centroid"
                value={`${metrics.spectralCentroid} Hz`}
                subtext={
                  metrics.spectralCentroid < 1500
                    ? '(dark/warm)'
                    : metrics.spectralCentroid < 3000
                      ? '(balanced)'
                      : '(bright)'
                }
              />

              <div className="mt-4 space-y-2">
                {metrics.frequencyBands.map((band) => (
                  <div key={band.name} className="flex items-center gap-3">
                    <span className="w-20 text-xs text-muted-foreground">{band.name}</span>
                    <div className="flex-1">
                      <Progress value={band.energy} className="h-3" />
                    </div>
                    <Badge
                      variant="outline"
                      className={`text-[10px] w-20 justify-center ${
                        band.rating === 'balanced'
                          ? 'border-emerald-500/50 text-emerald-600'
                          : band.rating === 'excessive' || band.rating === 'deficient'
                            ? 'border-red-500/50 text-red-600'
                            : 'border-amber-500/50 text-amber-600'
                      }`}
                    >
                      {band.rating}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Stereo Tab */}
        <TabsContent value="stereo">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Stereo Image</CardTitle>
              <CardDescription>Stereo width, phase correlation, and channel balance</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1">
              <MetricRow
                label="Stereo Width"
                value={`${metrics.stereoWidth.toFixed(0)}%`}
                subtext={
                  metrics.stereoWidth < 20
                    ? '(narrow)'
                    : metrics.stereoWidth < 60
                      ? '(moderate)'
                      : metrics.stereoWidth < 85
                        ? '(wide)'
                        : '(very wide)'
                }
              />
              <Separator />
              <MetricRow
                label="Phase Correlation"
                value={metrics.phaseCorrelation.toFixed(3)}
                subtext={
                  metrics.phaseCorrelation > 0.7
                    ? '(mono-safe)'
                    : metrics.phaseCorrelation > 0.3
                      ? '(ok)'
                      : metrics.phaseCorrelation > 0
                        ? '(risky)'
                        : '(phase issues!)'
                }
              />
              <Separator />
              <MetricRow
                label="L/R Balance"
                value={
                  Math.abs(metrics.stereoBalance) < 0.02
                    ? 'Centered'
                    : `${Math.abs(metrics.stereoBalance * 100).toFixed(1)}% ${
                        metrics.stereoBalance > 0 ? 'Right' : 'Left'
                      }`
                }
              />

              {/* Stereo Width Visual */}
              <div className="pt-6">
                <p className="mb-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Stereo Field
                </p>
                <div className="relative h-32 rounded-lg bg-muted/50 overflow-hidden">
                  {/* Center line */}
                  <div className="absolute left-1/2 top-0 h-full w-px bg-muted-foreground/20" />
                  {/* Width indicator */}
                  <div
                    className="absolute top-1/2 h-16 -translate-y-1/2 rounded-full bg-primary/20 border border-primary/40 transition-all duration-500"
                    style={{
                      left: `${50 - metrics.stereoWidth / 2}%`,
                      width: `${Math.max(2, metrics.stereoWidth)}%`
                    }}
                  />
                  {/* Balance dot */}
                  <div
                    className="absolute top-1/2 h-3 w-3 -translate-y-1/2 -translate-x-1/2 rounded-full bg-primary transition-all duration-500"
                    style={{
                      left: `${50 + metrics.stereoBalance * 40}%`
                    }}
                  />
                  <div className="absolute bottom-2 left-4 text-[10px] text-muted-foreground">L</div>
                  <div className="absolute bottom-2 right-4 text-[10px] text-muted-foreground">R</div>
                </div>
              </div>

              {/* Phase Correlation Meter */}
              <div className="pt-4">
                <p className="mb-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Phase Correlation Meter
                </p>
                <div className="relative h-6 rounded-full bg-muted/50 overflow-hidden">
                  <div className="absolute left-1/2 top-0 h-full w-px bg-muted-foreground/30" />
                  <div
                    className="absolute top-1/2 h-4 w-4 -translate-y-1/2 -translate-x-1/2 rounded-full bg-primary transition-all duration-500"
                    style={{
                      left: `${((metrics.phaseCorrelation + 1) / 2) * 100}%`
                    }}
                  />
                  <div className="absolute bottom-0 left-1 text-[9px] text-muted-foreground">-1</div>
                  <div className="absolute bottom-0 left-1/2 -translate-x-1/2 text-[9px] text-muted-foreground">
                    0
                  </div>
                  <div className="absolute bottom-0 right-1 text-[9px] text-muted-foreground">+1</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tips Tab */}
        <TabsContent value="tips">
          <div className="space-y-4">
            {/* Issues */}
            {metrics.issues.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Issues Found</CardTitle>
                  <CardDescription>Problems detected in your mix, sorted by severity</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {metrics.issues
                      .sort((a, b) => {
                        const order = { critical: 0, warning: 1, info: 2 }
                        return order[a.severity] - order[b.severity]
                      })
                      .map((issue, i) => (
                        <div key={i} className="flex gap-3 items-start">
                          <IssueIcon severity={issue.severity} />
                          <div>
                            <p className="text-sm font-medium">{issue.category}</p>
                            <p className="text-sm text-muted-foreground">{issue.message}</p>
                          </div>
                        </div>
                      ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Recommendations */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recommendations for Logic Pro</CardTitle>
                <CardDescription>Actionable steps to improve your mix</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {metrics.recommendations.map((rec, i) => (
                    <div key={i} className="flex gap-3 items-start">
                      <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                        {i + 1}
                      </div>
                      <p className="text-sm text-muted-foreground">{rec}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
        {/* Master Tab */}
        <TabsContent value="master">
          {originalFile ? (
            <MasteringPanel metrics={metrics} originalFile={originalFile} />
          ) : (
            <Card>
              <CardContent className="py-10 text-center">
                <Wand2 className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
                <p className="text-sm font-medium">Mastering unavailable</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Re-upload the original file to enable auto-mastering on a saved session.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
        {/* Waveform Tab */}
        <TabsContent value="waveform">
          <WaveformViewer
            session={session}
            onAddAnnotation={onAddAnnotation}
            onDeleteAnnotation={onDeleteAnnotation}
            onUpdateAnnotation={onUpdateAnnotation}
            onToggleGenerated={onToggleGenerated}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
