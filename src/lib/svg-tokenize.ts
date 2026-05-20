// SVG fill tokenization. Used by the bakery to replace every fill color
// in an SVG with a sentinel string that the consuming Companion module
// will swap for a runtime-chosen color before rasterizing.
//
// We use the hex literal `#deadbe` as the sentinel: it's a valid CSS hex
// color (so it round-trips through any SVG/CSS tooling untouched), and
// the source PreSonus icons only ever contain `#0211FF`, so collisions
// are impossible.
//
// Three places fills are declared in the source icons, all rewritten:
//   1. `<style>` CSS rules (`.st0 { fill: #0211FF }`, etc.)
//   2. Inline `style="fill:#0211FF"` attributes
//   3. `fill="#0211FF"` presentation attributes (skipping `none` and
//      `url(#…)` references, which point at gradients/patterns).

/** Sentinel value the runtime will replaceAll() with the real fill color. */
export const FILL_TOKEN = "#deadbe";

/**
 * Replace every fill color in the SVG with `FILL_TOKEN`.
 *
 * Returns the modified SVG as a string. `fill-rule:`, `fill-opacity:`,
 * etc. are left alone (we anchor on `fill` followed immediately by `:`
 * for CSS, and on the bare `fill=` attribute name for presentation).
 */
export function tokenizeSvgFills(svgText: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, "image/svg+xml");

  const parserError = doc.querySelector("parsererror");
  if (parserError) {
    throw new Error("SVG parse error: " + parserError.textContent);
  }

  // 1. <style> blocks.
  for (const style of doc.querySelectorAll("style")) {
    const css = style.textContent ?? "";
    style.textContent = rewriteAllFillDeclarations(css, FILL_TOKEN);
  }

  // 2/3. Element-level style="" and fill="" attributes.
  for (const el of doc.querySelectorAll<Element>("*")) {
    const styleAttr = el.getAttribute("style");
    if (styleAttr && /(^|[^-\w])fill\s*:/i.test(styleAttr)) {
      el.setAttribute("style", rewriteAllFillDeclarations(styleAttr, FILL_TOKEN));
    }
    if (el.hasAttribute("fill")) {
      const v = el.getAttribute("fill")!;
      if (v !== "none" && !v.startsWith("url(")) {
        el.setAttribute("fill", FILL_TOKEN);
      }
    }
  }

  return new XMLSerializer().serializeToString(doc);
}

function rewriteAllFillDeclarations(css: string, fill: string): string {
  return css.replace(
    /(^|[^-\w])(fill)\s*:\s*[^;}]+/gi,
    (_match, lead: string, prop: string) => `${lead}${prop}:${fill}`,
  );
}
