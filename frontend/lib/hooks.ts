"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

let push: ((url: string) => void) | null = null;

/** Mounted once in the layout so plain event handlers can navigate with the Next.js router. */
export function NavigationBridge() {
  const router = useRouter();
  useEffect(() => {
    push = router.push;
  }, [router]);
  return null;
}

export function navigate(path: string, params?: Record<string, string>) {
  const url = path + (params ? "?" + new URLSearchParams(params).toString() : "");
  if (push) push(url);
  else window.location.assign(url);
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const run = useCallback(() => {
    setLoading(true);
    return fn()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    run();
  }, [run]);
  return { data, error, loading, reload: run, setData };
}

// Minimal typing for the Web Speech API, which TypeScript's DOM lib does not ship.
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

/** Push-to-talk dictation. Works in Chrome, Edge and Safari; hidden elsewhere. */
export function useSpeech(onText: (text: string) => void) {
  // Resolved after mount, so the server render and the first client render agree.
  const [Ctor, setCtor] = useState<unknown>(undefined);
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    setCtor(() => w.SpeechRecognition || w.webkitSpeechRecognition);
  }, []);
  const supported = Boolean(Ctor);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<SpeechRecognitionLike | null>(null);
  const cb = useRef(onText);
  cb.current = onText;

  const stop = useCallback(() => rec.current?.stop(), []);
  const start = useCallback(() => {
    if (!Ctor) return;
    setError(null);
    const r = new (Ctor as new () => SpeechRecognitionLike)();
    r.lang = navigator.language || "en-US";
    r.interimResults = true;
    r.continuous = false;
    r.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      cb.current(text);
    };
    r.onerror = (e) =>
      setError(e.error === "not-allowed" ? "Microphone permission is blocked." : e.error === "no-speech" ? null : `Voice input failed (${e.error}).`);
    r.onend = () => setListening(false);
    rec.current = r;
    r.start();
    setListening(true);
  }, [Ctor]);

  useEffect(() => () => rec.current?.stop(), []);
  return { supported, listening, start, stop, error };
}

/** Downscale a phone photo before upload: faster on plant Wi-Fi, and plenty for reading a label. */
export async function shrinkImage(file: File, max = 1600): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 1_500_000) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((res) => canvas.toBlob((b) => res(b ?? file), "image/jpeg", 0.85));
  } catch {
    return file;
  }
}

/** True on screens where evidence opens as a side panel rather than a bottom sheet (Tailwind's lg). */
export function useWide(query = "(min-width: 1024px)") {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setWide(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [query]);
  return wide;
}
