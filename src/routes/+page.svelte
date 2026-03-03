<svelte:head>
	<title>Equipment Lifecycle Manager</title>
	<meta
		name="description"
		content="Equipment Lifecycle Manager (ELM) starter shell built with SvelteKit."
	/>
</svelte:head>

<main class="elm-shell">
	<section class="hero">
		<p class="eyebrow">ELM</p>
		<h1>Equipment Lifecycle Manager</h1>
		<p>
			Starter shell is live. Authentication, data model, and business workflows will be added as the
			new platform is defined.
		</p>
	</section>

	<section class="cards" aria-label="Project status">
		<article class="card">
			<h2>Frontend Shell</h2>
			<p>Ready for route and component development.</p>
		</article>
		<article class="card">
			<h2>Backend API</h2>
			<p>Reset to a minimal baseline with one health endpoint.</p>
		</article>
		<article class="card">
			<h2>Database</h2>
			<p>Schema reset to a neutral starting point for ELM-specific design.</p>
		</article>
	</section>
</main>

<style>
	:global(body) {
		margin: 0;
	}

	.elm-shell {
		min-height: 100vh;
		padding: clamp(1.5rem, 2.5vw, 3rem);
		display: grid;
		align-content: start;
		gap: 1.5rem;
	}

	.hero {
		max-width: 60rem;
		display: grid;
		gap: 0.75rem;
	}

	.eyebrow {
		margin: 0;
		font-size: 0.78rem;
		font-weight: 700;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--muted);
	}

	h1 {
		margin: 0;
		font-size: clamp(2rem, 4.5vw, 3.25rem);
		letter-spacing: -0.02em;
	}

	p {
		margin: 0;
		line-height: 1.6;
		color: var(--muted);
	}

	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
		gap: 1rem;
	}

	.card {
		padding: 1rem;
		border-radius: 0.9rem;
		background: var(--panel);
		border: 1px solid color-mix(in oklab, var(--ink) 10%, transparent);
		box-shadow: 0 12px 30px rgba(0, 0, 0, 0.08);
		display: grid;
		gap: 0.5rem;
	}

	h2 {
		margin: 0;
		font-size: 1.05rem;
	}
</style>
