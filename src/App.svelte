<script lang="ts">
  import {
    bake,
    validateChannelIconsPackagef,
    validateModuleTgz,
    type BakeResult,
  } from "./lib/bakery";
  import type { Manifest } from "./lib/manifest";

  // ---------- platform detection ------------------------------------------

  type Platform = "macos" | "windows" | "other";

  function detectPlatform(): Platform {
    const ua = navigator.userAgent || "";
    const plat = (navigator.platform || "").toLowerCase();
    if (plat.includes("mac") || /mac os|macintosh/i.test(ua)) return "macos";
    if (plat.includes("win") || /windows/i.test(ua)) return "windows";
    return "other";
  }

  let platform = $state<Platform>(detectPlatform());

  // ---------- form state --------------------------------------------------

  let channelIconsFile = $state<File | null>(null);
  let tgzFile = $state<File | null>(null);

  type CheckState =
    | { kind: "idle" }
    | { kind: "checking" }
    | { kind: "ok"; detail: string }
    | { kind: "error"; message: string };

  let channelIconsCheck = $state<CheckState>({ kind: "idle" });
  let tgzCheck = $state<CheckState>({ kind: "idle" });
  let tgzManifest = $state<Manifest | null>(null);

  let busy = $state(false);
  let status = $state("");
  let error = $state("");
  let result = $state<BakeResult | null>(null);
  let downloadUrl = $state("");

  // Per-input token so a fast re-pick supersedes any in-flight check.
  let channelIconsToken = 0;
  let tgzToken = 0;

  function clearResult() {
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = "";
    result = null;
  }

  function onChannelIconsDrop(e: DragEvent) {
    e.preventDefault();
    if (busy) return;
    const file = e.dataTransfer?.files?.[0] ?? null;
    if (!file) return;
    // Simulate a change event with the dropped file
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = (e.currentTarget as HTMLElement).querySelector('input[type="file"]') as HTMLInputElement;
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function onTgzDrop(e: DragEvent) {
    e.preventDefault();
    if (busy) return;
    const file = e.dataTransfer?.files?.[0] ?? null;
    if (!file) return;
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = (e.currentTarget as HTMLElement).querySelector('input[type="file"]') as HTMLInputElement;
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function onDragOver(e: DragEvent) {
    e.preventDefault();
  }

  /** Prevent the browser from navigating to a dropped file outside a drop zone. */
  function onDocumentDragOver(e: DragEvent) {
    if ((e.target as Element | null)?.closest(".filebox")) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "none";
  }

  function onDocumentDrop(e: DragEvent) {
    if ((e.target as Element | null)?.closest(".filebox")) return;
    e.preventDefault();
  }

  async function onChannelIconsPicked(e: Event) {
    channelIconsFile = (e.target as HTMLInputElement).files?.[0] ?? null;
    clearResult();
    manualStep = null;
    error = "";
    status = "";
    if (!channelIconsFile) {
      channelIconsCheck = { kind: "idle" };
      return;
    }
    const myToken = ++channelIconsToken;
    channelIconsCheck = { kind: "checking" };
    try {
      const { iconCount, source } = await validateChannelIconsPackagef(channelIconsFile);
      if (myToken !== channelIconsToken) return;
      const sourceLabel = source === "dll" ? "DLL" : ".skin";
      channelIconsCheck = {
        kind: "ok",
        detail: `${sourceLabel} \u00b7 ${iconCount} icon${iconCount === 1 ? "" : "s"}`,
      };
    } catch (err) {
      if (myToken !== channelIconsToken) return;
      channelIconsCheck = { kind: "error", message: (err as Error).message };
    }
  }

  async function onTgzPicked(e: Event) {
    tgzFile = (e.target as HTMLInputElement).files?.[0] ?? null;
    clearResult();
    manualStep = null;
    error = "";
    status = "";
    tgzManifest = null;
    if (!tgzFile) {
      tgzCheck = { kind: "idle" };
      return;
    }
    const myToken = ++tgzToken;
    tgzCheck = { kind: "checking" };
    try {
      const { manifest } = await validateModuleTgz(tgzFile);
      if (myToken !== tgzToken) return;
      tgzManifest = manifest;
      tgzCheck = {
        kind: "ok",
        detail: `${manifest.id}@${manifest.version}`,
      };
    } catch (err) {
      if (myToken !== tgzToken) return;
      tgzCheck = { kind: "error", message: (err as Error).message };
    }
  }

  async function onBake() {
    if (!channelIconsFile || !tgzFile) return;
    busy = true;
    error = "";
    status = "";
    clearResult();
    try {
      const r = await bake({
        channelIconsFile,
        tgzFile,
        onProgress: msg => (status = msg),
      });
      result = r;
      downloadUrl = URL.createObjectURL(r.blob);
      status = `Baked ${r.iconCount} icon${r.iconCount === 1 ? "" : "s"} into ${r.manifest.id}@${r.manifest.version}.`;
    } catch (err) {
      error = (err as Error).message;
      status = "";
    } finally {
      busy = false;
    }
  }

  // ---------- step gating -------------------------------------------------

  const step1Ok = $derived(channelIconsCheck.kind === "ok");
  const step2Ok = $derived(tgzCheck.kind === "ok");
  const canBake = $derived(step1Ok && step2Ok && !busy);
  const downloadReady = $derived(!!result && !!downloadUrl);

  // The "natural" current step (first incomplete one).
  const naturalStep = $derived(
    downloadReady ? 4 : !step1Ok ? 1 : !step2Ok ? 2 : 3,
  );

  // User can override the active step by clicking "Change" on a
  // completed one. Cleared automatically when the user re-picks a
  // file in onChannelIconsPicked / onTgzPicked.
  let manualStep = $state<number | null>(null);

  const activeStep = $derived(manualStep ?? naturalStep);

  function openStep(n: number) {
    manualStep = n;
  }

  function closeStep() {
    manualStep = null;
  }

  /**
   * True when the user has manually opened a step that was already
   * complete. In that case we surface a "Done" button so they can
   * collapse the step without having to pick a new file.
   */
  function isReopened(n: number, complete: boolean): boolean {
    return manualStep === n && complete;
  }

  function stepState(n: number): "active" | "done" | "locked" {
    if (n === activeStep) return "active";
    if (n === 1 && step1Ok && naturalStep > 1) return "done";
    if (n === 2 && step2Ok && naturalStep > 2) return "done";
    if (n === 3 && downloadReady && naturalStep > 3) return "done";
    if (n < naturalStep) return "done";
    return "locked";
  }

  const s1 = $derived(stepState(1));
  const s2 = $derived(stepState(2));
  const s3 = $derived(stepState(3));
  const s4 = $derived(stepState(4));

  const otherPlatform = $derived(platform === "macos" ? "windows" : "macos");

  const SKIN_PATH = "/Applications/Universal Control.app/Contents/PlugIns/studiolivepanel.bundle/Contents/Resources/channelicons.skin";
  const DLL_PATH = "C:\\Program Files\\PreSonus\\Universal Control\\Plugins\\studiolivepanel.dll";
</script>

<svelte:document ondragover={onDocumentDragOver} ondrop={onDocumentDrop} />

<main>
  <header class="hero">
    <h1>
      <span class="gradient-text">PreSonus StudioLive</span>
      <span class="hero-subtitle">Icon bakery for Bitfocus Companion</span>
    </h1>
    <p class="lede">
      Embeds vendor channel icons into the <a
        href="https://github.com/featherbear/bitfocus-companion-module-presonus-studiolive"
        target="_blank"
        rel="noopener noreferrer"
      ><code>bitfocus-presonus-studiolive</code></a> module, because
      we&rsquo;re not allowed to distribute them ourselves for legal
      reasons. The icons are available as part of your PreSonus
      Universal Control installation.
    </p>
  </header>

  <ol class="steps">
    <!-- ============================== Step 1 ============================== -->
    <li class="step state-{s1}">
      <div class="step-marker" aria-hidden="true">
        {#if s1 === "done"}
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l5 5L20 7"/></svg>
        {:else}
          <span>1</span>
        {/if}
      </div>

      {#if s1 === "active"}
        <div class="step-body">
          <h2>Pick your channel icons file</h2>
          <p class="step-hint">
            {#if platform === "macos"}
              On macOS, this lives at:<br />
              <code class="path">{SKIN_PATH}</code>
            {:else if platform === "windows"}
              On Windows, pick the studiolivepanel.dll at:<br />
              <code class="path">{DLL_PATH}</code><br />
              Required assets are automatically extracted.
            {:else}
              Pick <code>channelicons.skin</code> (macOS) or
              <code>studiolivepanel.dll</code> (Windows) from your
              Universal Control installation.
            {/if}
            {#if platform !== "other"}
              <button class="link-button" onclick={() => (platform = otherPlatform)}>
                Show {otherPlatform === "macos" ? "macOS" : "Windows"} path instead
              </button>
            {/if}
          </p>

          <label class="filebox" class:has-file={!!channelIconsFile} ondragover={onDragOver} ondrop={onChannelIconsDrop}>
            <input
              type="file"
              accept=".skin,.dll"
              onchange={onChannelIconsPicked}
              disabled={busy}
            />
            <span class="filebox-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/></svg>
            </span>
            <span class="filebox-text">
              <span class="filebox-title">
                {channelIconsFile?.name ?? "Choose a channelicons.skin or studiolivepanel.dll file"}
              </span>
              <span class="filebox-sub">
                {#if channelIconsCheck.kind === "checking"}
                  Checking&hellip;
                {:else if channelIconsCheck.kind === "ok"}
                  <span class="badge ok">OK</span> {channelIconsCheck.detail}
                {:else if channelIconsCheck.kind === "error"}
                  <span class="badge err">Error</span> {channelIconsCheck.message}
                {:else}
                  Click to browse, or drag a file here.
                {/if}
              </span>
            </span>
          </label>
          {#if isReopened(1, step1Ok)}
            <div class="step-actions">
              <button class="btn-ghost" type="button" onclick={closeStep}>
                Done &mdash; keep current file
              </button>
            </div>
          {/if}
        </div>
      {:else}
        <button class="step-summary" type="button" onclick={() => openStep(1)} disabled={s1 === "locked"}>
          <span class="summary-title">Channel icons file
            {#if s1 === "done" && channelIconsCheck.kind === "ok"}
              <span class="summary-meta">{channelIconsCheck.detail}</span>
            {/if}
          </span>
          {#if s1 === "done" && channelIconsFile}
            <span class="summary-detail">{channelIconsFile.name}</span>
          {/if}
          {#if s1 === "done"}<span class="summary-action">Change</span>{/if}
        </button>
      {/if}
    </li>

    <!-- ============================== Step 2 ============================== -->
    <li class="step state-{s2}">
      <div class="step-marker" aria-hidden="true">
        {#if s2 === "done"}
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l5 5L20 7"/></svg>
        {:else}
          <span>2</span>
        {/if}
      </div>

      {#if s2 === "active"}
        <div class="step-body">
          <h2>Pick the PreSonus StudioLive module file</h2>
          <p class="step-hint">
            Need it? Grab the latest version <a
              href="https://github.com/featherbear/bitfocus-companion-module-presonus-studiolive/releases"
              target="_blank"
              rel="noopener noreferrer"
            >here</a>.
          </p>

          <label class="filebox" class:has-file={!!tgzFile} ondragover={onDragOver} ondrop={onTgzDrop}>
            <input
              type="file"
              accept=".tgz,.gz,application/gzip"
              onchange={onTgzPicked}
              disabled={busy}
            />
            <span class="filebox-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.27 6.96 12 12.01l8.73-5.05"/><path d="M12 22.08V12"/></svg>
            </span>
            <span class="filebox-text">
              <span class="filebox-title">
                {tgzFile?.name ?? "Choose a .tgz file"}
              </span>
              <span class="filebox-sub">
                {#if tgzCheck.kind === "checking"}
                  Checking&hellip;
                {:else if tgzCheck.kind === "ok"}
                  <span class="badge ok">OK</span> {tgzCheck.detail}
                {:else if tgzCheck.kind === "error"}
                  <span class="badge err">Error</span> {tgzCheck.message}
                {:else}
                  Click to browse, or drag a file here.
                {/if}
              </span>
            </span>
          </label>
          {#if isReopened(2, step2Ok)}
            <div class="step-actions">
              <button class="btn-ghost" type="button" onclick={closeStep}>
                Done &mdash; keep current file
              </button>
            </div>
          {/if}
        </div>
      {:else}
        <button class="step-summary" type="button" onclick={() => openStep(2)} disabled={s2 === "locked"}>
          <span class="summary-title">PreSonus StudioLive module file
            {#if s2 === "done" && tgzCheck.kind === "ok"}
              <span class="summary-meta">{tgzCheck.detail}</span>
            {/if}
          </span>
          {#if s2 === "done" && tgzFile}
            <span class="summary-detail">{tgzFile.name}</span>
          {/if}
          {#if s2 === "done"}<span class="summary-action">Change</span>{/if}
        </button>
      {/if}
    </li>

    <!-- ============================== Step 3 ============================== -->
    <li class="step state-{s3}">
      <div class="step-marker" aria-hidden="true">
        {#if s3 === "done"}
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l5 5L20 7"/></svg>
        {:else}
          <span>3</span>
        {/if}
      </div>

      {#if s3 === "active"}
        <div class="step-body">
          <h2>Bake</h2>
          <p class="step-hint">yum.</p>
          <button class="cta" onclick={onBake} disabled={!canBake}>
            {busy ? "Baking\u2026" : downloadReady ? "Bake again" : "Bake module"}
          </button>
          {#if status}
            <p class="status">{status}</p>
          {/if}
          {#if error}
            <p class="alert err">{error}</p>
          {/if}
          {#if isReopened(3, downloadReady) && !busy}
            <div class="step-actions">
              <button class="btn-ghost" type="button" onclick={closeStep}>
                Cancel &mdash; keep current bake
              </button>
            </div>
          {/if}
        </div>
      {:else}
        <button class="step-summary" type="button" onclick={() => openStep(3)} disabled={s3 === "locked"}>
          <span class="summary-title">Bake the module
            {#if s3 === "done" && result}
              <span class="summary-meta">{result.iconCount} icon{result.iconCount === 1 ? "" : "s"}</span>
            {/if}
          </span>
          {#if s3 === "done"}<span class="summary-action">Bake again</span>{/if}
        </button>
      {/if}
    </li>

    <!-- ============================== Step 4 ============================== -->
    <li class="step state-{s4}">
      <div class="step-marker" aria-hidden="true">
        {#if s4 === "done"}
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l5 5L20 7"/></svg>
        {:else}
          <span>4</span>
        {/if}
      </div>

      {#if s4 === "active" && downloadReady && result}
        <div class="step-body">
          <h2>Download</h2>
          <a class="cta cta-alt" href={downloadUrl} download={result.filename}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5l5-5"/><path d="M12 15V3"/></svg>
            Download {result.filename}
          </a>
          <p class="alert warn">
            <strong>Do not redistribute this file.</strong> The embedded
            icons are vendor assets from PreSonus. A notice of this
            bake has been added to the module file.
          </p>
        </div>
      {:else}
        <div class="step-summary step-summary-static">
          <span class="summary-title">Download</span>
        </div>
      {/if}
    </li>
  </ol>

  <footer>
    <p>Everything runs locally. Nothing leaves your browser.</p>
  </footer>
</main>

<style>
  main {
    max-width: 780px;
    margin: 0 auto;
    padding: 56px 24px 96px;
  }

  /* ---------------- hero ---------------- */
  .hero { margin-bottom: 48px; }
  .hero h1 {
    margin: 0 0 18px;
    font-size: clamp(34px, 5vw, 50px);
    line-height: 1.05;
    letter-spacing: -0.02em;
    font-weight: 800;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .gradient-text {
    background: var(--gradient);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
  .hero-subtitle {
    color: var(--fg);
    font-size: clamp(20px, 2.8vw, 28px);
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  .lede {
    color: var(--fg-muted);
    font-size: 16px;
    line-height: 1.65;
    max-width: 62ch;
    margin: 0;
  }

  /* ---------------- stepper ---------------- */
  .steps {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .step {
    display: grid;
    grid-template-columns: 48px 1fr;
    gap: 18px;
    padding: 18px 22px;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    transition: border-color 160ms ease, box-shadow 160ms ease,
                opacity 160ms ease, padding 160ms ease, background 160ms ease;
  }

  /* Active step: emphatic frame, gradient ring, deep shadow */
  .step.state-active {
    padding: 28px 28px;
    border-color: color-mix(in srgb, var(--accent) 60%, transparent);
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--accent) 35%, transparent),
      var(--shadow-md);
    background: var(--bg-elev);
  }

  /* Done step: muted but readable */
  .step.state-done {
    background: var(--bg-sunken);
    border-color: var(--border);
    box-shadow: none;
  }

  /* Locked step: clearly inactive */
  .step.state-locked {
    background: transparent;
    border-style: dashed;
    border-color: var(--border);
    opacity: 0.6;
    box-shadow: none;
  }

  .step-marker {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    border: 1px solid var(--border-strong);
    background: var(--bg-sunken);
    color: var(--fg-muted);
    display: grid;
    place-items: center;
    font-weight: 700;
    font-size: 14px;
    margin-top: 1px;
    transition: background 160ms ease, color 160ms ease, border-color 160ms ease,
                box-shadow 160ms ease, transform 160ms ease;
  }
  .state-active .step-marker {
    width: 40px;
    height: 40px;
    background: var(--gradient);
    color: white;
    border-color: transparent;
    box-shadow: var(--shadow-glow);
  }
  .state-done .step-marker {
    background: var(--gradient);
    color: white;
    border-color: transparent;
  }
  .state-locked .step-marker {
    background: transparent;
    border-style: dashed;
  }

  .step-body h2 {
    margin: 0 0 10px;
    font-size: 20px;
    font-weight: 700;
    letter-spacing: -0.01em;
  }

  /* Collapsed summary row (used for done/locked) */
  .step-summary {
    display: grid;
    grid-template-columns: 1fr auto;
    column-gap: 14px;
    row-gap: 2px;
    align-items: center;
    width: 100%;
    background: none;
    border: none;
    padding: 0;
    color: inherit;
    text-align: left;
    cursor: pointer;
    font-family: inherit;
    font-size: inherit;
  }
  .step-summary.step-summary-static { cursor: default; }
  .step-summary:disabled { cursor: not-allowed; }
  .summary-title {
    grid-column: 1;
    grid-row: 1;
    font-size: 15px;
    font-weight: 600;
    color: var(--fg);
    display: inline-flex;
    align-items: baseline;
    gap: 8px;
  }
  .summary-meta {
    font-weight: 500;
    font-size: 13px;
    color: var(--fg-muted);
    position: relative;
    padding-left: 12px;
  }
  .summary-meta::before {
    content: "\00b7";
    position: absolute;
    left: 2px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--fg-faint);
    font-weight: 700;
  }
  .state-locked .summary-title { color: var(--fg-muted); font-weight: 500; }
  .summary-detail {
    grid-column: 1;
    grid-row: 2;
    color: var(--fg-muted);
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .summary-action {
    grid-column: 2;
    grid-row: 1 / span 2;
    align-self: center;
    color: var(--accent);
    font-size: 13px;
    font-weight: 600;
    text-decoration: underline;
    text-decoration-color: color-mix(in srgb, var(--accent) 40%, transparent);
    text-underline-offset: 2px;
  }
  .step-summary:hover:not(:disabled) .summary-action {
    text-decoration-color: var(--accent);
  }
  .step-hint {
    color: var(--fg-muted);
    font-size: 14px;
    margin: 0 0 16px;
    line-height: 1.6;
  }
  .step-hint .path {
    display: inline-block;
    margin-top: 6px;
    word-break: break-all;
    font-size: 12.5px;
  }

  .link-button {
    background: none;
    border: none;
    color: var(--accent);
    padding: 0;
    margin-left: 4px;
    font-size: 13px;
    text-decoration: underline;
    text-decoration-color: color-mix(in srgb, var(--accent) 40%, transparent);
    text-underline-offset: 2px;
    cursor: pointer;
  }
  .link-button:hover { text-decoration-color: var(--accent); }

  /* ---------------- filebox ---------------- */
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

  /* ---------------- CTAs ---------------- */
  .cta {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    background: var(--gradient);
    color: white;
    border: none;
    border-radius: 999px;
    padding: 12px 26px;
    font-size: 15px;
    font-weight: 600;
    letter-spacing: -0.005em;
    cursor: pointer;
    box-shadow: var(--shadow-md);
    transition: transform 120ms ease, box-shadow 160ms ease, opacity 160ms ease;
    text-decoration: none;
  }
  .cta:hover:not(:disabled) { transform: translateY(-1px); }
  .cta:active:not(:disabled) { transform: translateY(0); }
  .cta:disabled { opacity: 0.45; cursor: not-allowed; box-shadow: none; }
  .cta-alt {
    background: var(--bg-elev);
    color: var(--fg);
    border: 1px solid var(--border-strong);
    box-shadow: var(--shadow-sm);
  }
  .cta-alt:hover {
    border-color: color-mix(in srgb, var(--accent) 70%, var(--border-strong));
  }

  .step-actions {
    margin-top: 14px;
    display: flex;
    gap: 10px;
  }
  .btn-ghost {
    background: none;
    border: 1px solid var(--border-strong);
    color: var(--fg-muted);
    border-radius: 999px;
    padding: 8px 16px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    font-family: inherit;
    transition: color 140ms ease, border-color 140ms ease, background 140ms ease;
  }
  .btn-ghost:hover {
    color: var(--fg);
    border-color: var(--fg-muted);
    background: var(--bg-sunken);
  }

  /* ---------------- status / alerts ---------------- */
  .status {
    color: var(--fg-muted);
    margin: 14px 0 0;
    font-size: 13.5px;
  }
  .alert {
    margin: 16px 0 0;
    padding: 12px 14px;
    border-radius: var(--radius-sm);
    font-size: 13.5px;
    line-height: 1.55;
  }
  .alert.warn { background: var(--warn-bg); color: var(--warn); }
  .alert.err  { background: var(--err-bg);  color: var(--err);  white-space: pre-wrap; }
  .alert code {
    background: color-mix(in srgb, currentColor 10%, transparent);
    border-color: color-mix(in srgb, currentColor 20%, transparent);
    color: inherit;
  }

  /* ---------------- footer ---------------- */
  footer {
    margin-top: 40px;
    text-align: center;
    color: var(--fg-faint);
    font-size: 12.5px;
  }
  footer p { margin: 0; }

  /* ---------------- responsive ---------------- */
  @media (max-width: 560px) {
    main { padding: 32px 16px 64px; }
    .step {
      grid-template-columns: 44px 1fr;
      padding: 18px 16px;
      gap: 14px;
    }
    .step-marker { width: 32px; height: 32px; font-size: 13px; }
    .filebox { padding: 14px; }
  }
</style>
