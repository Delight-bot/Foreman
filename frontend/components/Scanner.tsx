"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { Camera, Keyboard, TriangleAlert, X } from "lucide-react";
import { Button, inputCls, Spinner } from "./ui";

interface Detector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}

/** Reads an asset tag from a QR code: either a Foreman link (…/ask?asset=CV-12) or the bare tag. */
export function tagFromQr(raw: string): string {
  const m = raw.match(/[?&]asset=([^&#]+)/);
  return decodeURIComponent(m ? m[1] : raw).trim().toUpperCase();
}

/** Decode one frame. Uses the browser's own detector where there is one (Chrome, Edge),
 *  and jsQR everywhere else (Safari, Firefox), so scanning works on any phone. */
export async function decodeFrame(canvas: HTMLCanvasElement, detector: Detector | null): Promise<string | null> {
  if (detector) {
    try {
      const codes = await detector.detect(canvas);
      if (codes.length) return codes[0].rawValue;
    } catch {
      /* fall through to jsQR */
    }
  }
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx || !canvas.width || !canvas.height) return null;
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return jsQR(data, width, height, { inversionAttempts: "attemptBoth" })?.data ?? null;
}

type State = "starting" | "scanning" | "insecure" | "denied" | "nocamera";

export function Scanner({ onTag, onClose }: { onTag: (tag: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [state, setState] = useState<State>("starting");
  const [manual, setManual] = useState("");
  const found = useRef(false);
  const hit = useCallback(
    (raw: string) => {
      if (found.current) return;
      found.current = true;
      navigator.vibrate?.(60);
      onTag(tagFromQr(raw));
    },
    [onTag],
  );

  useEffect(() => {
    // The camera needs a secure context: HTTPS, or localhost on this machine.
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setState("insecure");
      return;
    }
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    const Ctor = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
    const detector = Ctor ? new Ctor({ formats: ["qr_code"] }) : null;
    canvas.current = document.createElement("canvas");

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } } })
      .then(async (s) => {
        stream = s;
        if (!video.current || stopped) return;
        video.current.srcObject = s;
        video.current.setAttribute("playsinline", "true"); // iOS: play in place, not full screen
        await video.current.play();
        setState("scanning");
        const tick = async () => {
          if (stopped || !video.current || !canvas.current) return;
          const v = video.current;
          if (v.videoWidth) {
            // Scan the whole frame, downscaled: a code near the edge of the view still reads,
            // and the box on screen is only an aiming guide.
            const scale = Math.min(1, 640 / Math.max(v.videoWidth, v.videoHeight));
            canvas.current.width = Math.round(v.videoWidth * scale);
            canvas.current.height = Math.round(v.videoHeight * scale);
            canvas.current
              .getContext("2d", { willReadFrequently: true })
              ?.drawImage(v, 0, 0, canvas.current.width, canvas.current.height);
            const raw = await decodeFrame(canvas.current, detector);
            if (raw) {
              hit(raw);
              return;
            }
          }
          raf = requestAnimationFrame(tick);
        };
        tick();
      })
      .catch((e: DOMException) => {
        setState(e?.name === "NotFoundError" || e?.name === "OverconstrainedError" ? "nocamera" : "denied");
      });

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [hit]);

  const live = state === "starting" || state === "scanning";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/60 p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label="Scan asset tag">
      <div className="w-full max-w-[440px] rounded-t-2xl bg-paper p-5 sm:rounded-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-[18px] font-semibold">Scan the asset tag</h2>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 hover:bg-rule/60">
            <X size={20} />
          </button>
        </div>

        {live ? (
          <div className="relative mt-4 aspect-square overflow-hidden rounded-lg bg-ink">
            <video ref={video} className="h-full w-full object-cover" muted playsInline />
            <div className="pointer-events-none absolute inset-[10%] rounded-lg border-[3px] border-orange" />
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 bg-ink/70 py-2 text-[13px] text-paper">
              {state === "starting" ? <><Spinner size={14} /> Starting the camera</> : <><Camera size={14} /> Point at the QR label</>}
            </div>
          </div>
        ) : (
          <Problem state={state} />
        )}

        <form
          className="mt-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (manual.trim()) onTag(tagFromQr(manual));
          }}
        >
          <label htmlFor="tag" className="mb-1 flex items-center gap-1.5 text-[13px] font-semibold">
            <Keyboard size={14} /> Or type the tag printed on the machine
          </label>
          <div className="flex gap-2">
            <input id="tag" className={inputCls} placeholder="CV-12" value={manual} onChange={(e) => setManual(e.target.value)} />
            <Button type="submit" disabled={!manual.trim()}>
              Open
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Problem({ state }: { state: State }) {
  const text = {
    insecure: (
      <>
        The camera only works over <b>HTTPS</b> (or on localhost). This page is served over plain HTTP, so the browser
        blocks it. Open Foreman through its HTTPS address, or scan the label with your phone's own camera app: the QR
        code opens Foreman on that machine.
      </>
    ),
    denied: <>Camera permission is blocked. Allow camera access for this site in your browser settings, then try again.</>,
    nocamera: <>No camera was found on this device. Use your phone, or type the tag below.</>,
    starting: null,
    scanning: null,
  }[state];
  return (
    <div className="mt-4 flex items-start gap-2 rounded-md border-[1.5px] border-orange bg-orange/10 px-3 py-3 text-[14px]">
      <TriangleAlert size={17} className="mt-0.5 shrink-0 text-orange" />
      <p>{text}</p>
    </div>
  );
}
