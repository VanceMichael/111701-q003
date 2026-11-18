import { createHash } from 'node:crypto';

export function normalizePage(page) {
  return page.items.map((item) => {
    if (!item.id || !item.label || !item.state) {
      throw new Error('来源记录缺少 id、label 或 state');
    }
    const announcedHours = normalizeHours(item.hours);
    return {
      source: page.source,
      id: String(item.id),
      name: String(item.label).trim(),
      state: String(item.state),
      revision: Number(item.revision ?? 0),
      observedAt: page.observedAt ?? null,
      announcedHours,
      announcedHoursHash: announcedHours === null ? null : sha256(announcedHours),
      attachments: normalizeAttachments(item.attachments),
    };
  });
}

function normalizeAttachments(attachments) {
  if (attachments == null) {
    return [];
  }
  if (!Array.isArray(attachments)) {
    throw new Error('附件列表格式不正确');
  }
  return attachments.map((attachment) => {
    if (!attachment || !attachment.id) {
      throw new Error('附件缺少 id');
    }
    const downloaded = typeof attachment.content === 'string' && attachment.content.length > 0;
    return {
      id: String(attachment.id),
      revision: Number(attachment.revision ?? 0),
      supersedes: attachment.supersedes != null ? String(attachment.supersedes) : null,
      downloaded,
      hash: downloaded ? sha256(attachment.content) : null,
      hours: downloaded ? normalizeHours(attachment.hours) : null,
    };
  });
}

function normalizeHours(value) {
  if (value == null) {
    return null;
  }
  const text = String(value).trim();
  return text === '' ? null : text;
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
