import type { Dirent } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export type ChartRole = 'Member' | 'Maintainer' | 'Manager';

export type OnboardingSlide = {
	id: string;
	role: ChartRole;
	roleTier: number;
	title: string;
	description: string;
	imageUrl: string | null;
};

const ONBOARDING_ROOT_DIR = join(process.cwd(), 'static', 'onboarding');

const roleTierByName: Record<ChartRole, number> = {
	Member: 1,
	Maintainer: 2,
	Manager: 3
};

const roleFolderByName: Record<ChartRole, string> = {
	Member: 'member',
	Maintainer: 'maintainer',
	Manager: 'manager'
};

const imageExtensions = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.svg'] as const;

export function getRoleTier(role: ChartRole | null | undefined): number {
	if (!role) return 0;
	return roleTierByName[role] ?? 0;
}

export function toRoleTier(value: unknown): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed)) return 0;
	return Math.max(0, Math.min(3, parsed));
}

function byNameAsc(left: { name: string }, right: { name: string }) {
	return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' });
}

async function getSlideImageUrl(slideFsDir: string, slideWebDir: string): Promise<string | null> {
	const entries = await readdir(slideFsDir, { withFileTypes: true });
	const imageEntry = entries
		.filter((entry) => entry.isFile())
		.find((entry) =>
			imageExtensions.some((extension) => entry.name.toLowerCase().endsWith(extension))
		);
	if (!imageEntry) return null;
	return `/onboarding/${slideWebDir}/${imageEntry.name}`;
}

async function parseSlideContent(
	slideFsDir: string,
	fallbackTitle: string
): Promise<{ title: string; description: string }> {
	const contentPath = join(slideFsDir, 'content.txt');
	try {
		const raw = await readFile(contentPath, 'utf8');
		const normalized = raw.replace(/\r\n/g, '\n').trim();
		if (!normalized) {
			return { title: fallbackTitle, description: '' };
		}
		const lines = normalized.split('\n');
		const title = lines[0]?.trim() || fallbackTitle;
		const description = lines.slice(1).join('\n').trim();
		return { title, description };
	} catch {
		return { title: fallbackTitle, description: '' };
	}
}

async function loadRoleSlides(role: ChartRole): Promise<OnboardingSlide[]> {
	const roleFolder = roleFolderByName[role];
	const roleTier = roleTierByName[role];
	const roleDir = join(ONBOARDING_ROOT_DIR, roleFolder);

	let roleEntries: Dirent[] = [];
	try {
		roleEntries = await readdir(roleDir, { withFileTypes: true });
	} catch {
		return [];
	}

	const slideDirs = roleEntries.filter((entry) => entry.isDirectory()).sort(byNameAsc);
	const slides: OnboardingSlide[] = [];
	for (const slideDir of slideDirs) {
		const slideFsDir = join(roleDir, slideDir.name);
		const slideWebDir = `${roleFolder}/${slideDir.name}`;
		const fallbackTitle = slideDir.name.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
		const { title, description } = await parseSlideContent(slideFsDir, fallbackTitle || role);
		const imageUrl = await getSlideImageUrl(slideFsDir, slideWebDir);
		slides.push({
			id: `${roleFolder}-${slideDir.name}`,
			role,
			roleTier,
			title,
			description,
			imageUrl
		});
	}

	return slides;
}

export async function loadOnboardingSlidesByTierRange(params: {
	minExclusiveTier: number;
	maxInclusiveTier: number;
}): Promise<OnboardingSlide[]> {
	const minimum = Math.max(0, Math.min(3, params.minExclusiveTier));
	const maximum = Math.max(0, Math.min(3, params.maxInclusiveTier));
	if (maximum <= minimum) {
		return [];
	}

	const orderedRoles: ChartRole[] = ['Member', 'Maintainer', 'Manager'];
	const roles = orderedRoles.filter((role) => {
		const tier = roleTierByName[role];
		return tier > minimum && tier <= maximum;
	});
	if (roles.length === 0) {
		return [];
	}

	const allSlides = await Promise.all(roles.map((role) => loadRoleSlides(role)));
	return allSlides.flat();
}
