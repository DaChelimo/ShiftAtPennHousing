import type { Metadata } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import './globals.css';

// IBM Plex — Carbon's type pair: Plex Sans for UI, Plex Mono for times/IDs.
// next/font self-hosts and exposes each as a CSS variable consumed by
// globals.css (`--font-sans` / `--font-mono` via the @theme layer).
const ibmPlexSans = IBM_Plex_Sans({
  variable: '--font-ibm-plex-sans',
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  display: 'swap',
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: '--font-ibm-plex-mono',
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Shift@PennHousing — Admin',
  description: 'SM/HM schedule builder and house administration.',
};

// Applies the persisted theme (or light default) to <html data-theme> before
// first paint, so there is no flash and no hydration mismatch (the attribute is
// not React-controlled — hence suppressHydrationWarning).
const themeInitScript = `(function(){try{var t=localStorage.getItem('shift-theme');document.documentElement.setAttribute('data-theme',t==='dark'?'dark':'light');}catch(e){document.documentElement.setAttribute('data-theme','light');}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${ibmPlexSans.variable} ${ibmPlexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        {children}
      </body>
    </html>
  );
}
