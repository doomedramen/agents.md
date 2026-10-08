# rulepacks launch video

A 29-second landscape composition showing reusable agent instructions and the update-review workflow.

From `composition/`, run `npx hyperframes preview --background` to review. After preview approval, render with `npx hyperframes render --quality delivery --output ../brag.mp4`.

Final export and poster are pending preview approval. Suggested poster: the settled final card at 27.8 seconds. Extract the poster and replace only frame zero after export, following the brag delivery workflow.

## Validation

Hyperframes check passes with zero errors, including runtime, layout, and 79 WCAG AA contrast checks. Six structural advisory warnings remain for the intentionally small, five-scene single-file composition.

## Assets

- `assets/gsap.min.js`: GSAP 3.14.2, fetched from the package CDN; license reference appears in its header.
- `assets/music.mp3`: bundled brag track, Happy Beats / Business Moves vol. 10 by ende.app.
- `assets/click.ogg` and `assets/hit.ogg`: bundled brag Kenney SFX.
- `compositions/components/typed-prompt.html`: Hyperframes registry reference for deterministic typing. The main composition uses a simpler per-character opacity reveal.

No voiceover. Audio-reactive extraction was unavailable because the local Python runtime lacks numpy; the animation uses fixed musical cues instead.

## Assembly revision
User requested an additional visual explanation. Added 8 seconds at 10–18s, extending the film to 29 seconds so the assembly remains readable. TypeScript conventions, Prisma data access, and local .agents/project.md notes move as intact sheets into AGENTS.md, preserving their text and order. Shared excerpts come from examples/packages; the illustrative local note uses this repository’s real npm run check command. Review now runs 18–24s; outro 24–29s. Music and final fade extend accordingly. Final export remains pending revised preview approval.
