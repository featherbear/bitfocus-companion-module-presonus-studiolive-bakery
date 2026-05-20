<script lang="ts">
  import {
    bake,
    validateChannelIconsPackagef,
    validateModuleTgz,
    type BakeResult,
  } from "./lib/bakery";
  import type { Manifest } from "./lib/manifest";

  let skinFile = $state<File | null>(null);
  let tgzFile = $state<File | null>(null);

  type CheckState =
    | { kind: "idle" }
    | { kind: "checking" }
    | { kind: "ok"; detail: string }
    | { kind: "error"; message: string };

  let skinCheck = $state<CheckState>({ kind: "idle" });
  let tgzCheck = $state<CheckState>({ kind: "idle" });
  let tgzManifest = $state<Manifest | null>(null);

  let busy = $state(false);
  let status = $state("");
  let error = $state("");
  let result = $state<BakeResult | null>(null);
  let downloadUrl = $state("");

  // Each input gets a token; if the user picks a new file mid-check
  // we drop the in-flight result on the floor.
  let skinToken = 0;
  let tgzToken = 0;

  function clearResult() {
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = "";
    result = null;
  }

  async function onSkinPicked(e: Event) {
    skinFile = (e.target as HTMLInputElement).files?.[0] ?? null;
    clearResult();
    error = "";
    status = "";
    if (!skinFile) {
      skinCheck = { kind: "idle" };
      return;
    }
    const myToken = ++skinToken;
    skinCheck = { kind: "checking" };
    try {
      const { iconCount } = await validateChannelIconsPackagef(skinFile);
      if (myToken !== skinToken) return;
      skinCheck = {
        kind: "ok",
        detail: `${iconCount} icon${iconCount === 1 ? "" : "s"} found`,
      };
    } catch (err) {
      if (myToken !== skinToken) return;
      skinCheck = { kind: "error", message: (err as Error).message };
    }
  }

  async function onTgzPicked(e: Event) {
    tgzFile = (e.target as HTMLInputElement).files?.[0] ?? null;
    clearResult();
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
        detail: `${manifest.shortname}@${manifest.version}`,
      };
    } catch (err) {
      if (myToken !== tgzToken) return;
      tgzCheck = { kind: "error", message: (err as Error).message };
    }
  }

  async function onBake() {
    if (!skinFile || !tgzFile) return;
    busy = true;
    error = "";
    status = "";
    clearResult();
    try {
      const r = await bake({
        skinFile,
        tgzFile,
        onProgress: msg => (status = msg),
      });
      result = r;
      downloadUrl = URL.createObjectURL(r.blob);
      status = `Baked ${r.iconCount} icon${r.iconCount === 1 ? "" : "s"} into ${r.manifest.shortname}@${r.manifest.version}.`;
    } catch (err) {
      error = (err as Error).message;
      status = "";
    } finally {
      busy = false;
    }
  }

  const canBake = $derived(
    !!skinFile &&
      !!tgzFile &&
      skinCheck.kind === "ok" &&
      tgzCheck.kind === "ok" &&
      !busy,
  );
</script>

<main>
  <header>
    <h1>Companion module bakery</h1>
    <p class="lede">
      Combines your <code>channelicons.skin</code> with your
      <code>presonus-studiolive</code> Companion module
      <code>.tgz</code>. Output is a personal copy of the module with the
      icons baked in. Everything runs in your browser.
    </p>
  </header>

  <section class="picker-row">
    <label class="picker">
      <span class="picker-label">channelicons.skin</span>
      <input type="file" accept=".skin" onchange={onSkinPicked} disabled={busy} />
      <span class="filename">{skinFile?.name ?? "no file selected"}</span>
      {#if skinCheck.kind === "checking"}
        <span class="check checking">Checking…</span>
      {:else if skinCheck.kind === "ok"}
        <span class="check ok">OK — {skinCheck.detail}</span>
      {:else if skinCheck.kind === "error"}
        <span class="check err">{skinCheck.message}</span>
      {/if}
    </label>

    <label class="picker">
      <span class="picker-label">module .tgz</span>
      <input type="file" accept=".tgz,.gz,application/gzip" onchange={onTgzPicked} disabled={busy} />
      <span class="filename">{tgzFile?.name ?? "no file selected"}</span>
      {#if tgzCheck.kind === "checking"}
        <span class="check checking">Checking…</span>
      {:else if tgzCheck.kind === "ok"}
        <span class="check ok">OK — {tgzCheck.detail}</span>
      {:else if tgzCheck.kind === "error"}
        <span class="check err">{tgzCheck.message}</span>
      {/if}
    </label>
  </section>

  <p class="hint">
    On macOS, <code>channelicons.skin</code> is at:<br />
    <code class="path">/Applications/Universal Control.app/Contents/PlugIns/studiolivepanel.bundle/Contents/Resources/channelicons.skin</code>
  </p>

  <section class="actions">
    <button onclick={onBake} disabled={!canBake}>
      {busy ? "Baking…" : "Bake"}
    </button>

    {#if result && downloadUrl}
      <a class="download" href={downloadUrl} download={result.filename}>
        Download {result.filename}
      </a>
    {/if}
  </section>

  {#if status}
    <p class="status">{status}</p>
  {/if}
  {#if error}
    <p class="error">{error}</p>
  {/if}
</main>

<style>
  main {
    padding: 24px;
    max-width: 720px;
    margin: 0 auto;
  }
  header h1 { margin: 0 0 8px; font-size: 22px; }
  .lede { color: var(--muted); margin: 0 0 20px; font-size: 14px; line-height: 1.5; }

  .picker-row {
    display: grid;
    gap: 12px;
    margin-bottom: 16px;
  }
  .picker {
    display: grid;
    grid-template-columns: 180px 1fr;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 6px;
  }
  .picker-label {
    font-weight: 600;
    font-size: 13px;
  }
  .picker input[type="file"] {
    color: var(--fg);
    font: inherit;
  }
  .filename {
    grid-column: 1 / -1;
    font-size: 12px;
    color: var(--muted);
    word-break: break-all;
  }
  .check {
    grid-column: 1 / -1;
    font-size: 12px;
    word-break: break-word;
  }
  .check.checking { color: var(--muted); }
  .check.ok       { color: var(--accent); }
  .check.err      { color: var(--error); white-space: pre-wrap; }

  .hint { color: var(--muted); font-size: 12px; margin: 0 0 24px; }
  .path { word-break: break-all; }

  .actions {
    display: flex;
    gap: 12px;
    align-items: center;
  }
  .actions button {
    background: var(--accent);
    color: #111;
    border: 1px solid var(--accent);
    border-radius: 6px;
    padding: 8px 18px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
  }
  .actions button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .download {
    color: var(--accent);
    font-size: 14px;
  }

  .status { color: var(--muted); margin-top: 16px; font-size: 13px; }
  .error  { color: var(--error); margin-top: 16px; font-size: 13px; white-space: pre-wrap; }
</style>
