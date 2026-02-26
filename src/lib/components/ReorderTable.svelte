<script lang="ts">
	import HorizontalScrollArea from '$lib/components/HorizontalScrollArea.svelte';

	type ShiftChangeRow = {
		sortOrder?: number;
		startDate: string;
		endDate?: string | null;
		name: string;
		patternId: number | null;
		pattern: string;
	};

	type ShiftRow = {
		employeeTypeId: number;
		sortOrder: number;
		name: string;
		pattern: string;
		patternId: number | null;
		startDate: string;
		changes?: ShiftChangeRow[];
	};

	function isDateOnly(value: string): boolean {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
		const [yearText, monthText, dayText] = value.split('-');
		const year = Number(yearText);
		const month = Number(monthText);
		const day = Number(dayText);
		const parsed = new Date(Date.UTC(year, month - 1, day));
		if (Number.isNaN(parsed.getTime())) return false;
		return (
			parsed.getUTCFullYear() === year &&
			parsed.getUTCMonth() + 1 === month &&
			parsed.getUTCDate() === day
		);
	}

	function formatDateForDisplay(value: string): string {
		if (!isDateOnly(value)) return value;
		const [yearText, monthText, dayText] = value.split('-');
		return `${Number(monthText)}/${Number(dayText)}/${yearText}`;
	}

	function formatOptionalDateForDisplay(value: string | null | undefined, emptyLabel: string): string {
		if (!value) return emptyLabel;
		return formatDateForDisplay(value);
	}

	export let shifts: ShiftRow[] = [];
	export let expandedShiftRows: Set<number> = new Set<number>();
	export let isShiftReorderLoading = false;
	export let displayShiftEndDate: (shift: ShiftRow) => string = () => 'Indefinite';
	export let hasShiftHistoryChanges: (shift: ShiftRow) => boolean = () => false;
	export let changesForShift: (shift: ShiftRow) => ShiftChangeRow[] = (shift) => shift.changes ?? [];
	export let onToggleShiftDetails: (shiftId: number) => void = () => {};
	export let onEditShift: (shift: ShiftRow) => void = () => {};
	export let onEditShiftHistory: (shift: ShiftRow, change: ShiftChangeRow) => void = () => {};
	export let onReorder: (sourceId: number, nextOrderedIds: number[]) => Promise<void> | void = () => {};

	let tableEl: HTMLTableElement | null = null;

	type DragState = {
		sourceId: number;
		collapseSourceDetails: boolean;
		group: HTMLTableSectionElement;
		row: HTMLTableRowElement;
		detailsRow: HTMLTableRowElement | null;
		toggleBtn: HTMLButtonElement | null;
		handle: HTMLButtonElement;
		placeholder: HTMLTableSectionElement;
		ghost: HTMLDivElement;
		offsetX: number;
		offsetY: number;
		lastPointerY: number;
		currentBefore: HTMLTableSectionElement | null;
	};
	let dragState: DragState | null = null;
	const shiftReorderDebug = true;
	let lastToggledShiftId: number | null = null;

	function logShiftReorder(message: string, details?: Record<string, unknown>) {
		if (!shiftReorderDebug || typeof console === 'undefined') return;
		if (details) {
			console.log(`[ReorderTable] ${message}`, details);
			return;
		}
		console.log(`[ReorderTable] ${message}`);
	}

	function isDraggedRowTemporarilyCollapsed(shiftId: number): boolean {
		return Boolean(
			dragState &&
			dragState.collapseSourceDetails &&
			dragState.sourceId === shiftId
		);
	}

	function handleToggleShiftDetailsClick(shiftId: number) {
		lastToggledShiftId = shiftId;
		logShiftReorder('Show/Hide clicked', {
			shiftId,
			wasExpanded: expandedShiftRows.has(shiftId),
			hasDragState: Boolean(dragState),
			collapseSourceDetails: dragState?.collapseSourceDetails ?? false,
			dragSourceId: dragState?.sourceId ?? null
		});
		onToggleShiftDetails(shiftId);
		setTimeout(() => {
			logShiftReorder('Post-toggle state snapshot', {
				shiftId,
				isExpandedNow: expandedShiftRows.has(shiftId),
				hasDragState: Boolean(dragState)
			});
		}, 0);
	}

	$: if (lastToggledShiftId !== null) {
		const toggledShift = shifts.find((shift) => shift.employeeTypeId === lastToggledShiftId) ?? null;
		logShiftReorder('Prop/render sync snapshot', {
			shiftId: lastToggledShiftId,
			inShifts: Boolean(toggledShift),
			expandedInProp: expandedShiftRows.has(lastToggledShiftId),
			hasHistory: toggledShift ? hasShiftHistoryChanges(toggledShift) : null,
			changesCount: toggledShift ? changesForShift(toggledShift).length : null,
			temporarilyCollapsed: toggledShift
				? isDraggedRowTemporarilyCollapsed(toggledShift.employeeTypeId)
				: null,
			hasDragState: Boolean(dragState),
			collapseSourceDetails: dragState?.collapseSourceDetails ?? false,
			dragSourceId: dragState?.sourceId ?? null
		});
	}

	function groups(): HTMLTableSectionElement[] {
		if (!tableEl) return [];
		return Array.from(tableEl.querySelectorAll('tbody[data-shift-group-id]')).filter(
			(group): group is HTMLTableSectionElement => group instanceof HTMLTableSectionElement
		);
	}

	function groupShiftId(group: HTMLTableSectionElement | null): number | null {
		if (!group) return null;
		const raw = group.dataset.shiftGroupId;
		if (!raw) return null;
		const parsed = Number(raw);
		return Number.isInteger(parsed) ? parsed : null;
	}

	function makePlaceholder(heightPx: number): HTMLTableSectionElement {
		const tbody = document.createElement('tbody');
		tbody.className = 'shiftReorderPlaceholderGroup';
		const tr = document.createElement('tr');
		tr.className = 'shiftReorderPlaceholderRow';
		const td = document.createElement('td');
		td.colSpan = 7;
		td.innerHTML = `<div class="shiftReorderPlaceholderBox" style="--shift-ph-h:${Math.max(40, Math.round(heightPx))}px"></div>`;
		tr.appendChild(td);
		tbody.appendChild(tr);
		return tbody;
	}

	function buildGhostFromGroup(group: HTMLTableSectionElement, collapseDetails: boolean): HTMLDivElement {
		const ghost = document.createElement('div');
		ghost.className = 'shiftReorderGhost';
		const width = tableEl?.getBoundingClientRect().width ?? group.getBoundingClientRect().width;
		ghost.style.width = `${Math.round(width)}px`;

		const mini = document.createElement('table');
		const miniBody = group.cloneNode(true) as HTMLTableSectionElement;
		if (collapseDetails) {
			miniBody.querySelector('.setupDetailsRow')?.remove();
			const chevronBtn = miniBody.querySelector('.rowChevronBtn');
			if (chevronBtn instanceof HTMLButtonElement) {
				chevronBtn.textContent = 'Show';
				chevronBtn.setAttribute('aria-expanded', 'false');
			}
		}
		const btn = miniBody.querySelector('.shiftReorderHandleBtn');
		if (btn instanceof HTMLButtonElement) btn.blur();

		mini.appendChild(miniBody);
		ghost.appendChild(mini);
		document.body.appendChild(ghost);
		return ghost;
	}

	function beforeGroupForPointer(
		pointerY: number,
		sourceGroup: HTMLTableSectionElement,
		movingDown: boolean
	): HTMLTableSectionElement | null {
		const all = groups().filter((group) => group !== sourceGroup);
		if (all.length === 0) return null;

		for (let index = 0; index < all.length; index += 1) {
			const group = all[index];
			const rect = group.getBoundingClientRect();
			if (pointerY < rect.top) return group;
			if (pointerY <= rect.bottom) {
				return movingDown ? (all[index + 1] ?? null) : group;
			}
		}
		return null;
	}

	function onPointerMove(event: PointerEvent) {
		if (!dragState || !tableEl) return;
		event.preventDefault();

		const x = event.clientX - dragState.offsetX;
		const y = event.clientY - dragState.offsetY;
		dragState.ghost.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;

		const movingDown = event.clientY >= dragState.lastPointerY;
		const before = beforeGroupForPointer(event.clientY, dragState.group, movingDown);
		dragState.lastPointerY = event.clientY;
		if (before === dragState.currentBefore) return;
		dragState.currentBefore = before;

		if (before) {
			tableEl.insertBefore(dragState.placeholder, before);
		} else {
			tableEl.appendChild(dragState.placeholder);
		}
	}

	async function cleanupDrag(commit: boolean) {
		if (!dragState || !tableEl) return;
		const state = dragState;

		document.body.classList.remove('teamShiftRowDragging');
		state.row.classList.remove('is-dragging');
		if (state.collapseSourceDetails) {
			if (state.detailsRow) {
				state.detailsRow.style.display = '';
			}
			if (state.toggleBtn) {
				state.toggleBtn.textContent = 'Hide';
				state.toggleBtn.setAttribute('aria-expanded', 'true');
			}
		}

		if (commit) {
			tableEl.insertBefore(state.group, state.placeholder);
		}

		const orderedIds = groups()
			.map((group) => groupShiftId(group))
			.filter((id): id is number => id !== null);
		const sourceId = groupShiftId(state.group);

		state.placeholder.remove();
		state.ghost.remove();
		state.handle.blur();

		window.removeEventListener('pointermove', onPointerMove);
		window.removeEventListener('pointerup', onPointerUp);
		window.removeEventListener('pointercancel', onPointerUp);

		// Drag interaction is complete at this point; clear UI drag state immediately.
		dragState = null;

		if (commit && sourceId !== null) {
			await onReorder(sourceId, orderedIds);
		}
	}

	function onPointerUp(event: PointerEvent) {
		if (!dragState) return;
		event.preventDefault();
		void cleanupDrag(true);
	}

	function startDrag(
		group: HTMLTableSectionElement,
		row: HTMLTableRowElement,
		handle: HTMLButtonElement,
		event: PointerEvent
	) {
		if (isShiftReorderLoading || !tableEl) return;
		const sourceId = groupShiftId(group);
		if (sourceId === null) return;
		const collapseDetails = expandedShiftRows.has(sourceId);
		const detailsRow = collapseDetails
			? (group.querySelector('tr.setupDetailsRow') as HTMLTableRowElement | null)
			: null;
		const toggleBtn = row.querySelector('.rowChevronBtn');
		const toggleBtnEl = toggleBtn instanceof HTMLButtonElement ? toggleBtn : null;
		if (collapseDetails) {
			if (detailsRow) {
				detailsRow.style.display = 'none';
			}
			if (toggleBtnEl) {
				toggleBtnEl.textContent = 'Show';
				toggleBtnEl.setAttribute('aria-expanded', 'false');
			}
		}

		const rect = group.getBoundingClientRect();
		const rowRect = row.getBoundingClientRect();
		const ghost = buildGhostFromGroup(group, collapseDetails);
		const offsetX = event.clientX - rect.left;
		const offsetY = event.clientY - rect.top;
		ghost.style.transform = `translate(${Math.round(rect.left)}px, ${Math.round(rect.top)}px)`;

		const placeholder = makePlaceholder(rowRect.height);
		tableEl.insertBefore(placeholder, group.nextSibling);

		row.classList.add('is-dragging');
		document.body.classList.add('teamShiftRowDragging');

		dragState = {
			sourceId,
			collapseSourceDetails: collapseDetails,
			group,
			row,
			detailsRow,
			toggleBtn: toggleBtnEl,
			handle,
			placeholder,
			ghost,
			offsetX,
			offsetY,
			lastPointerY: event.clientY,
			currentBefore: null
		};

		window.addEventListener('pointermove', onPointerMove, { passive: false });
		window.addEventListener('pointerup', onPointerUp, { passive: false });
		window.addEventListener('pointercancel', onPointerUp, { passive: false });

		onPointerMove(event);
	}

	function onHandlePointerDown(event: PointerEvent) {
		if (isShiftReorderLoading || dragState) return;
		const target = event.target as HTMLElement | null;
		const handle = target?.closest('.shiftReorderHandleBtn');
		if (!(handle instanceof HTMLButtonElement)) return;
		if (event.button !== undefined && event.button !== 0) return;

		const row = target?.closest('tr[data-shift-id]');
		if (!(row instanceof HTMLTableRowElement)) return;
		const group = row.closest('tbody[data-shift-group-id]');
		if (!(group instanceof HTMLTableSectionElement)) return;

		event.preventDefault();
		startDrag(group, row, handle, event);
	}

	function onWindowKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && dragState) {
			event.preventDefault();
			void cleanupDrag(false);
		}
	}
</script>

<svelte:window on:keydown={onWindowKeydown} />

<HorizontalScrollArea>
	<table class="setupTable shiftsTimelineTable" bind:this={tableEl} on:pointerdown={onHandlePointerDown}>
		<colgroup>
			<col class="shiftColHandle" />
			<col class="shiftColName" />
			<col class="shiftColPattern" />
			<col class="shiftColStart" />
			<col class="shiftColEnd" />
			<col class="shiftColChanges" />
			<col class="shiftColActions" />
		</colgroup>
		<thead>
			<tr>
				<th class="shiftHandleColHead">
					<span class="srOnly">Reorder</span>
				</th>
				<th>Shift</th>
				<th>Pattern</th>
				<th>Start Date</th>
				<th>End Date</th>
				<th>Changes</th>
				<th class="shiftActionsColHead">
					<span class="srOnly">Actions</span>
				</th>
			</tr>
		</thead>
		{#each shifts as shift (shift.employeeTypeId)}
			<tbody data-shift-group-id={shift.employeeTypeId}>
				<tr data-shift-id={shift.employeeTypeId}>
					<td class="shiftHandleCell">
						<button
							type="button"
							class="shiftReorderHandleBtn"
							aria-label={`Move ${shift.name}`}
							title="Drag to reorder shift"
							disabled={isShiftReorderLoading}
						>
							<svg
								class="shiftReorderHandleIcon"
								viewBox="0 0 16 16"
								aria-hidden="true"
								focusable="false"
							>
								<path d="M3 4H13" />
								<path d="M3 8H13" />
								<path d="M3 12H13" />
							</svg>
						</button>
					</td>
					<td>{shift.name}</td>
					<td>{shift.pattern || 'Unassigned'}</td>
					<td>{formatDateForDisplay(shift.startDate)}</td>
					<td>{displayShiftEndDate(shift)}</td>
					<td class="shiftChangesCell">
						{#if hasShiftHistoryChanges(shift)}
								<button
									type="button"
									class="rowChevronBtn"
									aria-label={expandedShiftRows.has(shift.employeeTypeId) &&
									!isDraggedRowTemporarilyCollapsed(shift.employeeTypeId)
										? 'Hide shift change history'
										: 'Show shift change history'}
									aria-expanded={expandedShiftRows.has(shift.employeeTypeId) &&
									!isDraggedRowTemporarilyCollapsed(shift.employeeTypeId)}
									on:click={() => handleToggleShiftDetailsClick(shift.employeeTypeId)}
								>
									{expandedShiftRows.has(shift.employeeTypeId) &&
									!isDraggedRowTemporarilyCollapsed(shift.employeeTypeId)
										? 'Hide'
										: 'Show'}
								</button>
						{:else}
							<span class="shiftChangesNone">None</span>
						{/if}
					</td>
					<td class="shiftActionsCell">
						<button type="button" class="btn" on:click={() => onEditShift(shift)}>
							Edit
						</button>
					</td>
				</tr>
				{#if hasShiftHistoryChanges(shift) &&
					expandedShiftRows.has(shift.employeeTypeId) &&
					!isDraggedRowTemporarilyCollapsed(shift.employeeTypeId)}
					<tr class="setupDetailsRow">
						<td colspan={7}>
							<HorizontalScrollArea>
								<table class="setupSubTable shiftDetailsSubTable">
									<thead>
										<tr>
											<th>Pattern</th>
											<th>Effective Start</th>
											<th>Effective End</th>
											<th></th>
										</tr>
									</thead>
									<tbody>
										{#if changesForShift(shift).length === 0}
											<tr>
												<td colspan="4">No changes found.</td>
											</tr>
										{:else}
											{#each changesForShift(shift) as change}
												<tr>
													<td>{change.pattern || 'Unassigned'}</td>
													<td>{formatDateForDisplay(change.startDate)}</td>
													<td>{formatOptionalDateForDisplay(change.endDate, 'Indefinite')}</td>
													<td>
														<button
															type="button"
															class="btn"
															on:click={() => onEditShiftHistory(shift, change)}
														>
															Edit
														</button>
													</td>
												</tr>
											{/each}
										{/if}
									</tbody>
								</table>
							</HorizontalScrollArea>
						</td>
					</tr>
				{/if}
			</tbody>
		{/each}
	</table>
</HorizontalScrollArea>

<style>
	:global(body.teamShiftRowDragging *) {
		user-select: none !important;
	}

	:global(tr.is-dragging) {
		display: none;
	}
</style>
