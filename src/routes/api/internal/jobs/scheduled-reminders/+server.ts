import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { dispatchDueScheduledEventReminders } from '$lib/server/reminders/scheduled-event-reminders';

export const POST: RequestHandler = async () => {
	const summary = await dispatchDueScheduledEventReminders();
	return json(summary);
};
