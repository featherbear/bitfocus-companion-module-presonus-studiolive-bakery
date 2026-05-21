<script lang="ts">
  interface Props {
    lines: string[];
  }

  let { lines }: Props = $props();

  const TYPING_SPEED_MS = 28;

  let revealed = $state<number[]>([]);
  let animatingIdx = $state(-1);

  // Track the previous line count outside the reactive graph to avoid
  // re-triggering the effect when `revealed` changes.
  let prevLineCount = 0;
  let activeTimer: ReturnType<typeof setTimeout> | null = null;

  $effect(() => {
    const count = lines.length;

    if (count === 0) {
      // Reset
      if (activeTimer) { clearTimeout(activeTimer); activeTimer = null; }
      prevLineCount = 0;
      revealed = [];
      animatingIdx = -1;
      return;
    }

    if (count <= prevLineCount) return; // no new line

    // Cancel any in-flight animation (previous line should be done by now
    // given the per-step delay in bakery.ts, but be safe).
    if (activeTimer) { clearTimeout(activeTimer); activeTimer = null; }

    const idx = count - 1;
    prevLineCount = count;

    // Snapshot revealed outside $state so tick() doesn't touch reactive state
    // on every character — only the final assignment does.
    const target = lines[idx].length;
    let charCount = 0;

    // Mark the new line as starting (length 0) and set animating index.
    // Use a fresh array so previous lines keep their revealed counts.
    revealed = [...Array(idx).fill(999), 0];
    animatingIdx = idx;

    function tick() {
      charCount++;
      // Single reactive write per character.
      const next = revealed.slice();
      next[idx] = charCount;
      revealed = next;

      if (charCount < target) {
        activeTimer = setTimeout(tick, TYPING_SPEED_MS);
      } else {
        activeTimer = null;
      }
    }

    activeTimer = setTimeout(tick, TYPING_SPEED_MS);
  });
</script>

{#if lines.length > 0}
  <div class="bake-log" aria-live="polite" aria-label="Bake progress">
    {#each lines as line, i}
      <div class="log-line">
        <span class="prompt" aria-hidden="true">▶</span>
        <span class="text">{line.slice(0, revealed[i] ?? 0)}{#if i === animatingIdx}<span class="cursor" aria-hidden="true">█</span>{/if}</span>
      </div>
    {/each}
  </div>
{/if}

<style>
  .bake-log {
    margin-top: 14px;
    padding: 12px 14px;
    background: var(--bg-sunken);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-family: ui-monospace, "Cascadia Code", "Fira Code", monospace;
    font-size: 12.5px;
    line-height: 1.7;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .log-line {
    display: flex;
    gap: 8px;
    align-items: baseline;
    opacity: 0;
    animation: fadein 180ms ease forwards;
  }

  @keyframes fadein {
    from { opacity: 0; transform: translateY(3px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  .prompt {
    color: var(--accent);
    flex-shrink: 0;
    font-size: 10px;
    line-height: 1.9;
  }

  .text {
    color: var(--fg-muted);
    word-break: break-all;
  }

  .cursor {
    display: inline-block;
    color: var(--accent);
    animation: blink 700ms step-end infinite;
    font-size: 10px;
    line-height: 1;
    vertical-align: middle;
  }

  @keyframes blink {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0; }
  }
</style>
