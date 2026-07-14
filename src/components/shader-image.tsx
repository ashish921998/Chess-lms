"use client";

import dynamic from "next/dynamic";

/**
 * Renders an image behind a fluted-glass shader (@paper-design/shaders-react).
 * The photo stays fully visible, with a subtle vertical ribbed refraction —
 * like looking through a reeded glass panel. Low distortion keeps the board
 * and pieces clearly readable while adding tactile depth.
 *
 * Loaded with ssr: false because WebGL is browser-only; the parent provides a
 * solid paper background so there's no layout shift before hydration.
 */
const FlutedGlass = dynamic(
  () => import("@paper-design/shaders-react").then((m) => m.FlutedGlass),
  { ssr: false },
);

export function ShaderImage({
  src,
  className,
}: {
  src: string;
  className?: string;
}) {
  return (
    <FlutedGlass
      image={src}
      className={className}
      fit="cover"
      shape="lines"
      distortionShape="lens"
      angle={90}
      size={0.5}
      distortion={0.35}
      shift={0.1}
      stretch={0.15}
      blur={0.08}
      edges={0.15}
      shadows={0.12}
      highlights={0.08}
      grainOverlay={0.04}
    />
  );
}
