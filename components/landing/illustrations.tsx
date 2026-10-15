// The page's drawings. Inline SVG, drawn rather than captured, and unlabelled:
// a node that read `features/arena` would be a claim about somebody's code.
//
// They define no colour. Every stroke and fill is one of the product's own
// tokens, the ones the canvas reads, so the drawings follow the theme control
// and mean what the canvas means: green is incoming, amber is outgoing, blue is
// the selection, the category hues are the rail's. Static: nothing animates.

const T = {
  idle: "var(--muted)",
  incoming: "var(--incoming)",
  outgoing: "var(--outgoing)",
  accent: "var(--accent)",
  border: "var(--border)",
  surface: "var(--surface)",
  background: "var(--background)",
} as const;

type Tone = "idle" | "incoming" | "outgoing" | "accent";
const TONES: readonly Tone[] = ["idle", "incoming", "outgoing", "accent"];

const cat = (n: number): string => `var(--cat-${n})`;

/** One arrowhead per tone, so an edge's head takes the edge's colour. */
function Defs({ id }: { id: string }) {
  return (
    <defs>
      {TONES.map((tone) => (
        <marker
          key={tone}
          id={`${id}-${tone}`}
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="8"
          markerHeight="8"
          orient="auto"
        >
          <path d="M0 1 L9 5 L0 9 z" style={{ fill: T[tone] }} />
        </marker>
      ))}
    </defs>
  );
}

function Edge({
  id,
  d,
  tone = "idle",
  faint = false,
}: {
  id: string;
  d: string;
  tone?: Tone;
  faint?: boolean;
}) {
  return (
    <path
      d={d}
      fill="none"
      strokeWidth={tone === "idle" ? 1.25 : 1.75}
      markerEnd={`url(#${id}-${tone})`}
      style={{ stroke: T[tone], opacity: faint ? 0.35 : tone === "idle" ? 0.55 : 1 }}
    />
  );
}

/** A folder node: a header, and one row per file with its category colour. */
function Folder({
  x,
  y,
  w = 120,
  rows,
  tone = "idle",
}: {
  x: number;
  y: number;
  w?: number;
  /** [category 1-12, line length 0-1] per file row. */
  rows: readonly (readonly [number, number])[];
  tone?: Tone;
}) {
  const h = 36 + rows.length * 16;
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={6}
        strokeWidth={tone === "idle" ? 1 : 2}
        style={{ fill: T.surface, stroke: tone === "idle" ? T.border : T[tone] }}
      />
      <rect x={x + 10} y={y + 11} width={44} height={5} rx={2.5} style={{ fill: T.idle, opacity: 0.55 }} />
      {rows.map(([c, len], i) => (
        <g key={i}>
          <rect x={x + 10} y={y + 28 + i * 16} width={8} height={8} rx={2} style={{ fill: cat(c) }} />
          <rect
            x={x + 24}
            y={y + 30 + i * 16}
            width={Math.round((w - 40) * len)}
            height={4}
            rx={2}
            style={{ fill: T.idle, opacity: 0.35 }}
          />
        </g>
      ))}
    </g>
  );
}

/** A single file, smaller: used where the drawing is about one file's reach. */
function File({
  x,
  y,
  c,
  tone = "idle",
  faint = false,
}: {
  x: number;
  y: number;
  c: number;
  tone?: Tone;
  faint?: boolean;
}) {
  return (
    <g style={{ opacity: faint ? 0.5 : 1 }}>
      <rect
        x={x}
        y={y}
        width={76}
        height={26}
        rx={5}
        strokeWidth={tone === "idle" ? 1 : 1.75}
        style={{ fill: T.surface, stroke: tone === "idle" ? T.border : T[tone] }}
      />
      <rect x={x + 9} y={y + 9} width={8} height={8} rx={2} style={{ fill: cat(c) }} />
      <rect x={x + 23} y={y + 11} width={40} height={4} rx={2} style={{ fill: T.idle, opacity: 0.4 }} />
    </g>
  );
}

const svgProps = {
  role: "img",
  className: "h-auto w-full",
  xmlns: "http://www.w3.org/2000/svg",
} as const;

// --- the hero: a map with one file selected --------------------------------------

export function MapIllustration() {
  const id = "map";
  return (
    <svg
      {...svgProps}
      viewBox="0 0 560 380"
      aria-label="Une carte de dossiers reliés par des imports, avec un fichier sélectionné"
    >
      <Defs id={id} />
      {/* idle */}
      <Edge id={id} d="M160 70 L230 70" />
      <Edge id={id} d="M350 72 C380 72 380 84 410 84" />
      <Edge id={id} d="M440 250 L440 118" />
      {/* incoming to the selection */}
      <Edge id={id} d="M100 124 C100 180 150 180 150 240" tone="incoming" />
      <Edge id={id} d="M270 120 C270 180 200 180 200 240" tone="incoming" />
      {/* outgoing from it */}
      <Edge id={id} d="M230 290 L330 290" tone="outgoing" />
      <Edge id={id} d="M230 256 C340 220 470 220 470 118" tone="outgoing" />

      <Folder x={40} y={40} rows={[[1, 0.9], [2, 0.6], [1, 0.75]]} />
      <Folder x={230} y={20} rows={[[5, 0.8], [5, 0.5], [6, 0.9], [2, 0.65]]} />
      <Folder x={410} y={50} rows={[[3, 0.7], [8, 0.9]]} />
      <Folder x={110} y={240} rows={[[1, 0.85], [4, 0.6], [4, 0.9], [7, 0.5]]} tone="accent" />
      <Folder x={330} y={250} rows={[[9, 0.6], [2, 0.8], [10, 0.5]]} />
    </svg>
  );
}

// --- what it does: the reach of one file ------------------------------------------

export function ReachIllustration() {
  const id = "reach";
  return (
    <svg
      {...svgProps}
      viewBox="0 0 560 300"
      aria-label="Un fichier, les fichiers qui l'importent à gauche et ceux qu'il importe à droite"
    >
      <Defs id={id} />
      {/* two hops upstream: what breaks */}
      <Edge id={id} d="M96 40 C130 40 130 74 160 74" tone="incoming" faint />
      <Edge id={id} d="M96 100 L160 100" tone="incoming" faint />
      <Edge id={id} d="M96 160 C130 160 130 126 160 126" tone="incoming" faint />
      <Edge id={id} d="M96 220 C130 220 130 200 160 200" tone="incoming" faint />
      {/* direct importers */}
      <Edge id={id} d="M236 87 C262 87 262 137 282 137" tone="incoming" />
      <Edge id={id} d="M236 139 L282 150" tone="incoming" />
      <Edge id={id} d="M236 213 C262 213 262 163 282 163" tone="incoming" />
      {/* what it imports */}
      <Edge id={id} d="M358 143 C390 143 390 100 424 100" tone="outgoing" />
      <Edge id={id} d="M358 157 C390 157 390 200 424 200" tone="outgoing" />

      <File x={20} y={27} c={2} faint />
      <File x={20} y={87} c={1} faint />
      <File x={20} y={147} c={5} faint />
      <File x={20} y={207} c={2} faint />
      <File x={160} y={74} c={1} tone="incoming" />
      <File x={160} y={126} c={4} tone="incoming" />
      <File x={160} y={200} c={6} tone="incoming" />
      <File x={282} y={137} c={7} tone="accent" />
      <File x={424} y={87} c={8} tone="outgoing" />
      <File x={424} y={187} c={3} tone="outgoing" />
    </svg>
  );
}

// --- how it works: read, resolve, explain -----------------------------------------

function Panel({ x, children }: { x: number; children: React.ReactNode }) {
  return (
    <g>
      <rect x={x} y={10} width={150} height={140} rx={8} style={{ fill: T.surface, stroke: T.border }} />
      {children}
    </g>
  );
}

export function StepsIllustration() {
  const id = "steps";
  return (
    <svg
      {...svgProps}
      viewBox="0 0 560 160"
      aria-label="Trois étapes : lire les fichiers, résoudre les imports, dessiner la carte"
    >
      <Defs id={id} />
      {/* 1 — files */}
      <Panel x={5}>
        {[1, 2, 2, 5, 1, 6].map((c, i) => (
          <g key={i}>
            <rect x={25} y={26 + i * 19} width={8} height={8} rx={2} style={{ fill: cat(c) }} />
            <rect
              x={41}
              y={28 + i * 19}
              width={[70, 52, 84, 60, 76, 46][i]}
              height={4}
              rx={2}
              style={{ fill: T.idle, opacity: 0.4 }}
            />
          </g>
        ))}
      </Panel>
      <path d="M160 80 L198 80" fill="none" strokeWidth={1.5} markerEnd={`url(#${id}-idle)`} style={{ stroke: T.idle }} />
      {/* 2 — a tree of what was read */}
      <Panel x={205}>
        <path
          d="M280 34 L280 52 M280 52 L246 76 M280 52 L314 76 M246 76 L230 106 M246 76 L262 106 M314 76 L314 106 M314 76 L338 106"
          fill="none"
          strokeWidth={1.25}
          style={{ stroke: T.idle, opacity: 0.6 }}
        />
        {[
          [280, 30, 2],
          [246, 76, 1],
          [314, 76, 5],
          [230, 112, 4],
          [262, 112, 7],
          [314, 112, 2],
          [338, 112, 6],
        ].map(([cx, cy, c], i) => (
          <circle key={i} cx={cx} cy={cy} r={6} style={{ fill: cat(c) }} />
        ))}
      </Panel>
      <path d="M360 80 L398 80" fill="none" strokeWidth={1.5} markerEnd={`url(#${id}-idle)`} style={{ stroke: T.idle }} />
      {/* 3 — the map */}
      <Panel x={405}>
        <path d="M444 54 L474 54" fill="none" strokeWidth={1.5} markerEnd={`url(#${id}-accent)`} style={{ stroke: T.accent }} />
        <path
          d="M444 106 C456 106 456 54 474 54"
          fill="none"
          strokeWidth={1.25}
          markerEnd={`url(#${id}-idle)`}
          style={{ stroke: T.idle, opacity: 0.55 }}
        />
        <path d="M486 66 L486 96" fill="none" strokeWidth={1.5} markerEnd={`url(#${id}-outgoing)`} style={{ stroke: T.outgoing }} />
        <rect x={420} y={44} width={24} height={20} rx={4} style={{ fill: T.background, stroke: T.border }} />
        <rect x={474} y={44} width={24} height={20} rx={4} strokeWidth={2} style={{ fill: T.background, stroke: T.accent }} />
        <rect x={420} y={96} width={24} height={20} rx={4} style={{ fill: T.background, stroke: T.border }} />
        <rect x={474} y={100} width={24} height={20} rx={4} style={{ fill: T.background, stroke: T.border }} />
        <rect x={428} y={50} width={8} height={8} rx={2} style={{ fill: cat(2) }} />
        <rect x={482} y={50} width={8} height={8} rx={2} style={{ fill: cat(1) }} />
        <rect x={428} y={102} width={8} height={8} rx={2} style={{ fill: cat(5) }} />
        <rect x={482} y={106} width={8} height={8} rx={2} style={{ fill: cat(6) }} />
      </Panel>
    </svg>
  );
}

// --- frameworks: roles from conventions -------------------------------------------

export function RolesIllustration() {
  // Four groups, one per framework the product knows, each a different spread
  // of the rail's category colours. Nothing says which is which.
  const groups: readonly (readonly (readonly [number, number])[])[] = [
    [[1, 0.9], [2, 0.6], [5, 0.75], [6, 0.5]],
    [[3, 0.7], [4, 0.9], [7, 0.55], [8, 0.8]],
    [[9, 0.8], [2, 0.5], [10, 0.7]],
    [[11, 0.6], [1, 0.85], [5, 0.5], [12, 0.7]],
  ];
  return (
    <svg
      {...svgProps}
      viewBox="0 0 360 250"
      aria-label="Quatre groupes de fichiers, chacun réparti en rôles"
    >
      {groups.map((rows, i) => {
        const x = 10 + (i % 2) * 175;
        const y = 10 + Math.floor(i / 2) * 118;
        return (
          <g key={i}>
            <rect x={x} y={y} width={165} height={108} rx={8} style={{ fill: T.surface, stroke: T.border }} />
            {rows.map(([c, len], j) => (
              <g key={j}>
                <rect x={x + 14} y={y + 16 + j * 20} width={10} height={10} rx={2.5} style={{ fill: cat(c) }} />
                <rect
                  x={x + 32}
                  y={y + 19 + j * 20}
                  width={Math.round(110 * len)}
                  height={4}
                  rx={2}
                  style={{ fill: T.idle, opacity: 0.4 }}
                />
              </g>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

// --- what it refuses: a guessed link is not drawn ---------------------------------

export function RefusalIllustration() {
  const id = "refusal";
  return (
    <svg
      {...svgProps}
      viewBox="0 0 360 200"
      aria-label="Un lien résolu est tracé, un lien deviné ne l'est pas"
    >
      <Defs id={id} />
      {/* a resolved import: drawn */}
      <File x={30} y={34} c={1} />
      <File x={254} y={34} c={2} />
      <Edge id={id} d="M106 47 L254 47" tone="idle" />
      {/* a guess: two files and no line between them */}
      <File x={30} y={130} c={5} />
      <File x={254} y={130} c={6} />
      <path
        d="M118 143 L242 143"
        fill="none"
        strokeWidth={1.25}
        strokeDasharray="3 6"
        style={{ stroke: T.idle, opacity: 0.35 }}
      />
      <path d="M170 131 L190 155" fill="none" strokeWidth={1.75} strokeLinecap="round" style={{ stroke: T.idle }} />
    </svg>
  );
}
