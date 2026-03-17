<script lang="ts">
	import { base } from '$app/paths';
	import HorizontalScrollArea from '$lib/components/HorizontalScrollArea.svelte';
	import { fetchWithAuthRedirect as fetchWithAuthRedirectUtil } from '$lib/utils/fetchWithAuthRedirect';
	import { onDestroy, onMount, tick } from 'svelte';

	type UserRole = 'Member' | 'Maintainer' | 'Manager';
	type UsersViewMode = 'list' | 'add' | 'edit';
	type SortKey = 'name' | 'email' | 'role';
	type SortDirection = 'asc' | 'desc';
	type AccessUser = {
		userOid: string;
		name: string;
		email: string;
		role: UserRole;
		isActive: boolean;
	};
	type EntraUser = {
		userOid: string;
		displayName?: string;
		email?: string | null;
	};

	export let open = false;
	export let canAssignManagerRole = false;
	export let currentUserOid = '';
	export let onClose: () => void = () => {};
	export let onChartRefresh: () => void | Promise<void> = () => {};

	let usersViewMode: UsersViewMode = 'list';
	let selectedUserForEdit: AccessUser | null = null;
	let selectedAddRole: UserRole = 'Member';
	let selectedEditRole: UserRole = 'Member';
	let sortKey: SortKey = 'name';
	let sortDirection: SortDirection = 'asc';

	let users: AccessUser[] = [];
	let usersLoading = false;
	let usersError = '';

	let addUserQuery = '';
	let addUsers: EntraUser[] = [];
	let addUsersError = '';
	let addUsersLoading = false;
	let addUserSearchTimer: ReturnType<typeof setTimeout> | null = null;
	let showAddUserResults = false;
	let addUserComboEl: HTMLDivElement | null = null;
	let addUserResultsEl: HTMLDivElement | null = null;
	let addUserResultsRailEl: HTMLDivElement | null = null;
	let showAddUserResultsScrollbar = false;
	let addUserResultsThumbHeightPx = 0;
	let addUserResultsThumbTopPx = 0;
	let isDraggingAddUserResultsScrollbar = false;
	let addUserResultsDragStartY = 0;
	let addUserResultsDragStartThumbTopPx = 0;
	let addUserSelectionCommitted = false;
	let selectedAddUser: EntraUser | null = null;
	let addUserActionError = '';
	let editUserActionError = '';
	let addUserActionLoading = false;
	let editUserActionLoading = false;

	let modalScrollEl: HTMLDivElement | null = null;
	let railEl: HTMLDivElement | null = null;
	let showCustomScrollbar = false;
	let thumbHeightPx = 0;
	let thumbTopPx = 0;
	let isDraggingScrollbar = false;
	let dragStartY = 0;
	let dragStartThumbTopPx = 0;
	let wasOpen = false;

	$: canAssignManagerRoleEffective = canAssignManagerRole;

	async function fetchWithAuthRedirect(
		input: RequestInfo | URL,
		init: RequestInit
	): Promise<Response | null> {
		return fetchWithAuthRedirectUtil(input, init, base);
	}

	async function parseErrorMessage(response: Response, fallback: string): Promise<string> {
		const text = (await response.text().catch(() => '')).trim();
		if (!text) return fallback;
		try {
			const payload = JSON.parse(text) as { message?: string };
			if (typeof payload.message === 'string' && payload.message.trim()) {
				return payload.message;
			}
		} catch {
			// plain text
		}
		return text;
	}

	function closeModal() {
		onClose();
	}

	function handleBackdropMouseDown(event: MouseEvent) {
		if (event.target !== event.currentTarget) return;
		closeModal();
	}

	function resetAddUserResultsScrollbarState() {
		showAddUserResultsScrollbar = false;
		addUserResultsThumbHeightPx = 0;
		addUserResultsThumbTopPx = 0;
	}

	function resetUsersPane() {
		stopAddUserResultsDragging();
		usersViewMode = 'list';
		selectedUserForEdit = null;
		addUserQuery = '';
		addUsers = [];
		addUsersError = '';
		addUsersLoading = false;
		showAddUserResults = false;
		resetAddUserResultsScrollbarState();
		addUserSelectionCommitted = false;
		selectedAddUser = null;
		addUserActionError = '';
		editUserActionError = '';
		addUserActionLoading = false;
		editUserActionLoading = false;
		if (addUserSearchTimer) {
			clearTimeout(addUserSearchTimer);
			addUserSearchTimer = null;
		}
	}

	function openAddUserView() {
		stopAddUserResultsDragging();
		addUserQuery = '';
		addUsers = [];
		addUsersError = '';
		addUsersLoading = false;
		showAddUserResults = false;
		resetAddUserResultsScrollbarState();
		addUserSelectionCommitted = false;
		selectedAddUser = null;
		addUserActionError = '';
		addUserActionLoading = false;
		if (addUserSearchTimer) {
			clearTimeout(addUserSearchTimer);
			addUserSearchTimer = null;
		}
		selectedAddRole = 'Member';
		usersViewMode = 'add';
	}

	function openEditUserView(user: AccessUser) {
		selectedUserForEdit = user;
		selectedEditRole = user.role;
		editUserActionError = '';
		editUserActionLoading = false;
		usersViewMode = 'edit';
	}

	function toggleSort(nextKey: SortKey) {
		if (sortKey === nextKey) {
			sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
			return;
		}
		sortKey = nextKey;
		sortDirection = 'asc';
	}

	function ariaSortFor(key: SortKey): 'none' | 'ascending' | 'descending' {
		if (sortKey !== key) return 'none';
		return sortDirection === 'asc' ? 'ascending' : 'descending';
	}

	function toComparableValue(user: AccessUser, key: SortKey): string {
		if (key === 'name') return user.name;
		if (key === 'email') return user.email;
		return user.role;
	}

	function rolePrivilegeRank(role: UserRole): number {
		if (role === 'Manager') return 0;
		if (role === 'Maintainer') return 1;
		return 2;
	}

	function userLabel(user: EntraUser): string {
		const email = (user.email ?? '').trim();
		const name = (user.displayName ?? '').trim();
		let formattedName = name;
		if (name) {
			if (name.includes(',')) {
				formattedName = name;
			} else {
				const parts = name.split(/\s+/);
				if (parts.length >= 2) {
					const last = parts.pop();
					const first = parts.join(' ');
					formattedName = `${last}, ${first}`;
				}
			}
		}
		if (formattedName && email) return `${formattedName} <${email}>`;
		return formattedName || email || user.userOid;
	}

	async function loadAddUsers(query = addUserQuery) {
		addUsersLoading = true;
		addUsersError = '';
		try {
			const queryParam = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : '';
			const result = await fetchWithAuthRedirect(`${base}/api/chart/users${queryParam}`, {
				method: 'GET'
			});
			if (!result) return;
			if (!result.ok) {
				throw new Error(await parseErrorMessage(result, 'Failed to load users'));
			}
			const data = await result.json();
			addUsers = Array.isArray(data.users)
				? data.users.map((user: Record<string, unknown>) => ({
						userOid: String(user.userOid ?? ''),
						displayName: String(user.displayName ?? ''),
						email: user.email ? String(user.email) : null
					}))
				: [];
		} catch (error) {
			addUsersError = error instanceof Error ? error.message : 'Failed to load users';
		} finally {
			addUsersLoading = false;
		}
	}

	async function loadUsers() {
		usersLoading = true;
		usersError = '';
		try {
			const result = await fetchWithAuthRedirect(`${base}/api/chart/users`, { method: 'GET' });
			if (!result) return;
			if (!result.ok) {
				throw new Error(await parseErrorMessage(result, 'Failed to load users'));
			}
			const data = await result.json();
			users = Array.isArray(data.users)
				? data.users.map((row: Record<string, unknown>) => ({
						userOid: String(row.userOid ?? ''),
						name: String(row.displayName ?? row.userOid ?? ''),
						email: String(row.email ?? ''),
						role: String(row.roleName ?? 'Member') as UserRole,
						isActive: Boolean(row.isActive)
					}))
				: [];
		} catch (error) {
			usersError = error instanceof Error ? error.message : 'Failed to load users';
		} finally {
			usersLoading = false;
		}
	}

	function onAddUserQueryInput(event: Event) {
		const target = event.target as HTMLInputElement;
		addUserQuery = target.value;
		addUserSelectionCommitted = false;
		selectedAddUser = null;
		addUserActionError = '';
		if (addUserSearchTimer) clearTimeout(addUserSearchTimer);
		addUserSearchTimer = setTimeout(() => {
			void loadAddUsers(addUserQuery);
		}, 300);
	}

	function onAddUserSelect(user: EntraUser) {
		addUserQuery = userLabel(user);
		addUserSelectionCommitted = true;
		selectedAddUser = user;
		addUserActionError = '';
		closeAddUserResults();
	}

	function closeAddUserResults() {
		stopAddUserResultsDragging();
		showAddUserResults = false;
		resetAddUserResultsScrollbarState();
	}

	function onAddUserComboMouseDown(event: MouseEvent) {
		const target = event.target as HTMLElement | null;
		if (target?.closest('.setupUserComboItem')) return;
		if (addUserSelectionCommitted) return;
		showAddUserResults = true;
		if (addUsers.length === 0 && addUserQuery.trim().length > 0) {
			void loadAddUsers(addUserQuery);
		}
	}

	function clamp(value: number, min: number, max: number): number {
		return Math.min(max, Math.max(min, value));
	}

	function updateAddUserResultsScrollbar() {
		if (!addUserResultsEl) return;
		const scrollHeight = addUserResultsEl.scrollHeight;
		const clientHeight = addUserResultsEl.clientHeight;
		const scrollTop = addUserResultsEl.scrollTop;
		const hasOverflow = scrollHeight > clientHeight + 1;

		showAddUserResultsScrollbar = hasOverflow;
		if (!hasOverflow) {
			addUserResultsThumbHeightPx = 0;
			addUserResultsThumbTopPx = 0;
			return;
		}

		const railHeight = addUserResultsRailEl?.clientHeight ?? Math.max(clientHeight - 16, 0);
		if (railHeight <= 0) return;

		const minThumbHeight = 36;
		const nextThumbHeight = Math.max(minThumbHeight, (railHeight * clientHeight) / scrollHeight);
		const maxThumbTop = Math.max(railHeight - nextThumbHeight, 0);
		const maxScrollTop = Math.max(scrollHeight - clientHeight, 1);
		const nextThumbTop = (scrollTop / maxScrollTop) * maxThumbTop;

		addUserResultsThumbHeightPx = nextThumbHeight;
		addUserResultsThumbTopPx = clamp(nextThumbTop, 0, maxThumbTop);
	}

	function onAddUserResultsScroll() {
		if (!isDraggingAddUserResultsScrollbar) {
			updateAddUserResultsScrollbar();
		}
	}

	function onAddUserResultsDragMove(event: MouseEvent) {
		if (!isDraggingAddUserResultsScrollbar || !addUserResultsEl || !addUserResultsRailEl) return;

		const railHeight = addUserResultsRailEl.clientHeight;
		const maxThumbTop = Math.max(railHeight - addUserResultsThumbHeightPx, 0);
		const nextThumbTop = clamp(
			addUserResultsDragStartThumbTopPx + (event.clientY - addUserResultsDragStartY),
			0,
			maxThumbTop
		);
		const maxScrollTop = Math.max(addUserResultsEl.scrollHeight - addUserResultsEl.clientHeight, 0);

		addUserResultsThumbTopPx = nextThumbTop;
		addUserResultsEl.scrollTop = maxThumbTop > 0 ? (nextThumbTop / maxThumbTop) * maxScrollTop : 0;
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

	function stopAddUserResultsDragging() {
		if (isDraggingAddUserResultsScrollbar) {
			setGlobalScrollbarDragging(false);
		}
		isDraggingAddUserResultsScrollbar = false;
		if (typeof window !== 'undefined') {
			window.removeEventListener('mousemove', onAddUserResultsDragMove);
			window.removeEventListener('mouseup', stopAddUserResultsDragging);
		}
	}

	function startAddUserResultsThumbDrag(event: MouseEvent) {
		if (!showAddUserResultsScrollbar) return;
		event.preventDefault();
		event.stopPropagation();
		isDraggingAddUserResultsScrollbar = true;
		setGlobalScrollbarDragging(true);
		addUserResultsDragStartY = event.clientY;
		addUserResultsDragStartThumbTopPx = addUserResultsThumbTopPx;
		window.addEventListener('mousemove', onAddUserResultsDragMove);
		window.addEventListener('mouseup', stopAddUserResultsDragging);
	}

	function handleAddUserResultsRailClick(event: MouseEvent) {
		if (!addUserResultsEl || !addUserResultsRailEl || !showAddUserResultsScrollbar) return;
		if (event.target !== addUserResultsRailEl) return;

		const rect = addUserResultsRailEl.getBoundingClientRect();
		const desiredTop = clamp(
			event.clientY - rect.top - addUserResultsThumbHeightPx / 2,
			0,
			Math.max(rect.height - addUserResultsThumbHeightPx, 0)
		);
		const maxThumbTop = Math.max(rect.height - addUserResultsThumbHeightPx, 1);
		const maxScrollTop = Math.max(addUserResultsEl.scrollHeight - addUserResultsEl.clientHeight, 0);
		addUserResultsEl.scrollTop = (desiredTop / maxThumbTop) * maxScrollTop;
		updateAddUserResultsScrollbar();
	}

	async function handleAddUser() {
		addUserActionError = '';
		if (addUserActionLoading) return;
		if (!selectedAddUser) {
			addUserActionError = 'Select a user from the list before adding.';
			return;
		}

		addUserActionLoading = true;
		try {
			const result = await fetchWithAuthRedirect(`${base}/api/chart/users`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					targetUserOid: selectedAddUser.userOid,
					displayName: selectedAddUser.displayName ?? '',
					email: selectedAddUser.email ?? null,
					roleName: selectedAddRole
				})
			});
			if (!result) return;
			if (!result.ok) {
				throw new Error(await parseErrorMessage(result, 'Failed to add user'));
			}
			await loadUsers();
			await onChartRefresh();
			resetUsersPane();
		} catch (error) {
			addUserActionError = error instanceof Error ? error.message : 'Failed to add user';
		} finally {
			addUserActionLoading = false;
		}
	}

	async function handleSaveUserEdit() {
		editUserActionError = '';
		if (editUserActionLoading || !selectedUserForEdit) return;

		editUserActionLoading = true;
		try {
			const result = await fetchWithAuthRedirect(
				`${base}/api/chart/users/${encodeURIComponent(selectedUserForEdit.userOid)}`,
				{
					method: 'PATCH',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ roleName: selectedEditRole })
				}
			);
			if (!result) return;
			if (!result.ok) {
				throw new Error(await parseErrorMessage(result, 'Failed to update user'));
			}
			await loadUsers();
			await onChartRefresh();
			resetUsersPane();
		} catch (error) {
			editUserActionError = error instanceof Error ? error.message : 'Failed to update user';
		} finally {
			editUserActionLoading = false;
		}
	}

	async function handleRemoveUser() {
		editUserActionError = '';
		if (editUserActionLoading || !selectedUserForEdit) return;
		const isRemovingSelf = selectedUserForEdit.userOid === currentUserOid;

		editUserActionLoading = true;
		try {
			const result = await fetchWithAuthRedirect(
				`${base}/api/chart/users/${encodeURIComponent(selectedUserForEdit.userOid)}`,
				{
					method: 'PATCH',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ deactivate: true })
				}
			);
			if (!result) return;
			if (!result.ok) {
				throw new Error(await parseErrorMessage(result, 'Failed to remove user'));
			}
			if (isRemovingSelf) {
				window.location.reload();
				return;
			}
			await loadUsers();
			await onChartRefresh();
			resetUsersPane();
		} catch (error) {
			editUserActionError = error instanceof Error ? error.message : 'Failed to remove user';
		} finally {
			editUserActionLoading = false;
		}
	}

	function onDocumentMouseDown(event: MouseEvent) {
		const target = event.target as Node;
		if (showAddUserResults && addUserComboEl && !addUserComboEl.contains(target)) {
			closeAddUserResults();
		}
	}

	function updateCustomScrollbar() {
		if (!modalScrollEl) return;

		const scrollHeight = modalScrollEl.scrollHeight;
		const clientHeight = modalScrollEl.clientHeight;
		const scrollTop = modalScrollEl.scrollTop;
		const hasOverflow = scrollHeight > clientHeight + 1;

		showCustomScrollbar = hasOverflow;
		if (!hasOverflow) {
			thumbHeightPx = 0;
			thumbTopPx = 0;
			return;
		}

		const railHeight = railEl?.clientHeight ?? Math.max(clientHeight - 24, 0);
		if (railHeight <= 0) return;

		const minThumbHeight = 36;
		const nextThumbHeight = Math.max(minThumbHeight, (railHeight * clientHeight) / scrollHeight);
		const maxThumbTop = Math.max(railHeight - nextThumbHeight, 0);
		const maxScrollTop = Math.max(scrollHeight - clientHeight, 1);
		const nextThumbTop = (scrollTop / maxScrollTop) * maxThumbTop;

		thumbHeightPx = nextThumbHeight;
		thumbTopPx = clamp(nextThumbTop, 0, maxThumbTop);
	}

	function onModalScroll() {
		if (!isDraggingScrollbar) {
			updateCustomScrollbar();
		}
	}

	function onDragMove(event: MouseEvent) {
		if (!isDraggingScrollbar || !modalScrollEl || !railEl) return;

		const railHeight = railEl.clientHeight;
		const maxThumbTop = Math.max(railHeight - thumbHeightPx, 0);
		const nextThumbTop = clamp(dragStartThumbTopPx + (event.clientY - dragStartY), 0, maxThumbTop);
		const maxScrollTop = Math.max(modalScrollEl.scrollHeight - modalScrollEl.clientHeight, 0);

		thumbTopPx = nextThumbTop;
		modalScrollEl.scrollTop = maxThumbTop > 0 ? (nextThumbTop / maxThumbTop) * maxScrollTop : 0;
	}

	function stopDragging() {
		if (isDraggingScrollbar) {
			setGlobalScrollbarDragging(false);
		}
		isDraggingScrollbar = false;
		if (typeof window !== 'undefined') {
			window.removeEventListener('mousemove', onDragMove);
			window.removeEventListener('mouseup', stopDragging);
		}
	}

	function startThumbDrag(event: MouseEvent) {
		if (!showCustomScrollbar) return;
		event.preventDefault();
		event.stopPropagation();
		isDraggingScrollbar = true;
		setGlobalScrollbarDragging(true);
		dragStartY = event.clientY;
		dragStartThumbTopPx = thumbTopPx;
		window.addEventListener('mousemove', onDragMove);
		window.addEventListener('mouseup', stopDragging);
	}

	function handleRailClick(event: MouseEvent) {
		if (!modalScrollEl || !railEl || !showCustomScrollbar) return;
		if (event.target !== railEl) return;

		const rect = railEl.getBoundingClientRect();
		const desiredTop = clamp(
			event.clientY - rect.top - thumbHeightPx / 2,
			0,
			Math.max(rect.height - thumbHeightPx, 0)
		);
		const maxThumbTop = Math.max(rect.height - thumbHeightPx, 1);
		const maxScrollTop = Math.max(modalScrollEl.scrollHeight - modalScrollEl.clientHeight, 0);
		modalScrollEl.scrollTop = (desiredTop / maxThumbTop) * maxScrollTop;
		updateCustomScrollbar();
	}

	$: sortedUsers = [...users]
		.filter((user) => user.isActive)
		.sort((a, b) => {
			if (sortKey === 'role') {
				const compareRole = rolePrivilegeRank(a.role) - rolePrivilegeRank(b.role);
				if (compareRole !== 0) {
					return sortDirection === 'asc' ? compareRole : -compareRole;
				}
				const compareName = a.name.localeCompare(b.name);
				return sortDirection === 'asc' ? compareName : -compareName;
			}

			const aValue = toComparableValue(a, sortKey);
			const bValue = toComparableValue(b, sortKey);
			const compare = aValue.localeCompare(bValue);
			return sortDirection === 'asc' ? compare : -compare;
		});

	$: if (typeof document !== 'undefined') {
		document.body.classList.toggle('team-modal-open', open);
	}

	$: if (showAddUserResults && open && usersViewMode === 'add') {
		addUsers.length;
		addUsersLoading;
		addUsersError;
		tick().then(() => {
			updateAddUserResultsScrollbar();
			requestAnimationFrame(updateAddUserResultsScrollbar);
		});
	}

	$: if (open) {
		usersViewMode;
		sortedUsers.length;
		tick().then(() => {
			updateCustomScrollbar();
			requestAnimationFrame(updateCustomScrollbar);
		});
	}

	$: if (open && !wasOpen) {
		wasOpen = true;
		void loadUsers();
	}

	$: if (!open && wasOpen) {
		wasOpen = false;
		resetUsersPane();
		stopDragging();
	}

	onDestroy(() => {
		if (addUserSearchTimer) {
			clearTimeout(addUserSearchTimer);
		}
		stopDragging();
		stopAddUserResultsDragging();
		if (typeof document !== 'undefined') {
			document.removeEventListener('mousedown', onDocumentMouseDown);
			document.body.classList.remove('team-modal-open');
			if (!document.body.dataset.scrollbarDragCount) {
				document.body.classList.remove('scrollbar-dragging');
			}
		}
	});

	onMount(() => {
		document.addEventListener('mousedown', onDocumentMouseDown);
		const onResize = () => {
			updateCustomScrollbar();
			updateAddUserResultsScrollbar();
		};
		window.addEventListener('resize', onResize);
		return () => {
			document.removeEventListener('mousedown', onDocumentMouseDown);
			window.removeEventListener('resize', onResize);
		};
	});
</script>

{#if open}
	<div class="teamSetupBackdrop" role="presentation" on:mousedown={handleBackdropMouseDown}>
		<div class="teamSetupModal" role="dialog" aria-modal="true" aria-labelledby="team-setup-title">
			<div class="teamSetupModalScroll" bind:this={modalScrollEl} on:scroll={onModalScroll}>
				<header class="teamSetupHeader">
					<div>
						<h2 id="team-setup-title">Users</h2>
					</div>
					<button class="btn" type="button" on:click={closeModal}>Close</button>
				</header>

				<div class="teamSetupBody teamSetupBodySolo">
					<div class="teamSetupPanel">
						<section class="setupSection">
							<div class="usersPaneHeader">
								{#if usersViewMode === 'list'}
									<button
										type="button"
										class="iconSquareBtn"
										aria-label="Add user"
										title="Add user"
										on:click={openAddUserView}
									>
										<svg viewBox="0 0 24 24" aria-hidden="true">
											<path d="M12 5v14M5 12h14" />
										</svg>
									</button>
								{/if}
							</div>

							{#if usersViewMode === 'list'}
								<div class="setupCard">
									<HorizontalScrollArea>
										<table class="setupTable">
											<thead>
												<tr>
													<th aria-sort={ariaSortFor('name')}>
														<button
															type="button"
															class="tableSortBtn"
															on:click={() => toggleSort('name')}
														>
															User
															<span
																class={`sortIndicator${sortKey === 'name' ? ' active' : ''}`}
																aria-hidden="true"
															>
																{sortKey === 'name' ? (sortDirection === 'asc' ? '↑' : '↓') : '↕'}
															</span>
														</button>
													</th>
													<th aria-sort={ariaSortFor('email')}>
														<button
															type="button"
															class="tableSortBtn"
															on:click={() => toggleSort('email')}
														>
															Email
															<span
																class={`sortIndicator${sortKey === 'email' ? ' active' : ''}`}
																aria-hidden="true"
															>
																{sortKey === 'email' ? (sortDirection === 'asc' ? '↑' : '↓') : '↕'}
															</span>
														</button>
													</th>
													<th aria-sort={ariaSortFor('role')}>
														<button
															type="button"
															class="tableSortBtn"
															on:click={() => toggleSort('role')}
														>
															Role
															<span
																class={`sortIndicator${sortKey === 'role' ? ' active' : ''}`}
																aria-hidden="true"
															>
																{sortKey === 'role' ? (sortDirection === 'asc' ? '↑' : '↓') : '↕'}
															</span>
														</button>
													</th>
													<th></th>
												</tr>
											</thead>
											<tbody>
												{#if usersLoading}
													<tr>
														<td colspan="4">Loading users...</td>
													</tr>
												{:else if usersError}
													<tr>
														<td colspan="4">{usersError}</td>
													</tr>
												{:else if sortedUsers.length === 0}
													<tr>
														<td colspan="4">No users found for this chart.</td>
													</tr>
												{:else}
													{#each sortedUsers as user}
														<tr>
															<td>{user.name}</td>
															<td>{user.email}</td>
															<td>{user.role}</td>
															<td
																><button
																	type="button"
																	class="btn"
																	on:click={() => openEditUserView(user)}>Edit</button
																></td
															>
														</tr>
													{/each}
												{/if}
											</tbody>
										</table>
									</HorizontalScrollArea>
								</div>
							{:else if usersViewMode === 'add'}
								<div class="setupCard">
									<h4>Add User</h4>
									<div class="setupGrid">
										<div>
											<span class="srOnly">User search</span>
											<div
												class="setupUserCombo setupUserComboAddUser"
												role="combobox"
												aria-expanded={showAddUserResults}
												bind:this={addUserComboEl}
												on:mousedown={onAddUserComboMouseDown}
											>
												<input
													class="input"
													placeholder="Search by name or email"
													aria-label="User search"
													type="text"
													value={addUserQuery}
													on:input={onAddUserQueryInput}
													aria-autocomplete="list"
													aria-controls="add-user-results"
												/>
												{#if showAddUserResults}
													<div
														id="add-user-results"
														class="setupUserComboList setupUserComboListCustom"
														role="listbox"
													>
														<div
															class="setupUserComboListScroll"
															class:hasScrollbar={showAddUserResultsScrollbar}
															bind:this={addUserResultsEl}
															on:scroll={onAddUserResultsScroll}
														>
															{#if addUsersLoading}
																<div class="setupUserComboItem setupUserComboStatus">
																	Loading...
																</div>
															{:else if addUsersError}
																<div class="setupUserComboItem setupUserComboError">
																	{addUsersError}
																</div>
															{:else if addUsers.length === 0}
																<button
																	class="setupUserComboItem setupUserComboStatus"
																	type="button"
																	on:mousedown|preventDefault={closeAddUserResults}
																>
																	No matches
																</button>
															{:else}
																{#each addUsers as user}
																	<button
																		class="setupUserComboItem"
																		role="option"
																		type="button"
																		on:mousedown|preventDefault={() => onAddUserSelect(user)}
																	>
																		{userLabel(user)}
																	</button>
																{/each}
															{/if}
														</div>
														{#if showAddUserResultsScrollbar}
															<div
																class="setupUserComboScrollRail"
																role="presentation"
																aria-hidden="true"
																bind:this={addUserResultsRailEl}
																on:mousedown={handleAddUserResultsRailClick}
															>
																<div
																	class="setupUserComboScrollThumb"
																	class:dragging={isDraggingAddUserResultsScrollbar}
																	role="presentation"
																	style={`height:${addUserResultsThumbHeightPx}px;transform:translateY(${addUserResultsThumbTopPx}px);`}
																	on:mousedown={startAddUserResultsThumbDrag}
																></div>
															</div>
														{/if}
													</div>
												{/if}
											</div>
										</div>

										<fieldset class="roleFieldset">
											<legend>Access Level</legend>
											<label>
												<input
													type="radio"
													name="access-level-add"
													value="Member"
													bind:group={selectedAddRole}
												/>
												Member
											</label>
											<label>
												<input
													type="radio"
													name="access-level-add"
													value="Maintainer"
													bind:group={selectedAddRole}
												/>
												Maintainer
											</label>
											{#if canAssignManagerRoleEffective}
												<label>
													<input
														type="radio"
														name="access-level-add"
														value="Manager"
														bind:group={selectedAddRole}
													/>
													Manager
												</label>
											{/if}
										</fieldset>
									</div>
									<div class="setupActions">
										<button type="button" class="iconActionBtn actionBtn" on:click={resetUsersPane}>
											<svg viewBox="0 0 24 24" aria-hidden="true">
												<path d="M6 6l12 12M18 6L6 18" />
											</svg>
											Cancel
										</button>
										<button
											type="button"
											class="iconActionBtn primary actionBtn"
											on:click={handleAddUser}
											disabled={addUserActionLoading}
										>
											<svg viewBox="0 0 24 24" aria-hidden="true" class="calendarPlusIcon">
												<path d="M5 6h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z" />
												<path d="M7 3v6M15 3v6M3 11h16" />
												<path class="iconPlus" d="M18 4h6M21 1v6" />
											</svg>
											Add
										</button>
									</div>
									{#if addUserActionError}
										<div class="setupActionAlert" role="alert">{addUserActionError}</div>
									{/if}
								</div>
							{:else if selectedUserForEdit}
								<div class="setupCard">
									<h4>Edit User</h4>
									<div class="setupGrid">
										<div class="userSummaryCard" role="note" aria-label="Selected user">
											<div class="userSummaryName">{selectedUserForEdit.name}</div>
											<div class="userSummaryEmail">{selectedUserForEdit.email}</div>
										</div>

										<fieldset class="roleFieldset">
											<legend>Access Level</legend>
											<label>
												<input
													type="radio"
													name="access-level-edit"
													value="Member"
													bind:group={selectedEditRole}
												/>
												Member
											</label>
											<label>
												<input
													type="radio"
													name="access-level-edit"
													value="Maintainer"
													bind:group={selectedEditRole}
												/>
												Maintainer
											</label>
											<label>
												<input
													type="radio"
													name="access-level-edit"
													value="Manager"
													bind:group={selectedEditRole}
													disabled={!canAssignManagerRoleEffective}
												/>
												Manager
											</label>
										</fieldset>
									</div>

									<div class="setupActions">
										<button
											type="button"
											class="iconActionBtn danger actionBtn"
											on:click={handleRemoveUser}
											disabled={editUserActionLoading}
										>
											<svg viewBox="0 0 24 24" aria-hidden="true">
												<path
													d="M 2 4 h 20 M 6 4 V 1 h 12 v 3 M 2 6 h 20 M 4 6 l 1 15 h 13 L 20 6 M 9.5 8.5 v 10 M 14.5 8.5 v 10"
												/>
											</svg>
											Remove
										</button>
										<button type="button" class="iconActionBtn actionBtn" on:click={resetUsersPane}>
											<svg viewBox="0 0 24 24" aria-hidden="true">
												<path d="M6 6l12 12M18 6L6 18" />
											</svg>
											Cancel
										</button>
										<button
											type="button"
											class="iconActionBtn primary actionBtn"
											on:click={handleSaveUserEdit}
											disabled={editUserActionLoading}
										>
											<svg viewBox="0 0 24 24" aria-hidden="true">
												<path d="M4 12l5 5 11-11" />
											</svg>
											Save
										</button>
									</div>
									{#if editUserActionError}
										<div class="setupActionAlert" role="alert">{editUserActionError}</div>
									{/if}
								</div>
							{/if}
						</section>
					</div>
				</div>
			</div>

			{#if showCustomScrollbar}
				<div
					class="teamSetupScrollRail"
					role="presentation"
					aria-hidden="true"
					bind:this={railEl}
					on:mousedown={handleRailClick}
				>
					<div
						class="teamSetupScrollThumb"
						class:dragging={isDraggingScrollbar}
						role="presentation"
						style={`height:${thumbHeightPx}px;transform:translateY(${thumbTopPx}px);`}
						on:mousedown={startThumbDrag}
					></div>
				</div>
			{/if}
		</div>
	</div>
{/if}
