<script lang="ts">
  export let data: {
    approvedOids: string[];
    currentOid: string | null;
    hasUsers: boolean;
  };
</script>

<svelte:head>
  <title>BIRCH — Pending Access</title>
  <meta
    name="description"
    content="Access is pending. This is the BIRCH home."
  />
</svelte:head>

<main class="gate">
  <section class="panel" role="status" aria-live="polite">
    <div class="badge">Access Pending</div>
    <h1>BIRCH</h1>
    {#if data.hasUsers}
      <p>Your account doesn’t have access to any charts yet.</p>
    {:else}
      <p>
        Your account doesn’t have access yet. A manager needs to complete the initial setup before
        charts can be viewed.
      </p>
      <p class="note">
        This page will become the chart viewer once access is granted.
      </p>
    {/if}
    <div class="divider"></div>
    <div class="hint">
      If you believe this is an error, contact a chart manager.
    </div>
    <a class="retry" href="/">Retry Access</a>
    {#if !data.hasUsers}
      <div class="debug">
        <div class="debug-title">Approved OIDs</div>
        <div class="debug-list">
          {#if data.approvedOids.length === 0}
            <span class="empty">None configured</span>
          {:else}
            {#each data.approvedOids as oid}
              <span class="oid">{oid}</span>
            {/each}
          {/if}
        </div>
        <div class="debug-title">Your OID</div>
        <div class="debug-list">
          {#if data.currentOid}
            <span class="oid">{data.currentOid}</span>
          {:else}
            <span class="empty">Unknown</span>
          {/if}
        </div>
      </div>
    {/if}
  </section>
</main>

<style>
  :global(body) {
    margin: 0;
  }

  .gate {
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 48px 20px;
    background:
      radial-gradient(900px 500px at 20% 15%, rgba(200, 16, 46, 0.16), transparent 60%),
      radial-gradient(900px 500px at 80% 10%, rgba(38, 78, 255, 0.14), transparent 55%),
      linear-gradient(180deg, rgba(10, 10, 12, 0.98), rgba(12, 12, 16, 0.98));
    color: #f5f5f5;
  }

  .panel {
    width: min(640px, 100%);
    background: rgba(20, 20, 26, 0.82);
    border: 1px solid rgba(200, 16, 46, 0.5);
    border-radius: 18px;
    padding: 36px;
    box-shadow: 0 28px 60px rgba(0, 0, 0, 0.45);
    display: grid;
    gap: 18px;
    justify-items: center;
    text-align: center;
    backdrop-filter: blur(16px);
  }

  .badge {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 0.85rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.9);
    background: rgba(200, 16, 46, 0.2);
    border: 1px solid rgba(200, 16, 46, 0.6);
    padding: 6px 12px;
    border-radius: 999px;
    width: fit-content;
  }

  h1 {
    margin: 0;
    font-size: 2.2rem;
    letter-spacing: -0.02em;
  }

  p {
    margin: 0;
    color: rgba(255, 255, 255, 0.82);
    line-height: 1.6;
    font-size: 1.02rem;
  }

  .note {
    color: rgba(255, 255, 255, 0.72);
  }

  .divider {
    height: 1px;
    background: linear-gradient(
      90deg,
      rgba(255, 255, 255, 0),
      rgba(255, 255, 255, 0.25),
      rgba(255, 255, 255, 0)
    );
  }

  .hint {
    font-size: 0.95rem;
    color: rgba(255, 255, 255, 0.7);
  }

  .retry {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 10px 18px;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.25);
    color: rgba(255, 255, 255, 0.95);
    text-decoration: none;
    font-weight: 600;
    letter-spacing: 0.01em;
    background: rgba(255, 255, 255, 0.08);
    transition: transform 120ms ease, box-shadow 120ms ease, background 120ms ease;
  }

  .retry:hover {
    transform: translateY(-1px);
    background: rgba(255, 255, 255, 0.14);
    box-shadow: 0 10px 18px rgba(0, 0, 0, 0.25);
  }

  .debug {
    width: 100%;
    display: grid;
    gap: 10px;
    padding-top: 8px;
    border-top: 1px dashed rgba(255, 255, 255, 0.15);
    font-size: 0.9rem;
    color: rgba(255, 255, 255, 0.75);
  }

  .debug-title {
    font-weight: 700;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    font-size: 0.72rem;
    color: rgba(255, 255, 255, 0.55);
  }

  .debug-list {
    display: grid;
    gap: 6px;
    justify-items: center;
  }

  .oid {
    font-family: "IBM Plex Mono", "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 0.85rem;
    padding: 4px 8px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.85);
  }

  .empty {
    color: rgba(255, 255, 255, 0.5);
  }

  @media (max-width: 600px) {
    .panel {
      padding: 28px;
    }

    h1 {
      font-size: 1.8rem;
    }
  }
</style>
