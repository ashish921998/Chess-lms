import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const anthropicSans = localFont({
  src: "./fonts/anthropic-sans-variable.ttf",
  variable: "--font-anthropic-sans",
  display: "swap",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "Knight Riders Chess Academy — Think deeper. Play braver.",
  description:
    "Purposeful chess training, expert guidance, and visible progress for ambitious players.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${anthropicSans.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
