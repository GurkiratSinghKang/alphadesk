import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Providers } from "@/lib/providers";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "AlphaDesk — AI-Powered Trading Terminal",
  description:
    "Claude-powered trading platform with multi-strategy pipeline, real-time analysis, and automated portfolio management.",
  openGraph: {
    title: "AlphaDesk — AI-Powered Trading Terminal",
    description:
      "Claude-powered trading platform with multi-strategy pipeline, real-time analysis, and automated portfolio management.",
    url: "https://tradingalpha.net",
    siteName: "AlphaDesk",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "AlphaDesk — AI-Powered Trading Terminal",
    description: "Claude-powered trading platform.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`dark ${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
      style={{ backgroundColor: "#0a0a0f" }}
      suppressHydrationWarning
    >
      <body className="h-full bg-background text-foreground" suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
