<script lang="ts">
	import { createEventDispatcher } from 'svelte';

	export type ConfirmDialogTone = 'default' | 'danger' | 'primary';
	export type ConfirmDialogOption = {
		id: string;
		label: string;
		tone?: ConfirmDialogTone;
	};

	export let open = false;
	export let title = '';
	export let message = '';
	export let options: ConfirmDialogOption[] = [];
	export let cancelOptionId = 'cancel';
	export let closeOnBackdrop = true;

	const dispatch = createEventDispatcher<{ select: string }>();

	function select(optionId: string) {
		dispatch('select', optionId);
	}

	function handleBackdropMouseDown(event: MouseEvent) {
		if (!closeOnBackdrop) return;
		if (event.target !== event.currentTarget) return;
		select(cancelOptionId);
	}
</script>

{#if open}
	<div class="confirmDialogLayer" role="presentation" on:mousedown={handleBackdropMouseDown}>
		<div class="confirmDialogPanel" role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-title">
			<h3 id="confirm-dialog-title">{title}</h3>
			<p class="confirmDialogMessage">{message}</p>
			<div class="confirmDialogActions">
				{#each options as option (option.id)}
					<button
						type="button"
						class={`confirmDialogBtn${option.tone === 'danger'
							? ' danger'
							: option.tone === 'primary'
								? ' primary'
								: ''}`}
						on:click={() => select(option.id)}
					>
						{option.label}
					</button>
				{/each}
			</div>
		</div>
	</div>
{/if}

<style>
	.confirmDialogLayer {
		position: fixed;
		inset: 0;
		z-index: 1000;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 20px;
		background: rgba(0, 0, 0, 0.28);
	}

	.confirmDialogPanel {
		width: min(560px, calc(100dvw - 40px));
		border: 1px solid var(--modal-border, rgba(255, 255, 255, 0.16));
		border-radius: 14px;
		background: var(--modal-surface, #13161d);
		box-shadow: var(--shadow, 0 20px 40px rgba(0, 0, 0, 0.35));
		padding: 16px;
		display: grid;
		gap: 12px;
	}

	.confirmDialogPanel h3 {
		margin: 0;
		font-size: 18px;
		color: var(--text, #f3f6fc);
	}

	.confirmDialogMessage {
		margin: 0;
		color: var(--text, #f3f6fc);
		white-space: pre-wrap;
		line-height: 1.4;
	}

	.confirmDialogActions {
		display: flex;
		justify-content: flex-end;
		gap: 10px;
		flex-wrap: wrap;
	}

	.confirmDialogBtn {
		appearance: none;
		border: 1px solid var(--interactive-border, rgba(255, 255, 255, 0.2));
		background: var(--button-bg, transparent);
		color: var(--text, #f3f6fc);
		padding: 8px 14px;
		border-radius: 10px;
		font-weight: 700;
		cursor: pointer;
		min-width: 92px;
	}

	.confirmDialogBtn:hover {
		background: var(--interactive-bg-hover, rgba(255, 255, 255, 0.1));
	}

	.confirmDialogBtn.primary {
		background: var(--accent-2, #1f76ff);
		border-color: var(--accent-2, #1f76ff);
		color: #fff;
	}

	.confirmDialogBtn.primary:hover {
		background: var(--accent-3, #155bd0);
		border-color: var(--accent-3, #155bd0);
	}

	.confirmDialogBtn.danger {
		background: rgba(220, 38, 38, 0.18);
		border-color: rgba(220, 38, 38, 0.6);
		color: #fecaca;
	}

	.confirmDialogBtn.danger:hover {
		background: rgba(220, 38, 38, 0.28);
		border-color: rgba(220, 38, 38, 0.8);
	}

	:global(:root[data-theme='light']) .confirmDialogBtn.danger {
		background: rgba(200, 16, 46, 0.1);
		border-color: rgba(200, 16, 46, 0.55);
		color: rgba(120, 10, 30, 0.96);
	}

	:global(:root[data-theme='light']) .confirmDialogBtn.danger:hover {
		background: rgba(200, 16, 46, 0.16);
		border-color: rgba(200, 16, 46, 0.7);
		color: rgba(110, 8, 26, 0.98);
	}
</style>
