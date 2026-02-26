<script lang="ts">
	import { page } from '$app/stores';

	const DEFAULT_MESSAGE = 'An unexpected error occurred while loading the authentication error page.';
	$: currentStatus = $page.status ?? 500;
	$: currentMessage = $page.error?.message ?? DEFAULT_MESSAGE;
</script>

<svelte:head>
	<title>Shift Schedule - Authentication Error</title>
	<meta
		name="description"
		content="An authentication-related error occurred. Retry sign-in or return to the home page."
	/>
</svelte:head>

<main class="auth-error-fallback">
	<section class="panel" role="alert" aria-live="assertive">
		<div class="badge">Authentication Error</div>
		<h1>We could not display that sign-in page</h1>
		<p>{currentMessage}</p>
		<div class="meta">Status: {currentStatus}</div>
		<div class="actions">
			<a class="primary" href="/">Try Again</a>
		</div>
	</section>
</main>

<style>
	:global(body) {
		margin: 0;
	}

	.auth-error-fallback {
		min-height: 100vh;
		display: grid;
		place-items: center;
		padding: 40px 20px;
		background:
			radial-gradient(900px 500px at 20% 15%, rgba(200, 16, 46, 0.16), transparent 60%),
			radial-gradient(900px 500px at 80% 10%, rgba(38, 78, 255, 0.14), transparent 55%),
			linear-gradient(180deg, rgba(10, 10, 12, 0.98), rgba(12, 12, 16, 0.98));
		color: #f7f7f8;
	}

	.panel {
		width: min(680px, 100%);
		display: grid;
		gap: 16px;
		text-align: center;
		background: rgba(20, 20, 26, 0.82);
		border: 1px solid rgba(200, 16, 46, 0.5);
		border-radius: 16px;
		padding: 34px;
		box-shadow: 0 20px 52px rgba(0, 0, 0, 0.4);
		backdrop-filter: blur(10px);
	}

	.badge {
		justify-self: center;
		font-size: 0.82rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		padding: 6px 12px;
		border-radius: 999px;
		background: rgba(200, 16, 46, 0.2);
		border: 1px solid rgba(200, 16, 46, 0.6);
	}

	h1 {
		margin: 0;
		font-size: 2rem;
	}

	p {
		margin: 0;
		line-height: 1.55;
		color: rgba(247, 247, 248, 0.86);
	}

	.meta {
		font-size: 0.84rem;
		color: rgba(247, 247, 248, 0.65);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		justify-content: center;
		padding-top: 6px;
	}

	.actions a {
		text-decoration: none;
		border-radius: 999px;
		padding: 10px 16px;
		font-weight: 600;
	}

	.primary {
		color: #fff;
		background: rgba(200, 16, 46, 0.75);
		border: 1px solid rgba(255, 106, 131, 0.75);
	}

	@media (max-width: 640px) {
		.panel {
			padding: 26px;
		}

		h1 {
			font-size: 1.56rem;
		}
	}
</style>
