import { useState, useCallback } from "react";
import { Nav } from "./components/Nav";
import { Hero } from "./components/Hero";
import { HowItWorks } from "./components/HowItWorks";
import { CorrectionLoop } from "./components/CorrectionLoop";
import { Trust } from "./components/Trust";
import { Architecture } from "./components/Architecture";
import { FinalCta, Footer, DemoDialog } from "./components/Closing";

export default function App() {
  const [demo, setDemo] = useState(false);
  const openDemo = useCallback(() => setDemo(true), []);
  const closeDemo = useCallback(() => setDemo(false), []);
  return (
    <>
      <Nav onDemo={openDemo} />
      <main>
        <Hero onDemo={openDemo} />
        <HowItWorks />
        <CorrectionLoop />
        <Trust />
        <Architecture />
        <FinalCta onDemo={openDemo} />
      </main>
      <Footer />
      <DemoDialog open={demo} onClose={closeDemo} />
    </>
  );
}
