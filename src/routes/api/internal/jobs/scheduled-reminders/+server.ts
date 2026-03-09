import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { dispatchDueScheduledReminders } from '$lib/server/reminders/scheduled-reminders';

export const POST: RequestHandler = async () => {
	const summary = await dispatchDueScheduledReminders();
	return json(summary);
};
