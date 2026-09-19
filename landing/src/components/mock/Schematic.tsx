/**
 * The relay-board schematic from the presentation (K1 and K2 in parallel feeding K3, pins 13 and 14).
 * `highlight` picks which relay carries the orange evidence marker; `revised` draws the 2023
 * layout where K4 sits where K3 used to be.
 */
export function Schematic({
  highlight = "K3",
  revised = false,
  width = 276,
  className = "",
}: {
  highlight?: "K3" | "K4" | null;
  revised?: boolean;
  width?: number;
  className?: string;
}) {
  const ink = "#1b2028";
  const acc = "#e5682b";
  const main = revised ? "K4" : "K3";
  const isHi = highlight === main;
  return (
    <svg
      viewBox="0 0 276 88"
      width={width}
      height={(width * 88) / 276}
      className={className}
      fill="none"
      stroke={ink}
      strokeWidth="1.6"
      strokeLinecap="round"
      role="img"
      aria-label={`Wiring figure with relays K1, K2 and ${main}; ${isHi ? main + " highlighted" : "no highlight"}`}
    >
      <path d="M10 44h40M50 44v-22h30M50 44v22h30M110 22h40M110 66h40M150 22v44M150 44h40" />
      <rect x="80" y="10" width="30" height="24" rx="3" />
      <rect x="80" y="54" width="30" height="24" rx="3" />
      {revised ? (
        <>
          {/* 2023 revision: relay moved right of the contactor */}
          <rect x="190" y="30" width="22" height="28" rx="3" strokeDasharray="2 2" opacity="0.45" />
          <path d="M212 44h14" />
          <rect x="226" y="30" width="34" height="28" rx="3" stroke={isHi ? acc : ink} strokeWidth={isHi ? 2.4 : 1.6} />
          {isHi && <rect x="220" y="24" width="46" height="40" rx="6" stroke={acc} strokeDasharray="3 3" />}
          <path d="M260 44h6" />
        </>
      ) : (
        <>
          <rect x="190" y="30" width="34" height="28" rx="3" stroke={isHi ? acc : ink} strokeWidth={isHi ? 2.4 : 1.6} />
          {isHi && <rect x="184" y="24" width="46" height="40" rx="6" stroke={acc} strokeDasharray="3 3" />}
          <path d="M224 44h32M256 32v24" />
          <circle cx="256" cy="32" r="2.5" fill={ink} />
          <circle cx="256" cy="56" r="2.5" fill={ink} />
        </>
      )}
      <circle cx="10" cy="44" r="3" fill={ink} />
      <g fontFamily="IBM Plex Mono, monospace" stroke="none" fill={ink}>
        <text x="87" y="26" fontSize="9">K1</text>
        <text x="87" y="70" fontSize="9">K2</text>
        {revised ? (
          <>
            <text x="194" y="48" fontSize="7" opacity="0.5">old</text>
            <text x="235" y="48" fontSize="10" fontWeight="600" fill={isHi ? acc : ink}>K4</text>
          </>
        ) : (
          <>
            <text x="199" y="48" fontSize="10" fontWeight="600" fill={isHi ? acc : ink}>K3</text>
            <text x="238" y="40" fontSize="8">13</text>
            <text x="238" y="66" fontSize="8">14</text>
          </>
        )}
      </g>
    </svg>
  );
}
