import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Matplan & Tilbuds-Radar | 100% Vegansk & Peanøttfri',
  description:
    'Smart ukentlig matplanlegging, inventaroversikt og ruteoptimalisert tilbudsradar for REMA 1000, KIWI, MENY, Coop Extra, Spar, Joker og Oda.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="no" className="dark">
      <body className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-emerald-500 selection:text-slate-950">
        {children}
      </body>
    </html>
  );
}
