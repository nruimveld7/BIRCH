<script lang="ts">
	import { dev } from '$app/environment';
	import { base } from '$app/paths';
	import { onDestroy, onMount } from 'svelte';
	import '$lib/styles/theme.css';
	import { fetchWithAuthRedirect } from '$lib/utils/fetchWithAuthRedirect';

	type ScheduleRole = 'Member' | 'Maintainer' | 'Manager';
	type DevConsoleResponse = {
		ok?: boolean;
		command?: string;
		applied?: {
			onboardingLevel?: 'None' | ScheduleRole;
			onboardingTier?: number;
			accessRole?: ScheduleRole;
			scheduleId?: number;
			bootstrapStatus?: 0 | 1;
			cleared?: boolean;
		};
		message?: string;
	};
	type ShiftScheduleDevConsole = {
		run: (command: string) => Promise<DevConsoleResponse>;
		help: () => string[];
	};

	declare global {
		interface Window {
			shiftScheduleDev?: ShiftScheduleDevConsole;
		}
	}

	let { children, data } = $props<{
		children: () => unknown;
		data: {
			currentUserOid: string | null;
		};
	}>();

	function devConsoleHelp(): string[] {
		return [
			'await window.shiftScheduleDev.run("onboarding=none")',
			'await window.shiftScheduleDev.run("onboarding=member")',
			'await window.shiftScheduleDev.run("onboarding=maintainer")',
			'await window.shiftScheduleDev.run("onboarding=manager")',
			'await window.shiftScheduleDev.run("access=none")',
			'await window.shiftScheduleDev.run("access=member")',
			'await window.shiftScheduleDev.run("access=maintainer")',
			'await window.shiftScheduleDev.run("access=manager")',
			'await window.shiftScheduleDev.run("BootstrapStatus=0")',
			'await window.shiftScheduleDev.run("BootstrapStatus=1")',
			'await window.shiftScheduleDev.run("CleanSlate")'
		];
	}

	function registerDevConsoleCommands() {
		if (!dev || !data.currentUserOid || typeof window === 'undefined') return;
		window.shiftScheduleDev = {
			run: async (command: string) => {
				const response = await fetchWithAuthRedirect(
					`${base}/api/dev/console`,
					{
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({ command })
					},
					base
				);
				if (!response) {
					throw new Error('Request was cancelled');
				}
				const payload = (await response
					.json()
					.catch(() => null)) as DevConsoleResponse | null;
				if (!response.ok) {
					throw new Error(
						payload?.message?.trim() || `Command failed with status ${response.status}`
					);
				}
				window.location.reload();
				return payload ?? { ok: true };
			},
			help: devConsoleHelp
		};
	}

	onMount(() => {
		registerDevConsoleCommands();
	});

	$effect(() => {
		registerDevConsoleCommands();
	});

	onDestroy(() => {
		if (typeof window === 'undefined') return;
		if (window.shiftScheduleDev) {
			delete window.shiftScheduleDev;
		}
	});
</script>

{@render children()}
