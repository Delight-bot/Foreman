import { Smartphone, Monitor, ClipboardList, MessageSquare, Activity } from "lucide-react";
import { Section, Heading } from "./ui";

const access = [
  { icon: Smartphone, name: "Technician phone or tablet", text: "Scan, ask, photograph. Manuals for assigned assets cached for use with no signal." },
  { icon: Monitor, name: "Desktop research interface", text: "Long-form answers, side-by-side evidence viewer, reasoning across revisions." },
  { icon: ClipboardList, name: "CMMS work orders", text: "Open a work order and the assistant is already scoped to that asset; answers attach back to the ticket." },
  { icon: MessageSquare, name: "Teams or Slack", text: "Triage cards and owner escalations land in the channel the team already watches." },
  { icon: Activity, name: "PLC alarms", text: "An alarm can open a triage card before a technician is dispatched." },
];

export function Architecture() {
  return (
    <Section id="architecture" dots className="border-t border-rule">
      <Heading
        title="One intelligence layer inside the plant. Multiple ways to access it."
        lede="Drawings and procedures are proprietary. The proposed architecture keeps the documents, the index, and the answers on the plant network, and reaches technicians through the tools they already use."
      />

      <Diagram />

      <ul className="mt-14 grid gap-x-10 gap-y-8 md:grid-cols-2 lg:grid-cols-3">
        {access.map((a) => (
          <li key={a.name} className="border-t-[1.5px] border-ink pt-4">
            <div className="flex items-center gap-2.5 text-[17px] font-semibold">
              <a.icon size={20} className="text-orange" /> {a.name}
            </div>
            <p className="mt-2 text-[15px] leading-snug text-ink-2">{a.text}</p>
          </li>
        ))}
        <li className="border-t-[1.5px] border-orange pt-4">
          <div className="text-[17px] font-semibold">What stays inside</div>
          <p className="mt-2 text-[15px] leading-snug text-ink-2">
            The verified library, the search index, the asset graph, page images, answer history, and technician fix notes.
          </p>
        </li>
      </ul>
    </Section>
  );
}

function Diagram() {
  const ink = "#1b2028";
  const acc = "#e5682b";
  const paper = "#fbfaf7";
  const font = "IBM Plex Sans, sans-serif";
  const mono = "IBM Plex Mono, monospace";
  const Node = ({ x, y, w, label, sub, stroke = ink }: { x: number; y: number; w: number; label: string; sub?: string; stroke?: string }) => (
    <g>
      <rect x={x} y={y} width={w} height={sub ? 64 : 52} rx="8" fill={paper} stroke={stroke} strokeWidth="2.5" />
      <text x={x + w / 2} y={y + (sub ? 27 : 32)} textAnchor="middle" fontFamily={font} fontSize="16" fontWeight="600" fill={ink}>{label}</text>
      {sub && <text x={x + w / 2} y={y + 49} textAnchor="middle" fontFamily={font} fontSize="13" fill="#4b5563">{sub}</text>}
    </g>
  );
  return (
    <div className="overflow-x-auto">
      <svg viewBox="0 0 1000 420" className="w-full min-w-[720px]" role="img" aria-label="Foreman running inside the plant network, reached by a technician phone, a desktop, the CMMS, Teams or Slack, and PLC alarms">
        <defs>
          <marker id="arch-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill={ink} /></marker>
        </defs>
        {/* plant boundary */}
        <rect x="250" y="20" width="730" height="380" rx="12" fill="none" stroke={ink} strokeWidth="2" strokeDasharray="10 8" />
        <text x="960" y="46" textAnchor="end" fontFamily={mono} fontSize="12" fill={ink} letterSpacing="1">PLANT NETWORK</text>

        {/* core */}
        <rect x="420" y="120" width="300" height="200" rx="10" fill={ink} />
        <text x="570" y="160" textAnchor="middle" fontFamily={font} fontSize="24" fontWeight="600" fill="#f3f1ec">Foreman</text>
        <text x="570" y="188" textAnchor="middle" fontFamily={font} fontSize="14" fill="#c9ced6">verified library and index</text>
        <g fontFamily={mono} fontSize="11" fill="#f3f1ec">
          <rect x="445" y="212" width="120" height="30" rx="4" fill="none" stroke="#f3f1ec" strokeOpacity="0.5" />
          <text x="505" y="231" textAnchor="middle">manuals, drawings</text>
          <rect x="575" y="212" width="120" height="30" rx="4" fill="none" stroke="#f3f1ec" strokeOpacity="0.5" />
          <text x="635" y="231" textAnchor="middle">search index</text>
          <rect x="445" y="252" width="120" height="30" rx="4" fill="none" stroke="#f3f1ec" strokeOpacity="0.5" />
          <text x="505" y="271" textAnchor="middle">asset graph</text>
          <rect x="575" y="252" width="120" height="30" rx="4" fill="none" stroke={acc} />
          <text x="635" y="271" textAnchor="middle" fill={acc}>fix notes</text>
        </g>

        {/* access points */}
        <Node x={20} y={60} w={200} label="Technician phone" sub="scan, ask, photo; offline cache" stroke={acc} />
        <Node x={20} y={300} w={200} label="Desktop" sub="research mode" />
        <Node x={780} y={70} w={180} label="CMMS work orders" />
        <Node x={780} y={200} w={180} label="Teams or Slack" />
        <Node x={780} y={330} w={180} label="PLC alarms" />

        {/* links */}
        <line x1="220" y1="92" x2="416" y2="170" stroke={acc} strokeWidth="2.5" markerStart="url(#arch-arrow)" markerEnd="url(#arch-arrow)" />
        <line x1="220" y1="332" x2="416" y2="270" stroke={ink} strokeWidth="2.5" markerStart="url(#arch-arrow)" markerEnd="url(#arch-arrow)" />
        <line x1="724" y1="170" x2="776" y2="96" stroke={ink} strokeWidth="2.5" markerStart="url(#arch-arrow)" markerEnd="url(#arch-arrow)" />
        <line x1="724" y1="220" x2="776" y2="226" stroke={ink} strokeWidth="2.5" markerEnd="url(#arch-arrow)" />
        <line x1="776" y1="356" x2="724" y2="280" stroke={ink} strokeWidth="2.5" markerEnd="url(#arch-arrow)" />

        {/* link labels */}
        <g fontFamily={font} fontSize="12" fill="#4b5563">
          <text x="300" y="118">question and photo in, procedure out</text>
          <text x="780" y="150">ticket in, triage card out</text>
          <text x="800" y="318">alarm in</text>
        </g>
      </svg>
    </div>
  );
}
