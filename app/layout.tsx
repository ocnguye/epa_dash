import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

export const metadata: Metadata = {
  title: "EPA Dashboard",
  description: "A web-based platform designed to analyze the progress and performance of Interventional Radiology (IR) trainees.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
       <head>
        <link
          href="https://fonts.googleapis.com/css?family=Ubuntu:400,700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body
        className={`--font-ubuntu-sans antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
