export const SCHEDULE_STATUS = {
  CONFIRMED: 'confirmed',
  PENDING: 'pending-verification',
};

export const SCHEDULE_STATUS_LABELS = {
  [SCHEDULE_STATUS.CONFIRMED]: '已确认',
  [SCHEDULE_STATUS.PENDING]: '尚待核实',
};

export const SCHEDULE_ISSUE_LABELS = {
  'attachment-download-failed': '附件下载失败',
  'attachment-content-replaced': '附件内容被替换且未声明更正关系',
  'announcement-hours-replaced': '公告修订号未变但开放时间被改动',
  'channel-mismatch': '公告与附件的开放时间不一致',
  'schedule-unavailable': '暂无可用开放时间',
};

// 附件 supersedes 取该值时，表示这份附件更正的是公告正文里的开放时间。
const ANNOUNCEMENT_TARGET = 'announcement';

/**
 * 把新采集的公告记录与上一次保存的记录核对，产出可对外展示的记录。
 * 只有核对通过的记录才携带 schedule.hours；一旦下载失败或新旧内容打架，
 * 状态标为 pending-verification（尚待核实），hours 一律置空，
 * 未经确认的开放安排不会留在公开记录里。
 */
export function reconcileRecord(previous, record) {
  const issues = [];
  const attachments = record.attachments ?? [];

  if (attachments.some((attachment) => !attachment.downloaded)) {
    issues.push('attachment-download-failed');
  }

  // 同一附件的内容与上次不一致：只有提升修订号并声明 supersedes 才算已声明的更正，
  // 否则视为运营方静默替换，新旧内容打架。
  const previousById = new Map((previous?.attachments ?? []).map((attachment) => [attachment.id, attachment]));
  for (const attachment of attachments) {
    if (!attachment.downloaded) {
      continue;
    }
    const before = previousById.get(attachment.id);
    if (!before?.hash || before.hash === attachment.hash) {
      continue;
    }
    const documentedCorrection = attachment.revision > before.revision && attachment.supersedes !== null;
    if (!documentedCorrection) {
      issues.push('attachment-content-replaced');
    }
  }

  // 公告自身的开放时间：修订号没有提升却被改动，同样属于未经声明的替换。
  if (
    previous?.announcedHoursHash != null
    && record.announcedHoursHash != null
    && previous.announcedHoursHash !== record.announcedHoursHash
    && record.revision <= previous.revision
  ) {
    issues.push('announcement-hours-replaced');
  }

  const corrections = attachments
    .filter((attachment) => attachment.supersedes !== null)
    .map((attachment) => ({
      attachmentId: attachment.id,
      supersedes: attachment.supersedes,
      revision: attachment.revision,
    }));

  const authoritative = pickAuthoritativeAttachment(attachments);

  let hours = null;
  let decidedBy = null;
  if (authoritative?.hours != null) {
    if (record.announcedHours === null || authoritative.hours === record.announcedHours) {
      hours = authoritative.hours;
      decidedBy = record.announcedHours === null ? 'attachment' : 'announcement+attachment';
    } else if (authoritative.supersedes === ANNOUNCEMENT_TARGET) {
      // 附件明确声明更正公告正文，以附件为准。
      hours = authoritative.hours;
      decidedBy = 'attachment';
    } else {
      issues.push('channel-mismatch');
    }
  } else if (record.announcedHours !== null) {
    hours = record.announcedHours;
    decidedBy = 'announcement';
  }

  if (issues.length > 0) {
    hours = null;
    decidedBy = null;
  } else if (hours === null) {
    issues.push('schedule-unavailable');
  }

  return {
    source: record.source,
    id: record.id,
    name: record.name,
    state: record.state,
    revision: record.revision,
    observedAt: record.observedAt,
    announcedHoursHash: record.announcedHoursHash,
    attachments: attachments.map((attachment) => ({
      id: attachment.id,
      revision: attachment.revision,
      supersedes: attachment.supersedes,
      downloaded: attachment.downloaded,
      hash: attachment.hash,
    })),
    schedule: {
      status: issues.length > 0 ? SCHEDULE_STATUS.PENDING : SCHEDULE_STATUS.CONFIRMED,
      hours,
      decidedBy,
      corrections,
      issues: [...new Set(issues)],
    },
  };
}

// 权威附件：已下载、且未被同批其他附件声明取代的附件中，修订号最高的一份。
function pickAuthoritativeAttachment(attachments) {
  const supersededIds = new Set(
    attachments
      .filter((attachment) => (
        attachment.supersedes !== null
        && attachment.supersedes !== ANNOUNCEMENT_TARGET
        && attachment.supersedes !== attachment.id
      ))
      .map((attachment) => attachment.supersedes),
  );
  const contenders = attachments.filter(
    (attachment) => attachment.downloaded && !supersededIds.has(attachment.id),
  );
  if (contenders.length === 0) {
    return null;
  }
  return contenders.reduce((best, current) => (current.revision > best.revision ? current : best));
}
