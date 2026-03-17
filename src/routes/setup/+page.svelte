<svelte:head>
  <title>Organization Chart — First Time Setup</title>
  <meta name="description" content="Create the first chart to get started." />
</svelte:head>

<main class="gate">
  <section class="panel">
    <div class="badge">First Time Setup</div>
    <h1>Organization Chart</h1>
    <p>
      You’re signed in as a bootstrap manager. Create the first chart to begin building the
      system.
    </p>
    <form method="post" class="form">
      <label>
        Chart name
        <input name="name" type="text" placeholder="e.g. Primary Operations" required />
      </label>
      <button type="submit">Create Chart</button>
    </form>
    <div class="note">
      After creation, your bootstrap manager access will apply automatically.
    </div>
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

  .form {
    width: 100%;
    display: grid;
    gap: 16px;
  }

  label {
    display: grid;
    gap: 8px;
    text-align: left;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.9);
  }

  input {
    width: 100%;
    padding: 12px 14px;
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    background: rgba(255, 255, 255, 0.05);
    color: #fff;
    font-size: 1rem;
  }

  input::placeholder {
    color: rgba(255, 255, 255, 0.5);
  }

  button {
    justify-self: center;
    padding: 12px 22px;
    border-radius: 999px;
    border: none;
    background: rgba(200, 16, 46, 0.9);
    color: #fff;
    font-weight: 600;
    font-size: 1rem;
    letter-spacing: 0.01em;
    cursor: pointer;
    box-shadow: 0 12px 22px rgba(200, 16, 46, 0.28);
    transition: transform 120ms ease, box-shadow 120ms ease, background 120ms ease;
  }

  button:hover {
    transform: translateY(-1px);
    background: rgba(200, 16, 46, 1);
    box-shadow: 0 16px 30px rgba(200, 16, 46, 0.35);
  }

  .note {
    font-size: 0.95rem;
    color: rgba(255, 255, 255, 0.7);
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
