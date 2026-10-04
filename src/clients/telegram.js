import { config } from '../config.js';
import { logger } from '../utils/logger.js';

// Replicates the two Telegram nodes (error alert + "scripts generated" alert).
// Uses the Bot API directly via fetch — no extra dependency.
export class TelegramClient {
  constructor({ botToken = config.telegram.botToken, chatId = config.telegram.chatId, fetchImpl = globalThis.fetch } = {}) {
    this.botToken = botToken;
    this.chatId = chatId;
    this.fetch = fetchImpl;
  }

  async sendMessage(text, { parseMode } = {}) {
    if (!this.botToken) {
      logger.warn('TELEGRAM_BOT_TOKEN not set — skipping Telegram message');
      return null;
    }
    const res = await this.fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: this.chatId,
        text,
        ...(parseMode ? { parse_mode: parseMode } : {}),
      }),
    });
    if (!res.ok) {
      logger.error('Telegram sendMessage failed', await res.text());
    }
    return res.ok;
  }

  // Dynamic, count-safe version of the workflow's hardcoded data[0..9] alert.
  async scriptsGeneratedAlert(savedScripts) {
    const titles = savedScripts.map((s) => `• ${s.fields?.title || 'Untitled'}`).join('\n');
    const when = savedScripts[0]?.createdTime || new Date().toISOString();
    const text =
      `Scripts Completed at ${when}\n` +
      `for the following titles/topics:\n\n${titles}\n\n` +
      `Scripts are available for review`;
    return this.sendMessage(text);
  }

  async errorAlert({ workflowName, nodeName, message }) {
    const text =
      `Workflow Error: ${workflowName}\n\n` +
      `Failed Stage: ${nodeName}\n` +
      `Error: ${message}`;
    return this.sendMessage(text);
  }
}

export const telegram = () => new TelegramClient();
