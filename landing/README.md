# Foreman landing page

React 19 + TypeScript + Tailwind CSS 4 + Lucide React, built with Vite.

```
npm install
npm run dev      # local dev server
npm run build    # dist/index.html, a single self-contained file
```

Structure:

- `src/components/Hero.tsx`, `HeroDemo.tsx`: hero copy and the four-step phone walkthrough (identify, describe, procedure, evidence)
- `src/components/HowItWorks.tsx`: the five-stage process with a visual per stage
- `src/components/CorrectionLoop.tsx`: the mismatch flow with both outcomes (revised, escalated) and the fix-note follow-up
- `src/components/Trust.tsx`: evidence chips that open the cited page with the region outlined; receipt fields; outcomes when information cannot be verified
- `src/components/Architecture.tsx`: plant-network deployment diagram and access points
- `src/components/Closing.tsx`: final call to action, footer, and the demo request dialog
- `src/components/mock/`: reusable product mockups: `PhoneFrame` (rugged case), `Schematic` (relay figure), `ManualPage` (page 47)
- `src/components/ui/`: buttons, section shell, headings, tags
- `src/index.css`: theme tokens (paper, ink, orange), fonts, dot grid, motion

Before launch: connect the form in `Closing.tsx` (`DemoDialog`) to your inbox or CRM. It currently only confirms in-session.
