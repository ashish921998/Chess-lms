import { ShaderImage } from "@/components/shader-image";

/**
 * Shared split-screen shell for the auth pages (login + signup).
 *
 * Left half: the chess photo rendered as a halftone dot pattern (WebGL shader,
 * ink-on-paper) with an editorial caption overlay. Right half: the form content
 * (passed as children), centered on warm paper.
 *
 * On screens below 768px the image collapses to a short banner above the form
 * so the page stays usable on phones.
 *
 * Stays on the Paper Mono design system: warm paper, ink text, rust accent,
 * square corners, hairline borders, Georgia serif + Geist mono.
 */
export function AuthShell({
  image,
  imageAlt,
  caption,
  children,
}: {
  image: string;
  imageAlt: string;
  caption: string;
  children: React.ReactNode;
}) {
  return (
    <main className="grid min-h-svh w-full grid-cols-1 md:grid-cols-2">
      {/* Visual half — the photo behind fluted glass; the aside has a paper
          background so there's no flash before the WebGL canvas hydrates. */}
      <aside
        className="relative hidden bg-paper md:block"
        aria-label={imageAlt}
      >
        <ShaderImage src={image} className="absolute inset-0 h-full w-full" />
        {/* tint so the caption reads on the visible photo; darker toward the
            bottom where the caption sits */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, rgba(42,40,36,0.15) 0%, rgba(42,40,36,0.05) 35%, rgba(42,40,36,0.65) 100%)",
          }}
          aria-hidden="true"
        />
        {/* editorial caption, bottom-left */}
        <div className="absolute inset-x-0 bottom-0 p-10 text-paper">
          <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.14em] text-[#e6dccb]">
            <span className="h-px w-8 bg-rust" />
            Knight Riders Chess Academy
          </div>
          <p className="mt-4 max-w-md font-serif text-2xl leading-snug tracking-tight">
            {caption}
          </p>
        </div>
      </aside>

      {/* Mobile banner — a short slice of the image on small screens */}
      <div className="relative h-32 bg-paper md:hidden" aria-label={imageAlt}>
        <ShaderImage src={image} className="absolute inset-0 h-full w-full" />
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, rgba(42,40,36,0.2) 0%, rgba(42,40,36,0.5) 100%)",
          }}
          aria-hidden="true"
        />
      </div>

      {/* Form half */}
      <section className="flex flex-col justify-center bg-paper px-6 py-14 sm:px-12 md:px-16 lg:px-20">
        <div className="mx-auto w-full max-w-sm">{children}</div>
      </section>
    </main>
  );
}
