import { useEffect, useState } from "react";

/**
 * The height, in pixels, that the on-screen keyboard covers at the bottom of the
 * viewport — or 0 when the keyboard is closed.
 *
 * Uses the visualViewport API (supported on iOS Safari and Android Chrome, the
 * PWA targets). Where it is unavailable the hook stays at 0, so callers fall
 * back to their resting layout. Callers can pin a fixed element just above the
 * keyboard by using the returned value as its `bottom` offset.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      // How much shorter the visual viewport is than the layout viewport at the
      // bottom — i.e. the space taken by the keyboard. offsetTop accounts for
      // any visual-viewport shift (e.g. iOS pinning) so we don't over-count.
      const covered = window.innerHeight - vv.height - vv.offsetTop;
      setInset(Math.max(0, Math.round(covered)));
    };

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return inset;
}
