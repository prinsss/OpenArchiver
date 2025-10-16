import type { FetchMessageObject, ListResponse } from 'imapflow';
import type { Headers, ParsedMail } from 'mailparser';
import { logger } from '../../../config/logger';

function getHeaderValue(header: any): string | undefined {
	if (typeof header === 'string') {
		return header;
	}
	if (Array.isArray(header)) {
		return getHeaderValue(header[0]);
	}
	if (typeof header === 'object' && header !== null && 'value' in header) {
		return getHeaderValue(header.value);
	}
	return undefined;
}

export function getThreadId(headers: Headers): string | undefined {
	const referencesHeader = headers.get('references');

	if (referencesHeader) {
		const references = getHeaderValue(referencesHeader);
		if (references) {
			return references.split(' ')[0].trim();
		}
	}

	const inReplyToHeader = headers.get('in-reply-to');

	if (inReplyToHeader) {
		const inReplyTo = getHeaderValue(inReplyToHeader);
		if (inReplyTo) {
			return inReplyTo.trim();
		}
	}

	const conversationIdHeader = headers.get('conversation-id');

	if (conversationIdHeader) {
		const conversationId = getHeaderValue(conversationIdHeader);
		if (conversationId) {
			return conversationId.trim();
		}
	}

	const messageIdHeader = headers.get('message-id');

	if (messageIdHeader) {
		const messageId = getHeaderValue(messageIdHeader);
		if (messageId) {
			return messageId.trim();
		}
	}
	console.warn('No thread ID found, returning undefined');
	return undefined;
}

export function getMailDate(mail: ParsedMail, msg: FetchMessageObject): Date {
	// First we try to get the date from the email headers.
	const dateFromHeader = mail.headers.get('date');
	const headerDate = getHeaderValue(dateFromHeader);

	// Some emails might have an invalid date header that cannot be parsed by mailparser.
	// (e.g. "Date: [date", "date: Wed, 10 Apr 2019 18:01:01 Asia/Shanghai")
	// In that case, mail parser will fallback to current date, which is not what we want.
	// See: https://github.com/nodemailer/mailparser/blob/v3.7.5/lib/mail-parser.js#L333
	const isHeaderDateValid = headerDate && !isNaN(new Date(headerDate).getTime());

	// So if the header date is valid, we use it. Otherwise we fallback to internalDate.
	if (isHeaderDateValid && mail.date) {
		return mail.date;
	}

	// INTERNALDATE: the date and time when the message was received by the server.
	// See: https://datatracker.ietf.org/doc/html/rfc3501#section-2.3.3
	const internalDate = msg.internalDate;

	if (internalDate) {
		const date = internalDate instanceof Date ? internalDate : new Date(internalDate);
		if (!isNaN(date.getTime())) {
			return date;
		}
	}

	logger.warn({ mail, msg }, 'Email date is missing or invalid');
	return new Date();
}

export function getMailboxPriority(mailbox: ListResponse): number {
  const path = mailbox.path;
  const specialUse = mailbox.specialUse?.toLowerCase() ?? "";

  // Priority 6: INBOX (lowest priority)
  if (specialUse === "\\inbox" || path === "INBOX") {
    return 6;
  }

  // Priority 5: boxes marked as \all
  if (specialUse === "\\all" || mailbox.flags.has("\\All")) {
    return 5;
  }

  // Priority 4: boxes marked as \important
  if (specialUse === "\\important" || mailbox.flags.has("\\Important")) {
    return 4;
  }

  // Priority 3: boxes whose path starting with [Gmail]/
  if (path.startsWith("[Gmail]/")) {
    return 3;
  }

  // Priority 2: boxes whose path not includes "/"
  if (!path.includes("/")) {
    return 2;
  }

  // Priority 1: boxes whose path includes "/" but not starting with [Gmail]/
  return 1;
}

export function getSortedMailboxes(mailboxes: ListResponse[]): ListResponse[] {
  // sort mail boxes
  // 1. boxes whose path includes "/" but not starting with [Gmail]/
  // 2. boxes whose path not includes "/"
  // 3. boxes whose path starting with [Gmail]/
  // 4. boxes marked as \all

  const processableMailboxes = mailboxes.filter((mailbox) => {
    if (mailbox.flags.has("\\Noselect")) {
      return false;
    }
    return true;
  });

  const sortedMailboxes = processableMailboxes.sort((a, b) => {
    const aPath = a.path;
    const bPath = b.path;

    const aPriority = getMailboxPriority(a);
    const bPriority = getMailboxPriority(b);

    if (aPriority !== bPriority) {
      return aPriority - bPriority;
    }

    // If same priority, sort alphabetically
    return aPath.localeCompare(bPath);
  });

  return sortedMailboxes;
}
