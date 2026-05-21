<script lang="ts">
  import { walk, readFileBytes, type SkinPackage } from "../lib/packagef";

  interface IconEntry {
    path: string;
    group: string;
    name: string;
    svgText: string;
  }

  interface Props {
    pkg: SkinPackage;
    onclose: () => void;
  }

  let { pkg, onclose }: Props = $props();

  let dialogEl: HTMLDialogElement | null = $state(null);

  $effect(() => {
    if (dialogEl) dialogEl.showModal();
  });

  let loading = $state(false);
  let icons = $state<IconEntry[]>([]);
  let search = $state("");
  let loadedPkg = $state<SkinPackage | null>(null);

  const filtered = $derived(
    search.trim() === ""
      ? icons
      : (() => {
          const q = search.trim().toLowerCase();
          return icons.filter(
            i => i.name.toLowerCase().includes(q) || i.group.toLowerCase().includes(q),
          );
        })(),
  );

  const groups = $derived(
    (() => {
      const map = new Map<string, IconEntry[]>();
      for (const icon of filtered) {
        const list = map.get(icon.group);
        if (list) list.push(icon);
        else map.set(icon.group, [icon]);
      }
      return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
    })(),
  );

  $effect(() => {
    if (pkg === loadedPkg) return;
    loadIcons(pkg);
  });

  async function loadIcons(p: SkinPackage) {
    loadedPkg = p;
    icons = [];
    loading = true;
    search = "";
    const decoder = new TextDecoder("utf-8");
    const result: IconEntry[] = [];
    for (const { path, entry } of walk(p.root)) {
      if (!path.startsWith("images/") || !path.toLowerCase().endsWith(".svg")) continue;
      const bytes = await readFileBytes(entry);
      const rawSvg = decoder.decode(bytes);
      // Normalise SVG for preview: strip all fill/stroke/style attributes
      // and style blocks so the icon renders in the current foreground colour
      // via CSS `color: var(--fg)` on the container.
      const svgText = rawSvg
        .replace(new RegExp("<style[\\s\\S]*?<\\/sty" + "le>", "gi"), "")
        .replace(/\s(fill|stroke|style)="[^"]*"/gi, "");
      const parts = path.slice("images/".length).split("/");
      const group = parts.length > 1 ? parts[0] : "Other";
      const name = parts[parts.length - 1];
      result.push({ path, group, name, svgText });
    }
    result.sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
    icons = result;
    loading = false;
  }

  function onBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) onclose();
  }
</script>

<dialog
  bind:this={dialogEl}
  class="modal-backdrop"
  aria-label="Icon browser"
  oncancel={(e) => { e.preventDefault(); onclose(); }}
  onclick={onBackdropClick}
>
  <div class="modal">
    <div class="modal-header">
      <h2 class="modal-title">Icon browser</h2>
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="modal-search"
        type="search"
        placeholder="Search icons…"
        bind:value={search}
        autocomplete="off"
        spellcheck="false"
        autofocus
      />
      <button class="modal-close" type="button" onclick={onclose} aria-label="Close">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    </div>

    <div class="modal-body">
      {#if loading}
        <p class="modal-empty">Loading icons…</p>
      {:else if groups.length === 0}
        <p class="modal-empty">No icons match "{search}".</p>
      {:else}
        {#each groups as [group, groupIcons]}
          <div class="icon-group">
            <h3 class="icon-group-label">{group}</h3>
            <div class="icon-grid">
              {#each groupIcons as icon}
                <div class="icon-tile" title={icon.name.replace(/\.svg$/i, "")}>
                  <div class="icon-preview">
                    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                    {@html icon.svgText}
                  </div>
                  <span class="icon-name">{icon.name.replace(/\.svg$/i, "")}</span>
                </div>
              {/each}
            </div>
          </div>
        {/each}
      {/if}
    </div>

    <div class="modal-footer">
      {icons.length} icon{icons.length === 1 ? "" : "s"} total
      {#if search.trim()}
        &nbsp;&middot;&nbsp; {filtered.length} match{filtered.length === 1 ? "" : "es"}
      {/if}
    </div>
  </div>
</dialog>

<style>
  .modal-backdrop {
    /* Let the browser size and position the dialog via ::backdrop instead.
       Make the dialog itself a transparent full-viewport flex layer. */
    position: fixed;
    inset: 0;
    width: 100vw;
    height: 100dvh;
    z-index: 100;
    background: transparent;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    border: none;
    outline: none;
    overflow: visible;
    box-sizing: border-box;
  }

  .modal-backdrop::backdrop {
    background: rgba(0, 0, 0, 0.35);
    backdrop-filter: blur(2px);
  }

  .modal {
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-md);
    width: 100%;
    max-width: 760px;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .modal-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 18px 20px 14px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .modal-title {
    margin: 0;
    font-size: 17px;
    font-weight: 700;
    letter-spacing: -0.01em;
    color: var(--fg);
    flex-shrink: 0;
  }

  .modal-search {
    flex: 1;
    background: var(--bg-sunken);
    border: 1px solid var(--border-strong);
    border-radius: 999px;
    padding: 7px 14px;
    font-size: 13.5px;
    font-family: inherit;
    color: var(--fg);
    outline: none;
    transition: border-color 140ms ease, box-shadow 140ms ease;
    min-width: 0;
  }
  .modal-search:focus {
    border-color: var(--accent);
    box-shadow: var(--shadow-glow);
  }
  .modal-search::placeholder { color: var(--fg-faint); }

  .modal-close {
    background: none;
    border: none;
    color: var(--fg-muted);
    cursor: pointer;
    padding: 6px;
    border-radius: var(--radius-sm);
    display: grid;
    place-items: center;
    flex-shrink: 0;
    transition: color 120ms ease, background 120ms ease;
  }
  .modal-close:hover {
    color: var(--fg);
    background: var(--bg-sunken);
  }

  .modal-body {
    overflow-y: auto;
    flex: 1;
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  .modal-empty {
    color: var(--fg-muted);
    font-size: 14px;
    text-align: center;
    padding: 40px 0;
    margin: 0;
  }

  .modal-footer {
    border-top: 1px solid var(--border);
    padding: 10px 20px;
    font-size: 12px;
    color: var(--fg-faint);
    flex-shrink: 0;
  }

  .icon-group { display: flex; flex-direction: column; gap: 10px; }

  .icon-group-label {
    margin: 0;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--fg-faint);
  }

  .icon-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
    gap: 8px;
  }

  .icon-tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 10px 6px 8px;
    border-radius: var(--radius-sm);
    background: var(--bg-sunken);
    border: 1px solid var(--border);
    cursor: default;
    transition: background 120ms ease, border-color 120ms ease;
    min-width: 0;
  }
  .icon-tile:hover {
    background: color-mix(in srgb, var(--accent) 6%, var(--bg-sunken));
    border-color: color-mix(in srgb, var(--accent) 35%, var(--border));
  }

  .icon-preview {
    width: 40px;
    height: 40px;
    display: grid;
    place-items: center;
    color: var(--fg);
  }
  .icon-preview :global(svg) {
    width: 100%;
    height: 100%;
    max-width: 40px;
    max-height: 40px;
    fill: currentColor;
  }

  .icon-name {
    font-size: 10.5px;
    color: var(--fg-muted);
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    width: 100%;
    line-height: 1.3;
  }

  @media (max-width: 560px) {
    .modal { width: 100%; height: 100%; max-width: 100%; border-radius: 0; }
    .icon-grid { grid-template-columns: repeat(auto-fill, minmax(72px, 1fr)); }
  }
</style>
