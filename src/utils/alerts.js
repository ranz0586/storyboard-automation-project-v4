import { logger } from './logger.js';

// Notifications are observability, not the primary operation. A Telegram
// outage must not abort per-item continuation or turn persisted work into a
// failed pipeline response.
export async function safeTelegram(label, send) {
  try {
    return await send();
  } catch (err) {
    logger.warn(`${label} notification failed`, err?.message);
    return null;
  }
}
