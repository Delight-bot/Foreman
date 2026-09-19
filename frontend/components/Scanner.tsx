"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button, inputCls } from "./ui";

interface Detector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}

/** Reads an asset tag from a QR code: either a Foreman link (…#/ask?asset=CV-12) or the bare tag. */
export function tagFromQr(raw: string): string {
  const m = raw.match(/[?&]asset=([^&#]+)/);
  return decodeURIComponent(m ? m[1] : raw).trim().toUpperCase();
}

export function Scanner({ onTag, onClose }: { onTag: (tag: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const Ctor = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;

  useEffect(() => {
    if (!Ctor) return;
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    const detector = new Ctor({ formats: ["qr_code"] });
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then(async (s) => {
        stream = s;
        if (!video.current || stopped) return;
        video.current.srcObject = s;
        await video.current.play();
        const tick = async () => {
          if (stopped || !video.current) return;
          try {
            const codes = await detector.detect(video.current);
            if (codes.length) {
              onTag(tagFromQr(codes[0].rawValue));
              return;
            }
          } catch {
            /* frame not ready */
          }
          raf = requestAnimationFrame(tick);
        };
        tick();
      })
      .catch(() => setError("Camera permission is blocked. Enter the tag below instead."));
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [Ctor, onTag]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/60 p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label="Scan asset tag">
      <div className="w-full max-w-[440px] rounded-t-2xl bg-paper p-5 sm:rounded-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-[18px] font-semibold">Scan the asset tag</h2>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 hover:bg-rule/60">
            <X size={20} />
          </button>
        </div>
        {Ctor && !error ? (
          <div className="relative mt-4 aspect-square overflow-hidden rounded-lg bg-ink">
            <video ref={video} className="h-full w-full object-cover" muted playsInline />
            <div className="pointer-events-none absolute inset-[18%] rounded-lg border-[3px] border-orange" />
          </div>
        ) : (
          <p className="mt-3 text-[14px] text-ink-2">
            {error ??
              "This browser cannot read QR codes in the page. Point your phone's camera app at the tag: it opens Foreman on that machine. Or type the tag."}
          </p>
        )}
        <form
          className="mt-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (manual.trim()) onTag(tagFromQr(manual));
          }}
        >
          <input className={inputCls} placeholder="Tag, e.g. CV-12" value={manual} onChange={(e) => setManual(e.target.value)} aria-label="Asset tag" />
          <Button type="submit" disabled={!manual.trim()}>
            Open
          </Button>
        </form>
      </div>
    </div>
  );
}
