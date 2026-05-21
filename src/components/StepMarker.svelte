<script lang="ts">
  interface Props {
    n: number;
    state: "active" | "done" | "locked";
  }
  let { n, state }: Props = $props();
</script>

<div class="step-marker" aria-hidden="true">
  {#if state === "done"}
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 12l5 5L20 7"/>
    </svg>
  {:else}
    <span>{n}</span>
  {/if}
</div>
