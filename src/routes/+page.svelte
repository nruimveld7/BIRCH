<script lang="ts">
	import { base } from '$app/paths';
	import { onDestroy, onMount, tick } from 'svelte';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import ChartsModal from '$lib/components/ChartsModal.svelte';
	import ChartToolsModal from '$lib/components/ChartToolsModal.svelte';
	import OnboardingTourModal from '$lib/components/OnboardingTourModal.svelte';
	import ConfirmDialog, { type ConfirmDialogOption } from '$lib/components/ConfirmDialog.svelte';
	import Node from '$lib/components/Node.svelte';
	import UserSearchCombobox from '$lib/components/UserSearchCombobox.svelte';
	import { fetchWithAuthRedirect } from '$lib/utils/fetchWithAuthRedirect';

	type Theme = 'light' | 'dark';
	type ThemePreference = 'system' | 'dark' | 'light';
	type ChartRole = 'Member' | 'Maintainer' | 'Manager';
	type ChartMembership = {
		ChartId: number;
		Name: string;
		RoleName: ChartRole;
		AccessRoleLabel?: ChartRole | 'Bootstrap';
		IsDefault: boolean;
		IsActive: boolean;
		PlaceholderThemeJson?: string | null;
		VersionAt?: string | null;
	};
	type OnboardingSlide = {
		id: string;
		role: ChartRole;
		roleTier: number;
		title: string;
		description: string;
		imageUrl: string | null;
	};
	type ChartNode = {
		id: string;
		title: string;
		x: number;
		y: number;
		width: number;
		height: number;
		userOids: string[];
		childNodeIds: string[];
	};
	type NodeConnectorSide = 'top' | 'right' | 'bottom' | 'left';
	type NodeConnectorRef = { nodeId: string; side: NodeConnectorSide };
	type NodeConnection = { id: string; from: NodeConnectorRef; to: NodeConnectorRef };
	type RenderedConnection = { id: string; path: string };
	type Point = { x: number; y: number };
	type ActiveLinkedDrag = {
		rootNodeId: string;
		startRootPosition: Point;
		startPositionsByNodeId: Map<string, Point>;
	};
	type ActiveConnectorDrag = {
		source: NodeConnectorRef;
		pointerId: number;
		pointerX: number;
		pointerY: number;
		hoveredTarget: NodeConnectorRef | null;
		canDrop: boolean;
	};
	type SelectedEmployee = { userOid: string; displayName: string; email: string | null };
	type NodeContextMenuAction = 'pin' | 'addEmployee' | 'delete';
	type PinnedNodeEntry = { id: string; title: string };
	type PersistedNodeUser = { userOid: string; displayName: string; email: string | null };
	type PersistedChartNode = Omit<ChartNode, 'childNodeIds'> & { users: PersistedNodeUser[] };
	type ChartGraphPayload = {
		nodes: PersistedChartNode[];
		connections: NodeConnection[];
		pinnedNodeIds: string[];
	};
	const ACTIVE_USER_DRAG_WINDOW_KEY = '__birchNodeUserActiveDrag';
	const DEBUG_USER_DRAG = true;

	export let data: {
		chart: { ChartId: number; Name: string } | null;
		userRole: ChartRole | null;
		chartMemberships: ChartMembership[];
		currentUserOid: string | null;
		onboarding: {
			currentTier: number;
			targetTier: number;
			slides: OnboardingSlide[];
		};
	};

	let chart = data.chart;
	let userRole = data.userRole;
	let rawChartMemberships = data.chartMemberships;
	let chartMemberships: Array<{
		ChartId: number;
		Name: string;
		RoleName: ChartRole;
		AccessRoleLabel?: ChartRole | 'Bootstrap';
		IsDefault: boolean;
		IsActive: boolean;
		ThemeJson?: string | null;
		VersionAt?: string | Date | null;
	}> = [];
	let showChartsModal = false;
	let showToolsModal = false;
	let nodes: ChartNode[] = [];
	let nodeCanvasEl: HTMLDivElement | null = null;
	let rightRailEl: HTMLDivElement | null = null;
	let modeCardEl: HTMLDivElement | null = null;
	let newNodeButtonEl: HTMLButtonElement | null = null;
	let panX = 0;
	let panY = 0;
	let zoom = 1;
	const minZoom = 0.35;
	const maxZoom = 2.4;
	const homePanX = 0;
	const homePanY = 0;
	const homeZoom = 1;
	const nodeHeaderFontSizePx = 14;
	const nodeHeaderHorizontalPaddingPx = 12;
	const nodeHeaderTopPaddingPx = 10;
	const nodeHeaderBottomPaddingPx = 10;
	const nodeHeaderContentHeightPx = 16;
	const nodeTitleHitboxHorizontalPaddingPx = 8;
	const nodeTitleEmptyFocusWidthPx = 18;
	const nodeBodyPaddingPx = 5;
	const nodeUserLabelFontSizePx = 13;
	const nodeUserLabelMinHeightPx = 28;
	const nodeUserPlaceholderHeightPx = 30;
	const nodeUserLabelHorizontalPaddingPx = 34;
	const nodeGridSizePx = 29;
	const keyboardPanSpeed = 580;
	const dpadPanSpeed = 620;
	const momentumFriction = 0.0072;
	const momentumStopSpeed = 0.02;
	const edgePanThreshold = 120;
	const edgePanMaxSpeed = 760;
	const ctrlSnapNearestNodeDistance = 140;
	const ctrlSnapDetachDistance = 110;
	const ctrlSnapNodeGap = 24;
	const cameraFocusDurationMs = 280;
	let panPointerId: number | null = null;
	let isPanningDrag = false;
	let isPanningMomentum = false;
	let lastPanPointerX = 0;
	let lastPanPointerY = 0;
	let lastPanTimestamp = 0;
	let panVelocityX = 0;
	let panVelocityY = 0;
	let panAnimationFrame = 0;
	let activeKeys = new Set<string>();
	let isSpaceKeyPressed = false;
	let dpadDirection: { x: number; y: number } = { x: 0, y: 0 };
	let lastAnimationTimestamp = 0;
	let onWindowBlur: (() => void) | null = null;
	let onWindowPointerDownBlurHeaderInput: ((event: PointerEvent) => void) | null = null;
	let onWindowPointerUpResetInteractions: ((event: PointerEvent) => void) | null = null;
	let activeDraggedNodeId: string | null = null;
	let nodeDragCancelToken = 0;
	let activeCtrlSnapAnchorNodeId: string | null = null;
	let activeDraggedPointerX = 0;
	let activeDraggedPointerY = 0;
	let activeDragPointerOffsetX = 0;
	let activeDragPointerOffsetY = 0;
	let activeLinkedDrag: ActiveLinkedDrag | null = null;
	let usedLinkedDragForCurrentPointerDrag = false;
	let dragLockPointerX: number | null = null;
	let dragLockPointerY: number | null = null;
	let connections: NodeConnection[] = [];
	let activeConnectorDrag: ActiveConnectorDrag | null = null;
	let connectorPreviewPath = '';
	let renderedConnections: RenderedConnection[] = [];
	let selectedConnectionId: string | null = null;
	let selectedConnectionDeleteButtonPos: Point | null = null;
	let onWindowConnectorPointerMove: ((event: PointerEvent) => void) | null = null;
	let onWindowConnectorPointerUp: ((event: PointerEvent) => void) | null = null;
	let cameraAnimationFrame = 0;
	let cameraAnimationStartTime = 0;
	let cameraAnimationFromX = 0;
	let cameraAnimationFromY = 0;
	let cameraAnimationToX = 0;
	let cameraAnimationToY = 0;
	let cameraAnimationFromZoom = 1;
	let cameraAnimationToZoom = 1;

	let theme: Theme = 'dark';
	let themePreferenceState: ThemePreference = 'system';
	let systemTheme: Theme = 'dark';
	let mediaQuery: MediaQueryList | null = null;

	let onboardingOpen = false;
	let onboardingSlideIndex = 0;
	let onboardingDontShowAgain = false;
	let onboardingSaving = false;
	let onboardingSaveError = '';
	let onboardingDismissedForSession = false;
	let onboardingSlidesForModal: OnboardingSlide[] = data.onboarding.slides;
	let onboardingTargetTierForModal = data.onboarding.targetTier;
	let onboardingCurrentTierState = data.onboarding.currentTier;
	let nodeDeleteConfirm: {
		nodeId: string;
		title: string;
		message: string;
		options: ConfirmDialogOption[];
		cancelOptionId: string;
	} | null = null;
	let nodeContextMenu: { nodeId: string; x: number; y: number; isPinned: boolean } | null = null;
	let focusedTitleNodeId: string | null = null;
	let nodeEmployeePicker: { nodeId: string; x: number; y: number; key: number } | null = null;
	let nodeEmployeePickerNodeId: string | null = null;
	let nodeEmployeePickerKey = 0;
	let pinnedNodeIds = new Set<string>();
	let pinnedNodeEntries: PinnedNodeEntry[] = [];
	let userDisplayByOid = new Map<string, string>();
	let isUserRowDragging = false;
	let activeUserRowDrag:
		| {
				sourceComboId: string;
				sourceIndex: number;
				user: { userOid: string };
		  }
		| null = null;
	let activeUserRowDragHover:
		| {
				targetComboId: string | null;
				targetIndex: number | null;
		  }
		| null = null;
	let nodeUserDragPreviewByNodeId = new Map<
		string,
		{ visibleUserOids: string[]; placeholderIndex: number | null }
	>();
	let onGlobalUserDragState: ((event: Event) => void) | null = null;
	let onGlobalUserDragHover: ((event: Event) => void) | null = null;
	let graphLoading = false;
	let graphSaving = false;
	let graphLoadError = '';
	let graphSaveError = '';
	let graphHydrated = false;
	let isApplyingGraphSnapshot = false;
	let graphSaveTimeout: ReturnType<typeof setTimeout> | null = null;
	let lastPersistedGraphSignature = '';
	let queuedGraphSaveSignature: string | null = null;
	let lastLoggedPreviewSignature = '';
	let lastLoggedPageHoverSignature = '';
	let lastLoggedDomAlignmentSignature = '';

	function debugUserDrag(label: string, detail: Record<string, unknown>) {
		if (!DEBUG_USER_DRAG || typeof console === 'undefined') return;
		console.log(`[birch user-drag page] ${label}`, detail);
	}

	function shouldRenderInlineUserLabels(nodeId: string) {
		if (!isUserRowDragging) return false;
		return (
			activeUserRowDrag?.sourceComboId === nodeId || activeUserRowDragHover?.targetComboId === nodeId
		);
	}

	function clearUserRowDragState() {
		isUserRowDragging = false;
		activeUserRowDrag = null;
		activeUserRowDragHover = null;
		nodeUserDragPreviewByNodeId = new Map();
	}

	function hasGlobalActiveUserDrag() {
		if (typeof window === 'undefined') return false;
		const active = (window as typeof window & Record<string, unknown>)[ACTIVE_USER_DRAG_WINDOW_KEY];
		return Boolean(active);
	}

	const canOpenTools = () => userRole === 'Maintainer' || userRole === 'Manager';
	const canManageNodes = () => canOpenTools();
	let isEditMode = false;
	const canAssignManagerRole = () => userRole === 'Manager';
	const canOpenChartSetup = () => canAssignManagerRole() || chartMemberships.length > 1;
	const canToggleEditMode = () => canManageNodes();

	$: if (!canToggleEditMode() && isEditMode) {
		isEditMode = false;
	}

	$: if (!isEditMode && nodeDeleteConfirm) {
		nodeDeleteConfirm = null;
	}

	$: if (!isEditMode && nodeContextMenu) {
		nodeContextMenu = null;
	}

	$: if (!isEditMode && nodeEmployeePicker) {
		nodeEmployeePicker = null;
		nodeEmployeePickerNodeId = null;
	}

	function createNodeId() {
		if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
			return crypto.randomUUID();
		}
		return `node-${Date.now()}-${Math.round(Math.random() * 10000)}`;
	}

	function createConnectionId() {
		if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
			return `conn-${crypto.randomUUID()}`;
		}
		return `conn-${Date.now()}-${Math.round(Math.random() * 10000)}`;
	}

	function connectorKey(ref: NodeConnectorRef) {
		return `${ref.nodeId}:${ref.side}`;
	}

	function connectorEquals(a: NodeConnectorRef, b: NodeConnectorRef) {
		return a.nodeId === b.nodeId && a.side === b.side;
	}

	function getNodeById(nodeId: string) {
		return nodes.find((node) => node.id === nodeId) ?? null;
	}

	function getNodeElementById(nodeId: string) {
		if (typeof document === 'undefined') return null;
		return document.querySelector(`[data-node-id="${CSS.escape(nodeId)}"]`) as HTMLElement | null;
	}

	function isTargetInsideNode(targetEl: Element | null, nodeId: string) {
		const nodeEl = getNodeElementById(nodeId);
		return nodeEl ? nodeEl.contains(targetEl) : false;
	}

	function shouldKeepNodeContextMenuOpen(targetEl: Element | null) {
		if (!nodeContextMenu) return false;
		if (targetEl?.closest('.nodeContextMenu')) return true;
		return isTargetInsideNode(targetEl, nodeContextMenu.nodeId);
	}

	function shouldKeepNodeEmployeePickerOpen(targetEl: Element | null) {
		if (!nodeEmployeePicker) return false;
		if (targetEl?.closest('.nodeEmployeePickerPopover')) return true;
		return isTargetInsideNode(targetEl, nodeEmployeePicker.nodeId);
	}

	function closeNodeTransientOverlaysForTarget(targetEl: Element | null) {
		if (nodeContextMenu && !shouldKeepNodeContextMenuOpen(targetEl)) {
			nodeContextMenu = null;
		}
		if (nodeEmployeePicker && !shouldKeepNodeEmployeePickerOpen(targetEl)) {
			nodeEmployeePicker = null;
			nodeEmployeePickerNodeId = null;
		}
	}

	function isNodeInteractionLocked() {
		return Boolean(activeConnectorDrag || isPanningDrag || isUserRowDragging);
	}

	function isUserPickerInteractionLocked() {
		// User pickers should only lock for competing canvas gestures.
		// A stale user-row drag flag should not block starting a new pluck.
		return Boolean(activeConnectorDrag || isPanningDrag);
	}

	function cancelCanvasPanDrag() {
		if (!isPanningDrag || panPointerId === null || !nodeCanvasEl) return;
		if ((nodeCanvasEl as HTMLElement).hasPointerCapture(panPointerId)) {
			(nodeCanvasEl as HTMLElement).releasePointerCapture(panPointerId);
		}
		isPanningDrag = false;
		panPointerId = null;
	}

	function requestCancelNodeDrag() {
		nodeDragCancelToken += 1;
		activeDraggedNodeId = null;
		activeDragPointerOffsetX = 0;
		activeDragPointerOffsetY = 0;
		activeLinkedDrag = null;
		usedLinkedDragForCurrentPointerDrag = false;
		dragLockPointerX = null;
		dragLockPointerY = null;
		activeCtrlSnapAnchorNodeId = null;
	}

	function requestCancelUserRowDrag() {
		if (!isUserRowDragging || typeof window === 'undefined') return;
		window.dispatchEvent(new CustomEvent('birch-cancel-user-row-drag'));
	}

	function cancelActiveGesture() {
		if (activeDraggedNodeId) {
			requestCancelNodeDrag();
			return true;
		}
		if (activeConnectorDrag) {
			cancelConnectorDrag();
			return true;
		}
		if (isPanningDrag) {
			cancelCanvasPanDrag();
			stopMomentum();
			return true;
		}
		if (isUserRowDragging) {
			requestCancelUserRowDrag();
			return true;
		}
		return false;
	}

	function getPinnedNodeRenderScale(nodeId: string) {
		if (!pinnedNodeIds.has(nodeId) || zoom >= 1) return 1;
		return 1 + (1 - zoom) * 0.8;
	}

	function shouldRenderNodeUserOverlay(nodeId: string, userOid: string) {
		return !(
			activeUserRowDrag &&
			activeUserRowDrag.sourceComboId === nodeId &&
			activeUserRowDrag.user.userOid === userOid
		);
	}

	function updateNodeUserDragPreview(
		nodeId: string,
		visibleUserOids: string[],
		placeholderIndex: number | null
	) {
		const next = new Map(nodeUserDragPreviewByNodeId);
		const isDefaultPreview =
			placeholderIndex === null &&
			visibleUserOids.length === getNodeById(nodeId)?.userOids.length &&
			visibleUserOids.every((userOid, index) => getNodeById(nodeId)?.userOids[index] === userOid);

		if (isDefaultPreview) {
			next.delete(nodeId);
		} else {
			next.set(nodeId, { visibleUserOids: [...visibleUserOids], placeholderIndex });
		}
		nodeUserDragPreviewByNodeId = next;
		const signature = JSON.stringify({
			nodeId,
			visibleUserOids,
			placeholderIndex,
			directPreviewCount: next.size
		});
		if (signature !== lastLoggedPreviewSignature) {
			lastLoggedPreviewSignature = signature;
			debugUserDrag('preview-map-update', JSON.parse(signature));
		}
	}

	function getNodeUserOverlayEntries(node: ChartNode) {
		const directPreview = nodeUserDragPreviewByNodeId.get(node.id) ?? null;
		if (directPreview) {
			return directPreview.visibleUserOids.map((userOid, visibleIndex) => ({
				userOid,
				displayIndex:
					directPreview.placeholderIndex !== null &&
					directPreview.placeholderIndex >= 0 &&
					visibleIndex >= directPreview.placeholderIndex
						? visibleIndex + 1
						: visibleIndex,
				extraOffsetPx:
					directPreview.placeholderIndex !== null &&
					directPreview.placeholderIndex >= 0 &&
					visibleIndex >= directPreview.placeholderIndex
						? nodeUserPlaceholderHeightPx - nodeUserLabelMinHeightPx
						: 0
			}));
		}

		const visibleUserOids = node.userOids.filter((userOid) => shouldRenderNodeUserOverlay(node.id, userOid));
		const placeholderIndex =
			activeUserRowDragHover?.targetComboId === node.id &&
			activeUserRowDragHover.targetIndex !== null &&
			activeUserRowDragHover.targetIndex >= 0
				? activeUserRowDragHover.targetIndex
				: null;

	return visibleUserOids.map((userOid, visibleIndex) => ({
		userOid,
		displayIndex:
			placeholderIndex !== null && visibleIndex >= placeholderIndex
				? visibleIndex + 1
				: visibleIndex,
		extraOffsetPx:
			placeholderIndex !== null && visibleIndex >= placeholderIndex
				? nodeUserPlaceholderHeightPx - nodeUserLabelMinHeightPx
				: 0
	}));
}

	$: if (isUserRowDragging && typeof document !== 'undefined') {
		queueMicrotask(() => {
			const activeNodeIds = new Set<string>();
			if (activeUserRowDrag?.sourceComboId) activeNodeIds.add(activeUserRowDrag.sourceComboId);
			if (activeUserRowDragHover?.targetComboId) activeNodeIds.add(activeUserRowDragHover.targetComboId);

			const domAlignmentSnapshot = [...activeNodeIds]
				.map((nodeId) => {
					const comboRoot = document.querySelector(
						`[data-user-combo-id="${CSS.escape(nodeId)}"]`
					) as HTMLElement | null;
					if (!comboRoot) {
						return { nodeId, missing: 'combo-root' };
					}

					const rowRects = Array.from(
						comboRoot.querySelectorAll<HTMLElement>('[data-user-row-index]')
					).map((rowEl) => {
						const rect = rowEl.getBoundingClientRect();
						return {
							rowIndex: Number(rowEl.dataset.userRowIndex ?? '-1'),
							top: Math.round(rect.top * 100) / 100,
							height: Math.round(rect.height * 100) / 100,
							centerY: Math.round((rect.top + rect.height / 2) * 100) / 100
						};
					});

					const placeholderRects = Array.from(
						comboRoot.querySelectorAll<HTMLElement>('[data-user-placeholder-index]')
					).map((placeholderEl) => {
						const rect = placeholderEl.getBoundingClientRect();
						return {
							placeholderIndex: Number(placeholderEl.dataset.userPlaceholderIndex ?? '-1'),
							top: Math.round(rect.top * 100) / 100,
							height: Math.round(rect.height * 100) / 100,
							centerY: Math.round((rect.top + rect.height / 2) * 100) / 100
						};
					});

					const overlayRects = Array.from(
						document.querySelectorAll<HTMLElement>(
							`[data-overlay-node-id="${CSS.escape(nodeId)}"]`
						)
					).map((overlayEl) => {
						const rect = overlayEl.getBoundingClientRect();
						return {
							userOid: overlayEl.dataset.overlayUserOid ?? '',
							displayIndex: Number(overlayEl.dataset.overlayDisplayIndex ?? '-1'),
							top: Math.round(rect.top * 100) / 100,
							height: Math.round(rect.height * 100) / 100,
							centerY: Math.round((rect.top + rect.height / 2) * 100) / 100
						};
					});

					return {
						nodeId,
						rowRects,
						placeholderRects,
						overlayRects
					};
				})
				.filter((entry) => entry !== null);

			const signature = JSON.stringify(domAlignmentSnapshot);
			if (signature !== lastLoggedDomAlignmentSignature) {
				lastLoggedDomAlignmentSignature = signature;
				debugUserDrag('dom-alignment', { domAlignmentSnapshot });
			}
		});
	}

	function setNodePinnedState(nodeId: string, shouldPin: boolean) {
		const currentlyPinned = pinnedNodeIds.has(nodeId);
		if (currentlyPinned === shouldPin) return;
		const nextPinnedNodeIds = new Set(pinnedNodeIds);
		if (shouldPin) {
			nextPinnedNodeIds.add(nodeId);
		} else {
			nextPinnedNodeIds.delete(nodeId);
		}
		pinnedNodeIds = nextPinnedNodeIds;
		// Reassign to force immediate geometry refresh for scaled nodes and attached connections.
		nodes = [...nodes];
	}

	function getConnectorDirectionVector(side: NodeConnectorSide): Point {
		if (side === 'top') return { x: 0, y: -1 };
		if (side === 'right') return { x: 1, y: 0 };
		if (side === 'bottom') return { x: 0, y: 1 };
		return { x: -1, y: 0 };
	}

	function toCanvasLocalPoint(screenX: number, screenY: number): Point | null {
		if (!nodeCanvasEl) return null;
		const rect = nodeCanvasEl.getBoundingClientRect();
		return { x: screenX - rect.left, y: screenY - rect.top };
	}

	function worldToCanvasPoint(point: Point): Point {
		return {
			x: panX + point.x * zoom,
			y: panY + point.y * zoom
		};
	}

	function getNodeHeaderHeight() {
		return nodeHeaderTopPaddingPx + nodeHeaderContentHeightPx + nodeHeaderBottomPaddingPx;
	}

	function mapNodeLocalPointToWorld(node: ChartNode, localPoint: Point): Point {
		const renderScale = getPinnedNodeRenderScale(node.id);
		const centerX = node.width * 0.5;
		const centerY = node.height * 0.5;
		return {
			x: node.x + centerX + (localPoint.x - centerX) * renderScale,
			y: node.y + centerY + (localPoint.y - centerY) * renderScale
		};
	}

	function getNodeTitleCenter(node: ChartNode): Point {
		return mapNodeLocalPointToWorld(node, getNodeTitleLocalPoint(node));
	}

	function getNodeTitleLocalPoint(node: ChartNode): Point {
		return {
			x: node.width * 0.5,
			y: getNodeHeaderHeight() * 0.5
		};
	}

	function getNodeTitleFontSize(nodeId: string, fontScale: number) {
		return nodeHeaderFontSizePx * fontScale * getPinnedNodeRenderScale(nodeId);
	}

function getNodeUserLabelCenter(node: ChartNode, userIndex: number, extraOffsetPx = 0): Point {
	return mapNodeLocalPointToWorld(node, getNodeUserLabelLocalPoint(node, userIndex, extraOffsetPx));
}

function getNodeUserLabelLocalPoint(node: ChartNode, userIndex: number, extraOffsetPx = 0): Point {
	return {
		x: node.width * 0.5,
		y:
			getNodeHeaderHeight() +
			nodeBodyPaddingPx +
			nodeUserLabelMinHeightPx * userIndex +
			nodeUserLabelMinHeightPx * 0.5 +
			extraOffsetPx
	};
}

	function getNodeOverlayWidth(node: ChartNode, horizontalPaddingPx: number, canvasZoom: number) {
		return Math.max(
			0,
			(node.width - horizontalPaddingPx * 2) * canvasZoom * getPinnedNodeRenderScale(node.id)
		);
	}

	function estimateTextWidthPx(text: string, fontSizePx: number) {
		const trimmed = text.length > 0 ? text : '';
		if (trimmed.length === 0) return 0;
		return Math.ceil(trimmed.length * fontSizePx * 0.62);
	}

	function isNodeTitleEditorFocused(nodeId: string) {
		if (typeof document === 'undefined') return false;
		const activeEl = document.activeElement as HTMLElement | null;
		return activeEl?.dataset?.nodeTitleEditorId === nodeId;
	}

	function getNodeTitleHitWidth(node: ChartNode, fontScale: number, canvasZoom: number) {
		const fontSize = getNodeTitleFontSize(node.id, fontScale);
		const isActiveTitleEdit =
			focusedTitleNodeId === node.id && isNodeTitleEditorFocused(node.id);
		const titleText =
			node.title.length > 0
				? node.title
				: isActiveTitleEdit
					? ''
					: 'Untitled node';
		const measuredWidth = estimateTextWidthPx(titleText, fontSize);
		const desiredWidth =
			measuredWidth > 0
				? measuredWidth + nodeTitleHitboxHorizontalPaddingPx * 2
				: nodeTitleEmptyFocusWidthPx;
		return Math.min(
			getNodeOverlayWidth(node, nodeHeaderHorizontalPaddingPx, canvasZoom),
			desiredWidth
		);
	}

	function placeCaretAtEnd(element: HTMLElement) {
		if (typeof window === 'undefined') return;
		const selection = window.getSelection();
		if (!selection) return;
		const range = document.createRange();
		range.selectNodeContents(element);
		range.collapse(false);
		selection.removeAllRanges();
		selection.addRange(range);
	}

	async function beginNodeTitleEdit(nodeId: string) {
		if (!isEditMode) return;
		focusedTitleNodeId = nodeId;
		bringNodeToFront(nodeId);
		await tick();
		const editorEl = document.querySelector<HTMLElement>(
			`[data-node-title-editor-id="${nodeId}"]`
		);
		if (editorEl) {
			editorEl.textContent = getNodeById(nodeId)?.title ?? '';
			editorEl.focus();
			placeCaretAtEnd(editorEl);
		}
	}

	function getConnectorWorldPoint(ref: NodeConnectorRef): Point | null {
		const node = getNodeById(ref.nodeId);
		if (!node) return null;
		const renderScale = getPinnedNodeRenderScale(node.id);
		const halfWidth = (node.width * renderScale) * 0.5;
		const halfHeight = (node.height * renderScale) * 0.5;
		const centerX = node.x + node.width * 0.5;
		const centerY = node.y + node.height * 0.5;
		if (ref.side === 'top') {
			return { x: centerX, y: centerY - halfHeight };
		}
		if (ref.side === 'right') {
			return { x: centerX + halfWidth, y: centerY };
		}
		if (ref.side === 'bottom') {
			return { x: centerX, y: centerY + halfHeight };
		}
		return { x: centerX - halfWidth, y: centerY };
	}

	function canDropConnection(source: NodeConnectorRef, target: NodeConnectorRef) {
		if (source.nodeId === target.nodeId) return false;
		return !connections.some(
			(connection) =>
				connectorEquals(connection.from, source) && connectorEquals(connection.to, target)
		);
	}

	function buildSplinePath(
		start: Point,
		end: Point,
		startSide: NodeConnectorSide,
		endSide: NodeConnectorSide
	) {
		const startVec = getConnectorDirectionVector(startSide);
		const endVec = getConnectorDirectionVector(endSide);
		const distance = Math.hypot(end.x - start.x, end.y - start.y);
		const handle = Math.max(30, Math.min(220, distance * 0.42));
		const c1 = { x: start.x + startVec.x * handle, y: start.y + startVec.y * handle };
		const c2 = { x: end.x + endVec.x * handle, y: end.y + endVec.y * handle };
		return `M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${end.x} ${end.y}`;
	}

	function buildPreviewSplinePath(start: Point, end: Point, startSide: NodeConnectorSide) {
		const startVec = getConnectorDirectionVector(startSide);
		const distance = Math.hypot(end.x - start.x, end.y - start.y);
		const handle = Math.max(26, Math.min(180, distance * 0.36));
		const c1 = { x: start.x + startVec.x * handle, y: start.y + startVec.y * handle };
		const c2 = {
			x: end.x - (end.x - start.x) * 0.35,
			y: end.y - (end.y - start.y) * 0.35
		};
		return `M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${end.x} ${end.y}`;
	}

	function resolveConnectorFromElement(target: EventTarget | null): NodeConnectorRef | null {
		const element = target instanceof Element ? target : null;
		const connectorEl = element?.closest(
			'[data-connector-node-id][data-connector-side]'
		) as HTMLElement | null;
		if (!connectorEl) return null;
		const nodeId = connectorEl.dataset.connectorNodeId;
		const side = connectorEl.dataset.connectorSide as NodeConnectorSide | undefined;
		if (!nodeId || (side !== 'top' && side !== 'right' && side !== 'bottom' && side !== 'left')) {
			return null;
		}
		return { nodeId, side };
	}

	function resolveConnectorAtScreenPoint(
		screenX: number,
		screenY: number
	): NodeConnectorRef | null {
		if (typeof document === 'undefined') return null;
		return resolveConnectorFromElement(document.elementFromPoint(screenX, screenY));
	}

	function hasConnectorAtScreenPoint(screenX: number, screenY: number) {
		if (typeof document === 'undefined') return false;
		const stack = document.elementsFromPoint(screenX, screenY);
		for (const element of stack) {
			if (!(element instanceof HTMLElement)) continue;
			if (element.closest('[data-connector-node-id][data-connector-side]')) {
				return true;
			}
		}
		return false;
	}

	function updateConnectorPreviewPath() {
		if (!activeConnectorDrag) {
			connectorPreviewPath = '';
			return;
		}
		const sourceWorld = getConnectorWorldPoint(activeConnectorDrag.source);
		const sourceCanvas = sourceWorld ? worldToCanvasPoint(sourceWorld) : null;
		const pointerCanvas = toCanvasLocalPoint(
			activeConnectorDrag.pointerX,
			activeConnectorDrag.pointerY
		);
		if (!sourceCanvas || !pointerCanvas) {
			connectorPreviewPath = '';
			return;
		}
		if (activeConnectorDrag.hoveredTarget && activeConnectorDrag.canDrop) {
			const targetWorld = getConnectorWorldPoint(activeConnectorDrag.hoveredTarget);
			const targetCanvas = targetWorld ? worldToCanvasPoint(targetWorld) : pointerCanvas;
			connectorPreviewPath = buildSplinePath(
				sourceCanvas,
				targetCanvas,
				activeConnectorDrag.source.side,
				activeConnectorDrag.hoveredTarget.side
			);
			return;
		}
		connectorPreviewPath = buildPreviewSplinePath(
			sourceCanvas,
			pointerCanvas,
			activeConnectorDrag.source.side
		);
	}

	function recalculateRenderedConnections() {
		renderedConnections = connections
			.map((connection) => {
				const sourceWorld = getConnectorWorldPoint(connection.from);
				const targetWorld = getConnectorWorldPoint(connection.to);
				if (!sourceWorld || !targetWorld) return null;
				const sourceCanvas = worldToCanvasPoint(sourceWorld);
				const targetCanvas = worldToCanvasPoint(targetWorld);
				return {
					id: connection.id,
					path: buildSplinePath(
						sourceCanvas,
						targetCanvas,
						connection.from.side,
						connection.to.side
					)
				};
			})
			.filter((entry): entry is RenderedConnection => entry !== null);
	}

	function clearSelectedConnection() {
		selectedConnectionId = null;
		selectedConnectionDeleteButtonPos = null;
	}

	function handleConnectionClick(connectionId: string, event: MouseEvent | PointerEvent) {
		if (!isEditMode) return;
		if (hasConnectorAtScreenPoint(event.clientX, event.clientY)) return;
		const localPoint = toCanvasLocalPoint(event.clientX, event.clientY);
		if (!localPoint) return;
		selectedConnectionId = connectionId;
		selectedConnectionDeleteButtonPos = {
			x: localPoint.x + 16,
			y: localPoint.y - 16
		};
		event.preventDefault();
		event.stopPropagation();
	}

	function handleConnectionPointerDown(event: PointerEvent) {
		if (!isEditMode) return;
		if (hasConnectorAtScreenPoint(event.clientX, event.clientY)) return;
		event.stopPropagation();
	}

	function deleteSelectedConnection() {
		if (!selectedConnectionId) return;
		connections = connections.filter((connection) => connection.id !== selectedConnectionId);
		recalculateRenderedConnections();
		clearSelectedConnection();
	}

	function updateConnectorDragHover(pointerX: number, pointerY: number) {
		if (!activeConnectorDrag) return;
		const hovered = resolveConnectorAtScreenPoint(pointerX, pointerY);
		const canDrop =
			hovered !== null && hovered.nodeId !== activeConnectorDrag.source.nodeId
				? canDropConnection(activeConnectorDrag.source, hovered)
				: false;
		activeConnectorDrag = {
			...activeConnectorDrag,
			pointerX,
			pointerY,
			hoveredTarget: hovered,
			canDrop
		};
	}

	function removeConnectorWindowListeners() {
		if (typeof window === 'undefined') return;
		if (onWindowConnectorPointerMove) {
			window.removeEventListener('pointermove', onWindowConnectorPointerMove);
			onWindowConnectorPointerMove = null;
		}
		if (onWindowConnectorPointerUp) {
			window.removeEventListener('pointerup', onWindowConnectorPointerUp);
			window.removeEventListener('pointercancel', onWindowConnectorPointerUp);
			onWindowConnectorPointerUp = null;
		}
	}

	function cancelConnectorDrag() {
		activeConnectorDrag = null;
		removeConnectorWindowListeners();
	}

	function handleConnectorPointerMove(event: PointerEvent) {
		if (!activeConnectorDrag || event.pointerId !== activeConnectorDrag.pointerId) return;
		updateConnectorDragHover(event.clientX, event.clientY);
		event.preventDefault();
	}

	function handleConnectorPointerUp(event: PointerEvent) {
		if (!activeConnectorDrag || event.pointerId !== activeConnectorDrag.pointerId) return;
		updateConnectorDragHover(event.clientX, event.clientY);
		if (activeConnectorDrag.hoveredTarget && activeConnectorDrag.canDrop) {
			connections = [
				...connections,
				{
					id: createConnectionId(),
					from: activeConnectorDrag.source,
					to: activeConnectorDrag.hoveredTarget
				}
			];
			recalculateRenderedConnections();
		}
		cancelConnectorDrag();
		event.preventDefault();
	}

	function beginConnectorDrag(
		nodeId: string,
		side: NodeConnectorSide,
		pointerX: number,
		pointerY: number,
		pointerId: number
	) {
		if (!isEditMode) return;
		if (activeDraggedNodeId || activeConnectorDrag || isPanningDrag || isUserRowDragging) return;
		clearSelectedConnection();
		const source: NodeConnectorRef = { nodeId, side };
		stopMomentum();
		activeConnectorDrag = {
			source,
			pointerId,
			pointerX,
			pointerY,
			hoveredTarget: null,
			canDrop: false
		};
		updateConnectorDragHover(pointerX, pointerY);
		if (!onWindowConnectorPointerMove) {
			onWindowConnectorPointerMove = handleConnectorPointerMove;
			window.addEventListener('pointermove', onWindowConnectorPointerMove, { passive: false });
		}
		if (!onWindowConnectorPointerUp) {
			onWindowConnectorPointerUp = handleConnectorPointerUp;
			window.addEventListener('pointerup', onWindowConnectorPointerUp, { passive: false });
			window.addEventListener('pointercancel', onWindowConnectorPointerUp, { passive: false });
		}
	}

	$: {
		if (!isEditMode && activeConnectorDrag) {
			cancelConnectorDrag();
		}
	}

	$: {
		if (!isEditMode && selectedConnectionId) {
			clearSelectedConnection();
		}
	}

	$: {
		const validNodeIds = new Set(nodes.map((node) => node.id));
		const filtered = connections.filter(
			(connection) =>
				validNodeIds.has(connection.from.nodeId) && validNodeIds.has(connection.to.nodeId)
		);
		if (filtered.length !== connections.length) {
			connections = filtered;
		}
		if (
			selectedConnectionId &&
			!filtered.some((connection) => connection.id === selectedConnectionId)
		) {
			clearSelectedConnection();
		}
	}

	$: {
		connections;
		nodes;
		pinnedNodeIds;
		panX;
		panY;
		zoom;
		recalculateRenderedConnections();
	}

	$: {
		activeConnectorDrag;
		panX;
		panY;
		zoom;
		nodes;
		pinnedNodeIds;
		updateConnectorPreviewPath();
	}

	$: {
		nodes;
		pinnedNodeIds;
		let untitledIndex = 0;
		pinnedNodeEntries = Array.from(pinnedNodeIds)
			.map((nodeId) => getNodeById(nodeId))
			.filter((node): node is ChartNode => node !== null)
			.map((node) => {
				const title =
					node.title.trim().length > 0 ? node.title.trim() : `Untitled node ${++untitledIndex}`;
				return { id: node.id, title };
			});
	}

	function getVisibleCanvasCenterLocalPoint() {
		if (!nodeCanvasEl) return null;
		const canvasRect = nodeCanvasEl.getBoundingClientRect();
		const rightRailRect = rightRailEl?.getBoundingClientRect() ?? null;
		const modeCardRect = modeCardEl?.getBoundingClientRect() ?? null;
		const newNodeButtonRect = newNodeButtonEl?.getBoundingClientRect() ?? null;

		const leftInset = modeCardRect
			? Math.max(0, Math.min(modeCardRect.right, canvasRect.right) - Math.max(modeCardRect.left, canvasRect.left))
			: 0;
		const rightInset = rightRailRect
			? Math.max(0, Math.min(rightRailRect.right, canvasRect.right) - Math.max(rightRailRect.left, canvasRect.left))
			: 0;
		const topInset = Math.max(
			modeCardRect
				? Math.max(0, Math.min(modeCardRect.bottom, canvasRect.bottom) - Math.max(modeCardRect.top, canvasRect.top))
				: 0,
			newNodeButtonRect
				? Math.max(
						0,
						Math.min(newNodeButtonRect.bottom, canvasRect.bottom) -
							Math.max(newNodeButtonRect.top, canvasRect.top)
				  )
				: 0
		);

		const visibleLeft = leftInset;
		const visibleRight = Math.max(visibleLeft, canvasRect.width - rightInset);
		const visibleTop = topInset;
		const visibleBottom = Math.max(visibleTop, canvasRect.height);

		return {
			x: (visibleLeft + visibleRight) * 0.5,
			y: (visibleTop + visibleBottom) * 0.5
		};
	}

	function addNewNode() {
		const width = 290;
		const height = 160;
		const nodeCount = nodes.length;
		const visibleCenter = getVisibleCanvasCenterLocalPoint();
		const baseX =
			visibleCenter !== null ? (visibleCenter.x - panX) / zoom - width * 0.5 : 32;
		const baseY =
			visibleCenter !== null ? (visibleCenter.y - panY) / zoom - height * 0.5 : 32;
		const staggerOffset = Math.min(nodeCount, 8) * 18;
		const newNode: ChartNode = {
			id: createNodeId(),
			title: '',
			x: Math.round(baseX + staggerOffset),
			y: Math.round(baseY + staggerOffset),
			width,
			height,
			userOids: [],
			childNodeIds: []
		};
		nodes = [...nodes, newNode];
	}

	function updateNodePosition(nodeId: string, nextX: number, nextY: number) {
		nodes = nodes.map((node) =>
			node.id === nodeId
				? {
						...node,
						x: nextX,
						y: nextY
					}
				: node
		);
	}

	function updateNodePositions(positionByNodeId: Map<string, Point>) {
		nodes = nodes.map((node) => {
			const nextPosition = positionByNodeId.get(node.id);
			return nextPosition ? { ...node, x: nextPosition.x, y: nextPosition.y } : node;
		});
	}

	function getConnectedNodeIds(rootNodeId: string) {
		const connectedNodeIds = new Set<string>([rootNodeId]);
		const pendingNodeIds = [rootNodeId];
		while (pendingNodeIds.length > 0) {
			const currentNodeId = pendingNodeIds.pop();
			if (!currentNodeId) continue;
			for (const connection of connections) {
				let neighborNodeId: string | null = null;
				if (connection.from.nodeId === currentNodeId) {
					neighborNodeId = connection.to.nodeId;
				} else if (connection.to.nodeId === currentNodeId) {
					neighborNodeId = connection.from.nodeId;
				}
				if (!neighborNodeId || connectedNodeIds.has(neighborNodeId)) continue;
				connectedNodeIds.add(neighborNodeId);
				pendingNodeIds.push(neighborNodeId);
			}
		}
		return connectedNodeIds;
	}

	function beginLinkedDrag(nodeId: string) {
		const rootNode = getNodeById(nodeId);
		if (!rootNode) return null;
		const connectedNodeIds = getConnectedNodeIds(nodeId);
		const startPositionsByNodeId = new Map<string, Point>();
		for (const node of nodes) {
			if (!connectedNodeIds.has(node.id)) continue;
			startPositionsByNodeId.set(node.id, { x: node.x, y: node.y });
		}
		const nextLinkedDrag = {
			rootNodeId: nodeId,
			startRootPosition: { x: rootNode.x, y: rootNode.y },
			startPositionsByNodeId
		};
		activeLinkedDrag = nextLinkedDrag;
		usedLinkedDragForCurrentPointerDrag = startPositionsByNodeId.size > 1;
		return nextLinkedDrag;
	}

	function clearLinkedDrag() {
		activeLinkedDrag = null;
	}

	function updateLinkedDragPositions(nodeId: string, nextX: number, nextY: number) {
		const linkedDrag =
			activeLinkedDrag?.rootNodeId === nodeId ? activeLinkedDrag : beginLinkedDrag(nodeId);
		if (!linkedDrag) {
			updateNodePosition(nodeId, nextX, nextY);
			return;
		}
		const deltaX = nextX - linkedDrag.startRootPosition.x;
		const deltaY = nextY - linkedDrag.startRootPosition.y;
		const positionByNodeId = new Map<string, Point>();
		for (const [linkedNodeId, startPosition] of linkedDrag.startPositionsByNodeId) {
			positionByNodeId.set(linkedNodeId, {
				x: startPosition.x + deltaX,
				y: startPosition.y + deltaY
			});
		}
		updateNodePositions(positionByNodeId);
	}

	function resolveDropTopLeftCollision(nodeId: string, nextX: number, nextY: number) {
		let resolvedX = nextX;
		let resolvedY = nextY;
		const shiftStep = 24;
		const collisionDistance = 10;
		for (let attempt = 0; attempt < 32; attempt += 1) {
			const hasCollision = nodes.some((node) => {
				if (node.id === nodeId) return false;
				return Math.hypot(resolvedX - node.x, resolvedY - node.y) <= collisionDistance;
			});
			if (!hasCollision) break;
			resolvedX += shiftStep;
			resolvedY += shiftStep;
		}
		return { x: resolvedX, y: resolvedY };
	}

	function getPointToNodeRectEdgeDistance(pointX: number, pointY: number, node: ChartNode) {
		const nodeRight = node.x + node.width;
		const nodeBottom = node.y + node.height;
		const gapX = Math.max(0, Math.max(node.x - pointX, pointX - nodeRight));
		const gapY = Math.max(0, Math.max(node.y - pointY, pointY - nodeBottom));
		return Math.hypot(gapX, gapY);
	}

	function resolveClosestSnapPositionForAnchor(
		draggedNode: ChartNode,
		anchorNode: ChartNode,
		cursorWorldX: number,
		cursorWorldY: number,
		fallbackX: number,
		fallbackY: number
	) {
		const anchorCenterX = anchorNode.x + anchorNode.width * 0.5;
		const anchorCenterY = anchorNode.y + anchorNode.height * 0.5;
		const stepX = (anchorNode.width + draggedNode.width) * 0.5 + ctrlSnapNodeGap;
		const stepY = (anchorNode.height + draggedNode.height) * 0.5 + ctrlSnapNodeGap;
		let snappedX = fallbackX;
		let snappedY = fallbackY;
		let bestTargetDistance = Number.POSITIVE_INFINITY;
		for (const offsetY of [-1, 0, 1]) {
			for (const offsetX of [-1, 0, 1]) {
				if (offsetX === 0 && offsetY === 0) continue;
				const targetCenterX = anchorCenterX + offsetX * stepX;
				const targetCenterY = anchorCenterY + offsetY * stepY;
				const snapDistance = Math.hypot(cursorWorldX - targetCenterX, cursorWorldY - targetCenterY);
				if (snapDistance >= bestTargetDistance) continue;
				bestTargetDistance = snapDistance;
				snappedX = targetCenterX - draggedNode.width * 0.5;
				snappedY = targetCenterY - draggedNode.height * 0.5;
			}
		}
		return { x: snappedX, y: snappedY };
	}

	function resolveCtrlSnapPosition(
		nodeId: string,
		nextX: number,
		nextY: number,
		cursorWorldX: number,
		cursorWorldY: number
	): { x: number; y: number; anchorNodeId: string } | null {
		const draggedNode = nodes.find((node) => node.id === nodeId);
		if (!draggedNode) return null;
		const activeAnchorNode = activeCtrlSnapAnchorNodeId
			? (nodes.find((node) => node.id === activeCtrlSnapAnchorNodeId) ?? null)
			: null;
		if (activeAnchorNode && activeAnchorNode.id !== nodeId) {
			const anchorDistance = getPointToNodeRectEdgeDistance(
				cursorWorldX,
				cursorWorldY,
				activeAnchorNode
			);
			if (anchorDistance <= ctrlSnapDetachDistance) {
				const snapped = resolveClosestSnapPositionForAnchor(
					draggedNode,
					activeAnchorNode,
					cursorWorldX,
					cursorWorldY,
					nextX,
					nextY
				);
				return { ...snapped, anchorNodeId: activeAnchorNode.id };
			}
		}
		let nearestNode: ChartNode | null = null;
		let nearestEdgeDistance = Number.POSITIVE_INFINITY;
		for (const candidate of nodes) {
			if (candidate.id === nodeId) continue;
			const edgeDistance = getPointToNodeRectEdgeDistance(cursorWorldX, cursorWorldY, candidate);
			if (edgeDistance > ctrlSnapNearestNodeDistance || edgeDistance >= nearestEdgeDistance)
				continue;
			nearestEdgeDistance = edgeDistance;
			nearestNode = candidate;
		}
		if (!nearestNode) return null;
		const snapped = resolveClosestSnapPositionForAnchor(
			draggedNode,
			nearestNode,
			cursorWorldX,
			cursorWorldY,
			nextX,
			nextY
		);
		return { ...snapped, anchorNodeId: nearestNode.id };
	}

	function keepDraggedNodePointerAnchored(nextPanX: number, nextPanY: number, nextZoom: number) {
		if (!activeDraggedNodeId || !nodeCanvasEl) return;
		const draggedNode = nodes.find((node) => node.id === activeDraggedNodeId);
		if (!draggedNode) return;
		const rect = nodeCanvasEl.getBoundingClientRect();
		const safeNextZoom = nextZoom > 0 ? nextZoom : 1;
		const effectivePointerLocalX = (dragLockPointerX ?? activeDraggedPointerX) - rect.left;
		const effectivePointerLocalY = (dragLockPointerY ?? activeDraggedPointerY) - rect.top;
		const pointerOffsetScreenX = activeDragPointerOffsetX * safeNextZoom;
		const pointerOffsetScreenY = activeDragPointerOffsetY * safeNextZoom;
		const targetNodeLocalX = effectivePointerLocalX - pointerOffsetScreenX;
		const targetNodeLocalY = effectivePointerLocalY - pointerOffsetScreenY;
		const nodeScreenWidth = draggedNode.width * safeNextZoom;
		const nodeScreenHeight = draggedNode.height * safeNextZoom;
		const maxNodeLocalX = Math.max(0, rect.width - nodeScreenWidth);
		const maxNodeLocalY = Math.max(0, rect.height - nodeScreenHeight);
		const clampedNodeLocalX = Math.min(maxNodeLocalX, Math.max(0, targetNodeLocalX));
		const clampedNodeLocalY = Math.min(maxNodeLocalY, Math.max(0, targetNodeLocalY));
		const adjustedWorldX = (clampedNodeLocalX - nextPanX) / safeNextZoom;
		const adjustedWorldY = (clampedNodeLocalY - nextPanY) / safeNextZoom;
		if (activeLinkedDrag?.rootNodeId === activeDraggedNodeId) {
			updateLinkedDragPositions(activeDraggedNodeId, adjustedWorldX, adjustedWorldY);
		} else {
			updateNodePosition(activeDraggedNodeId, adjustedWorldX, adjustedWorldY);
		}
	}

	function updateNodePositionWithPointer(
		nodeId: string,
		nextX: number,
		nextY: number,
		pointerX: number,
		pointerY: number,
		ctrlKey: boolean,
		shiftKey: boolean,
		spaceKey: boolean
	) {
		if (activeDraggedNodeId !== nodeId) {
			activeDraggedNodeId = nodeId;
			stopMomentum();
			ensurePanAnimation();
		}
		if (spaceKey) {
			if (activeLinkedDrag?.rootNodeId !== nodeId) {
				beginLinkedDrag(nodeId);
			}
		} else if (activeLinkedDrag?.rootNodeId === nodeId) {
			clearLinkedDrag();
		}
		const commitPosition = (resolvedX: number, resolvedY: number) => {
			if (spaceKey) {
				updateLinkedDragPositions(nodeId, resolvedX, resolvedY);
			} else {
				updateNodePosition(nodeId, resolvedX, resolvedY);
			}
		};
		if (shiftKey) {
			activeCtrlSnapAnchorNodeId = null;
			commitPosition(
				Math.round(nextX / nodeGridSizePx) * nodeGridSizePx,
				Math.round(nextY / nodeGridSizePx) * nodeGridSizePx
			);
		} else if (ctrlKey) {
			const safeZoom = zoom > 0 ? zoom : 1;
			const canvasLocalPoint = nodeCanvasEl
				? {
						x: pointerX - nodeCanvasEl.getBoundingClientRect().left,
						y: pointerY - nodeCanvasEl.getBoundingClientRect().top
					}
				: null;
			const cursorWorldX =
				canvasLocalPoint === null ? nextX : (canvasLocalPoint.x - panX) / safeZoom;
			const cursorWorldY =
				canvasLocalPoint === null ? nextY : (canvasLocalPoint.y - panY) / safeZoom;
			const snappedPosition = resolveCtrlSnapPosition(
				nodeId,
				nextX,
				nextY,
				cursorWorldX,
				cursorWorldY
			);
			if (snappedPosition) {
				activeCtrlSnapAnchorNodeId = snappedPosition.anchorNodeId;
				commitPosition(snappedPosition.x, snappedPosition.y);
			} else {
				activeCtrlSnapAnchorNodeId = null;
				commitPosition(nextX, nextY);
			}
		} else {
			activeCtrlSnapAnchorNodeId = null;
			commitPosition(nextX, nextY);
		}
		activeDraggedPointerX = pointerX;
		activeDraggedPointerY = pointerY;
	}

	function updateNodeTitle(nodeId: string, title: string) {
		nodes = nodes.map((node) => (node.id === nodeId ? { ...node, title } : node));
	}

	function updateNodeWidth(nodeId: string, nextWidth: number) {
		nodes = nodes.map((node) =>
			node.id === nodeId && Math.abs(node.width - nextWidth) > 0.5
				? { ...node, width: nextWidth }
				: node
		);
	}

	function shouldDeferGraphSave() {
		return (
			isUserRowDragging ||
			activeUserRowDrag !== null
		);
	}

	function updateNodeHeight(nodeId: string, nextHeight: number) {
		nodes = nodes.map((node) =>
			node.id === nodeId && Math.abs(node.height - nextHeight) > 0.5
				? { ...node, height: nextHeight }
				: node
		);
	}

	function updateNodeUsers(nodeId: string, userOids: string[]) {
		nodes = nodes.map((node) => {
			if (node.id !== nodeId) return node;
			if (
				node.userOids.length === userOids.length &&
				node.userOids.every((userOid, index) => userOid === userOids[index])
			) {
				return node;
			}
			return { ...node, userOids };
		});
	}

	function bringNodeToFront(nodeId: string) {
		clearSelectedConnection();
		const index = nodes.findIndex((node) => node.id === nodeId);
		if (index < 0 || index === nodes.length - 1) return;
		const selectedNode = nodes[index];
		nodes = [...nodes.slice(0, index), ...nodes.slice(index + 1), selectedNode];
	}

	function focusNode(nodeId: string) {
		const node = getNodeById(nodeId);
		if (!node || !nodeCanvasEl) return;
		const viewportWidth = nodeCanvasEl.clientWidth;
		const viewportHeight = nodeCanvasEl.clientHeight;
		if (viewportWidth <= 0 || viewportHeight <= 0) return;
		stopMomentum();
		const targetZoom = (minZoom + maxZoom) * 0.5;
		const targetLocalX = viewportWidth * 0.5;
		const targetLocalY = viewportHeight * 0.5;
		const nodeCenterX = node.x + node.width * 0.5;
		const nodeCenterY = node.y + node.height * 0.5;
		animateCameraTo(
			targetLocalX - nodeCenterX * targetZoom,
			targetLocalY - nodeCenterY * targetZoom,
			targetZoom
		);
		bringNodeToFront(nodeId);
	}

	function handleNodeDragStart(nodeId: string, pointerX: number, pointerY: number) {
		if (activeConnectorDrag || isPanningDrag || isUserRowDragging) {
			return;
		}
		if (activeDraggedNodeId && activeDraggedNodeId !== nodeId) {
			// Recover from stale node drag ownership and continue this new drag start.
			requestCancelNodeDrag();
		}
		activeDraggedNodeId = nodeId;
		activeDraggedPointerX = pointerX;
		activeDraggedPointerY = pointerY;
		const draggedNode = nodes.find((node) => node.id === nodeId);
		if (draggedNode && nodeCanvasEl) {
			const rect = nodeCanvasEl.getBoundingClientRect();
			const pointerLocalX = pointerX - rect.left;
			const pointerLocalY = pointerY - rect.top;
			const safeZoom = zoom > 0 ? zoom : 1;
			activeDragPointerOffsetX = (pointerLocalX - (panX + draggedNode.x * safeZoom)) / safeZoom;
			activeDragPointerOffsetY = (pointerLocalY - (panY + draggedNode.y * safeZoom)) / safeZoom;
		} else {
			activeDragPointerOffsetX = 0;
			activeDragPointerOffsetY = 0;
		}
		dragLockPointerX = null;
		dragLockPointerY = null;
		activeCtrlSnapAnchorNodeId = null;
		activeLinkedDrag = null;
		usedLinkedDragForCurrentPointerDrag = false;
		stopMomentum();
		ensurePanAnimation();
	}

	function handleNodeDragEnd(nodeId: string) {
		if (activeDraggedNodeId === nodeId) {
			const droppedNode = nodes.find((node) => node.id === nodeId);
			if (droppedNode && !usedLinkedDragForCurrentPointerDrag) {
				const resolved = resolveDropTopLeftCollision(nodeId, droppedNode.x, droppedNode.y);
				if (resolved.x !== droppedNode.x || resolved.y !== droppedNode.y) {
					updateNodePosition(nodeId, resolved.x, resolved.y);
				}
			}
			activeDraggedNodeId = null;
			activeDragPointerOffsetX = 0;
			activeDragPointerOffsetY = 0;
			activeLinkedDrag = null;
			usedLinkedDragForCurrentPointerDrag = false;
			dragLockPointerX = null;
			dragLockPointerY = null;
			activeCtrlSnapAnchorNodeId = null;
		}
	}

	function nodeHasConfiguration(node: ChartNode): boolean {
		if (node.title.trim().length > 0) return true;
		if (node.userOids.length > 0) return true;
		if (node.childNodeIds.length > 0) return true;
		return connections.some(
			(connection) => connection.from.nodeId === node.id || connection.to.nodeId === node.id
		);
	}

	function deleteNode(nodeId: string) {
		if (nodeContextMenu?.nodeId === nodeId) {
			nodeContextMenu = null;
		}
		if (nodeEmployeePicker?.nodeId === nodeId) {
			nodeEmployeePicker = null;
			nodeEmployeePickerNodeId = null;
		}
		if (pinnedNodeIds.has(nodeId)) {
			setNodePinnedState(nodeId, false);
		}
		nodes = nodes
			.filter((node) => node.id !== nodeId)
			.map((node) =>
				node.childNodeIds.includes(nodeId)
					? { ...node, childNodeIds: node.childNodeIds.filter((childId) => childId !== nodeId) }
					: node
			);
		connections = connections.filter(
			(connection) => connection.from.nodeId !== nodeId && connection.to.nodeId !== nodeId
		);
		if (activeDraggedNodeId === nodeId) {
			activeDraggedNodeId = null;
			activeDragPointerOffsetX = 0;
			activeDragPointerOffsetY = 0;
			dragLockPointerX = null;
			dragLockPointerY = null;
		}
		if (activeCtrlSnapAnchorNodeId === nodeId) {
			activeCtrlSnapAnchorNodeId = null;
		}
		if (
			activeConnectorDrag &&
			(activeConnectorDrag.source.nodeId === nodeId ||
				activeConnectorDrag.hoveredTarget?.nodeId === nodeId)
		) {
			cancelConnectorDrag();
		}
		if (selectedConnectionId) {
			const stillExists = connections.some((connection) => connection.id === selectedConnectionId);
			if (!stillExists) {
				clearSelectedConnection();
			}
		}
	}

	function handleNodeDeleteRequest(nodeId: string) {
		nodeContextMenu = null;
		if (!isEditMode) return;
		const node = nodes.find((entry) => entry.id === nodeId);
		if (!node) return;
		if (!nodeHasConfiguration(node)) {
			deleteNode(nodeId);
			return;
		}
		const fallbackTitle = 'Untitled node';
		const nodeTitle = node.title.trim().length > 0 ? node.title.trim() : fallbackTitle;
		nodeDeleteConfirm = {
			nodeId,
			title: 'Confirm Node Deletion',
			message: `"${nodeTitle}" has configuration applied. Deleting it will remove its settings and any connections tied to it. Continue?`,
			options: [
				{ id: 'cancel', label: 'Cancel' },
				{ id: 'delete', label: 'Delete Node', tone: 'danger' }
			],
			cancelOptionId: 'cancel'
		};
	}

	function closeNodeDeleteConfirm(optionId: string) {
		const pending = nodeDeleteConfirm;
		nodeDeleteConfirm = null;
		if (!pending) return;
		if (optionId !== 'delete') return;
		deleteNode(pending.nodeId);
	}

	function openNodeContextMenu(nodeId: string, pointerX: number, pointerY: number) {
		if (!isEditMode || !nodeCanvasEl) return;
		nodeEmployeePicker = null;
		nodeEmployeePickerNodeId = null;
		bringNodeToFront(nodeId);
		const rect = nodeCanvasEl.getBoundingClientRect();
		const menuWidth = 180;
		const menuHeight = 132;
		const edgePadding = 10;
		const localX = pointerX - rect.left;
		const localY = pointerY - rect.top;
		nodeContextMenu = {
			nodeId,
			isPinned: pinnedNodeIds.has(nodeId),
			x: Math.min(
				Math.max(edgePadding, localX),
				Math.max(edgePadding, rect.width - menuWidth - edgePadding)
			),
			y: Math.min(
				Math.max(edgePadding, localY),
				Math.max(edgePadding, rect.height - menuHeight - edgePadding)
			)
		};
	}

	function openNodeEmployeePicker(nodeId: string, preferredX: number, preferredY: number) {
		if (!nodeCanvasEl) return;
		const rect = nodeCanvasEl.getBoundingClientRect();
		const popoverWidth = 380;
		const popoverHeight = 300;
		const edgePadding = 10;
		const localX = preferredX;
		const localY = preferredY;
		nodeEmployeePickerKey += 1;
		nodeEmployeePickerNodeId = nodeId;
		nodeEmployeePicker = {
			nodeId,
			key: nodeEmployeePickerKey,
			x: Math.min(
				Math.max(edgePadding, localX),
				Math.max(edgePadding, rect.width - popoverWidth - edgePadding)
			),
			y: Math.min(
				Math.max(edgePadding, localY),
				Math.max(edgePadding, rect.height - popoverHeight - edgePadding)
			)
		};
	}

	function handleNodeEmployeeSelection(nodeId: string, userOids: string[]) {
		if (!nodeId) return;
		const nextUserOids = [...userOids];
		updateNodeUsers(nodeId, nextUserOids);
	}

	function updateUserDisplayMap(users: SelectedEmployee[]) {
		if (users.length === 0) return;
		const nextMap = new Map(userDisplayByOid);
		for (const user of users) {
			const userOid = `${user.userOid ?? ''}`.trim();
			const displayName = `${user.displayName ?? ''}`.trim();
			if (!userOid || !displayName || displayName === userOid) continue;
			nextMap.set(userOid, displayName);
		}
		userDisplayByOid = nextMap;
	}

	function userDisplayLabel(userOid: string) {
		return userDisplayByOid.get(userOid) ?? userOid;
	}

	function handleNodeContextMenuAction(action: NodeContextMenuAction) {
		const pending = nodeContextMenu;
		nodeContextMenu = null;
		if (!pending) return;
		if (action === 'pin') {
			bringNodeToFront(pending.nodeId);
			setNodePinnedState(pending.nodeId, !pending.isPinned);
			return;
		}
		if (action === 'addEmployee') {
			bringNodeToFront(pending.nodeId);
			openNodeEmployeePicker(pending.nodeId, pending.x, pending.y);
			return;
		}
		handleNodeDeleteRequest(pending.nodeId);
	}

	function calculateEdgePanVelocity(negativeOverflow: number, positiveOverflow: number) {
		if (negativeOverflow > 0) {
			const strength = Math.min(1, negativeOverflow / edgePanThreshold);
			return strength * edgePanMaxSpeed;
		}
		if (positiveOverflow > 0) {
			const strength = Math.min(1, positiveOverflow / edgePanThreshold);
			return -strength * edgePanMaxSpeed;
		}
		return 0;
	}

	function easeOutCubic(value: number) {
		return 1 - Math.pow(1 - value, 3);
	}

	function stopCameraAnimation() {
		if (!cameraAnimationFrame) return;
		cancelAnimationFrame(cameraAnimationFrame);
		cameraAnimationFrame = 0;
	}

	function stepCameraAnimation(timestamp: number) {
		const elapsed = timestamp - cameraAnimationStartTime;
		const progress = Math.min(1, elapsed / cameraFocusDurationMs);
		const easedProgress = easeOutCubic(progress);
		zoom =
			cameraAnimationFromZoom +
			(cameraAnimationToZoom - cameraAnimationFromZoom) * easedProgress;
		panX = cameraAnimationFromX + (cameraAnimationToX - cameraAnimationFromX) * easedProgress;
		panY = cameraAnimationFromY + (cameraAnimationToY - cameraAnimationFromY) * easedProgress;
		if (progress >= 1) {
			zoom = cameraAnimationToZoom;
			panX = cameraAnimationToX;
			panY = cameraAnimationToY;
			cameraAnimationFrame = 0;
			return;
		}
		cameraAnimationFrame = requestAnimationFrame(stepCameraAnimation);
	}

	function animateCameraTo(targetPanX: number, targetPanY: number, targetZoom: number) {
		stopCameraAnimation();
		cameraAnimationFromZoom = zoom;
		cameraAnimationToZoom = targetZoom;
		cameraAnimationFromX = panX;
		cameraAnimationFromY = panY;
		cameraAnimationToX = targetPanX;
		cameraAnimationToY = targetPanY;
		cameraAnimationStartTime = performance.now();
		cameraAnimationFrame = requestAnimationFrame(stepCameraAnimation);
	}

	function stopPanAnimation() {
		if (panAnimationFrame) {
			cancelAnimationFrame(panAnimationFrame);
			panAnimationFrame = 0;
		}
	}

	function ensurePanAnimation() {
		if (panAnimationFrame) return;
		lastAnimationTimestamp = performance.now();
		panAnimationFrame = requestAnimationFrame(stepPanAnimation);
	}

	function startMomentum(vx: number, vy: number) {
		panVelocityX = vx;
		panVelocityY = vy;
		isPanningMomentum = true;
		ensurePanAnimation();
	}

	function stopMomentum() {
		isPanningMomentum = false;
		panVelocityX = 0;
		panVelocityY = 0;
		stopCameraAnimation();
	}

	function handleCanvasPointerDown(event: PointerEvent) {
		if (event.button !== 0 || !nodeCanvasEl) return;
		// Node drag handlers call preventDefault on the same pointerdown.
		// If that happened, do not also start a canvas pan for this pointer.
		if (
			event.defaultPrevented ||
			activeDraggedNodeId ||
			activeConnectorDrag ||
			isUserRowDragging ||
			isPanningDrag
		) {
			return;
		}
		const targetEl = event.target as Element | null;
		closeNodeTransientOverlaysForTarget(targetEl);
		clearSelectedConnection();
		if (targetEl?.closest('.node')) return;
		window.dispatchEvent(new CustomEvent('birch-canvas-background-pointerdown'));
		panPointerId = event.pointerId;
		isPanningDrag = true;
		stopMomentum();
		lastPanPointerX = event.clientX;
		lastPanPointerY = event.clientY;
		lastPanTimestamp = performance.now();
		(nodeCanvasEl as HTMLElement).setPointerCapture(event.pointerId);
		event.preventDefault();
	}

	function handleCanvasPointerMove(event: PointerEvent) {
		if (!isPanningDrag || panPointerId !== event.pointerId) return;
		const now = performance.now();
		const dt = Math.max(1, now - lastPanTimestamp);
		const dx = event.clientX - lastPanPointerX;
		const dy = event.clientY - lastPanPointerY;
		panX += dx;
		panY += dy;
		panVelocityX = dx / dt;
		panVelocityY = dy / dt;
		lastPanPointerX = event.clientX;
		lastPanPointerY = event.clientY;
		lastPanTimestamp = now;
	}

	function handleCanvasPointerUp(event: PointerEvent) {
		if (!isPanningDrag || panPointerId !== event.pointerId || !nodeCanvasEl) return;
		isPanningDrag = false;
		(nodeCanvasEl as HTMLElement).releasePointerCapture(event.pointerId);
		panPointerId = null;
		startMomentum(panVelocityX, panVelocityY);
	}

	function zoomAtPoint(targetZoom: number, screenX: number, screenY: number) {
		if (!nodeCanvasEl) return;
		stopCameraAnimation();
		const nextZoom = Math.min(maxZoom, Math.max(minZoom, targetZoom));
		if (Math.abs(nextZoom - zoom) < 0.0001) return;
		const rect = nodeCanvasEl.getBoundingClientRect();
		const localX = screenX - rect.left;
		const localY = screenY - rect.top;
		const worldX = (localX - panX) / zoom;
		const worldY = (localY - panY) / zoom;
		zoom = nextZoom;
		panX = localX - worldX * zoom;
		panY = localY - worldY * zoom;
		recalculateRenderedConnections();
		updateConnectorPreviewPath();
		keepDraggedNodePointerAnchored(panX, panY, zoom);
	}

	function zoomByStep(direction: 1 | -1) {
		if (!nodeCanvasEl) return;
		const rect = nodeCanvasEl.getBoundingClientRect();
		const factor = direction > 0 ? 1.12 : 1 / 1.12;
		zoomAtPoint(zoom * factor, rect.left + rect.width * 0.5, rect.top + rect.height * 0.5);
	}

	function handleCanvasWheel(event: WheelEvent) {
		nodeContextMenu = null;
		nodeEmployeePicker = null;
		nodeEmployeePickerNodeId = null;
		event.preventDefault();
		const factor = Math.exp(-event.deltaY * 0.0015);
		zoomAtPoint(zoom * factor, event.clientX, event.clientY);
	}

	function resetViewOrigin() {
		stopMomentum();
		animateCameraTo(homePanX, homePanY, homeZoom);
	}

	function startDpadPan(x: number, y: number) {
		dpadDirection = { x, y };
		stopMomentum();
		ensurePanAnimation();
	}

	function stopDpadPan() {
		dpadDirection = { x: 0, y: 0 };
	}

	function handleKeyDown(event: KeyboardEvent) {
		if (event.code === 'Space') {
			isSpaceKeyPressed = true;
		}
		if (event.key === 'Escape' && cancelActiveGesture()) {
			event.preventDefault();
			return;
		}
		if (nodeEmployeePicker && event.key === 'Escape') {
			nodeEmployeePicker = null;
			nodeEmployeePickerNodeId = null;
			event.preventDefault();
			return;
		}
		if (nodeContextMenu && event.key === 'Escape') {
			nodeContextMenu = null;
			event.preventDefault();
			return;
		}
		if (nodeDeleteConfirm && event.key === 'Escape') {
			nodeDeleteConfirm = null;
			event.preventDefault();
			return;
		}
		const target = event.target as HTMLElement | null;
		if (
			target &&
			(target.tagName === 'INPUT' ||
				target.tagName === 'TEXTAREA' ||
				target.tagName === 'SELECT' ||
				target.isContentEditable)
		) {
			return;
		}
		if (
			event.key === 'ArrowUp' ||
			event.key === 'ArrowDown' ||
			event.key === 'ArrowLeft' ||
			event.key === 'ArrowRight'
		) {
			activeKeys.add(event.key);
			stopMomentum();
			ensurePanAnimation();
			event.preventDefault();
			return;
		}
		if (activeDraggedNodeId && event.code === 'Space') {
			event.preventDefault();
		}
	}

	$: if (!isEditMode) {
		cancelConnectorDrag();
		clearSelectedConnection();
		cancelCanvasPanDrag();
		requestCancelNodeDrag();
		requestCancelUserRowDrag();
	}

	function handleKeyUp(event: KeyboardEvent) {
		if (event.code === 'Space') {
			isSpaceKeyPressed = false;
		}
		if (activeDraggedNodeId && event.code === 'Space') {
			event.preventDefault();
		}
		if (activeKeys.has(event.key)) {
			activeKeys.delete(event.key);
			event.preventDefault();
		}
	}

	function stepPanAnimation(timestamp: number) {
		const dtMs = Math.max(1, timestamp - lastAnimationTimestamp);
		const dtSec = dtMs / 1000;
		lastAnimationTimestamp = timestamp;

		let vx = 0;
		let vy = 0;
		if (activeKeys.has('ArrowRight')) vx -= keyboardPanSpeed;
		if (activeKeys.has('ArrowLeft')) vx += keyboardPanSpeed;
		if (activeKeys.has('ArrowDown')) vy -= keyboardPanSpeed;
		if (activeKeys.has('ArrowUp')) vy += keyboardPanSpeed;
		vx -= dpadDirection.x * dpadPanSpeed;
		vy -= dpadDirection.y * dpadPanSpeed;

		if (vx !== 0 || vy !== 0) {
			panX += vx * dtSec;
			panY += vy * dtSec;
		}

		if (isPanningMomentum) {
			panX += panVelocityX * dtMs;
			panY += panVelocityY * dtMs;
			const decay = Math.exp(-momentumFriction * dtMs);
			panVelocityX *= decay;
			panVelocityY *= decay;
			if (Math.hypot(panVelocityX, panVelocityY) < momentumStopSpeed) {
				stopMomentum();
			}
		}

		if (activeDraggedNodeId && nodeCanvasEl) {
			const rect = nodeCanvasEl.getBoundingClientRect();
			const pointerLocalX = activeDraggedPointerX - rect.left;
			const pointerLocalY = activeDraggedPointerY - rect.top;
			const draggedNode = nodes.find((node) => node.id === activeDraggedNodeId);
			const nodeScreenWidth = (draggedNode?.width ?? 0) * zoom;
			const nodeScreenHeight = (draggedNode?.height ?? 0) * zoom;
			const maxNodeLocalX = Math.max(0, rect.width - nodeScreenWidth);
			const maxNodeLocalY = Math.max(0, rect.height - nodeScreenHeight);
			const pointerOffsetScreenX = activeDragPointerOffsetX * zoom;
			const pointerOffsetScreenY = activeDragPointerOffsetY * zoom;
			const targetNodeLocalX = pointerLocalX - pointerOffsetScreenX;
			const targetNodeLocalY = pointerLocalY - pointerOffsetScreenY;
			const leftOverflow = Math.max(0, -targetNodeLocalX);
			const rightOverflow = Math.max(0, targetNodeLocalX - maxNodeLocalX);
			const topOverflow = Math.max(0, -targetNodeLocalY);
			const bottomOverflow = Math.max(0, targetNodeLocalY - maxNodeLocalY);
			const edgeVx = calculateEdgePanVelocity(leftOverflow, rightOverflow);
			const edgeVy = calculateEdgePanVelocity(topOverflow, bottomOverflow);
			const lockLocalX =
				edgeVx > 0
					? pointerOffsetScreenX
					: edgeVx < 0
						? pointerOffsetScreenX + maxNodeLocalX
						: null;
			const lockLocalY =
				edgeVy > 0
					? pointerOffsetScreenY
					: edgeVy < 0
						? pointerOffsetScreenY + maxNodeLocalY
						: null;
			const prevLockPointerX = dragLockPointerX;
			const prevLockPointerY = dragLockPointerY;
			dragLockPointerX = lockLocalX === null ? null : rect.left + lockLocalX;
			dragLockPointerY = lockLocalY === null ? null : rect.top + lockLocalY;
			const lockChanged =
				prevLockPointerX !== dragLockPointerX || prevLockPointerY !== dragLockPointerY;
			if (lockChanged) {
				keepDraggedNodePointerAnchored(panX, panY, zoom);
			}
			if (edgeVx !== 0 || edgeVy !== 0) {
				const deltaPanX = edgeVx * dtSec;
				const deltaPanY = edgeVy * dtSec;
				panX += deltaPanX;
				panY += deltaPanY;
				keepDraggedNodePointerAnchored(panX, panY, zoom);
			}
		} else {
			dragLockPointerX = null;
			dragLockPointerY = null;
		}

		const shouldContinue =
			vx !== 0 || vy !== 0 || isPanningMomentum || activeDraggedNodeId !== null;
		if (shouldContinue) {
			panAnimationFrame = requestAnimationFrame(stepPanAnimation);
		} else {
			stopPanAnimation();
		}
	}

	function resolveTheme(preference: ThemePreference): Theme {
		if (preference === 'light' || preference === 'dark') return preference;
		return systemTheme;
	}

	function applyTheme(nextTheme: Theme) {
		if (typeof document === 'undefined') return;
		document.documentElement.setAttribute('data-theme', nextTheme);
	}

	function loadThemePreference(): ThemePreference {
		if (typeof localStorage === 'undefined') return 'system';
		const saved = localStorage.getItem('birch.themePreference');
		return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system';
	}

	function persistThemePreference(preference: ThemePreference) {
		if (typeof localStorage === 'undefined') return;
		localStorage.setItem('birch.themePreference', preference);
	}

	function toggleTheme() {
		themePreferenceState =
			themePreferenceState === 'system'
				? 'dark'
				: themePreferenceState === 'dark'
					? 'light'
					: 'system';
		persistThemePreference(themePreferenceState);
		theme = resolveTheme(themePreferenceState);
		applyTheme(theme);
	}

	function blurElementAfterHandler(target: EventTarget | null) {
		queueMicrotask(() => {
			if (target instanceof HTMLElement) {
				target.blur();
			}
		});
	}

	function runThenBlur(event: Event, action: () => void) {
		action();
		blurElementAfterHandler(event.currentTarget);
	}

	function stopDpadPanAndBlur(event: PointerEvent) {
		stopDpadPan();
		blurElementAfterHandler(event.currentTarget);
	}

	function getOrderedPinnedNodeIds() {
		return Array.from(pinnedNodeIds);
	}

	function buildGraphPayload(): ChartGraphPayload {
		return {
			nodes: nodes.map((node) => ({
				id: node.id,
				title: node.title,
				x: node.x,
				y: node.y,
				width: node.width,
				height: node.height,
				userOids: [...node.userOids],
				users: node.userOids.map((userOid) => ({
					userOid,
					displayName: userDisplayLabel(userOid),
					email: null
				}))
			})),
			connections: connections.map((connection) => ({
				id: connection.id,
				from: { ...connection.from },
				to: { ...connection.to }
			})),
			pinnedNodeIds: getOrderedPinnedNodeIds()
		};
	}

	function serializeGraphPayload(payload: ChartGraphPayload) {
		return JSON.stringify(payload);
	}

	function clearQueuedGraphSave() {
		if (!graphSaveTimeout) return;
		clearTimeout(graphSaveTimeout);
		graphSaveTimeout = null;
	}

	async function persistChartGraph(signature = serializeGraphPayload(buildGraphPayload())) {
		if (!chart?.ChartId) return;
		if (graphSaving) {
			queuedGraphSaveSignature = signature;
			return;
		}

		graphSaving = true;
		graphSaveError = '';
		try {
			const payload = buildGraphPayload();
			const response = await fetchWithAuthRedirect(
				`${base}/api/chart/graph`,
				{
					method: 'PUT',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(payload)
				},
				base
			);
			if (!response || !response.ok) {
				graphSaveError = 'Unable to save chart changes.';
				return;
			}
			lastPersistedGraphSignature = serializeGraphPayload(payload);
		} catch {
			graphSaveError = 'Unable to save chart changes.';
		} finally {
			graphSaving = false;
			if (queuedGraphSaveSignature && queuedGraphSaveSignature !== lastPersistedGraphSignature) {
				const nextSignature = queuedGraphSaveSignature;
				queuedGraphSaveSignature = null;
				void persistChartGraph(nextSignature);
			} else {
				queuedGraphSaveSignature = null;
			}
		}
	}

	function chartGraphSave(signature: string) {
		if (!chart?.ChartId) return;
		clearQueuedGraphSave();
		graphSaveTimeout = setTimeout(() => {
			graphSaveTimeout = null;
			void persistChartGraph(signature);
		}, 350);
	}

	async function loadChartGraph() {
		clearQueuedGraphSave();
		queuedGraphSaveSignature = null;
		graphHydrated = false;
		graphLoadError = '';

		if (!chart?.ChartId) {
			nodes = [];
			connections = [];
			pinnedNodeIds = new Set<string>();
			lastPersistedGraphSignature = serializeGraphPayload(buildGraphPayload());
			graphHydrated = true;
			return;
		}

		graphLoading = true;
		try {
			const response = await fetchWithAuthRedirect(`${base}/api/chart/graph`, {}, base);
			if (!response || !response.ok) {
				graphLoadError = 'Unable to load chart layout.';
				nodes = [];
				connections = [];
				pinnedNodeIds = new Set<string>();
				lastPersistedGraphSignature = serializeGraphPayload(buildGraphPayload());
				graphHydrated = true;
				return;
			}

			const payload = (await response.json()) as Partial<ChartGraphPayload>;
			const nextNodes = Array.isArray(payload.nodes)
				? payload.nodes.map((node) => ({
						id: String(node.id ?? ''),
						title: String(node.title ?? ''),
						x: Number(node.x ?? 0),
						y: Number(node.y ?? 0),
						width: Number(node.width ?? 290),
						height: Number(node.height ?? 160),
						userOids: Array.isArray(node.userOids)
							? node.userOids.map((userOid) => String(userOid))
							: [],
						childNodeIds: []
					}))
				: [];
			const nextConnections = Array.isArray(payload.connections)
				? payload.connections.map((connection) => ({
						id: String(connection.id ?? ''),
						from: {
							nodeId: String(connection.from?.nodeId ?? ''),
							side: connection.from?.side ?? 'right'
						},
						to: {
							nodeId: String(connection.to?.nodeId ?? ''),
							side: connection.to?.side ?? 'left'
						}
					}))
				: [];
			const nextPinnedNodeIds = Array.isArray(payload.pinnedNodeIds)
				? payload.pinnedNodeIds.map((nodeId) => String(nodeId))
				: [];

			isApplyingGraphSnapshot = true;
			nodes = nextNodes;
			connections = nextConnections;
			pinnedNodeIds = new Set(nextPinnedNodeIds);
			updateUserDisplayMap(
				nextNodes.flatMap((node, nodeIndex) => {
					const users = Array.isArray(payload.nodes?.[nodeIndex]?.users)
						? payload.nodes?.[nodeIndex]?.users ?? []
						: [];
					return users.map((user) => ({
						userOid: String(user.userOid ?? ''),
						displayName: String(user.displayName ?? user.userOid ?? ''),
						email: user.email ? String(user.email) : null
					}));
				})
			);
			isApplyingGraphSnapshot = false;
			lastPersistedGraphSignature = serializeGraphPayload(buildGraphPayload());
			graphHydrated = true;
		} catch {
			graphLoadError = 'Unable to load chart layout.';
			nodes = [];
			connections = [];
			pinnedNodeIds = new Set<string>();
			lastPersistedGraphSignature = serializeGraphPayload(buildGraphPayload());
			graphHydrated = true;
		} finally {
			isApplyingGraphSnapshot = false;
			graphLoading = false;
		}
	}

	$: chartMemberships = rawChartMemberships.map((membership) => ({
		ChartId: membership.ChartId,
		Name: membership.Name,
		RoleName: membership.RoleName,
		AccessRoleLabel: membership.AccessRoleLabel ?? membership.RoleName,
		IsDefault: membership.IsDefault,
		IsActive: membership.IsActive,
		ThemeJson: membership.PlaceholderThemeJson ?? null,
		VersionAt: membership.VersionAt ?? null
	}));

	async function refreshMemberships() {
		const res = await fetchWithAuthRedirect(`${base}/api/charts/memberships`, {}, base);
		if (!res || !res.ok) return;
		const payload = await res.json();
		rawChartMemberships = payload.memberships ?? [];
		const resolvedActiveId = payload.activeChartId as number | null;
		const activeMembership =
			rawChartMemberships.find((membership) => membership.ChartId === resolvedActiveId) ??
			rawChartMemberships[0] ??
			null;
		chart = activeMembership
			? { ChartId: activeMembership.ChartId, Name: activeMembership.Name }
			: null;
		userRole = activeMembership?.RoleName ?? null;
		await loadChartGraph();
	}

	$: {
		nodes;
		connections;
		pinnedNodeIds;
		chart?.ChartId;
		isUserRowDragging;
		activeUserRowDrag;
		activeUserRowDragHover;
		nodeUserDragPreviewByNodeId;
		const signature = serializeGraphPayload(buildGraphPayload());
		if (shouldDeferGraphSave()) {
			clearQueuedGraphSave();
		} else if (
			graphHydrated &&
			!graphLoading &&
			!isApplyingGraphSnapshot &&
			chart?.ChartId &&
			signature !== lastPersistedGraphSignature
		) {
			chartGraphSave(signature);
		}
	}

	async function saveOnboardingProgress() {
		if (onboardingSaving || onboardingTargetTierForModal <= onboardingCurrentTierState) {
			return true;
		}
		onboardingSaving = true;
		onboardingSaveError = '';
		try {
			const response = await fetchWithAuthRedirect(
				`${base}/api/onboarding/role`,
				{
					method: 'PATCH',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ onboardingRole: onboardingTargetTierForModal })
				},
				base
			);
			if (!response || !response.ok) {
				onboardingSaveError = 'Unable to save onboarding progress. Please try again.';
				return false;
			}
			onboardingCurrentTierState = Math.max(
				onboardingCurrentTierState,
				onboardingTargetTierForModal
			);
			return true;
		} catch {
			onboardingSaveError = 'Unable to save onboarding progress. Please try again.';
			return false;
		} finally {
			onboardingSaving = false;
		}
	}

	async function openOnboardingFromHelp() {
		if (onboardingSaving) return;
		onboardingSaveError = '';
		try {
			const response = await fetchWithAuthRedirect(`${base}/api/onboarding/slides`, {}, base);
			if (!response || !response.ok) {
				onboardingSaveError = 'Unable to load onboarding steps. Please try again.';
				return;
			}
			const payload = await response.json();
			const fetchedSlides = Array.isArray(payload?.slides)
				? (payload.slides as OnboardingSlide[])
				: [];
			onboardingSlidesForModal = fetchedSlides;
			onboardingTargetTierForModal =
				typeof payload?.targetTier === 'number' ? payload.targetTier : data.onboarding.targetTier;
			onboardingSlideIndex = 0;
			onboardingDontShowAgain = false;
			onboardingDismissedForSession = false;
			onboardingOpen = onboardingSlidesForModal.length > 0;
		} catch {
			onboardingSaveError = 'Unable to load onboarding steps. Please try again.';
		}
	}

	async function handleOnboardingClose(markComplete: boolean) {
		if (markComplete) {
			const saved = await saveOnboardingProgress();
			if (!saved) return;
		}
		onboardingOpen = false;
		onboardingDismissedForSession = true;
		onboardingDontShowAgain = false;
	}

	async function handleOnboardingComplete() {
		const saved = await saveOnboardingProgress();
		if (!saved) return;
		onboardingOpen = false;
		onboardingDismissedForSession = true;
		onboardingDontShowAgain = false;
	}

	onMount(() => {
		stopCameraAnimation();
		stopMomentum();
		panX = homePanX;
		panY = homePanY;
		zoom = homeZoom;
		void loadChartGraph();
		void refreshMemberships();
		document.body.classList.add('app-shell-route');
		window.addEventListener('keydown', handleKeyDown);
		window.addEventListener('keyup', handleKeyUp);
		onWindowBlur = () => {
			activeKeys.clear();
			isSpaceKeyPressed = false;
			stopDpadPan();
			activeDraggedNodeId = null;
			activeDragPointerOffsetX = 0;
			activeDragPointerOffsetY = 0;
			activeLinkedDrag = null;
			usedLinkedDragForCurrentPointerDrag = false;
			dragLockPointerX = null;
			dragLockPointerY = null;
			cancelConnectorDrag();
		};
		window.addEventListener('blur', onWindowBlur);
		onWindowPointerDownBlurHeaderInput = (event: PointerEvent) => {
			// Defensive stale-lock recovery: if a previous drag end was missed, clear before new interaction.
			if (activeDraggedNodeId && !activeConnectorDrag && !isPanningDrag) {
				requestCancelNodeDrag();
			}
			if (isUserRowDragging && !hasGlobalActiveUserDrag()) {
				clearUserRowDragState();
			}
			const targetEl = event.target as HTMLElement | null;
			closeNodeTransientOverlaysForTarget(targetEl);
			const activeEl = document.activeElement;
			if (
				activeEl instanceof HTMLElement &&
				activeEl.classList.contains('nodeTitleOverlayEditor') &&
				!targetEl?.closest('.nodeTitleOverlayEditor')
			) {
				activeEl.blur();
			}
		};
		window.addEventListener('pointerdown', onWindowPointerDownBlurHeaderInput, true);
		onWindowPointerUpResetInteractions = (event: PointerEvent) => {
			// Defensive unlock: avoid stale drag/pan lock states when component-level pointerup is missed.
			if (activeDraggedNodeId) {
				requestCancelNodeDrag();
			}
			if (isUserRowDragging && !hasGlobalActiveUserDrag()) {
				clearUserRowDragState();
			}
			if (isPanningDrag) {
				cancelCanvasPanDrag();
				stopMomentum();
			}
		};
		window.addEventListener('pointerup', onWindowPointerUpResetInteractions, true);
		window.addEventListener('pointercancel', onWindowPointerUpResetInteractions, true);
		onGlobalUserDragState = (event: Event) => {
			const detail = (event as CustomEvent<unknown>).detail;
			const validActiveDrag =
				detail &&
				typeof detail === 'object' &&
				'sourceComboId' in detail &&
				'user' in detail
					? (detail as {
							sourceComboId: string;
							sourceIndex: number;
							user: { userOid: string };
					  })
					: null;
			isUserRowDragging = validActiveDrag !== null;
			activeUserRowDrag = validActiveDrag;
			if (!validActiveDrag) {
				activeUserRowDragHover = null;
				nodeUserDragPreviewByNodeId = new Map();
			}
			debugUserDrag('drag-state', {
				isUserRowDragging,
				activeUserRowDrag:
					activeUserRowDrag === null
						? null
						: {
								sourceComboId: activeUserRowDrag.sourceComboId,
								sourceIndex: activeUserRowDrag.sourceIndex,
								userOid: activeUserRowDrag.user.userOid
						  }
			});
		};
		onGlobalUserDragHover = (event: Event) => {
			const detail = (event as CustomEvent<unknown>).detail;
			activeUserRowDragHover =
				detail &&
				typeof detail === 'object' &&
				'targetComboId' in detail &&
				'targetIndex' in detail
					? (detail as { targetComboId: string | null; targetIndex: number | null })
					: null;
			const signature = JSON.stringify({
				targetComboId: activeUserRowDragHover?.targetComboId ?? null,
				targetIndex: activeUserRowDragHover?.targetIndex ?? null
			});
			if (signature !== lastLoggedPageHoverSignature) {
				lastLoggedPageHoverSignature = signature;
				debugUserDrag('hover-state', JSON.parse(signature));
			}
		};
		window.addEventListener('node-user-drag-state', onGlobalUserDragState as EventListener);
		window.addEventListener('node-user-drag-hover', onGlobalUserDragHover as EventListener);
		systemTheme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
		themePreferenceState = loadThemePreference();
		theme = resolveTheme(themePreferenceState);
		applyTheme(theme);
		mediaQuery = window.matchMedia('(prefers-color-scheme: light)');
		const onMediaThemeChange = (event: MediaQueryListEvent) => {
			systemTheme = event.matches ? 'light' : 'dark';
			if (themePreferenceState === 'system') {
				theme = systemTheme;
				applyTheme(theme);
			}
		};
		mediaQuery.addEventListener('change', onMediaThemeChange);

		if (data.onboarding.slides.length > 0 && !onboardingDismissedForSession) {
			onboardingSlidesForModal = data.onboarding.slides;
			onboardingTargetTierForModal = data.onboarding.targetTier;
			onboardingOpen = true;
		}

		return () => {
			window.removeEventListener('keydown', handleKeyDown);
			window.removeEventListener('keyup', handleKeyUp);
			if (onWindowBlur) {
				window.removeEventListener('blur', onWindowBlur);
				onWindowBlur = null;
			}
			if (onWindowPointerDownBlurHeaderInput) {
				window.removeEventListener('pointerdown', onWindowPointerDownBlurHeaderInput, true);
				onWindowPointerDownBlurHeaderInput = null;
			}
			if (onWindowPointerUpResetInteractions) {
				window.removeEventListener('pointerup', onWindowPointerUpResetInteractions, true);
				window.removeEventListener('pointercancel', onWindowPointerUpResetInteractions, true);
				onWindowPointerUpResetInteractions = null;
			}
				if (onGlobalUserDragState) {
					window.removeEventListener('node-user-drag-state', onGlobalUserDragState as EventListener);
					onGlobalUserDragState = null;
				}
				if (onGlobalUserDragHover) {
					window.removeEventListener('node-user-drag-hover', onGlobalUserDragHover as EventListener);
					onGlobalUserDragHover = null;
				}
				activeKeys.clear();
			stopDpadPan();
			stopMomentum();
			stopPanAnimation();
			stopCameraAnimation();
			clearQueuedGraphSave();
			activeDraggedNodeId = null;
			isSpaceKeyPressed = false;
			activeLinkedDrag = null;
			usedLinkedDragForCurrentPointerDrag = false;
				nodeContextMenu = null;
				nodeEmployeePicker = null;
				nodeEmployeePickerNodeId = null;
				isUserRowDragging = false;
				activeUserRowDrag = null;
				activeUserRowDragHover = null;
				nodeUserDragPreviewByNodeId = new Map();
				activeDragPointerOffsetX = 0;
			activeDragPointerOffsetY = 0;
			dragLockPointerX = null;
			dragLockPointerY = null;
			cancelConnectorDrag();
			mediaQuery?.removeEventListener('change', onMediaThemeChange);
		};
	});

	onDestroy(() => {
		if (typeof document !== 'undefined') {
			document.body.classList.remove('app-shell-route');
		}
		activeDraggedNodeId = null;
			nodeContextMenu = null;
			nodeEmployeePicker = null;
			nodeEmployeePickerNodeId = null;
			isUserRowDragging = false;
			activeUserRowDrag = null;
			activeUserRowDragHover = null;
			nodeUserDragPreviewByNodeId = new Map();
			activeDragPointerOffsetX = 0;
		activeDragPointerOffsetY = 0;
		dragLockPointerX = null;
		dragLockPointerY = null;
		stopCameraAnimation();
		clearQueuedGraphSave();
		cancelConnectorDrag();
	});
</script>

<div class="app">
	<div class="card">
		<div class="cardScroll">
			<div class="topbar">
				<div class="topbarTitleSlot">
					{#if canOpenChartSetup()}
						<button
							type="button"
							class="title titleButton"
							on:click={() => (showChartsModal = true)}
							aria-label="Open chart setup"
						>
							{chart?.Name ?? 'No Chart Selected'}
						</button>
					{:else}
						<div class="title">{chart?.Name ?? 'No Chart Selected'}</div>
					{/if}
				</div>
				<div class="topbarCenter"></div>
				<div class="topbarActions">
					{#if canOpenTools()}
						<button
							type="button"
							class="actionBtn chartToolsBtn"
							aria-label="Open users"
							title="Open users"
							on:click={() => (showToolsModal = true)}
						>
							<svg
								class="chartToolsIcon"
								viewBox="0 0 24 24"
								aria-hidden="true"
								focusable="false"
							>
								<circle cx="9" cy="8" r="2.6"></circle>
								<circle cx="15.6" cy="9.1" r="2.2"></circle>
								<path d="M4.8 16.8c0-2.6 2.2-4.3 4.8-4.3s4.8 1.7 4.8 4.3" />
								<path d="M12.8 16.6c0-1.9 1.5-3.2 3.5-3.2s3.3 1.2 3.3 3.2" />
							</svg>
						</button>
					{/if}
					<ThemeToggle
						mode="cycle"
						themePreference={themePreferenceState}
						effectiveTheme={theme}
						onToggle={toggleTheme}
					/>
					<button
						type="button"
						class="onboardingHelpBtn"
						aria-label="Open onboarding guide"
						title="Open onboarding guide"
						on:click={openOnboardingFromHelp}
					>
						?
					</button>
				</div>
			</div>
			<div class="chartViewport">
				<div class="rightRail" bind:this={rightRailEl}>
					<div class="controlsCard controlsCardTopRight" aria-label="Controls">
						<div class="controlsCardTop">
							<div class="controlsBarGroup zoomControl" aria-label="Zoom controls">
								<button
									type="button"
									class="controlsBtn zoomBtn"
									aria-label="Zoom in"
									on:click={(event) => runThenBlur(event, () => zoomByStep(1))}
								>
									<svg class="zoomBtnSvg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
										<circle cx="10.5" cy="10.5" r="6.5"></circle>
										<line x1="15.6" y1="15.6" x2="20.2" y2="20.2"></line>
										<line x1="10.5" y1="7.9" x2="10.5" y2="13.1"></line>
										<line x1="7.9" y1="10.5" x2="13.1" y2="10.5"></line>
									</svg>
								</button>
								<button
									type="button"
									class="controlsBtn zoomBtn"
									aria-label="Zoom out"
									on:click={(event) => runThenBlur(event, () => zoomByStep(-1))}
								>
									<svg class="zoomBtnSvg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
										<circle cx="10.5" cy="10.5" r="6.5"></circle>
										<line x1="15.6" y1="15.6" x2="20.2" y2="20.2"></line>
										<line x1="7.9" y1="10.5" x2="13.1" y2="10.5"></line>
									</svg>
								</button>
							</div>
							<div class="controlsBarGroup dpadControl" aria-label="Pan controls">
								<button
									type="button"
									class="controlsBtn dpadBtn dpadUp"
									aria-label="Pan up"
									on:pointerdown={() => startDpadPan(0, -1)}
									on:pointerup={stopDpadPanAndBlur}
									on:pointerleave={stopDpadPanAndBlur}
									on:pointercancel={stopDpadPanAndBlur}
								>
									▲
								</button>
								<button
									type="button"
									class="controlsBtn dpadBtn dpadLeft"
									aria-label="Pan left"
									on:pointerdown={() => startDpadPan(-1, 0)}
									on:pointerup={stopDpadPanAndBlur}
									on:pointerleave={stopDpadPanAndBlur}
									on:pointercancel={stopDpadPanAndBlur}
								>
									◀
								</button>
								<button
									type="button"
									class="controlsBtn dpadBtn dpadCenter"
									aria-label="Return to origin"
									on:click={(event) => runThenBlur(event, resetViewOrigin)}
								>
									<svg class="dpadHomeSvg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
										<path d="M4.5 10.8L12 4.8l7.5 6" />
										<path d="M6.5 10.3V19h11V10.3" />
										<path d="M10 19v-4.6h4V19" />
									</svg>
								</button>
								<button
									type="button"
									class="controlsBtn dpadBtn dpadRight"
									aria-label="Pan right"
									on:pointerdown={() => startDpadPan(1, 0)}
									on:pointerup={stopDpadPanAndBlur}
									on:pointerleave={stopDpadPanAndBlur}
									on:pointercancel={stopDpadPanAndBlur}
								>
									▶
								</button>
								<button
									type="button"
									class="controlsBtn dpadBtn dpadDown"
									aria-label="Pan down"
									on:pointerdown={() => startDpadPan(0, 1)}
									on:pointerup={stopDpadPanAndBlur}
									on:pointerleave={stopDpadPanAndBlur}
									on:pointercancel={stopDpadPanAndBlur}
								>
									▼
								</button>
							</div>
						</div>
					</div>
					{#if pinnedNodeEntries.length > 0}
						<div class="pinnedPanel" aria-label="Pinned nodes">
							<div class="pinnedPanelHeader">Pinned Nodes</div>
							<div class="pinnedPanelList">
								{#each pinnedNodeEntries as pinnedNode (pinnedNode.id)}
									<button
										type="button"
										class="pinnedPanelItem"
										on:click={(event) => runThenBlur(event, () => focusNode(pinnedNode.id))}
										title={pinnedNode.title}
									>
										{pinnedNode.title}
									</button>
								{/each}
							</div>
						</div>
					{/if}
				</div>
				{#if canToggleEditMode()}
					<div
						class="modeCard"
						aria-label="Mode"
						bind:this={modeCardEl}
					>
						<div class="modeGroup">
							<label class="modeSwitch">
								<span class:isModeActive={!isEditMode}>View</span>
								<input
									class="modeSwitchInput"
									type="checkbox"
									bind:checked={isEditMode}
									aria-label="Toggle edit mode"
									on:change={(event) => blurElementAfterHandler(event.currentTarget)}
								/>
								<span class="modeSwitchSlider" aria-hidden="true"></span>
								<span class:isModeActive={isEditMode}>Edit</span>
							</label>
						</div>
					</div>
				{/if}
				{#if isEditMode}
					<button
						type="button"
						class="actionBtn newNodeBtn newNodeFloating"
						bind:this={newNodeButtonEl}
						on:click={(event) => runThenBlur(event, addNewNode)}
					>
						+ New Node
					</button>
				{/if}
				<div
					class="nodeCanvas"
					class:isPanningDrag
					class:nodeCanvasEditMode={isEditMode}
					bind:this={nodeCanvasEl}
					style={`--grid-offset-x:${panX}px;--grid-offset-y:${panY}px;--grid-size:${nodeGridSizePx * zoom}px;`}
					on:pointerdown={handleCanvasPointerDown}
					on:pointermove={handleCanvasPointerMove}
					on:pointerup={handleCanvasPointerUp}
					on:pointercancel={handleCanvasPointerUp}
					on:wheel={handleCanvasWheel}
				>
					<svg class="connectionsLayer" aria-hidden="true">
						{#each renderedConnections as connection (connection.id)}
							<path
								class="connectionHitPath"
								class:connectionHitPathInteractive={isEditMode}
								d={connection.path}
								on:pointerdown={handleConnectionPointerDown}
								on:click={(event) => handleConnectionClick(connection.id, event)}
							></path>
							<path
								class="connectionPath"
								class:connectionPathSelected={selectedConnectionId === connection.id}
								d={connection.path}
							></path>
						{/each}
						{#if connectorPreviewPath}
							<path
								class="connectionPath connectionPathPreview"
								class:connectionPathPreviewInvalid={Boolean(
									activeConnectorDrag?.hoveredTarget && !activeConnectorDrag?.canDrop
								)}
								d={connectorPreviewPath}
							></path>
						{/if}
					</svg>
					{#if selectedConnectionId && selectedConnectionDeleteButtonPos}
						<button
							type="button"
							class="connectionDeleteBtn"
							aria-label="Delete selected connection"
							style={`left:${selectedConnectionDeleteButtonPos.x}px;top:${selectedConnectionDeleteButtonPos.y}px;`}
							on:pointerdown|stopPropagation
							on:click={(event) => runThenBlur(event, deleteSelectedConnection)}
						>
							×
						</button>
					{/if}
					<div
						class="nodePlane"
						style={`transform: translate(${panX}px, ${panY}px) scale(${zoom});`}
					>
						{#each nodes as node (node.id)}
							<Node
									id={node.id}
								title={node.title}
								x={node.x}
								y={node.y}
								width={node.width}
								height={node.height}
								draggable={isEditMode}
								editable={isEditMode}
								pinned={pinnedNodeIds.has(node.id)}
								hasBodyContent={node.userOids.length > 0 || isUserRowDragging}
									showConnectors={isEditMode}
									dragScale={zoom}
									renderScale={getPinnedNodeRenderScale(node.id)}
									renderTitleInline={false}
									lockedPointerX={activeDraggedNodeId === node.id ? dragLockPointerX : null}
									lockedPointerY={activeDraggedNodeId === node.id ? dragLockPointerY : null}
								spacePressed={isSpaceKeyPressed}
								interactionLocked={isNodeInteractionLocked()}
								cancelDragToken={nodeDragCancelToken}
								on:move={(event) =>
									updateNodePositionWithPointer(
										event.detail.id,
										event.detail.x,
										event.detail.y,
										event.detail.pointerX,
										event.detail.pointerY,
										event.detail.ctrlKey,
										event.detail.shiftKey,
										event.detail.spaceKey
									)}
								on:titlechange={(event) => updateNodeTitle(event.detail.id, event.detail.title)}
								on:activate={(event) => bringNodeToFront(event.detail.id)}
								on:dragstart={(event) =>
									handleNodeDragStart(
										event.detail.id,
										event.detail.pointerX,
										event.detail.pointerY
									)}
								on:dragend={(event) => handleNodeDragEnd(event.detail.id)}
								on:contextrequest={(event) =>
									openNodeContextMenu(
										event.detail.id,
										event.detail.pointerX,
										event.detail.pointerY
									)}
								on:connectordragstart={(event) =>
									beginConnectorDrag(
										event.detail.id,
										event.detail.side,
										event.detail.pointerX,
										event.detail.pointerY,
										event.detail.pointerId
									)}
								on:widthchange={(event) => updateNodeWidth(event.detail.id, event.detail.width)}
								on:heightchange={(event) => updateNodeHeight(event.detail.id, event.detail.height)}
							>
								<UserSearchCombobox
									ariaLabel="Node employees"
									comboId={node.id}
									viewOnly={!isEditMode}
									hideSearchInput={isEditMode}
									renderLabelsInline={shouldRenderInlineUserLabels(node.id)}
									interactionLocked={isUserPickerInteractionLocked()}
									on:interact={() => bringNodeToFront(node.id)}
									selectedUserOids={node.userOids}
									knownUsers={node.userOids.map((userOid) => ({
										userOid,
										displayName: userDisplayLabel(userOid),
										email: null
									}))}
									on:selectionchange={(event) => {
										updateUserDisplayMap(event.detail.users);
										handleNodeEmployeeSelection(node.id, event.detail.userOids);
									}}
									on:dragpreviewchange={(event) => {
										updateNodeUserDragPreview(
											event.detail.comboId,
											event.detail.visibleUserOids,
											event.detail.placeholderIndex
										);
									}}
								/>
								<svelte:fragment slot="overlay">
									{@const renderScale = getPinnedNodeRenderScale(node.id)}
									{@const nodeCanvasScale = Math.max(zoom * renderScale, 0.0001)}
									{@const overlayCounterScale = 1 / nodeCanvasScale}
									{@const titleLocal = getNodeTitleLocalPoint(node)}
									{@const titleWidth = getNodeTitleHitWidth(node, zoom, zoom)}
									{@const titleFontSize = getNodeTitleFontSize(node.id, zoom)}
									{@const userLabelWidth = getNodeOverlayWidth(
										node,
										nodeBodyPaddingPx + nodeUserLabelHorizontalPaddingPx,
										zoom
									)}
									{#if isEditMode && focusedTitleNodeId === node.id}
										<div
											class="nodeTitleOverlayEditor"
											contenteditable="true"
											role="textbox"
											aria-label="Node title"
											data-node-title-editor-id={node.id}
											style={`--node-overlay-counter-scale:${overlayCounterScale};left:${titleLocal.x}px;top:${titleLocal.y}px;width:${titleWidth}px;font-size:${titleFontSize}px;`}
											on:pointerdown|stopPropagation
											on:contextmenu={(event) => {
												event.preventDefault();
												event.stopPropagation();
												bringNodeToFront(node.id);
												openNodeContextMenu(node.id, event.clientX, event.clientY);
											}}
											on:keydown={(event) => {
												if (event.key === 'Enter') {
													event.preventDefault();
													(event.currentTarget as HTMLDivElement).blur();
												}
											}}
											on:blur={() => {
												if (focusedTitleNodeId === node.id) {
													focusedTitleNodeId = null;
												}
											}}
											on:input={(event) => {
												const nextTitle = ((event.currentTarget as HTMLDivElement).textContent ?? '').replace(
													/[\r\n]+/g,
													''
												);
												updateNodeTitle(node.id, nextTitle);
											}}
										></div>
									{:else}
										<div
											class="nodeTitleOverlayLabel"
											class:nodeTitleOverlayLabelEditable={isEditMode}
											style={`--node-overlay-counter-scale:${overlayCounterScale};left:${titleLocal.x}px;top:${titleLocal.y}px;width:${titleWidth}px;font-size:${titleFontSize}px;`}
											on:pointerdown={(event) => {
												if (!isEditMode || event.button !== 0) return;
												event.stopPropagation();
											}}
											on:click|stopPropagation={(event) => {
												if (!isEditMode) return;
												event.preventDefault();
												void beginNodeTitleEdit(node.id);
											}}
											on:contextmenu={(event) => {
												event.preventDefault();
												event.stopPropagation();
												if (!isEditMode) return;
												bringNodeToFront(node.id);
												openNodeContextMenu(node.id, event.clientX, event.clientY);
											}}
										>
											{node.title || 'Untitled node'}
										</div>
									{/if}
									{#if !shouldRenderInlineUserLabels(node.id)}
										{#each getNodeUserOverlayEntries(node) as overlayEntry (`${node.id}:${overlayEntry.userOid}:${overlayEntry.displayIndex}`)}
											{@const userLabelLocal = getNodeUserLabelLocalPoint(
												node,
												overlayEntry.displayIndex,
												overlayEntry.extraOffsetPx
											)}
											<div
												class="nodeBodyTextOverlayLabel"
												data-overlay-node-id={node.id}
												data-overlay-user-oid={overlayEntry.userOid}
												data-overlay-display-index={overlayEntry.displayIndex}
												style={`--node-overlay-counter-scale:${overlayCounterScale};left:${userLabelLocal.x}px;top:${userLabelLocal.y}px;width:${userLabelWidth}px;font-size:${nodeUserLabelFontSizePx * zoom * renderScale}px;`}
											>
												{userDisplayLabel(overlayEntry.userOid)}
											</div>
										{/each}
									{/if}
								</svelte:fragment>
							</Node>
						{/each}
					</div>
						{#if nodeContextMenu}
						<div
							class="nodeContextMenu"
							style={`left:${nodeContextMenu.x}px;top:${nodeContextMenu.y}px;`}
							on:pointerdown|stopPropagation
						>
							<button
								type="button"
								class="nodeContextMenuItem"
								on:click={(event) =>
									runThenBlur(event, () => handleNodeContextMenuAction('pin'))}
							>
								<svg
									viewBox="0 0 24 24"
									aria-hidden="true"
									focusable="false"
									class="nodeContextMenuIcon"
								>
									<path d="M8 4h8l-1 3.6 2.6 3.8v1.6H6.4v-1.6L9 7.6 8 4Z" />
									<path d="M12 13v5.2" />
									{#if nodeContextMenu.isPinned}
										<circle class="nodeContextMenuPinNo" cx="12" cy="11" r="9.1"></circle>
										<path class="nodeContextMenuPinNo" d="M5.4 17.6L18.6 4.4" />
									{/if}
								</svg>
								<span>{nodeContextMenu.isPinned ? 'Unpin' : 'Pin'}</span>
							</button>
							<button
								type="button"
								class="nodeContextMenuItem"
								on:click={(event) =>
									runThenBlur(event, () => handleNodeContextMenuAction('addEmployee'))}
							>
								<svg
									viewBox="0 0 24 24"
									aria-hidden="true"
									focusable="false"
									class="nodeContextMenuIcon"
								>
									<path d="M12 5v14M5 12h14" />
								</svg>
								<span>Add Employee</span>
							</button>
							<button
								type="button"
								class="nodeContextMenuItem danger"
								on:click={(event) =>
									runThenBlur(event, () => handleNodeContextMenuAction('delete'))}
							>
								<svg
									viewBox="0 0 24 24"
									aria-hidden="true"
									focusable="false"
									class="nodeContextMenuIcon"
								>
									<path d="M4 7h16" />
									<path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7" />
									<path d="M6.5 7l.9 11.2c.1 1 1 1.8 2 1.8h5.2c1 0 1.9-.8 2-1.8L17.5 7" />
									<path d="M10 11v5M14 11v5" />
								</svg>
								<span>Delete</span>
							</button>
						</div>
					{/if}
					{#if nodeEmployeePicker}
						<div
							class="nodeEmployeePickerPopover"
							style={`left:${nodeEmployeePicker.x}px;top:${nodeEmployeePicker.y}px;`}
							on:pointerdown|stopPropagation
						>
							{#key `${nodeEmployeePickerNodeId ?? ''}-${nodeEmployeePicker.key}`}
									<UserSearchCombobox
										ariaLabel="Employee search"
										comboId={nodeEmployeePickerNodeId}
										placeholder="Search employees"
									autoFocus={true}
									directoryOnly={true}
									interactionLocked={isUserPickerInteractionLocked()}
									on:interact={() => {
										if (nodeEmployeePickerNodeId) {
											bringNodeToFront(nodeEmployeePickerNodeId);
										}
									}}
									selectedUserOids={getNodeById(nodeEmployeePickerNodeId ?? '')?.userOids ?? []}
									knownUsers={(getNodeById(nodeEmployeePickerNodeId ?? '')?.userOids ?? []).map(
										(userOid) => ({
											userOid,
											displayName: userDisplayLabel(userOid),
											email: null
										})
									)}
										on:selectionchange={(event) => {
											updateUserDisplayMap(event.detail.users);
											handleNodeEmployeeSelection(
												nodeEmployeePickerNodeId ?? '',
												event.detail.userOids
											);
										}}
										on:dragpreviewchange={(event) => {
											updateNodeUserDragPreview(
												event.detail.comboId,
												event.detail.visibleUserOids,
												event.detail.placeholderIndex
											);
										}}
									/>
							{/key}
						</div>
					{/if}
				</div>
			</div>
		</div>
	</div>
</div>

<ChartsModal
	open={showChartsModal}
	activeChartId={chart?.ChartId ?? null}
	{chartMemberships}
	currentThemeMode={theme}
	onThemeModeChange={(nextMode) => {
		themePreferenceState = nextMode;
		theme = nextMode;
		applyTheme(theme);
		persistThemePreference(themePreferenceState);
	}}
	onClose={() => (showChartsModal = false)}
	onMembershipsRefresh={async () => {
		await refreshMemberships();
	}}
/>

<ChartToolsModal
	open={showToolsModal}
	canAssignManagerRole={canAssignManagerRole()}
	currentUserOid={data.currentUserOid ?? ''}
	onClose={() => (showToolsModal = false)}
	onChartRefresh={async () => {
		await refreshMemberships();
	}}
/>

<OnboardingTourModal
	open={onboardingOpen}
	slides={onboardingSlidesForModal}
	currentIndex={onboardingSlideIndex}
	dontShowAgain={onboardingDontShowAgain}
	isSaving={onboardingSaving}
	errorMessage={onboardingSaveError}
	on:indexChange={(event) => (onboardingSlideIndex = event.detail)}
	on:dontShowAgainChange={(event) => (onboardingDontShowAgain = event.detail)}
	on:close={(event) => handleOnboardingClose(event.detail.markComplete)}
	on:complete={handleOnboardingComplete}
/>

<ConfirmDialog
	open={Boolean(nodeDeleteConfirm)}
	title={nodeDeleteConfirm?.title ?? ''}
	message={nodeDeleteConfirm?.message ?? ''}
	options={nodeDeleteConfirm?.options ?? []}
	cancelOptionId={nodeDeleteConfirm?.cancelOptionId ?? 'cancel'}
	on:select={(event) => closeNodeDeleteConfirm(event.detail)}
/>

<style>
	.actionBtn {
		appearance: none;
		border: 1px solid var(--interactive-border);
		border-radius: 999px;
		background: var(--interactive-bg);
		color: var(--text);
		padding: 8px 12px;
		font-size: 13px;
		font-weight: 760;
		cursor: pointer;
	}
	.actionBtn:hover {
		background: var(--interactive-bg-hover);
		border-color: var(--interactive-border-hover);
	}
	.chartToolsBtn {
		width: 38px;
		height: 38px;
		padding: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}
	.chartToolsIcon {
		width: 18px;
		height: 18px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.chartViewport {
		position: relative;
		min-height: 0;
		flex: 1;
	}
	.rightRail {
		position: absolute;
		top: 12px;
		right: 12px;
		z-index: 6;
		width: 220px;
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 10px;
		pointer-events: none;
	}
	.controlsCard {
		color: var(--controls-text, var(--text));
		position: relative;
		display: inline-flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		padding: 10px;
		pointer-events: auto;
		border: 1px solid color-mix(in srgb, var(--interactive-border) 84%, white 10%);
		border-radius: 12px;
		background: linear-gradient(
				90deg,
				color-mix(
					in srgb,
					var(--controls-background, var(--panel-bg)) 82%,
					var(--canvas-accent-2) 18%
				) 0%,
				transparent 40%
			),
			linear-gradient(
				180deg,
				color-mix(in srgb, var(--controls-background, var(--panel-bg)) 96%, transparent) 0%,
				color-mix(in srgb, var(--controls-background, var(--interactive-bg)) 88%, transparent) 100%
			);
		backdrop-filter: blur(4px);
		box-shadow:
			0 12px 24px color-mix(in srgb, black 20%, transparent),
			inset 0 1px 0 color-mix(in srgb, white 12%, transparent);
	}
	.controlsCardTopRight {
		top: auto;
		right: auto;
	}
	.pinnedPanel {
		color: var(--controls-text, var(--text));
		position: relative;
		width: 100%;
		max-height: min(42vh, 420px);
		padding: 10px;
		display: flex;
		flex-direction: column;
		gap: 8px;
		overflow: hidden;
		pointer-events: auto;
		border: 1px solid color-mix(in srgb, var(--interactive-border) 84%, white 10%);
		border-radius: 12px;
		background: linear-gradient(
			180deg,
			color-mix(in srgb, var(--controls-background, var(--panel-bg)) 95%, transparent) 0%,
			color-mix(in srgb, var(--controls-background, var(--interactive-bg)) 88%, transparent) 100%
		);
		backdrop-filter: blur(4px);
		box-shadow:
			0 12px 24px color-mix(in srgb, black 20%, transparent),
			inset 0 1px 0 color-mix(in srgb, white 12%, transparent);
	}
	.pinnedPanelHeader {
		font-size: 11px;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		opacity: 0.72;
		text-align: center;
	}
	.pinnedPanelList {
		display: flex;
		flex: 1 1 auto;
		flex-direction: column;
		align-items: stretch;
		gap: 6px;
		min-height: 0;
		padding: 2px;
		overflow-y: auto;
		overflow-x: clip;
	}
	.pinnedPanelItem {
		appearance: none;
		flex: 0 0 auto;
		width: 100%;
		min-height: 38px;
		border: 1px solid var(--interactive-border);
		border-radius: 10px;
		padding: 9px 10px;
		background: color-mix(in srgb, var(--controls-background, var(--panel-bg)) 88%, transparent);
		color: var(--controls-text, var(--text));
		font-size: 13px;
		font-weight: 650;
		text-align: center;
		cursor: pointer;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		transition:
			background 0.12s ease,
			border-color 0.12s ease,
			transform 0.08s ease;
	}
	.pinnedPanelItem:hover {
		background: var(--interactive-bg-hover);
		border-color: var(--canvas-accent-1);
	}
	.pinnedPanelItem:focus-visible {
		outline: none;
		box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--canvas-accent) 42%, white 8%);
	}
	.controlsCardTop {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}
	.modeCard {
		position: absolute;
		top: 12px;
		left: 12px;
		z-index: 6;
	}
	.newNodeFloating {
		position: absolute;
		top: 12px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 6;
	}
	.modeGroup {
		color: var(--controls-text, var(--text));
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 4px 8px;
		border: 1px solid var(--interactive-border);
		border-radius: 999px;
		background: color-mix(in srgb, var(--controls-background, var(--panel-bg)) 88%, transparent);
	}
	.modeLabel {
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		opacity: 0.82;
	}
	.modeSwitch {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		font-weight: 700;
	}
	.modeSwitchInput {
		position: absolute;
		opacity: 0;
		pointer-events: none;
	}
	.modeSwitchSlider {
		position: relative;
		display: inline-block;
		width: 42px;
		height: 24px;
		border-radius: 999px;
		border: 1px solid var(--interactive-border);
		background: color-mix(
			in srgb,
			var(--controls-background, var(--interactive-bg)) 82%,
			transparent
		);
		cursor: pointer;
		transition: background 0.14s ease;
	}
	.modeSwitchSlider::after {
		content: '';
		position: absolute;
		top: 2px;
		left: 2px;
		width: 18px;
		height: 18px;
		border-radius: 999px;
		background: var(--controls-text, var(--text));
		transition: transform 0.14s ease;
	}
	.modeSwitchInput:checked + .modeSwitchSlider {
		background: color-mix(in srgb, var(--canvas-accent) 55%, transparent);
	}
	.modeSwitchInput:checked + .modeSwitchSlider::after {
		transform: translateX(18px);
	}
	.modeSwitchInput:focus-visible + .modeSwitchSlider {
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--canvas-accent) 28%, transparent);
	}
	.isModeActive {
		color: var(--controls-text, var(--text));
	}
	.modeBadge {
		font-size: 12px;
		font-weight: 720;
		opacity: 0.9;
	}
	.controlsBarGroup {
		color: var(--controls-text, var(--text));
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 4px;
		border: 1px solid var(--interactive-border);
		border-radius: 12px;
		background: color-mix(in srgb, var(--controls-background, var(--panel-bg)) 88%, transparent);
		box-shadow: inset 0 1px 0 color-mix(in srgb, white 16%, transparent);
	}
	.controlsBtn {
		appearance: none;
		width: 34px;
		height: 34px;
		border: 1px solid var(--interactive-border);
		border-radius: 10px;
		background: color-mix(in srgb, var(--controls-background, var(--interactive-bg)) 90%, transparent);
		color: var(--controls-text, var(--text));
		font-size: 18px;
		font-weight: 800;
		line-height: 1;
		cursor: pointer;
		transition:
			transform 0.08s ease,
			background 0.12s ease,
			border-color 0.12s ease,
			box-shadow 0.12s ease;
	}
	.controlsBtn:hover {
		background: color-mix(
			in srgb,
			var(--controls-background, var(--interactive-bg-hover)) 82%,
			var(--controls-text, var(--text)) 18%
		);
		border-color: var(--canvas-accent-1);
		box-shadow: 0 0 0 1px color-mix(in srgb, var(--canvas-accent) 32%, transparent), var(--shadow-soft);
	}
	.controlsBtn:active {
		transform: translateY(1px);
	}
	.controlsBtn:focus-visible {
		outline: none;
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--canvas-accent) 28%, transparent);
	}
	.zoomControl {
		flex-direction: column;
		gap: 6px;
	}
	.zoomBtn {
		width: 42px;
		height: 32px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-weight: 820;
	}
	.zoomBtnSvg {
		width: 19px;
		height: 19px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.9;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.dpadControl {
		display: grid;
		grid-template-columns: repeat(3, 30px);
		grid-template-rows: repeat(3, 30px);
		gap: 3px;
		padding: 2px;
		border-radius: 10px;
	}
	.dpadBtn {
		width: 28px;
		height: 28px;
		border-radius: 8px;
		font-size: 9px;
		font-weight: 900;
	}
	.dpadUp {
		grid-column: 2;
		grid-row: 1;
	}
	.dpadLeft {
		grid-column: 1;
		grid-row: 2;
	}
	.dpadCenter {
		grid-column: 2;
		grid-row: 2;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		border-radius: 999px;
		background: radial-gradient(
			circle at 35% 25%,
			color-mix(in srgb, var(--controls-text, white) 18%, transparent) 0%,
			color-mix(in srgb, var(--controls-background, var(--interactive-bg)) 92%, transparent) 60%
		);
	}
	.dpadHomeSvg {
		width: 13px;
		height: 13px;
		display: block;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.9;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.dpadRight {
		grid-column: 3;
		grid-row: 2;
	}
	.dpadDown {
		grid-column: 2;
		grid-row: 3;
	}
	.newNodeBtn {
		min-width: 128px;
	}
	.newNodeBtn:hover {
		border-color: var(--canvas-accent-1);
		box-shadow: 0 0 0 1px color-mix(in srgb, var(--canvas-accent) 32%, transparent), var(--shadow-soft);
	}
	.newNodeBtn:focus-visible {
		outline: none;
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--canvas-accent) 28%, transparent);
	}
	.nodeCanvas {
		position: relative;
		flex: 1;
		min-height: 0;
		overflow: hidden;
		cursor: grab;
		user-select: none;
		touch-action: none;
		background: radial-gradient(
				circle at 20% 0%,
				color-mix(in srgb, var(--canvas-accent-2) 32%, transparent) 0%,
				transparent 58%
			),
			linear-gradient(180deg, var(--canvas-background) 0%, var(--canvas-background) 100%);
		background-size:
			auto,
			auto;
		background-position:
			0 0,
			0 0;
	}
	.nodeCanvas.nodeCanvasEditMode {
		background:
			radial-gradient(
				circle at 20% 0%,
				color-mix(in srgb, var(--canvas-accent-2) 32%, transparent) 0%,
				transparent 58%
			),
			linear-gradient(
				90deg,
				color-mix(in srgb, var(--node-border) 22%, transparent) 1px,
				transparent 1px
			),
			linear-gradient(
				0deg,
				color-mix(in srgb, var(--node-border) 18%, transparent) 1px,
				transparent 1px
			),
			linear-gradient(180deg, var(--canvas-background) 0%, var(--canvas-background) 100%);
		background-size:
			auto,
			var(--grid-size, 29px) var(--grid-size, 29px),
			var(--grid-size, 29px) var(--grid-size, 29px),
			auto;
		background-position:
			0 0,
			var(--grid-offset-x, 0px) var(--grid-offset-y, 0px),
			var(--grid-offset-x, 0px) var(--grid-offset-y, 0px),
			0 0;
	}
	.nodeCanvas.isPanningDrag {
		cursor: grabbing;
	}
	.connectionsLayer {
		position: absolute;
		inset: 0;
		z-index: 4;
		pointer-events: none;
		overflow: visible;
	}
	.connectionPath {
		fill: none;
		stroke: color-mix(in srgb, var(--node-connection) 82%, white 12%);
		stroke-width: 2.4;
		stroke-linecap: round;
		stroke-linejoin: round;
		opacity: 0.92;
		pointer-events: none;
	}
	.connectionPathSelected {
		stroke: color-mix(in srgb, var(--node-connection) 92%, white 8%);
		stroke-width: 3;
	}
	.connectionHitPath {
		fill: none;
		stroke: transparent;
		stroke-width: 14;
		stroke-linecap: round;
		stroke-linejoin: round;
		pointer-events: none;
	}
	.connectionHitPathInteractive {
		pointer-events: stroke;
		cursor: pointer;
	}
	.connectionPathPreview {
		stroke-dasharray: 7 5;
		stroke-width: 2;
		pointer-events: none;
	}
	.connectionPathPreviewInvalid {
		stroke: color-mix(in srgb, #cf423e 78%, white 12%);
		opacity: 0.8;
	}
	.connectionDeleteBtn {
		position: absolute;
		z-index: 8;
		width: 28px;
		height: 28px;
		border-radius: 999px;
		border: 1px solid color-mix(in srgb, var(--interactive-border-hover) 88%, white 8%);
		background: color-mix(in srgb, var(--panel-bg) 90%, white 10%);
		color: color-mix(in srgb, #d42d4f 88%, black 5%);
		font-size: 18px;
		font-weight: 700;
		line-height: 1;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		box-shadow: var(--shadow-soft);
		cursor: pointer;
		transform: translate(-50%, -50%);
	}
	.connectionDeleteBtn:hover {
		background: color-mix(in srgb, var(--panel-bg) 82%, white 18%);
	}
	.connectionDeleteBtn:focus-visible {
		outline: none;
		box-shadow: var(--focus-ring);
	}
	.nodeContextMenu {
		--text: var(--node-text);
		--interactive-border: var(--node-border);
		--interactive-border-hover:
			color-mix(in srgb, var(--node-border) 78%, var(--node-text));
		--interactive-bg: color-mix(in srgb, var(--node-background) 90%, var(--node-text) 10%);
		--interactive-bg-hover: color-mix(in srgb, var(--node-background) 82%, var(--node-text) 18%);
		position: absolute;
		z-index: 70;
		overflow: hidden;
		min-width: 180px;
		padding: 6px;
		display: flex;
		flex-direction: column;
		gap: 2px;
		border: 1px solid color-mix(in srgb, var(--node-border) 78%, white 10%);
		border-radius: 12px;
		background: var(--node-background);
		color: var(--node-text);
		opacity: 1;
		backdrop-filter: none;
		-webkit-backdrop-filter: none;
		box-shadow:
			0 14px 28px color-mix(in srgb, black 24%, transparent),
			inset 0 1px 0 color-mix(in srgb, white 14%, transparent);
	}
	.nodeEmployeePickerPopover {
		--text: var(--node-text);
		--muted: color-mix(in srgb, var(--node-text) 64%, transparent);
		--surface-2: color-mix(in srgb, var(--node-background) 92%, var(--node-text) 8%);
		--interactive-border: var(--node-border);
		--interactive-border-hover:
			color-mix(in srgb, var(--node-border) 78%, var(--node-text));
		--interactive-bg: color-mix(in srgb, var(--node-background) 90%, var(--node-text) 10%);
		--interactive-bg-hover: color-mix(in srgb, var(--node-background) 82%, var(--node-text) 18%);
		--accent-1: color-mix(in srgb, var(--node-border) 64%, var(--node-text) 36%);
		position: absolute;
		z-index: 71;
		width: 380px;
		max-width: min(380px, calc(100% - 20px));
		padding: 10px;
		border: 1px solid color-mix(in srgb, var(--node-border) 76%, white 10%);
		border-radius: 12px;
		background: var(--node-background);
		color: var(--node-text);
		box-shadow:
			0 14px 28px color-mix(in srgb, black 24%, transparent),
			inset 0 1px 0 color-mix(in srgb, white 14%, transparent);
	}
	.nodeContextMenuItem {
		appearance: none;
		width: 100%;
		border: 0;
		border-radius: 8px;
		padding: 8px 10px;
		display: inline-flex;
		align-items: center;
		gap: 9px;
		background: transparent;
		color: var(--node-text);
		font-size: 13px;
		font-weight: 670;
		text-align: left;
		cursor: pointer;
	}
	.nodeContextMenuItem:hover {
		background: color-mix(in srgb, var(--node-background) 82%, var(--node-text) 18%);
	}
	.nodeContextMenuItem:focus-visible {
		outline: none;
		box-shadow: var(--focus-ring);
	}
	.nodeContextMenuItem.danger {
		color: color-mix(in srgb, #d84b65 82%, var(--node-text));
	}
	.nodeContextMenuIcon {
		width: 16px;
		height: 16px;
		flex: 0 0 auto;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.nodeContextMenuPinNo {
		stroke-width: 1.5;
	}
	.nodePlane {
		position: absolute;
		inset: 0;
		z-index: 5;
		transform-origin: 0 0;
	}
	.nodeTitleOverlayEditor,
	.nodeTitleOverlayLabel,
	.nodeBodyTextOverlayLabel {
		position: absolute;
		display: block;
		box-sizing: border-box;
		transform: translate(-50%, -50%) scale(var(--node-overlay-counter-scale, 1));
		transform-origin: center center;
		margin: 0;
		padding: 0;
		border: 0;
		background: transparent;
		font-family: inherit;
		letter-spacing: inherit;
		color: var(--node-text);
		font-style: normal;
		font-weight: 700;
		line-height: 1.15;
		text-align: center;
		white-space: nowrap;
		text-overflow: ellipsis;
		overflow: hidden;
	}
	.nodeTitleOverlayEditor {
		pointer-events: auto;
		outline: none;
		cursor: text;
	}
	.nodeTitleOverlayLabel {
		pointer-events: none;
	}
	.nodeTitleOverlayLabelEditable {
		pointer-events: auto;
		cursor: text;
	}
	.nodeBodyTextOverlayLabel {
		pointer-events: none;
		font-weight: 600;
	}
	@media (max-width: 900px) {
		.rightRail {
			top: 8px;
			right: 8px;
			width: 180px;
			gap: 8px;
		}
		.controlsCard {
			padding: 8px;
			gap: 6px;
		}
		.controlsCardTop {
			gap: 6px;
		}
		.pinnedPanel {
			max-height: min(36vh, 280px);
			padding: 8px;
		}
		.modeCard {
			top: 8px;
			left: 8px;
		}
		.newNodeFloating {
			top: 56px;
		}
	}
</style>
