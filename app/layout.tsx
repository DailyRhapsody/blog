import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AnalyticsCollector } from "@/components/AnalyticsCollector";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://tengjun.org";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "DailyRhapsody",
  description: "I think, therefore I am.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
        <AnalyticsCollector />
        {/* Anti-Scrape Honeypot */}
        <a 
          href="/api/honeypot" 
          aria-hidden="true" 
          tabIndex={-1} 
          style={{ position: 'absolute', top: -100, left: -100, width: 1, height: 1, overflow: 'hidden', opacity: 0 }}
        >
          DailyRhapsody Feed
        </a>
      </body>
    </html>
  );
}
