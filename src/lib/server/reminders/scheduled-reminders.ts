import { sendPlaceholderAlertNotification } from '$lib/server/mail/notifications';
import { env } from '$env/dynamic/private';

export type ScheduledReminderDispatchSummary = {
	nowIso: string;
	candidateEvents: number;
	dueReminders: number;
	claimedReminders: number;
	sentReminders: number;
	skippedReminders: number;
	failedReminders: number;
};

// Placeholder reminder dispatcher.
// We are intentionally preserving the reminder pipeline structure from Shift Schedule,
// but BIRCH does not yet have a finalized reminder data model.
export async function dispatchDueScheduledReminders(): Promise<ScheduledReminderDispatchSummary> {
	const nowIso = new Date().toISOString();
	const heartbeatRecipient = env.MAIL_PLACEHOLDER_HEARTBEAT_TO?.trim() ?? '';

	let sentReminders = 0;
	let skippedReminders = 1;
	let failedReminders = 0;

	if (heartbeatRecipient) {
		try {
			const result = await sendPlaceholderAlertNotification({
				hierarchyName: 'Placeholder Hierarchy',
				intendedRecipients: [heartbeatRecipient],
				targetMemberName: 'BIRCH User',
				triggeringUserName: 'BIRCH Reminder Worker',
				status: 'Heartbeat Placeholder Alert'
			});
			if (result.sent) {
				sentReminders = 1;
				skippedReminders = 0;
			} else {
				skippedReminders = 1;
			}
		} catch {
			failedReminders = 1;
			skippedReminders = 0;
		}
	}

	return {
		nowIso,
		candidateEvents: 0,
		dueReminders: heartbeatRecipient ? 1 : 0,
		claimedReminders: heartbeatRecipient ? 1 : 0,
		sentReminders,
		skippedReminders,
		failedReminders
	};
}
