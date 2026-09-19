import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { Nav } from "@/components/Nav";
import { NavigationBridge } from "@/lib/hooks";
import "./globals.css";

const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-sans" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono" });

export const metadata: Metadata = {
  title: "Foreman",
  description: "Troubleshooting procedures with the page they came from.",
};

export const viewport: Viewport = { themeColor: "#f3f1ec", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <NavigationBridge />
        <div className="min-h-screen pb-20 md:pb-0">
          <Nav />
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
