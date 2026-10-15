import Link from "next/link";
import type { ReactNode } from "react";
import { ThemeControl } from "@/components/theme-control";
import { HeroForm } from "./hero-form";
import {
  MapIllustration,
  ReachIllustration,
  RefusalIllustration,
  RolesIllustration,
  StepsIllustration,
} from "./illustrations";

// The signed-out page. It uses the product's own tokens, its own header look
// and its own theme control: nothing here defines a colour or a component the
// tool does not have. The only thing the marketing page adds is scale: larger
// type, wider spacing, a single column, and measure on every paragraph.
//
// Everything claimed below is something the tool does today and can be shown in
// the next thirty seconds. No testimonials, no logos, no pricing.

const COLUMN = "mx-auto w-full max-w-[1140px] px-6";

// Headings scale with the viewport and sit tight.
const H1 = "text-[clamp(2.25rem,5.6vw,4.25rem)] font-semibold leading-[1.08] tracking-[-0.035em]";
const H2 = "text-[clamp(1.75rem,3.4vw,2.75rem)] font-semibold leading-[1.1] tracking-[-0.03em]";

// Measure: ~46 characters beside a figure, ~64 across a full-width section.
const BESIDE = "max-w-[46ch]";
const ACROSS = "max-w-[64ch]";
const BODY = "text-base leading-relaxed text-muted";

function Section({ children }: { children: ReactNode }) {
  return (
    <section className="border-t border-border py-24 md:py-32">
      <div className={COLUMN}>{children}</div>
    </section>
  );
}

/** Text and figure, 5rem apart; stacked on a phone, figure last. */
function Split({
  text,
  figure,
  flip = false,
}: {
  text: ReactNode;
  figure: ReactNode;
  flip?: boolean;
}) {
  return (
    <div className="grid items-center gap-x-20 gap-y-12 md:grid-cols-2">
      <div className={`flex min-w-0 flex-col gap-6 ${flip ? "md:order-2" : ""}`}>{text}</div>
      <div className={`min-w-0 ${flip ? "md:order-1" : ""}`}>{figure}</div>
    </div>
  );
}

function Header() {
  return (
    <header className="sticky top-0 z-10 h-9 border-b border-border bg-surface">
      <div className={`${COLUMN} flex h-full items-center gap-3`}>
        <Link href="/" className="text-xs font-semibold">
          Cartograph
        </Link>
        <div className="ml-auto flex items-center gap-3">
          <ThemeControl />
          <Link
            href="/sign-in"
            className="rounded border border-border px-2 py-0.5 text-xs hover:border-accent hover:text-accent"
          >
            Se connecter
          </Link>
        </div>
      </div>
    </header>
  );
}

const REFUSALS: readonly { title: string; reason: string }[] = [
  {
    title: "Noter le code.",
    reason:
      "Pas de score, pas de note, pas de « problèmes détectés ». Cartograph explique un dépôt, il ne le juge pas.",
  },
  {
    title: "Deviner un lien.",
    reason:
      "Un lien existe parce qu'un import a été résolu vers un vrai fichier. Sinon il est compté, avec la raison pour laquelle il ne l'a pas été.",
  },
  {
    title: "Approcher une route.",
    reason:
      "Si la méthode et le chemin complet ne sont pas tous deux lisibles dans le code, aucune route n'est affichée.",
  },
  {
    title: "Lire un dépôt privé.",
    reason: "Pas encore : seuls les dépôts GitHub publics sont analysés.",
  },
  {
    title: "Lire autre chose que TypeScript et JavaScript.",
    reason: "Les autres langages d'un dépôt ne sont pas analysés.",
  },
];

const STEPS: readonly { n: string; title: string; text: string }[] = [
  {
    n: "1",
    title: "Lecture",
    text: "Le dépôt est téléchargé à un commit précis, et chaque fichier TypeScript ou JavaScript est analysé avec le compilateur TypeScript.",
  },
  {
    n: "2",
    title: "Résolution",
    text: "Un import devient un lien seulement s'il pointe vers un fichier réel. Les autres sont comptés, avec leur raison.",
  },
  {
    n: "3",
    title: "Explication",
    text: "Un modèle d'IA explique ce que l'analyse a trouvé. Il ne décide jamais de ce qui existe.",
  },
];

export function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />
      <main>
        {/* The hero takes most of the first screen. */}
        <section className="flex min-h-[calc(100svh-2.25rem)] items-center py-16 md:py-20">
          <div className={COLUMN}>
            <Split
              text={
                <>
                  <h1 className={H1}>Voyez ce que votre dépôt contient vraiment.</h1>
                  <p className={`${BODY} ${BESIDE}`}>
                    Collez l&apos;adresse d&apos;un dépôt GitHub public. Cartograph lit le code,
                    résout chaque import vers un vrai fichier et dessine la carte. Rien
                    n&apos;est deviné.
                  </p>
                  <HeroForm />
                </>
              }
              figure={<MapIllustration />}
            />
          </div>
        </section>

        <Section>
          <Split
            text={
              <>
                <h2 className={H2}>Une carte, et ce qui dépend de quoi.</h2>
                <p className={`${BODY} ${BESIDE}`}>
                  Les fichiers sont regroupés par dossier. Sélectionnez-en un : en vert, ce qui
                  l&apos;importe ; en ambre, ce qu&apos;il importe ; et plus loin, tout ce qui
                  casse si vous le modifiez.
                </p>
                <p className={`${BODY} ${BESIDE}`}>
                  Quand une convention de framework le permet, chaque fichier reçoit un rôle :
                  pages, routes, Controllers, Services. Un panneau explique un fichier ou un
                  dossier, et vous pouvez poser une question au dépôt.
                </p>
              </>
            }
            figure={<ReachIllustration />}
          />
        </Section>

        <Section>
          <div className="flex flex-col gap-16">
            <h2 className={`${H2} max-w-[20ch]`}>Trois étapes, aucune n&apos;est une estimation.</h2>
            <div className="mx-auto w-full max-w-[44rem]">
              <StepsIllustration />
            </div>
            <ol className="grid gap-x-20 gap-y-10 md:grid-cols-3">
              {STEPS.map((step) => (
                <li key={step.n} className="flex flex-col gap-3">
                  <span className="font-mono text-xs text-muted">{step.n}</span>
                  <h3 className="text-lg font-semibold tracking-tight">{step.title}</h3>
                  <p className={`${BODY} ${BESIDE}`}>{step.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </Section>

        <Section>
          <Split
            flip
            text={
              <>
                <h2 className={H2}>Les conventions de quatre frameworks.</h2>
                <p className={`${BODY} ${BESIDE}`}>
                  Next.js, NestJS, Express et React : leurs conventions donnent un rôle aux
                  fichiers et font apparaître les routes dont la méthode et le chemin complet sont
                  écrits dans le code.
                </p>
                <p className={`${BODY} ${BESIDE}`}>
                  Dans un monorepo, chaque package est reconnu séparément. Sans framework reconnu,
                  la carte des imports s&apos;affiche quand même, sans rôles ni routes.
                </p>
              </>
            }
            figure={<RolesIllustration />}
          />
        </Section>

        {/* The most interesting section goes last, where someone still reading
            will reach it. */}
        <Section>
          <div className="flex flex-col gap-16">
            <Split
              text={
                <>
                  <h2 className={H2}>Ce que Cartograph ne fait pas, exprès.</h2>
                  <p className={`${BODY} ${BESIDE}`}>
                    Chacun de ces refus protège la même chose : que tout ce qui est à
                    l&apos;écran vienne du code, et de rien d&apos;autre.
                  </p>
                </>
              }
              figure={<RefusalIllustration />}
            />
            <ul className="flex flex-col">
              {REFUSALS.map((item) => (
                <li
                  key={item.title}
                  className="grid gap-x-20 gap-y-2 border-t border-border py-6 md:grid-cols-2"
                >
                  <h3 className="text-lg font-semibold tracking-tight">{item.title}</h3>
                  <p className={`${BODY} ${ACROSS}`}>{item.reason}</p>
                </li>
              ))}
            </ul>
          </div>
        </Section>
      </main>

      <footer className="border-t border-border py-10">
        <div className={`${COLUMN} flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted`}>
          <span className="font-semibold text-foreground">Cartograph</span>
          <span>Le code est lu, pas deviné.</span>
          <Link href="/sign-in" className="ml-auto hover:text-accent">
            Se connecter
          </Link>
        </div>
      </footer>
    </div>
  );
}
