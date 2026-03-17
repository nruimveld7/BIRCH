<script lang="ts">
	import { base } from '$app/paths';
	import { createEventDispatcher } from 'svelte';
	import { onDestroy, onMount, tick } from 'svelte';
	import { fetchWithAuthRedirect as fetchWithAuthRedirectUtil } from '$lib/utils/fetchWithAuthRedirect';

	type EntraUser = {
		userOid: string;
		displayName?: string;
		email?: string | null;
	};

	type ActiveUserDrag = {
		sourceComboId: string;
		sourceIndex: number;
		user: EntraUser;
	};

	type DragHoverDetail = {
		active: ActiveUserDrag | null;
		targetComboId: string | null;
		targetIndex: number | null;
		overCombobox: boolean;
		pointerX: number;
		pointerY: number;
	};

	type UserMoveDetail = {
		moveId: string;
		sourceComboId: string;
		sourceIndex: number;
		targetComboId: string;
		targetIndex: number;
		user: EntraUser;
	};

	type SourceDragSession = {
		pointerId: number;
		handleEl: HTMLButtonElement;
		ghostEl: HTMLDivElement;
		ghostOffsetX: number;
		ghostOffsetY: number;
		lastHover: DragHoverDetail;
	};

	const DRAG_STATE_EVENT = 'node-user-drag-state';
	const DRAG_HOVER_EVENT = 'node-user-drag-hover';
	const MOVE_EVENT = 'node-user-move';
	const CANCEL_DRAG_EVENT = 'birch-cancel-user-row-drag';
	const ACTIVE_DRAG_WINDOW_KEY = '__birchNodeUserActiveDrag';
	const ACTIVE_HOVER_WINDOW_KEY = '__birchNodeUserActiveHover';
	const ACCEPTED_MOVES_WINDOW_KEY = '__birchNodeUserAcceptedMoves';
	const DEBUG_USER_DRAG = true;

	export let ariaLabel = 'User search';
	export let placeholder = 'Search by name or email';
	export let disabled = false;
	export let viewOnly = false;
	export let hideSearchInput = false;
	export let autoFocus = false;
	export let directoryOnly = false;
	export let renderLabelsInline = true;
	export let interactionLocked = false;
	export let comboId: string | null = null;
	export let selectedUserOids: string[] = [];
	export let knownUsers: Array<{ userOid: string; displayName: string; email: string | null }> = [];
	const dispatch = createEventDispatcher<{
		interact: { comboId: string };
		selectionchange: {
			userOids: string[];
			count: number;
			users: Array<{ userOid: string; displayName: string; email: string | null }>;
		};
		dragpreviewchange: {
			comboId: string;
			visibleUserOids: string[];
			placeholderIndex: number | null;
		};
	}>();

	let comboEl: HTMLDivElement | null = null;
	let inputEl: HTMLInputElement | null = null;
	let resultsEl: HTMLDivElement | null = null;
	let resultsRailEl: HTMLDivElement | null = null;

	let query = '';
	let users: EntraUser[] = [];
	let error = '';
	let duplicateError = '';
	let loading = false;
	let searchTimer: ReturnType<typeof setTimeout> | null = null;
	let showResults = false;
	let selectedUsers: EntraUser[] = [];

	let showResultsScrollbar = false;
	let resultsThumbHeightPx = 0;
	let resultsThumbTopPx = 0;
	let isDraggingResultsScrollbar = false;
	let resultsDragStartY = 0;
	let resultsDragStartThumbTopPx = 0;

	let activeDrag: ActiveUserDrag | null = null;
	let dragPlaceholderIndex: number | null = null;
	let isDragOverCombobox = false;
	let hoverTargetComboId: string | null = null;
	let hoverTargetIndex: number | null = null;
	let hoverOverCombobox = false;
	let displayedRows: Array<{ user: EntraUser; originalIndex: number }> = [];
	let sourceDragSession: SourceDragSession | null = null;
	let pendingLocalUserOids: string[] | null = null;
	let canShowDragPreview = false;
	let lastLoggedHoverSignature = '';
	let lastLoggedPreviewSignature = '';

	function debugUserDrag(label: string, detail: Record<string, unknown>) {
		if (!DEBUG_USER_DRAG || typeof console === 'undefined') return;
		console.log(`[birch user-drag combobox] ${label}`, detail);
	}

	function normalizeUserOids(userOids: string[]) {
		const seen = new Set<string>();
		const normalized: string[] = [];
		for (const userOid of userOids) {
			const trimmed = `${userOid ?? ''}`.trim();
			if (trimmed.length === 0 || seen.has(trimmed)) continue;
			seen.add(trimmed);
			normalized.push(trimmed);
		}
		return normalized;
	}

	function sameUserOidList(a: string[], b: string[]) {
		if (a.length !== b.length) return false;
		for (let i = 0; i < a.length; i += 1) {
			if (a[i] !== b[i]) return false;
		}
		return true;
	}

	function setSelectedUsersFromLocal(nextUsers: EntraUser[]) {
		selectedUsers = nextUsers;
		pendingLocalUserOids = nextUsers.map((user) => user.userOid);
	}

	const resolvedComboId =
		comboId ??
		(typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
			? crypto.randomUUID()
			: `combo-${Date.now()}-${Math.round(Math.random() * 100000)}`);

	$: displayedRows = selectedUsers
		.map((user, originalIndex) => ({ user, originalIndex }))
		.filter(
			(row) =>
				!(
					activeDrag &&
					activeDrag.sourceComboId === resolvedComboId &&
					row.originalIndex === activeDrag.sourceIndex
				)
		);
	$: if (activeDrag) {
		displayedRows.length;
		updateDragPreviewFromGlobalHover();
	}
	$: canShowDragPreview =
		!viewOnly && !directoryOnly && Boolean(activeDrag) && isDragAllowedFor(activeDrag);
	$: {
		const normalizedSelectedUserOids = normalizeUserOids(selectedUserOids);
		const awaitingLocalApply =
			pendingLocalUserOids &&
			!sameUserOidList(normalizedSelectedUserOids, pendingLocalUserOids);
		if (!awaitingLocalApply) {
			pendingLocalUserOids = null;
			const currentSelectedUserOids = selectedUsers.map((user) => user.userOid);
			if (!sameUserOidList(normalizedSelectedUserOids, currentSelectedUserOids)) {
				const knownUsersByOid = new Map(knownUsers.map((user) => [user.userOid, user]));
				const existingUsersByOid = new Map(selectedUsers.map((user) => [user.userOid, user]));
				selectedUsers = normalizedSelectedUserOids.map((userOid) => {
					const known = knownUsersByOid.get(userOid);
					if (known) {
						return {
							userOid: known.userOid,
							displayName: known.displayName,
							email: known.email
						};
					}
					return (
						existingUsersByOid.get(userOid) ?? {
							userOid,
							displayName: userOid,
							email: null
						}
					);
				});
			}
		}
	}
	$: {
		const userOids = selectedUsers.map((user) => user.userOid);
		dispatch('selectionchange', {
			userOids,
			count: userOids.length,
			users: selectedUsers.map((user) => ({
				userOid: user.userOid,
				displayName: userDisplayName(user) || user.userOid,
				email: user.email ?? null
			}))
		});
	}
	$: {
		displayedRows;
		dragPlaceholderIndex;
		dispatch('dragpreviewchange', {
			comboId: resolvedComboId,
			visibleUserOids: displayedRows.map((row) => row.user.userOid),
			placeholderIndex: dragPlaceholderIndex
		});
	}

	async function fetchWithAuthRedirect(
		input: RequestInfo | URL,
		init: RequestInit
	): Promise<Response | null> {
		return fetchWithAuthRedirectUtil(input, init, base);
	}

	function userLabel(user: EntraUser): string {
		const email = (user.email ?? '').trim();
		const formattedName = userDisplayName(user);
		if (formattedName && email) return `${formattedName} <${email}>`;
		return formattedName || email || user.userOid;
	}

	function userDisplayName(user: EntraUser): string {
		const name = (user.displayName ?? '').trim();
		if (!name) return '';
		if (name.includes(',')) return name;
		const parts = name.split(/\s+/);
		if (parts.length < 2) return name;
		const last = parts.pop();
		const first = parts.join(' ');
		return `${last}, ${first}`;
	}

	function clamp(value: number, min: number, max: number) {
		return Math.min(max, Math.max(min, value));
	}

	function onRootPointerDownCapture(event: PointerEvent) {
		if (event.button !== 0) return;
		dispatch('interact', { comboId: resolvedComboId });
	}

	function stopWheelPropagation(event: WheelEvent) {
		event.stopPropagation();
	}

	function setGlobalScrollbarDragging(active: boolean) {
		if (typeof document === 'undefined') return;
		const body = document.body;
		const current = Number(body.dataset.scrollbarDragCount ?? '0');
		const next = Math.max(0, current + (active ? 1 : -1));
		if (next === 0) {
			delete body.dataset.scrollbarDragCount;
		} else {
			body.dataset.scrollbarDragCount = String(next);
		}
		body.classList.toggle('scrollbar-dragging', next > 0);
	}

	function resetResultsScrollbarState() {
		showResultsScrollbar = false;
		resultsThumbHeightPx = 0;
		resultsThumbTopPx = 0;
	}

	function updateResultsScrollbar() {
		if (!resultsEl) return;
		const scrollHeight = resultsEl.scrollHeight;
		const clientHeight = resultsEl.clientHeight;
		const scrollTop = resultsEl.scrollTop;
		const hasOverflow = scrollHeight > clientHeight + 1;

		showResultsScrollbar = hasOverflow;
		if (!hasOverflow) {
			resultsThumbHeightPx = 0;
			resultsThumbTopPx = 0;
			return;
		}

		const railHeight = resultsRailEl?.clientHeight ?? Math.max(clientHeight - 16, 0);
		if (railHeight <= 0) return;

		const minThumbHeight = 36;
		const nextThumbHeight = Math.max(minThumbHeight, (railHeight * clientHeight) / scrollHeight);
		const maxThumbTop = Math.max(railHeight - nextThumbHeight, 0);
		const maxScrollTop = Math.max(scrollHeight - clientHeight, 1);
		const nextThumbTop = (scrollTop / maxScrollTop) * maxThumbTop;

		resultsThumbHeightPx = nextThumbHeight;
		resultsThumbTopPx = clamp(nextThumbTop, 0, maxThumbTop);
	}

	function onResultsScroll() {
		if (!isDraggingResultsScrollbar) {
			updateResultsScrollbar();
		}
	}

	function onResultsDragMove(event: MouseEvent) {
		if (!isDraggingResultsScrollbar || !resultsEl || !resultsRailEl) return;

		const railHeight = resultsRailEl.clientHeight;
		const maxThumbTop = Math.max(railHeight - resultsThumbHeightPx, 0);
		const nextThumbTop = clamp(
			resultsDragStartThumbTopPx + (event.clientY - resultsDragStartY),
			0,
			maxThumbTop
		);
		const maxScrollTop = Math.max(resultsEl.scrollHeight - resultsEl.clientHeight, 0);

		resultsThumbTopPx = nextThumbTop;
		resultsEl.scrollTop = maxThumbTop > 0 ? (nextThumbTop / maxThumbTop) * maxScrollTop : 0;
	}

	function stopResultsDragging() {
		if (isDraggingResultsScrollbar) {
			setGlobalScrollbarDragging(false);
		}
		isDraggingResultsScrollbar = false;
		if (typeof window !== 'undefined') {
			window.removeEventListener('mousemove', onResultsDragMove);
			window.removeEventListener('mouseup', stopResultsDragging);
		}
	}

	function startResultsThumbDrag(event: MouseEvent) {
		if (!showResultsScrollbar) return;
		event.preventDefault();
		event.stopPropagation();
		isDraggingResultsScrollbar = true;
		setGlobalScrollbarDragging(true);
		resultsDragStartY = event.clientY;
		resultsDragStartThumbTopPx = resultsThumbTopPx;
		window.addEventListener('mousemove', onResultsDragMove);
		window.addEventListener('mouseup', stopResultsDragging);
	}

	function handleResultsRailClick(event: MouseEvent) {
		if (!resultsEl || !resultsRailEl || !showResultsScrollbar) return;
		if (event.target !== resultsRailEl) return;

		const rect = resultsRailEl.getBoundingClientRect();
		const desiredTop = clamp(
			event.clientY - rect.top - resultsThumbHeightPx / 2,
			0,
			Math.max(rect.height - resultsThumbHeightPx, 0)
		);
		const maxThumbTop = Math.max(rect.height - resultsThumbHeightPx, 1);
		const maxScrollTop = Math.max(resultsEl.scrollHeight - resultsEl.clientHeight, 0);
		resultsEl.scrollTop = (desiredTop / maxThumbTop) * maxScrollTop;
		updateResultsScrollbar();
	}

	function closeResults() {
		stopResultsDragging();
		showResults = false;
		resetResultsScrollbarState();
	}

	async function loadUsers(search = query) {
		loading = true;
		error = '';
		try {
			const queryParam = search.trim() ? `?q=${encodeURIComponent(search.trim())}` : '';
			const result = await fetchWithAuthRedirect(`${base}/api/chart/users${queryParam}`, {
				method: 'GET'
			});
			if (!result) return;
			if (!result.ok) throw new Error('Failed to load users');
			const data = await result.json();
			users = Array.isArray(data.users)
				? data.users.map((user: Record<string, unknown>) => ({
						userOid: String(user.userOid ?? ''),
						displayName: String(user.displayName ?? ''),
						email: user.email ? String(user.email) : null
					}))
				: [];
		} catch (fetchError) {
			error = fetchError instanceof Error ? fetchError.message : 'Failed to load users';
		} finally {
			loading = false;
		}
	}

	function onQueryInput(event: Event) {
		const target = event.target as HTMLInputElement;
		query = target.value;
		duplicateError = '';
		showResults = true;
		if (searchTimer) clearTimeout(searchTimer);
		searchTimer = setTimeout(() => {
			void loadUsers(query);
		}, 300);
	}

	function onComboMouseDown(event: MouseEvent) {
		if (interactionLocked) return;
		if (disabled) return;
		const target = event.target as HTMLElement | null;
		if (target?.closest('.setupUserComboItem')) return;
		showResults = true;
		if (users.length === 0 && query.trim().length > 0) {
			void loadUsers(query);
		}
	}

	function onUserSelect(user: EntraUser) {
		if (selectedUsers.some((existing) => existing.userOid === user.userOid)) {
			duplicateError = 'User is already added';
			closeResults();
			return;
		}
		setSelectedUsersFromLocal([...selectedUsers, user]);
		duplicateError = '';
		query = '';
		users = [];
		closeResults();
	}

	function removeSelectedUser(userOid: string) {
		setSelectedUsersFromLocal(selectedUsers.filter((user) => user.userOid !== userOid));
		duplicateError = '';
	}

	function onDocumentMouseDown(event: MouseEvent) {
		const target = event.target as Node;
		if (showResults && comboEl && !comboEl.contains(target)) {
			closeResults();
		}
		const activeEl = document.activeElement;
		if (
			comboEl &&
			activeEl instanceof HTMLElement &&
			comboEl.contains(activeEl) &&
			!comboEl.contains(target)
		) {
			activeEl.blur();
		}
	}

	function onCanvasBackgroundPointerDown() {
		closeResults();
		const activeEl = document.activeElement;
		if (comboEl && activeEl instanceof HTMLElement && comboEl.contains(activeEl)) {
			activeEl.blur();
		}
	}

	async function focusSearchInput() {
		if (!autoFocus || !inputEl || disabled || viewOnly || hideSearchInput) return;
		await tick();
		inputEl?.focus();
	}

	function broadcastDragState(next: ActiveUserDrag | null) {
		if (typeof window === 'undefined') return;
		(window as typeof window & Record<string, unknown>)[ACTIVE_DRAG_WINDOW_KEY] = next;
		window.dispatchEvent(
			new CustomEvent<ActiveUserDrag | null>(DRAG_STATE_EVENT, { detail: next })
		);
	}

	function broadcastDragHover(detail: DragHoverDetail) {
		if (typeof window === 'undefined') return;
		(window as typeof window & Record<string, unknown>)[ACTIVE_HOVER_WINDOW_KEY] = detail;
		window.dispatchEvent(new CustomEvent<DragHoverDetail>(DRAG_HOVER_EVENT, { detail }));
	}

	function broadcastMove(detail: UserMoveDetail) {
		if (typeof window === 'undefined') return;
		window.dispatchEvent(new CustomEvent<UserMoveDetail>(MOVE_EVENT, { detail }));
	}

	function getAcceptedMoveIds(): Set<string> {
		if (typeof window === 'undefined') return new Set<string>();
		const bucket = (window as typeof window & Record<string, unknown>)[ACCEPTED_MOVES_WINDOW_KEY];
		if (bucket instanceof Set) {
			return bucket as Set<string>;
		}
		const next = new Set<string>();
		(window as typeof window & Record<string, unknown>)[ACCEPTED_MOVES_WINDOW_KEY] = next;
		return next;
	}

	function clearDragPreview() {
		dragPlaceholderIndex = null;
		isDragOverCombobox = false;
	}

	function updateDragPreviewFromGlobalHover() {
		if (!activeDrag || viewOnly || directoryOnly || !isDragAllowedFor(activeDrag)) {
			clearDragPreview();
			return;
		}

			const isHoveringInsideThisCombo =
				hoverTargetComboId === resolvedComboId &&
				hoverTargetIndex !== null &&
				hoverTargetIndex >= 0;

		if (isHoveringInsideThisCombo) {
			dragPlaceholderIndex = hoverTargetIndex;
			isDragOverCombobox = hoverOverCombobox;
			logDragPreview('inside-target');
			return;
		}

		dragPlaceholderIndex = displayedRows.length;
		isDragOverCombobox = false;
		logDragPreview('fallback-to-end');
	}

	function logDragPreview(reason: string) {
		const signature = JSON.stringify({
			reason,
			comboId: resolvedComboId,
			sourceComboId: activeDrag?.sourceComboId ?? null,
			sourceIndex: activeDrag?.sourceIndex ?? null,
			draggedUserOid: activeDrag?.user.userOid ?? null,
			hoverTargetComboId,
			hoverTargetIndex,
			hoverOverCombobox,
			dragPlaceholderIndex,
			displayedRowOids: displayedRows.map((row) => row.user.userOid)
		});
		if (signature === lastLoggedPreviewSignature) return;
		lastLoggedPreviewSignature = signature;
		debugUserDrag('preview', JSON.parse(signature));
	}

	function removeUserAt(usersList: EntraUser[], index: number, userOid: string): EntraUser[] {
		if (index >= 0 && index < usersList.length && usersList[index]?.userOid === userOid) {
			return [...usersList.slice(0, index), ...usersList.slice(index + 1)];
		}
		const fallbackIndex = usersList.findIndex((user) => user.userOid === userOid);
		if (fallbackIndex === -1) return usersList;
		return [...usersList.slice(0, fallbackIndex), ...usersList.slice(fallbackIndex + 1)];
	}

	function insertUserAt(usersList: EntraUser[], index: number, user: EntraUser): EntraUser[] {
		const clampedIndex = clamp(index, 0, usersList.length);
		return [...usersList.slice(0, clampedIndex), user, ...usersList.slice(clampedIndex)];
	}

	function handleMoveEvent(event: Event) {
		const move = (event as CustomEvent<UserMoveDetail>).detail;
		if (!move) return;

		if (move.sourceComboId === move.targetComboId) {
			if (move.sourceComboId !== resolvedComboId) return;
			const withoutDragged = removeUserAt(selectedUsers, move.sourceIndex, move.user.userOid);
			setSelectedUsersFromLocal(insertUserAt(withoutDragged, move.targetIndex, move.user));
			duplicateError = '';
			return;
		}

		if (move.sourceComboId === resolvedComboId) {
			queueMicrotask(() => {
				const acceptedMoveIds = getAcceptedMoveIds();
				if (!acceptedMoveIds.has(move.moveId)) return;
				acceptedMoveIds.delete(move.moveId);
				setSelectedUsersFromLocal(removeUserAt(selectedUsers, move.sourceIndex, move.user.userOid));
				duplicateError = '';
			});
			return;
		}

		if (move.targetComboId === resolvedComboId) {
			if (selectedUsers.some((user) => user.userOid === move.user.userOid)) {
				duplicateError = 'User is already added';
				return;
			}
			getAcceptedMoveIds().add(move.moveId);
			setSelectedUsersFromLocal(insertUserAt(selectedUsers, move.targetIndex, move.user));
			duplicateError = '';
		}
	}

	function handleDragStateEvent(event: Event) {
		activeDrag = (event as CustomEvent<ActiveUserDrag | null>).detail;
		debugUserDrag('drag-state', {
			comboId: resolvedComboId,
			activeDrag:
				activeDrag === null
					? null
					: {
							sourceComboId: activeDrag.sourceComboId,
							sourceIndex: activeDrag.sourceIndex,
							userOid: activeDrag.user.userOid
					  }
		});
		if (!activeDrag) {
			hoverTargetComboId = null;
			hoverTargetIndex = null;
			hoverOverCombobox = false;
			clearDragPreview();
			return;
		}
		updateDragPreviewFromGlobalHover();
	}

	function isDragAllowedFor(active: ActiveUserDrag | null): boolean {
		if (!active) return false;
		if (active.sourceComboId === resolvedComboId) return true;
		return !selectedUsers.some((user) => user.userOid === active.user.userOid);
	}

	function handleDragHoverEvent(event: Event) {
		const hover = (event as CustomEvent<DragHoverDetail>).detail;
		if (!hover || !hover.active) {
			hoverTargetComboId = null;
			hoverTargetIndex = null;
			hoverOverCombobox = false;
			clearDragPreview();
			return;
		}
		hoverTargetComboId = hover.targetComboId;
		hoverTargetIndex = hover.targetIndex;
		hoverOverCombobox = hover.overCombobox;
		const hoverSignature = JSON.stringify({
			comboId: resolvedComboId,
			targetComboId: hoverTargetComboId,
			targetIndex: hoverTargetIndex,
			hoverOverCombobox,
			pointerX: Math.round(hover.pointerX),
			pointerY: Math.round(hover.pointerY),
			activeSourceComboId: hover.active.sourceComboId,
			activeSourceIndex: hover.active.sourceIndex,
			activeUserOid: hover.active.user.userOid
		});
		if (hoverSignature !== lastLoggedHoverSignature) {
			lastLoggedHoverSignature = hoverSignature;
			debugUserDrag('hover', JSON.parse(hoverSignature));
		}
		updateDragPreviewFromGlobalHover();
	}

	function buildDragGhost(rowEl: HTMLElement): HTMLDivElement {
		const ghost = document.createElement('div');
		ghost.className = 'nodeUserDragGhost';
		const rowClone = rowEl.cloneNode(true) as HTMLElement;
		rowClone.classList.add('nodeUserDragGhostRow');
		ghost.appendChild(rowClone);
		const rect = rowEl.getBoundingClientRect();
		ghost.style.width = `${Math.round(rect.width)}px`;
		document.body.appendChild(ghost);
		return ghost;
	}

	function positionDragGhost(
		ghost: HTMLDivElement,
		pointerX: number,
		pointerY: number,
		offsetX: number,
		offsetY: number
	) {
		ghost.style.transform = `translate(${Math.round(pointerX - offsetX)}px, ${Math.round(pointerY - offsetY)}px)`;
	}

	function resolveHoverTarget(
		pointerX: number,
		pointerY: number,
		active: ActiveUserDrag,
		movingDown: boolean
	): DragHoverDetail {
		const topEl = document.elementFromPoint(pointerX, pointerY) as HTMLElement | null;
		if (!topEl) {
			return {
				active,
				targetComboId: null,
				targetIndex: null,
				overCombobox: false,
				pointerX,
				pointerY
			};
		}

		const targetComboRoot = topEl.closest<HTMLElement>('[data-user-combo-id]');
		if (!targetComboRoot) {
			return {
				active,
				targetComboId: null,
				targetIndex: null,
				overCombobox: false,
				pointerX,
				pointerY
			};
		}

		const targetComboId = targetComboRoot.dataset.userComboId ?? null;
		if (!targetComboId) {
			return {
				active,
				targetComboId: null,
				targetIndex: null,
				overCombobox: false,
				pointerX,
				pointerY
			};
		}

		const selectedUserOidsRaw = targetComboRoot.dataset.userSelectedOids ?? '';
		const selectedUserOidsSet = new Set(
			selectedUserOidsRaw
				.split(',')
				.map((entry) => entry.trim())
				.filter((entry) => entry.length > 0)
		);
		if (targetComboId !== active.sourceComboId && selectedUserOidsSet.has(active.user.userOid)) {
			return {
				active,
				targetComboId: null,
				targetIndex: null,
				overCombobox: false,
				pointerX,
				pointerY
			};
		}

		const rowEl = topEl.closest<HTMLElement>('[data-user-row-index]');
		if (rowEl && rowEl.dataset.userComboId === targetComboId) {
			const rowIndex = Number(rowEl.dataset.userRowIndex ?? '-1');
			if (Number.isFinite(rowIndex) && rowIndex >= 0) {
				const rowRect = rowEl.getBoundingClientRect();
				const midpointY = rowRect.top + rowRect.height / 2;
				return {
					active,
					targetComboId,
					targetIndex: pointerY < midpointY ? rowIndex : rowIndex + 1,
					overCombobox: false,
					pointerX,
					pointerY
				};
			}
		}

		const placeholderEl = topEl.closest<HTMLElement>('[data-user-placeholder-index]');
		if (placeholderEl && placeholderEl.dataset.userComboId === targetComboId) {
			const placeholderIndex = Number(placeholderEl.dataset.userPlaceholderIndex ?? '-1');
			if (Number.isFinite(placeholderIndex) && placeholderIndex >= 0) {
				return {
					active,
					targetComboId,
					targetIndex: placeholderIndex,
					overCombobox: false,
					pointerX,
					pointerY
				};
			}
		}

		const listEl = topEl.closest<HTMLElement>('[data-user-list]');
		if (listEl && listEl.dataset.userComboId === targetComboId) {
			const rowEls = Array.from(listEl.querySelectorAll<HTMLElement>('[data-user-row-index]'))
				.map((el) => ({
					el,
					index: Number(el.dataset.userRowIndex ?? '-1')
				}))
				.filter((entry) => Number.isFinite(entry.index) && entry.index >= 0)
				.sort((a, b) => a.index - b.index);

			for (const entry of rowEls) {
				const rect = entry.el.getBoundingClientRect();
				const midpointY = rect.top + rect.height / 2;
				if (pointerY < midpointY) {
					return {
						active,
						targetComboId,
						targetIndex: entry.index,
						overCombobox: false,
						pointerX,
						pointerY
					};
				}
			}

			return {
				active,
				targetComboId,
				targetIndex: rowEls.length,
				overCombobox: false,
				pointerX,
				pointerY
			};
		}

		const isOverCombobox = Boolean(topEl.closest('[data-user-combobox-drop]'));
		const displayCount = Number(targetComboRoot.dataset.userDisplayCount ?? '0');
		const safeDisplayCount = Number.isFinite(displayCount) ? Math.max(0, displayCount) : 0;
		return {
			active,
			targetComboId,
			targetIndex: safeDisplayCount,
			overCombobox: isOverCombobox,
			pointerX,
			pointerY
		};
	}

	function endSourceDragSession() {
		if (!sourceDragSession) return;
		sourceDragSession.ghostEl.remove();
		if (sourceDragSession.handleEl.hasPointerCapture(sourceDragSession.pointerId)) {
			sourceDragSession.handleEl.releasePointerCapture(sourceDragSession.pointerId);
		}
		sourceDragSession = null;
		window.removeEventListener('pointermove', onSourceDragPointerMove);
		window.removeEventListener('pointerup', onSourceDragPointerUpOrCancel);
		window.removeEventListener('pointercancel', onSourceDragPointerUpOrCancel);
		document.body.classList.remove('teamShiftRowDragging');
	}

	function onSourceDragPointerMove(event: PointerEvent) {
		if (!sourceDragSession || !activeDrag) return;
		if (event.pointerId !== sourceDragSession.pointerId) return;
		event.preventDefault();
		const movingDown = event.clientY >= sourceDragSession.lastHover.pointerY;
		positionDragGhost(
			sourceDragSession.ghostEl,
			event.clientX,
			event.clientY,
			sourceDragSession.ghostOffsetX,
			sourceDragSession.ghostOffsetY
		);
		const hover = resolveHoverTarget(event.clientX, event.clientY, activeDrag, movingDown);
		sourceDragSession.lastHover = hover;
		debugUserDrag('source-move', {
			comboId: resolvedComboId,
			pointerX: Math.round(event.clientX),
			pointerY: Math.round(event.clientY),
			movingDown,
			resolvedTargetComboId: hover.targetComboId,
			resolvedTargetIndex: hover.targetIndex,
			overCombobox: hover.overCombobox
		});
		broadcastDragHover(hover);
	}

	function finalizeSourceDrag(pointerX: number, pointerY: number) {
		activeDrag = null;
		broadcastDragHover({
			active: null,
			targetComboId: null,
			targetIndex: null,
			overCombobox: false,
			pointerX,
			pointerY
		});
		broadcastDragState(null);
		clearDragPreview();
	}

	function onSourceDragPointerUpOrCancel(event: PointerEvent) {
		if (!sourceDragSession) return;
		if (event.pointerId !== sourceDragSession.pointerId) return;
		event.preventDefault();
		const hover = sourceDragSession.lastHover;
		const dragSnapshot = activeDrag;
		debugUserDrag('source-drop', {
			comboId: resolvedComboId,
			pointerX: Math.round(event.clientX),
			pointerY: Math.round(event.clientY),
			sourceComboId: dragSnapshot?.sourceComboId ?? null,
			sourceIndex: dragSnapshot?.sourceIndex ?? null,
			userOid: dragSnapshot?.user.userOid ?? null,
			targetComboId: hover.targetComboId,
			targetIndex: hover.targetIndex
		});
		if (dragSnapshot && hover.targetComboId && hover.targetIndex !== null && hover.targetIndex >= 0) {
			broadcastMove({
				moveId:
					typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
						? crypto.randomUUID()
						: `${Date.now()}-${Math.round(Math.random() * 1_000_000)}`,
				sourceComboId: dragSnapshot.sourceComboId,
				sourceIndex: dragSnapshot.sourceIndex,
				targetComboId: hover.targetComboId,
				targetIndex: hover.targetIndex,
				user: dragSnapshot.user
			});
		}
		endSourceDragSession();
		// Let target combos flush their local insert before parent state hides empty node bodies.
		queueMicrotask(() => {
			finalizeSourceDrag(event.clientX, event.clientY);
		});
	}

	function onHandlePointerDown(event: PointerEvent, user: EntraUser, sourceIndex: number) {
		const globalActiveDrag = (
			typeof window !== 'undefined'
				? (window as typeof window & Record<string, unknown>)[ACTIVE_DRAG_WINDOW_KEY]
				: null
		) as ActiveUserDrag | null;
		const dragCursorActive =
			typeof document !== 'undefined'
				? document.body.classList.contains('teamShiftRowDragging')
				: false;
		if (interactionLocked) {
			debugUserDrag('pluck-blocked:interactionLocked', {
				comboId: resolvedComboId,
				sourceIndex,
				userOid: user.userOid,
				interactionLocked,
				disabled,
				hasLocalActiveDrag: Boolean(activeDrag),
				hasSourceDragSession: Boolean(sourceDragSession),
				hasGlobalActiveDrag: Boolean(globalActiveDrag),
				globalSourceComboId: globalActiveDrag?.sourceComboId ?? null,
				dragCursorActive
			});
			return;
		}
		if (disabled || activeDrag || sourceDragSession) {
			debugUserDrag('pluck-blocked:localState', {
				comboId: resolvedComboId,
				sourceIndex,
				userOid: user.userOid,
				disabled,
				hasLocalActiveDrag: Boolean(activeDrag),
				localSourceComboId: activeDrag?.sourceComboId ?? null,
				hasSourceDragSession: Boolean(sourceDragSession),
				sessionPointerId: sourceDragSession?.pointerId ?? null,
				hasGlobalActiveDrag: Boolean(globalActiveDrag),
				globalSourceComboId: globalActiveDrag?.sourceComboId ?? null,
				dragCursorActive
			});
			return;
		}
		if (event.button !== 0) {
			debugUserDrag('pluck-blocked:button', {
				comboId: resolvedComboId,
				sourceIndex,
				userOid: user.userOid,
				button: event.button
			});
			return;
		}
		const handleEl = event.currentTarget as HTMLButtonElement;
		const rowEl = handleEl.closest('.nodeUserRow');
		if (!(rowEl instanceof HTMLElement)) {
			debugUserDrag('pluck-blocked:missingRowEl', {
				comboId: resolvedComboId,
				sourceIndex,
				userOid: user.userOid
			});
			return;
		}
		const rowRect = rowEl.getBoundingClientRect();
		const ghostOffsetX = event.clientX - rowRect.left;
		const ghostOffsetY = event.clientY - rowRect.top;
		event.preventDefault();
		event.stopPropagation();
		activeDrag = { sourceComboId: resolvedComboId, sourceIndex, user };
		debugUserDrag('source-start', {
			comboId: resolvedComboId,
			sourceIndex,
			userOid: user.userOid,
			pointerX: Math.round(event.clientX),
			pointerY: Math.round(event.clientY),
			displayedRowOids: displayedRows.map((row) => row.user.userOid),
			hasGlobalActiveDrag: Boolean(globalActiveDrag),
			globalSourceComboId: globalActiveDrag?.sourceComboId ?? null
		});
		broadcastDragState(activeDrag);
		const ghost = buildDragGhost(rowEl);
		positionDragGhost(ghost, event.clientX, event.clientY, ghostOffsetX, ghostOffsetY);
		handleEl.setPointerCapture(event.pointerId);
		sourceDragSession = {
			pointerId: event.pointerId,
			handleEl,
			ghostEl: ghost,
			ghostOffsetX,
			ghostOffsetY,
			lastHover: resolveHoverTarget(event.clientX, event.clientY, activeDrag, false)
		};
		broadcastDragHover(sourceDragSession.lastHover);
		document.body.classList.add('teamShiftRowDragging');
		window.addEventListener('pointermove', onSourceDragPointerMove, { passive: false });
		window.addEventListener('pointerup', onSourceDragPointerUpOrCancel, { passive: false });
		window.addEventListener('pointercancel', onSourceDragPointerUpOrCancel, { passive: false });
	}

	function onWindowKeydown(event: KeyboardEvent) {
		if (event.key !== 'Escape' || !sourceDragSession) return;
		event.preventDefault();
		endSourceDragSession();
		finalizeSourceDrag(0, 0);
	}

	function onCancelUserRowDrag() {
		if (!sourceDragSession) return;
		endSourceDragSession();
		finalizeSourceDrag(0, 0);
	}

	$: if (showResults) {
		users.length;
		loading;
		error;
		tick().then(() => {
			updateResultsScrollbar();
		});
	}

	onMount(() => {
		void focusSearchInput();
		document.addEventListener('mousedown', onDocumentMouseDown);
		window.addEventListener(DRAG_STATE_EVENT, handleDragStateEvent as EventListener);
		window.addEventListener(DRAG_HOVER_EVENT, handleDragHoverEvent as EventListener);
		window.addEventListener(MOVE_EVENT, handleMoveEvent as EventListener);
		window.addEventListener('keydown', onWindowKeydown);
		window.addEventListener(CANCEL_DRAG_EVENT, onCancelUserRowDrag as EventListener);
		window.addEventListener(
			'birch-canvas-background-pointerdown',
			onCanvasBackgroundPointerDown as EventListener
		);
		// Defensive stale-state recovery after remounts: if no drag cursor is active,
		// clear any lingering global drag markers so new drags can start.
		const dragCursorActive = document.body.classList.contains('teamShiftRowDragging');
		const staleActiveDrag = (
			window as typeof window & Record<string, unknown>
		)[ACTIVE_DRAG_WINDOW_KEY] as ActiveUserDrag | null | undefined;
		if (!dragCursorActive && staleActiveDrag) {
			finalizeSourceDrag(0, 0);
		}
		const initialActiveDrag = (
			window as typeof window & Record<string, unknown>
		)[ACTIVE_DRAG_WINDOW_KEY] as ActiveUserDrag | null | undefined;
		if (initialActiveDrag) {
			handleDragStateEvent(new CustomEvent<ActiveUserDrag | null>(DRAG_STATE_EVENT, { detail: initialActiveDrag }));
			const initialHover = (
				window as typeof window & Record<string, unknown>
			)[ACTIVE_HOVER_WINDOW_KEY] as DragHoverDetail | null | undefined;
			if (initialHover) {
				handleDragHoverEvent(new CustomEvent<DragHoverDetail>(DRAG_HOVER_EVENT, { detail: initialHover }));
			}
		}
	});

	onDestroy(() => {
		if (searchTimer) {
			clearTimeout(searchTimer);
			searchTimer = null;
		}
		stopResultsDragging();
		endSourceDragSession();
		if (typeof window !== 'undefined') {
			const globalActiveDrag = (
				window as typeof window & Record<string, unknown>
			)[ACTIVE_DRAG_WINDOW_KEY] as ActiveUserDrag | null | undefined;
			if (globalActiveDrag?.sourceComboId === resolvedComboId) {
				finalizeSourceDrag(0, 0);
			}
		}
		if (typeof document !== 'undefined') {
			document.removeEventListener('mousedown', onDocumentMouseDown);
		}
		if (typeof window !== 'undefined') {
			window.removeEventListener(DRAG_STATE_EVENT, handleDragStateEvent as EventListener);
			window.removeEventListener(DRAG_HOVER_EVENT, handleDragHoverEvent as EventListener);
			window.removeEventListener(MOVE_EVENT, handleMoveEvent as EventListener);
			window.removeEventListener('keydown', onWindowKeydown);
			window.removeEventListener(CANCEL_DRAG_EVENT, onCancelUserRowDrag as EventListener);
			window.removeEventListener(
				'birch-canvas-background-pointerdown',
				onCanvasBackgroundPointerDown as EventListener
			);
		}
	});
</script>

<div
	class="nodeUserPicker"
	class:nodeUserPickerDragActive={canShowDragPreview}
	data-user-combo-id={resolvedComboId}
	data-user-display-count={displayedRows.length}
	data-user-selected-oids={selectedUsers.map((user) => user.userOid).join(',')}
	on:pointerdown|capture={onRootPointerDownCapture}
>
	{#if !directoryOnly && (displayedRows.length > 0 || (!viewOnly && dragPlaceholderIndex !== null))}
		<div
			class="nodeUserList"
			aria-live="polite"
			data-user-list
			data-user-combo-id={resolvedComboId}
		>
				{#if !viewOnly && !directoryOnly && dragPlaceholderIndex === 0}
					<div
						class="nodeUserDropPlaceholder"
						class:nodeUserDropPlaceholderActive={hoverTargetComboId === resolvedComboId && hoverTargetIndex === 0}
						data-user-placeholder-index={0}
						data-user-combo-id={resolvedComboId}
						aria-hidden="true"
				></div>
			{/if}
			{#each displayedRows as row, displayIndex (row.user.userOid + '-' + row.originalIndex)}
				<div
					class="nodeUserRow"
					class:nodeUserRowViewOnly={viewOnly}
					data-user-row-index={displayIndex}
					data-user-combo-id={resolvedComboId}
				>
					<div class="nodeUserFieldElement" class:nodeUserFieldElementViewOnly={viewOnly}>
						{#if !viewOnly && !directoryOnly}
							<button
								type="button"
								class="nodeUserDragHandle shiftReorderHandleBtn"
								aria-label={`Drag ${userDisplayName(row.user)}`}
								on:pointerdown|stopPropagation={(event) =>
									onHandlePointerDown(event, row.user, row.originalIndex)}
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
						{/if}
						<div class="nodeUserLabel" aria-label="Selected user name">
							{#if renderLabelsInline}
								{userDisplayName(row.user)}
							{:else}
								<span class="nodeUserLabelHiddenText" aria-hidden="true">
									{userDisplayName(row.user)}
								</span>
							{/if}
						</div>
					</div>
					{#if !viewOnly && !directoryOnly}
						<button
							type="button"
							class="nodeUserRemoveBtn"
							aria-label={`Remove ${userDisplayName(row.user)}`}
							on:click={() => removeSelectedUser(row.user.userOid)}
						>
							X
						</button>
					{/if}
				</div>
				{#if !viewOnly && !directoryOnly && dragPlaceholderIndex === displayIndex + 1}
					<div
						class="nodeUserDropPlaceholder"
						class:nodeUserDropPlaceholderActive={hoverTargetComboId === resolvedComboId && hoverTargetIndex === displayIndex + 1}
						data-user-placeholder-index={displayIndex + 1}
						data-user-combo-id={resolvedComboId}
						aria-hidden="true"
					></div>
				{/if}
			{/each}
		</div>
	{/if}
	{#if !viewOnly && !hideSearchInput}
		<div
			class="setupUserCombo setupUserComboAddUser"
			class:dragOver={isDragOverCombobox}
			role="combobox"
			aria-expanded={showResults}
			bind:this={comboEl}
			data-user-combobox-drop
			data-user-combo-id={resolvedComboId}
			on:mousedown={onComboMouseDown}
			on:wheel={stopWheelPropagation}
		>
			<input
				class="input"
				bind:this={inputEl}
				{placeholder}
				{disabled}
				name={`user-search-${resolvedComboId}`}
				aria-label={ariaLabel}
				type="text"
				value={query}
				autofocus={autoFocus}
				on:input={onQueryInput}
				autocomplete="new-password"
				autocorrect="off"
				autocapitalize="none"
				spellcheck="false"
				data-form-type="other"
				data-lpignore="true"
				data-1p-ignore="true"
				aria-autocomplete="list"
			/>
			{#if showResults}
				<div
					class="setupUserComboList setupUserComboListCustom"
					role="listbox"
					on:wheel={stopWheelPropagation}
				>
					<div
						class="setupUserComboListScroll"
						class:hasScrollbar={showResultsScrollbar}
						bind:this={resultsEl}
						on:scroll={onResultsScroll}
						on:wheel={stopWheelPropagation}
					>
						{#if loading}
							<div class="setupUserComboItem setupUserComboStatus">Loading...</div>
						{:else if error}
							<div class="setupUserComboItem setupUserComboError">{error}</div>
						{:else if users.length === 0}
							<button
								class="setupUserComboItem setupUserComboStatus"
								type="button"
								on:mousedown|preventDefault={closeResults}
							>
								No matches
							</button>
						{:else}
							{#each users as user}
								<button
									class="setupUserComboItem"
									role="option"
									type="button"
									on:mousedown|preventDefault={() => onUserSelect(user)}
								>
									{userLabel(user)}
								</button>
							{/each}
						{/if}
					</div>
					{#if showResultsScrollbar}
						<div
							class="setupUserComboScrollRail"
							role="presentation"
							aria-hidden="true"
							bind:this={resultsRailEl}
							on:mousedown={handleResultsRailClick}
							on:wheel={stopWheelPropagation}
						>
							<div
								class="setupUserComboScrollThumb"
								class:dragging={isDraggingResultsScrollbar}
								role="presentation"
								style={`height:${resultsThumbHeightPx}px;transform:translateY(${resultsThumbTopPx}px);`}
								on:mousedown={startResultsThumbDrag}
							></div>
						</div>
					{/if}
				</div>
			{/if}
		</div>
		{#if duplicateError}
			<div class="nodeUserError" role="status">{duplicateError}</div>
		{/if}
	{/if}
</div>

<style>
	.nodeUserPicker {
		--node-user-focus-accent: var(--canvas-accent, var(--node-border));
		--node-user-focus-border: color-mix(
			in srgb,
			var(--node-user-focus-accent) 78%,
			var(--node-text)
		);
		--node-user-focus-ring: 0 0 0 3px
			color-mix(in srgb, var(--node-user-focus-accent) 22%, transparent);
		display: flex;
		flex-direction: column;
		gap: 8px;
		width: 100%;
	}

	.nodeUserPicker.nodeUserPickerDragActive {
		min-height: 30px;
	}

	.nodeUserList {
		display: flex;
		flex-direction: column;
		flex: 1 1 auto;
		min-height: 0;
	}

	.nodeUserRow {
		position: relative;
		display: grid;
		grid-template-columns: 1fr;
		align-items: center;
	}
	.nodeUserRow.nodeUserRowViewOnly {
		gap: 0;
	}

	.nodeUserFieldElement {
		position: relative;
		display: block;
		min-width: 0;
	}
	.nodeUserFieldElement.nodeUserFieldElementViewOnly {
		display: block;
	}

	.nodeUserDragHandle {
		appearance: none;
		position: absolute;
		left: 6px;
		top: 50%;
		transform: translateY(-50%);
		border: 0;
		border-radius: 999px;
		background: transparent;
		color: var(--muted);
		width: 24px;
		height: 28px;
		padding: 0;
		cursor: grab;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		transition:
			transform 0.12s ease,
			background 0.12s ease,
			color 0.12s ease;
		z-index: 2;
	}

	.nodeUserDragHandle::before {
		content: '';
		position: absolute;
		left: 0;
		top: 0;
		bottom: 0;
		width: 4px;
		border-radius: 999px;
		background: transparent;
		transition: background 0.12s ease;
	}

	.nodeUserDragHandle:hover::before {
		background: var(--accent-1);
	}

	.nodeUserDragHandle:hover {
		color: var(--text);
	}

	.nodeUserDragHandle:focus-visible {
		outline: none;
		box-shadow: var(--focus-ring);
	}

	.shiftReorderHandleIcon {
		width: 16px;
		height: 16px;
		display: block;
	}

	.shiftReorderHandleIcon path {
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
		fill: none;
		pointer-events: none;
	}

	.nodeUserDragHandle:active {
		cursor: grabbing;
		transform: translateY(-50%) scale(0.96);
	}

	.nodeUserLabel {
		min-width: 0;
		min-height: 28px;
		display: flex;
		align-items: center;
		justify-content: center;
		text-align: center;
		line-height: 1.15;
		font-size: 13px;
		font-weight: 600;
		color: var(--text);
		padding: 6px 34px;
		border-radius: 8px;
		background: color-mix(in srgb, var(--surface-2) 66%, transparent);
	}
	.nodeUserLabelHiddenText {
		visibility: hidden;
	}
	.nodeUserFieldElement.nodeUserFieldElementViewOnly .nodeUserLabel {
		border-radius: 12px;
	}

	.nodeUserRemoveBtn {
		appearance: none;
		position: absolute;
		right: 6px;
		top: 50%;
		transform: translateY(-50%);
		border: 1px solid var(--interactive-border);
		border-radius: 8px;
		background: var(--interactive-bg);
		color: var(--text);
		width: 24px;
		height: 24px;
		font-size: 12px;
		font-weight: 700;
		cursor: pointer;
		z-index: 2;
	}

	.nodeUserRemoveBtn:hover {
		background: var(--interactive-bg-hover);
		border-color: var(--interactive-border-hover);
	}

	.nodeUserDropPlaceholder {
		flex: 0 0 auto;
		height: 30px;
		border: 1px dashed var(--interactive-border-hover);
		border-radius: 8px;
		background: color-mix(in srgb, var(--interactive-bg-hover) 42%, transparent);
		transition:
			background 0.12s ease,
			border-color 0.12s ease,
			box-shadow 0.12s ease,
			transform 0.12s ease;
	}

	.nodeUserDropPlaceholder.nodeUserDropPlaceholderActive {
		border-color: color-mix(in srgb, var(--accent-1) 78%, var(--interactive-border-hover));
		background: color-mix(in srgb, var(--accent-1) 24%, var(--interactive-bg-hover));
		box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent-1) 30%, transparent);
		transform: scaleY(1.04);
	}

	.nodeUserError {
		font-size: 11px;
		color: var(--error, #b42318);
		text-align: center;
	}

	.nodeUserPicker :global(.setupUserCombo.dragOver) {
		outline: none;
	}

	.nodeUserPicker :global(.setupUserCombo) {
		border-color: var(--interactive-border);
		background: var(--interactive-bg);
		color: var(--text);
	}

	.nodeUserPicker :global(.setupUserCombo:focus-within) {
		border-color: var(--node-user-focus-border);
		box-shadow: var(--node-user-focus-ring);
	}

	.nodeUserPicker :global(.setupUserCombo .input) {
		color: var(--text);
		background: transparent;
	}

	.nodeUserPicker :global(.setupUserCombo .input:focus) {
		border-color: var(--node-user-focus-border);
		box-shadow: var(--node-user-focus-ring);
	}

	.nodeUserPicker :global(.setupUserCombo .input::placeholder) {
		color: var(--muted);
	}

	.nodeUserPicker :global(.setupUserCombo[aria-expanded='true']) {
		z-index: 520;
	}

	.nodeUserPicker :global(.setupUserComboList) {
		z-index: 530;
		border-color: var(--interactive-border);
		background: var(--node-background);
		color: var(--text);
		box-shadow:
			0 14px 28px color-mix(in srgb, black 24%, transparent),
			inset 0 1px 0 color-mix(in srgb, white 14%, transparent);
	}

	.nodeUserPicker :global(.setupUserComboScrollRail) {
		background: color-mix(in srgb, var(--node-background) 86%, var(--node-text) 14%);
	}

	.nodeUserPicker :global(.setupUserComboScrollThumb) {
		background: color-mix(in srgb, var(--node-border) 64%, var(--node-text) 36%);
	}

	.nodeUserPicker :global(.setupUserComboScrollThumb:hover),
	.nodeUserPicker :global(.setupUserComboScrollThumb.dragging) {
		background: color-mix(in srgb, var(--canvas-accent) 58%, var(--node-text) 42%);
	}

	.nodeUserPicker :global(.setupUserComboItem) {
		color: var(--text);
	}

	.nodeUserPicker :global(button.setupUserComboItem:hover) {
		background: color-mix(in srgb, var(--node-background) 82%, var(--node-text) 18%);
	}

	.nodeUserPicker :global(.setupUserComboStatus),
	.nodeUserPicker :global(.setupUserComboError) {
		color: var(--text);
	}

	:global(.nodeUserDragGhost) {
		--text: var(--node-text);
		--muted: color-mix(in srgb, var(--node-text) 64%, transparent);
		--surface-2: color-mix(in srgb, var(--node-background) 92%, var(--node-text) 8%);
		--interactive-bg: color-mix(in srgb, var(--node-background) 90%, var(--node-text) 10%);
		--interactive-bg-hover: color-mix(
			in srgb,
			var(--node-background) 82%,
			var(--node-text) 18%
		);
		--interactive-border: var(--node-border);
		--interactive-border-hover: color-mix(
			in srgb,
			var(--node-border) 78%,
			var(--node-text)
		);
		--accent-1: var(--canvas-accent-1);
		position: fixed;
		top: 0;
		left: 0;
		z-index: 1200;
		pointer-events: none;
		opacity: 0.96;
		filter: drop-shadow(0 14px 28px rgba(0, 0, 0, 0.24));
		padding: 6px;
		border-radius: 12px;
		border: 1px solid color-mix(in srgb, var(--node-border) 78%, white 10%);
		background: var(--node-background);
		color: var(--node-text);
		backdrop-filter: blur(10px);
	}

	:global(.nodeUserDragGhost .nodeUserRow) {
		margin: 0;
	}

	:global(.nodeUserDragGhost .nodeUserLabelHiddenText) {
		visibility: visible;
	}

	:global(body.teamShiftRowDragging),
	:global(body.teamShiftRowDragging *) {
		cursor: grabbing !important;
	}

	:global(body.teamShiftRowDragging) .nodeUserDragHandle:hover::before {
		background: transparent;
	}

	:global(body.teamShiftRowDragging) .nodeUserDragHandle:hover {
		color: var(--muted);
	}
</style>
