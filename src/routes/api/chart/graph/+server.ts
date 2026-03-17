import { error, json, type Cookies } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { GetPool } from '$lib/server/db';
import { getActiveChartId } from '$lib/server/auth';
import { requireChartRole } from '$lib/server/chart-access';

type RoleName = 'Member' | 'Maintainer' | 'Manager';

type GraphNodePayload = {
	id: string;
	title: string;
	x: number;
	y: number;
	width: number;
	height: number;
	userOids: string[];
};

type GraphConnectionPayload = {
	id: string;
	from: { nodeId: string; side: 'top' | 'right' | 'bottom' | 'left' };
	to: { nodeId: string; side: 'top' | 'right' | 'bottom' | 'left' };
};

async function getActorContext(userOid: string, cookies: Cookies) {
	const chartId = await getActiveChartId(cookies);
	if (!chartId) throw error(400, 'No active chart selected');

	const roleName = (await requireChartRole({
		userOid,
		chartId,
		minimumRole: 'Member',
		message: 'You do not have access to this chart'
	})) as RoleName;
	return { chartId, roleName };
}

function requireString(value: unknown, fieldName: string, maxLength: number): string {
	if (typeof value !== 'string') throw error(400, `${fieldName} is required`);
	const trimmed = value.trim();
	if (!trimmed || trimmed.length > maxLength) {
		throw error(400, `${fieldName} must be between 1 and ${maxLength} characters`);
	}
	return trimmed;
}

function parseNumber(value: unknown, fieldName: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw error(400, `${fieldName} must be a finite number`);
	}
	return value;
}

function parseSide(value: unknown, fieldName: string): 'top' | 'right' | 'bottom' | 'left' {
	if (value === 'top' || value === 'right' || value === 'bottom' || value === 'left') {
		return value;
	}
	throw error(400, `${fieldName} is invalid`);
}

function parseNodes(value: unknown): GraphNodePayload[] {
	if (!Array.isArray(value)) throw error(400, 'nodes must be an array');
	return value.map((node, index) => {
		const source = node as Record<string, unknown>;
		const id = requireString(source.id, `nodes[${index}].id`, 64);
		const title = typeof source.title === 'string' ? source.title.slice(0, 200) : '';
		const x = parseNumber(source.x, `nodes[${index}].x`);
		const y = parseNumber(source.y, `nodes[${index}].y`);
		const width = parseNumber(source.width, `nodes[${index}].width`);
		const height = parseNumber(source.height, `nodes[${index}].height`);
		if (width <= 0 || height <= 0) {
			throw error(400, `nodes[${index}] width and height must be positive`);
		}
		const userOids = Array.isArray(source.userOids)
			? source.userOids.map((userOid, userIndex) =>
					requireString(userOid, `nodes[${index}].userOids[${userIndex}]`, 64)
				)
			: [];
		if (new Set(userOids).size !== userOids.length) {
			throw error(400, `nodes[${index}].userOids contains duplicates`);
		}
		return { id, title, x, y, width, height, userOids };
	});
}

function parseConnections(value: unknown, knownNodeIds: Set<string>): GraphConnectionPayload[] {
	if (!Array.isArray(value)) throw error(400, 'connections must be an array');
	return value.map((connection, index) => {
		const source = connection as Record<string, unknown>;
		const id = requireString(source.id, `connections[${index}].id`, 64);
		const from = (source.from ?? {}) as Record<string, unknown>;
		const to = (source.to ?? {}) as Record<string, unknown>;
		const fromNodeId = requireString(from.nodeId, `connections[${index}].from.nodeId`, 64);
		const toNodeId = requireString(to.nodeId, `connections[${index}].to.nodeId`, 64);
		if (!knownNodeIds.has(fromNodeId) || !knownNodeIds.has(toNodeId)) {
			throw error(400, `connections[${index}] references an unknown node`);
		}
		if (fromNodeId === toNodeId) {
			throw error(400, `connections[${index}] cannot connect a node to itself`);
		}
		return {
			id,
			from: {
				nodeId: fromNodeId,
				side: parseSide(from.side, `connections[${index}].from.side`)
			},
			to: {
				nodeId: toNodeId,
				side: parseSide(to.side, `connections[${index}].to.side`)
			}
		};
	});
}

function parsePinnedNodeIds(value: unknown, knownNodeIds: Set<string>): string[] {
	if (value == null) return [];
	if (!Array.isArray(value)) throw error(400, 'pinnedNodeIds must be an array');
	const pinnedNodeIds = value.map((nodeId, index) =>
		requireString(nodeId, `pinnedNodeIds[${index}]`, 64)
	);
	if (new Set(pinnedNodeIds).size !== pinnedNodeIds.length) {
		throw error(400, 'pinnedNodeIds contains duplicates');
	}
	for (const nodeId of pinnedNodeIds) {
		if (!knownNodeIds.has(nodeId)) {
			throw error(400, 'pinnedNodeIds references an unknown node');
		}
	}
	return pinnedNodeIds;
}

export const GET: RequestHandler = async ({ locals, cookies }) => {
	const user = locals.user;
	if (!user) throw error(401, 'Unauthorized');

	const { chartId } = await getActorContext(user.id, cookies);
	const pool = await GetPool();
	const result = await pool.request().input('chartId', chartId).query(`
		SELECT
			n.NodeKey,
			n.Title,
			n.PositionX,
			n.PositionY,
			n.Width,
			n.Height,
			n.LayerOrder,
			n.IsPinned,
			n.PinnedOrder,
			nu.SortOrder AS UserSortOrder,
			nu.UserOid,
			COALESCE(NULLIF(LTRIM(RTRIM(u.DisplayName)), ''), NULLIF(LTRIM(RTRIM(u.FullName)), ''), nu.UserOid) AS UserDisplayName,
			u.Email
		FROM dbo.Nodes n
		LEFT JOIN dbo.NodeUsers nu
			ON nu.NodeId = n.NodeId
		LEFT JOIN dbo.Users u
			ON u.UserOid = nu.UserOid
		WHERE n.ChartId = @chartId
		ORDER BY n.LayerOrder, nu.SortOrder;

		SELECT
			c.ConnectionKey,
			sn.NodeKey AS SourceNodeKey,
			c.FromSide,
			tn.NodeKey AS TargetNodeKey,
			c.ToSide
		FROM dbo.NodeConnections c
		INNER JOIN dbo.Nodes sn ON sn.NodeId = c.SourceNodeId
		INNER JOIN dbo.Nodes tn ON tn.NodeId = c.TargetNodeId
		WHERE c.ChartId = @chartId
		ORDER BY c.ConnectionKey;
	`);

	const nodeMap = new Map<
		string,
		{
			id: string;
			title: string;
			x: number;
			y: number;
			width: number;
			height: number;
			layerOrder: number;
			isPinned: boolean;
			pinnedOrder: number | null;
			userOids: string[];
			users: Array<{ userOid: string; displayName: string; email: string | null }>;
		}
	>();

	for (const row of result.recordsets?.[0] ?? []) {
		const nodeKey = String(row.NodeKey);
		const existing =
			nodeMap.get(nodeKey) ??
			{
				id: nodeKey,
				title: String(row.Title ?? ''),
				x: Number(row.PositionX ?? 0),
				y: Number(row.PositionY ?? 0),
				width: Number(row.Width ?? 290),
				height: Number(row.Height ?? 160),
				layerOrder: Number(row.LayerOrder ?? 0),
				isPinned: Boolean(row.IsPinned),
				pinnedOrder:
					row.PinnedOrder === null || row.PinnedOrder === undefined
						? null
						: Number(row.PinnedOrder),
				userOids: [],
				users: []
			};
		if (row.UserOid) {
			existing.userOids.push(String(row.UserOid));
			existing.users.push({
				userOid: String(row.UserOid),
				displayName: String(row.UserDisplayName ?? row.UserOid),
				email: row.Email ? String(row.Email) : null
			});
		}
		nodeMap.set(nodeKey, existing);
	}

	const nodes = Array.from(nodeMap.values())
		.sort((a, b) => a.layerOrder - b.layerOrder)
		.map((node) => ({
			id: node.id,
			title: node.title,
			x: node.x,
			y: node.y,
			width: node.width,
			height: node.height,
			userOids: node.userOids,
			users: node.users
		}));

	const pinnedNodeIds = Array.from(nodeMap.values())
		.filter((node) => node.isPinned)
		.sort((a, b) => (a.pinnedOrder ?? Number.MAX_SAFE_INTEGER) - (b.pinnedOrder ?? Number.MAX_SAFE_INTEGER))
		.map((node) => node.id);

	const connections = (result.recordsets?.[1] ?? []).map((row) => ({
		id: String(row.ConnectionKey),
		from: {
			nodeId: String(row.SourceNodeKey),
			side: row.FromSide as 'top' | 'right' | 'bottom' | 'left'
		},
		to: {
			nodeId: String(row.TargetNodeKey),
			side: row.ToSide as 'top' | 'right' | 'bottom' | 'left'
		}
	}));

	return json({ nodes, connections, pinnedNodeIds });
};

export const PUT: RequestHandler = async ({ locals, cookies, request }) => {
	const user = locals.user;
	if (!user) throw error(401, 'Unauthorized');

	const { chartId, roleName } = await getActorContext(user.id, cookies);
	if (!(roleName === 'Maintainer' || roleName === 'Manager')) {
		throw error(403, 'Only maintainers or managers can update the chart graph');
	}

	const body = await request.json().catch(() => null);
	const nodes = parseNodes((body as Record<string, unknown> | null)?.nodes);
	const knownNodeIds = new Set(nodes.map((node) => node.id));
	if (knownNodeIds.size !== nodes.length) {
		throw error(400, 'nodes contains duplicate ids');
	}
	const connections = parseConnections((body as Record<string, unknown> | null)?.connections, knownNodeIds);
	if (new Set(connections.map((connection) => connection.id)).size !== connections.length) {
		throw error(400, 'connections contains duplicate ids');
	}
	const pinnedNodeIds = parsePinnedNodeIds(
		(body as Record<string, unknown> | null)?.pinnedNodeIds,
		knownNodeIds
	);

	const nodeUsers = nodes.flatMap((node) =>
		node.userOids.map((userOid, index) => ({
			nodeId: node.id,
			userOid,
			sortOrder: index
		}))
	);

	const nodesJson = JSON.stringify(
		nodes.map((node, index) => ({
			id: node.id,
			title: node.title,
			x: node.x,
			y: node.y,
			width: node.width,
			height: node.height,
			layerOrder: index,
			isPinned: pinnedNodeIds.includes(node.id),
			pinnedOrder: pinnedNodeIds.indexOf(node.id)
		}))
	);
	const nodeUsersJson = JSON.stringify(nodeUsers);
	const connectionsJson = JSON.stringify(
		connections.map((connection) => ({
			id: connection.id,
			sourceNodeId: connection.from.nodeId,
			fromSide: connection.from.side,
			targetNodeId: connection.to.nodeId,
			toSide: connection.to.side
		}))
	);

	const pool = await GetPool();
	const tx = pool.transaction();
	await tx.begin();

	try {
		await tx
			.request()
			.input('chartId', chartId)
			.input('actorUserOid', user.id)
			.input('nodesJson', nodesJson)
			.input('nodeUsersJson', nodeUsersJson)
			.input('connectionsJson', connectionsJson)
			.query(`
				DECLARE @NodeMap TABLE (
					NodeKey nvarchar(64) NOT NULL PRIMARY KEY,
					NodeId bigint NOT NULL
				);

				DELETE FROM dbo.NodeConnections
				WHERE ChartId = @chartId;

				DELETE nu
				FROM dbo.NodeUsers nu
				INNER JOIN dbo.Nodes n ON n.NodeId = nu.NodeId
				WHERE n.ChartId = @chartId;

				DELETE FROM dbo.Nodes
				WHERE ChartId = @chartId;

				INSERT INTO dbo.Nodes (
					ChartId,
					NodeKey,
					Title,
					PositionX,
					PositionY,
					Width,
					Height,
					LayerOrder,
					IsPinned,
					PinnedOrder,
					CreatedBy,
					UpdatedAt,
					UpdatedBy
				)
				OUTPUT inserted.NodeKey, inserted.NodeId INTO @NodeMap(NodeKey, NodeId)
				SELECT
					@chartId,
					source.id,
					source.title,
					source.x,
					source.y,
					source.width,
					source.height,
					source.layerOrder,
					source.isPinned,
					CASE WHEN source.isPinned = 1 THEN source.pinnedOrder ELSE NULL END,
					@actorUserOid,
					SYSUTCDATETIME(),
					@actorUserOid
				FROM OPENJSON(@nodesJson)
				WITH (
					id nvarchar(64) '$.id',
					title nvarchar(200) '$.title',
					x decimal(18,6) '$.x',
					y decimal(18,6) '$.y',
					width decimal(18,6) '$.width',
					height decimal(18,6) '$.height',
					layerOrder int '$.layerOrder',
					isPinned bit '$.isPinned',
					pinnedOrder int '$.pinnedOrder'
				) AS source;

				INSERT INTO dbo.NodeUsers (
					NodeId,
					UserOid,
					SortOrder,
					CreatedBy,
					UpdatedAt,
					UpdatedBy
				)
				SELECT
					nodeMap.NodeId,
					source.userOid,
					source.sortOrder,
					@actorUserOid,
					SYSUTCDATETIME(),
					@actorUserOid
				FROM OPENJSON(@nodeUsersJson)
				WITH (
					nodeId nvarchar(64) '$.nodeId',
					userOid nvarchar(64) '$.userOid',
					sortOrder int '$.sortOrder'
				) AS source
				INNER JOIN @NodeMap nodeMap ON nodeMap.NodeKey = source.nodeId;

				INSERT INTO dbo.NodeConnections (
					ChartId,
					ConnectionKey,
					SourceNodeId,
					FromSide,
					TargetNodeId,
					ToSide,
					CreatedBy,
					UpdatedAt,
					UpdatedBy
				)
				SELECT
					@chartId,
					source.id,
					sourceNode.NodeId,
					source.fromSide,
					targetNode.NodeId,
					source.toSide,
					@actorUserOid,
					SYSUTCDATETIME(),
					@actorUserOid
				FROM OPENJSON(@connectionsJson)
				WITH (
					id nvarchar(64) '$.id',
					sourceNodeId nvarchar(64) '$.sourceNodeId',
					fromSide varchar(6) '$.fromSide',
					targetNodeId nvarchar(64) '$.targetNodeId',
					toSide varchar(6) '$.toSide'
				) AS source
				INNER JOIN @NodeMap sourceNode ON sourceNode.NodeKey = source.sourceNodeId
				INNER JOIN @NodeMap targetNode ON targetNode.NodeKey = source.targetNodeId;
			`);

		await tx.commit();
		return json({ ok: true });
	} catch (err) {
		try {
			await tx.rollback();
		} catch {
			// Preserve the original SQL error when rollback itself fails.
		}
		throw err;
	}
};
