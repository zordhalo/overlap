import type { Metadata } from 'next';
import { Bitcount_Prop_Single, IBM_Plex_Mono, Space_Grotesk } from 'next/font/google';
import './globals.css';

/**
 * Font variable names must match exactly what `globals.css` documents at its
 * top: `--font-display`, `--font-body`, `--font-mono`. That comment block is
 * authoritative — the CSS `@theme` block builds `--font-display-family` etc.
 * from these three.
 */
const fontDisplay = Bitcount_Prop_Single({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-display',
  display: 'swap',
});

// Space Grotesk stands in for Satoshi — see the note in globals.css: the
// reference (runs-on.dev) self-hosts Satoshi woff2s this repo doesn't have.
const fontBody = Space_Grotesk({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-body',
  display: 'swap',
});

const fontMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Overlap',
  description:
    "See your people's time zones on a globe, and get ranked meeting times when everyone is awake and free.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fontDisplay.variable} ${fontBody.variable} ${fontMono.variable}`}>
      <body className="min-h-screen bg-(--paper) text-(--ink) antialiased">{children}</body>
    </html>
  );
}
