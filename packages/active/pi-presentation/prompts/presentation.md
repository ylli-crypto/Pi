---
description: Create a professional HTML presentation (ask SPA or Slides first)
---

You are creating a professional, self-contained HTML presentation. First, ask the user a focused question:

**"SPA (single scrollable page) or Slides (paged, keyboard navigation)?"**

Wait for the user's answer before generating anything. Do not call the `presentation` tool until the user has chosen.

## Determine the content

If arguments were provided after `/presentation`, treat them as the topic or focus. Otherwise, use our current conversation as the source material — summarize and structure what we've been discussing into a coherent presentation.

Read the codebase, plan, or any referenced files in full before writing slides so the content is grounded and accurate, not generic.

## Build the slides/sections

Structure the explanation into a logical flow: a strong opening (what & why), then the key points or steps, then a closing. Aim for 6–12 slides/sections — enough to inform, not so many that it drags.

For each slide/section body, write clean, information-dense HTML. Supported tags: `h3`, `p`, `ul`, `ol`, `li`, `code`, `pre`, `blockquote`, `strong`, `em`, `img`. Use lists and short paragraphs for scannability. Do NOT overfill any single slide — if a slide gets too dense, split it.

## Design discipline

The `presentation` tool handles the visual design — you only provide content. The design is intentionally professional and restrained:
- Clean system typography, clear hierarchy
- One accent color (deep teal), generous whitespace
- No childish gradients, rainbows, bounce animations, or emoji clutter
- Enough information to be useful, structured so it's not overwhelming

## Call the tool

Once the user has chosen SPA or Slides, call the `presentation` tool with:
- `format`: "spa" or "slides" (as the user chose)
- `title`: a clear, professional title
- `subtitle`: optional one-line summary
- `slides`: ordered array of `{ heading, body }` (body = rich HTML)
- `layout`: "two-column" only for slides where a side-by-side comparison genuinely helps

Report the generated file path to the user and tell them how to navigate (slides: ← → Space / F for fullscreen; spa: scroll + top nav).

$@
