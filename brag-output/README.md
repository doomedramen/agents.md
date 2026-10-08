# rulepacks launch video

A 21-second landscape composition showing reusable agent instructions and the update-review workflow.

From `composition/`, run `npx hyperframes preview --background` to review. After preview approval, render with `npx hyperframes render --quality delivery --output ../brag.mp4`.

Final export and poster are pending preview approval. Suggested poster: the settled final card at 19.8 seconds. Extract the poster and replace only frame zero after export, following the brag delivery workflow.

## Validation

Hyperframes check passes with zero errors, including runtime, layout, and 123 WCAG AA contrast checks. Five structural advisory warnings remain for the intentionally small, four-scene single-file composition.

## Assets

- `assets/gsap.min.js`: GSAP 3.14.2, fetched from the package CDN; license reference appears in its header.
- `assets/music.mp3`: bundled brag track, Happy Beats / Business Moves vol. 10 by ende.app.
- `assets/click.ogg` and `assets/hit.ogg`: bundled brag Kenney SFX.
- `compositions/components/typed-prompt.html`: Hyperframes registry reference for deterministic typing. The main composition uses a simpler per-character opacity reveal.

No voiceover. Audio-reactive extraction was unavailable because the local Python runtime lacks numpy; the animation uses fixed musical cues instead.
