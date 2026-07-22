/**
 * presentation tool — generates a professional, self-contained HTML
 * presentation. Two formats:
 *   - "slides": paged, keyboard-navigated (←/→/space), one slide per view
 *   - "spa":    single scrollable page with sticky section nav
 *
 * Design is intentionally restrained: clean typography, one accent color,
 * generous whitespace, no childish gradients/bounce. Enough information,
 * good hierarchy, not overfilled.
 */

import { StringEnum, Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const ACCENT = "#0f766e"; // deep teal — professional, calm
const ACCENT_SOFT = "#e6f3f2";

function esc(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function slideShell(opts: {
  title: string;
  subtitle?: string;
  author?: string;
  slides: { heading: string; body: string; layout?: string }[];
}): string {
  const { title, subtitle, author, slides } = opts;
  const total = slides.length;

  // Title slide + content slides
  const slidesHtml = [
    `<section class="slide title-slide" data-index="0">
       <div class="title-inner">
         <div class="accent-bar"></div>
         <h1 class="doc-title">${esc(title)}</h1>
         ${subtitle ? `<p class="doc-subtitle">${esc(subtitle)}</p>` : ""}
         ${author ? `<p class="doc-author">${esc(author)}</p>` : ""}
         <p class="slide-hint">Use ← → or Space to navigate</p>
       </div>
     </section>`,
    ...slides.map((s, i) => {
      const twoCol = s.layout === "two-column";
      return `<section class="slide content-slide" data-index="${i + 1}">
        <header class="slide-head">
          <span class="slide-kicker">${String(i + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}</span>
          <h2 class="slide-heading">${esc(s.heading)}</h2>
        </header>
        <div class="slide-body ${twoCol ? "two-col" : ""}">${s.body}</div>
      </section>`;
    }),
  ].join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<style>
  :root {
    --accent: ${ACCENT};
    --accent-soft: ${ACCENT_SOFT};
    --ink: #1a1f2e;
    --ink-soft: #4a5568;
    --ink-mute: #8a94a6;
    --bg: #fafafa;
    --rule: #e2e8f0;
    --serif: ui-serif, Georgia, "Times New Roman", serif;
    --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    --mono: ui-monospace, "SF Mono", "Cascadia Code", Menlo, Consolas, monospace;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; }
  body {
    font-family: var(--sans);
    color: var(--ink);
    background: var(--bg);
    overflow: hidden;
  }
  .deck { position: relative; width: 100vw; height: 100vh; }
  .slide {
    position: absolute; inset: 0;
    display: none;
    flex-direction: column;
    padding: 7vh 10vw;
    animation: fade .35s ease;
  }
  .slide.active { display: flex; }
  @keyframes fade { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }

  /* Title slide */
  .title-slide { justify-content: center; }
  .title-inner { max-width: 760px; }
  .accent-bar { width: 56px; height: 4px; background: var(--accent); margin-bottom: 28px; border-radius: 2px; }
  .doc-title { font-size: clamp(2rem, 5vw, 3.4rem); font-weight: 700; letter-spacing: -0.02em; line-height: 1.1; }
  .doc-subtitle { font-size: clamp(1rem, 2vw, 1.35rem); color: var(--ink-soft); margin-top: 18px; font-weight: 400; }
  .doc-author { font-size: 0.95rem; color: var(--ink-mute); margin-top: 14px; }
  .slide-hint { font-size: 0.85rem; color: var(--ink-mute); margin-top: 40px; }

  /* Content slides */
  .slide-head { margin-bottom: 32px; border-bottom: 1px solid var(--rule); padding-bottom: 18px; }
  .slide-kicker { font-family: var(--mono); font-size: 0.78rem; color: var(--accent); letter-spacing: 0.08em; text-transform: uppercase; display: block; margin-bottom: 8px; }
  .slide-heading { font-size: clamp(1.5rem, 3vw, 2.1rem); font-weight: 650; letter-spacing: -0.015em; line-height: 1.2; }
  .slide-body { font-size: clamp(1rem, 1.6vw, 1.18rem); line-height: 1.65; color: var(--ink-soft); flex: 1; }
  .slide-body.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; }
  .slide-body h3 { font-size: 1.1rem; color: var(--ink); margin: 0 0 10px; font-weight: 600; }
  .slide-body p { margin-bottom: 14px; }
  .slide-body ul, .slide-body ol { margin: 0 0 14px 1.3em; }
  .slide-body li { margin-bottom: 6px; }
  .slide-body code { font-family: var(--mono); font-size: 0.88em; background: var(--accent-soft); padding: 1px 6px; border-radius: 3px; color: var(--accent); }
  .slide-body pre { background: #0f172a; color: #e2e8f0; padding: 18px; border-radius: 8px; overflow-x: auto; margin: 14px 0; font-size: 0.85rem; line-height: 1.5; }
  .slide-body pre code { background: none; color: inherit; padding: 0; }
  .slide-body blockquote { border-left: 3px solid var(--accent); padding-left: 16px; color: var(--ink-mute); font-style: italic; margin: 14px 0; }
  .slide-body strong { color: var(--ink); font-weight: 650; }
  .slide-body img { max-width: 100%; border-radius: 6px; margin: 10px 0; }

  /* Controls */
  .controls { position: fixed; bottom: 24px; right: 28px; display: flex; gap: 8px; z-index: 10; }
  .ctrl-btn {
    width: 38px; height: 38px; border-radius: 50%; border: 1px solid var(--rule);
    background: #fff; color: var(--ink-soft); cursor: pointer; font-size: 1rem;
    display: flex; align-items: center; justify-content: center;
    transition: all .15s; box-shadow: 0 1px 3px rgba(0,0,0,.06);
  }
  .ctrl-btn:hover { border-color: var(--accent); color: var(--accent); }
  .progress { position: fixed; top: 0; left: 0; height: 3px; background: var(--accent); z-index: 10; transition: width .3s ease; }
  .counter { position: fixed; bottom: 30px; left: 28px; font-family: var(--mono); font-size: 0.8rem; color: var(--ink-mute); z-index: 10; }
</style>
</head>
<body>
  <div class="progress" id="progress"></div>
  <div class="deck" id="deck">
    ${slidesHtml}
  </div>
  <div class="counter" id="counter">01 / ${String(total).padStart(2, "0")}</div>
  <div class="controls">
    <button class="ctrl-btn" id="prev" title="Previous (←)">‹</button>
    <button class="ctrl-btn" id="next" title="Next (→)">›</button>
    <button class="ctrl-btn" id="fullscreen" title="Fullscreen (f)">⛶</button>
  </div>
<script>
  (function () {
    const slides = [...document.querySelectorAll(".slide")];
    let idx = 0;
    const total = slides.length;
    const progress = document.getElementById("progress");
    const counter = document.getElementById("counter");
    function show(n) {
      idx = Math.max(0, Math.min(total - 1, n));
      slides.forEach((s, i) => s.classList.toggle("active", i === idx));
      progress.style.width = ((idx + 1) / total * 100) + "%";
      counter.textContent = String(idx + 1).padStart(2, "0") + " / " + String(total).padStart(2, "0");
    }
    document.getElementById("prev").onclick = () => show(idx - 1);
    document.getElementById("next").onclick = () => show(idx + 1);
    document.getElementById("fullscreen").onclick = () => {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen();
      else document.exitFullscreen();
    };
    document.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") { e.preventDefault(); show(idx + 1); }
      else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); show(idx - 1); }
      else if (e.key === "Home") show(0);
      else if (e.key === "End") show(total - 1);
      else if (e.key === "f" || e.key === "F") document.getElementById("fullscreen").click();
    });
    show(0);
  })();
</script>
</body>
</html>`;
}

function spaShell(opts: {
  title: string;
  subtitle?: string;
  author?: string;
  sections: { heading: string; body: string }[];
}): string {
  const { title, subtitle, author, sections } = opts;
  const navItems = sections
    .map((s, i) => `<a href="#sec-${i}" class="nav-link">${esc(s.heading)}</a>`)
    .join("\n");
  const sectionsHtml = sections
    .map((s, i) => `<section id="sec-${i}" class="section">
      <span class="sec-kicker">${String(i + 1).padStart(2, "0")}</span>
      <h2 class="sec-heading">${esc(s.heading)}</h2>
      <div class="sec-body">${s.body}</div>
    </section>`)
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<style>
  :root {
    --accent: ${ACCENT};
    --accent-soft: ${ACCENT_SOFT};
    --ink: #1a1f2e;
    --ink-soft: #4a5568;
    --ink-mute: #8a94a6;
    --bg: #fafafa;
    --rule: #e2e8f0;
    --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    --mono: ui-monospace, "SF Mono", "Cascadia Code", Menlo, Consolas, monospace;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: var(--sans); color: var(--ink); background: var(--bg); line-height: 1.65; }
  .topbar {
    position: sticky; top: 0; z-index: 50; background: rgba(250,250,250,.92);
    backdrop-filter: blur(8px); border-bottom: 1px solid var(--rule);
  }
  .topbar-inner { max-width: 880px; margin: 0 auto; padding: 16px 24px; display: flex; align-items: baseline; gap: 20px; }
  .brand { font-weight: 700; font-size: 1rem; color: var(--accent); letter-spacing: -0.01em; }
  .nav { display: flex; gap: 18px; flex-wrap: wrap; margin-left: auto; }
  .nav-link { font-size: 0.88rem; color: var(--ink-soft); text-decoration: none; transition: color .15s; }
  .nav-link:hover { color: var(--accent); }
  .hero { max-width: 880px; margin: 0 auto; padding: 90px 24px 60px; }
  .accent-bar { width: 56px; height: 4px; background: var(--accent); margin-bottom: 28px; border-radius: 2px; }
  .hero h1 { font-size: clamp(2rem, 5vw, 3rem); font-weight: 700; letter-spacing: -0.025em; line-height: 1.1; }
  .hero .subtitle { font-size: clamp(1.05rem, 2vw, 1.35rem); color: var(--ink-soft); margin-top: 18px; max-width: 620px; }
  .hero .author { font-size: 0.92rem; color: var(--ink-mute); margin-top: 16px; }
  .content { max-width: 880px; margin: 0 auto; padding: 0 24px 120px; }
  .section { padding: 48px 0; border-top: 1px solid var(--rule); scroll-margin-top: 70px; }
  .sec-kicker { font-family: var(--mono); font-size: 0.78rem; color: var(--accent); letter-spacing: 0.08em; }
  .sec-heading { font-size: clamp(1.4rem, 3vw, 1.9rem); font-weight: 650; letter-spacing: -0.015em; margin: 10px 0 20px; line-height: 1.25; }
  .sec-body { font-size: 1.08rem; color: var(--ink-soft); }
  .sec-body h3 { font-size: 1.12rem; color: var(--ink); margin: 22px 0 10px; font-weight: 600; }
  .sec-body p { margin-bottom: 16px; }
  .sec-body ul, .sec-body ol { margin: 0 0 16px 1.3em; }
  .sec-body li { margin-bottom: 7px; }
  .sec-body code { font-family: var(--mono); font-size: 0.88em; background: var(--accent-soft); padding: 1px 6px; border-radius: 3px; color: var(--accent); }
  .sec-body pre { background: #0f172a; color: #e2e8f0; padding: 18px; border-radius: 8px; overflow-x: auto; margin: 16px 0; font-size: 0.85rem; line-height: 1.55; }
  .sec-body pre code { background: none; color: inherit; padding: 0; }
  .sec-body blockquote { border-left: 3px solid var(--accent); padding-left: 16px; color: var(--ink-mute); font-style: italic; margin: 16px 0; }
  .sec-body strong { color: var(--ink); font-weight: 650; }
  .sec-body img { max-width: 100%; border-radius: 6px; margin: 12px 0; }
  html { scroll-behavior: smooth; }
</style>
</head>
<body>
  <div class="topbar">
    <div class="topbar-inner">
      <span class="brand">${esc(title)}</span>
      <nav class="nav">${navItems}</nav>
    </div>
  </div>
  <header class="hero">
    <div class="accent-bar"></div>
    <h1>${esc(title)}</h1>
    ${subtitle ? `<p class="subtitle">${esc(subtitle)}</p>` : ""}
    ${author ? `<p class="author">${esc(author)}</p>` : ""}
  </header>
  <main class="content">
    ${sectionsHtml}
  </main>
</body>
</html>`;
}

export default function presentationExtension(pi: ExtensionAPI): void {
  pi.registerTool(
    defineTool({
      name: "presentation",
      label: "Presentation",
      description:
        "Generate a professional, self-contained HTML presentation from structured content. " +
        "Two formats: \"slides\" (paged, keyboard-navigated) or \"spa\" (single scrollable page with sticky nav). " +
        "Design is clean and restrained — good typography, one accent color, generous whitespace, not childish or overfilled. " +
        "Provide rich HTML in each slide/section body (h3, p, ul, ol, code, pre, blockquote, img, strong all supported).",
      promptSnippet:
        "Build a polished HTML presentation. Provide format (spa|slides), title, and slides/sections with rich HTML bodies.",
      parameters: Type.Object({
        format: StringEnum(["spa", "slides"], {
          description: "\"slides\" = paged deck with keyboard navigation; \"spa\" = single scrollable page.",
        }),
        title: Type.String({ description: "Presentation title." }),
        subtitle: Type.Optional(Type.String({ description: "Optional subtitle shown under the title." })),
        author: Type.Optional(Type.String({ description: "Optional author line." })),
        slides: Type.Array(
          Type.Object({
            heading: Type.String({ description: "Slide/section heading." }),
            body: Type.String({
              description:
                "HTML body content. Supports h3, p, ul, ol, li, code, pre, blockquote, strong, em, img. " +
                "Write clean, information-dense HTML — not overfilled. Use lists for structure.",
            }),
            layout: Type.Optional(
              Type.String({ description: "Optional: \"two-column\" (slides only) splits body into two columns." }),
            ),
          }),
          { description: "Ordered list of slides (slides format) or sections (spa format)." },
        ),
        outputPath: Type.Optional(
          Type.String({
            description: "Optional output file path. Defaults to ./presentation-<timestamp>.html in the project.",
          }),
        ),
      }),
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        const p = params as {
          format: "spa" | "slides";
          title: string;
          subtitle?: string;
          author?: string;
          slides: { heading: string; body: string; layout?: string }[];
          outputPath?: string;
        };

        if (!p.slides || p.slides.length === 0) {
          return {
            content: [{ type: "text", text: "Cannot create presentation: no slides/sections provided." }],
          };
        }

        const html =
          p.format === "slides"
            ? slideShell({ title: p.title, subtitle: p.subtitle, author: p.author, slides: p.slides })
            : spaShell({ title: p.title, subtitle: p.subtitle, author: p.author, sections: p.slides });

        const ts = Date.now();
        const outPath = p.outputPath
          ? (p.outputPath.startsWith("/") ? p.outputPath : join(ctx.cwd, p.outputPath))
          : join(ctx.cwd, `presentation-${ts}.html`);

        try {
          writeFileSync(outPath, html, "utf-8");
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: "text", text: `Failed to write presentation: ${msg}` }],
          };
        }

        if (ctx.hasUI) {
          ctx.ui.notify(`Presentation created (${p.format})`, "info");
        }

        return {
          content: [
            {
              type: "text",
              text:
                `Created a ${p.format === "slides" ? "paged slide deck" : "single-page"} presentation ` +
                `with ${p.slides.length} ${p.format === "slides" ? "slides" : "sections"}.\n` +
                `File: ${outPath}\n\n` +
                `Open it in a browser to view. ${
                  p.format === "slides"
                    ? "Navigate with ← → Space; press F for fullscreen."
                    : "Scroll to read; use the top nav to jump between sections."
                }`,
            },
          ],
          details: { format: p.format, path: outPath, count: p.slides.length },
        };
      },
    }),
  );
}
