import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin']
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin']
})

export const metadata: Metadata = {
  title: 'Pocket Producer — Song Profiler',
  description:
    'Analyze your mix for mastering readiness. Get loudness, dynamics, frequency, and stereo metrics with actionable recommendations.'
}

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var d=document.documentElement;if(window.matchMedia('(prefers-color-scheme:dark)').matches){d.classList.add('dark')}window.matchMedia('(prefers-color-scheme:dark)').addEventListener('change',function(e){e.matches?d.classList.add('dark'):d.classList.remove('dark')})}catch(e){}})();`
          }}
        />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>{children}</body>
    </html>
  )
}
