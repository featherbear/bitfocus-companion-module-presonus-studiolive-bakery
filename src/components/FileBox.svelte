<script lang="ts">
  import type { Snippet } from "svelte";

  type CheckState =
    | { kind: "idle" }
    | { kind: "checking" }
    | { kind: "ok"; detail: string }
    | { kind: "error"; message: string };

  interface Props {
    file: File | null;
    accept: string;
    disabled?: boolean;
    check: CheckState;
    placeholder: string;
    icon: Snippet;
    onchange: (e: Event) => void;
  }

  let { file, accept, disabled = false, check, placeholder, icon, onchange }: Props = $props();

  let inputEl: HTMLInputElement | null = $state(null);

  function onDragOver(e: DragEvent) {
    e.preventDefault();
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    if (disabled) return;
    const dropped = e.dataTransfer?.files?.[0] ?? null;
    if (!dropped || !inputEl) return;
    const dt = new DataTransfer();
    dt.items.add(dropped);
    inputEl.files = dt.files;
    inputEl.dispatchEvent(new Event("change", { bubbles: true }));
  }
</script>

<label class="filebox" class:has-file={!!file} ondragover={onDragOver} ondrop={onDrop}>
  <input
    bind:this={inputEl}
    type="file"
    {accept}
    {onchange}
    {disabled}
  />
  <span class="filebox-icon" aria-hidden="true">
    {@render icon()}
  </span>
  <span class="filebox-text">
    <span class="filebox-title">
      {file?.name ?? placeholder}
    </span>
    <span class="filebox-sub">
      {#if check.kind === "checking"}
        Checking&hellip;
      {:else if check.kind === "ok"}
        <span class="badge ok">OK</span> {check.detail}
      {:else if check.kind === "error"}
        <span class="badge err">Error</span> {check.message}
      {:else}
        Click to browse, or drag a file here.
      {/if}
    </span>
  </span>
</label>

<style>
  .filebox {
    display: grid;
    grid-template-columns: 44px 1fr;
    gap: 14px;
    align-items: center;
    padding: 16px 18px;
    background: var(--bg-sunken);
    border: 1.5px dashed var(--border-strong);
    border-radius: var(--radius);
    cursor: pointer;
    transition: border-color 160ms ease, background 160ms ease, transform 160ms ease;
  }
  .filebox:hover {
    border-color: color-mix(in srgb, var(--accent) 60%, var(--border-strong));
    background: color-mix(in srgb, var(--accent) 4%, var(--bg-sunken));
  }
  .filebox.has-file {
    border-style: solid;
    background: var(--bg-elev);
  }
  .filebox input[type="file"] {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
  }
  .filebox-icon {
    width: 44px;
    height: 44px;
    border-radius: var(--radius-sm);
    background: var(--gradient);
    color: white;
    display: grid;
    place-items: center;
    box-shadow: var(--shadow-sm);
  }
  .filebox-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .filebox-title {
    font-weight: 600;
    font-size: 15px;
    color: var(--fg);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .filebox-sub {
    color: var(--fg-muted);
    font-size: 13px;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .badge {
    display: inline-block;
    padding: 1px 8px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .badge.ok  { background: var(--ok-bg);  color: var(--ok); }
  .badge.err { background: var(--err-bg); color: var(--err); }

  @media (max-width: 560px) {
    .filebox { padding: 14px; }
  }
</style>
