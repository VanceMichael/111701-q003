import test from 'node:test';
import assert from 'node:assert/strict';
import { collect } from '../src/pipeline.mjs';
import { RecordStore } from '../src/store.mjs';

const PAGE_BASE = { source: 'local', observedAt: '2026-11-18T08:00:00.000Z' };

function sourceWith(item) {
  return async () => ({ ...PAGE_BASE, items: [item] });
}

test('公告与附件时间一致时开放时间被确认', async () => {
  const { records } = await collect({
    source: sourceWith({
      id: 'a',
      label: '游泳馆开放公告',
      state: 'active',
      revision: 1,
      hours: '周一至周五 09:00-17:00',
      attachments: [
        { id: 'att-1', revision: 1, content: '附件：周一至周五 09:00-17:00', hours: '周一至周五 09:00-17:00' },
      ],
    }),
  });
  assert.equal(records[0].schedule.status, 'confirmed');
  assert.equal(records[0].schedule.hours, '周一至周五 09:00-17:00');
  assert.deepEqual(records[0].schedule.issues, []);
});

test('附件声明更正公告正文时以附件时间为准并记录更正关系', async () => {
  const { records } = await collect({
    source: sourceWith({
      id: 'a',
      label: '游泳馆开放公告',
      state: 'active',
      revision: 1,
      hours: '周一至周五 09:00-17:00',
      attachments: [
        { id: 'att-1', revision: 1, supersedes: 'announcement', content: '更正附件', hours: '周一至周五 10:00-18:00' },
      ],
    }),
  });
  assert.equal(records[0].schedule.status, 'confirmed');
  assert.equal(records[0].schedule.hours, '周一至周五 10:00-18:00');
  assert.equal(records[0].schedule.decidedBy, 'attachment');
  assert.deepEqual(records[0].schedule.corrections, [
    { attachmentId: 'att-1', supersedes: 'announcement', revision: 1 },
  ]);
});

test('附件之间的更正链以未被取代的最新附件为准', async () => {
  const { records } = await collect({
    source: sourceWith({
      id: 'a',
      label: '游泳馆开放公告',
      state: 'active',
      revision: 2,
      hours: '周一至周五 09:00-17:00',
      attachments: [
        { id: 'att-1', revision: 1, content: '旧附件', hours: '周一至周五 09:00-18:00' },
        { id: 'att-2', revision: 2, supersedes: 'att-1', content: '更正附件', hours: '周一至周五 09:00-17:00' },
      ],
    }),
  });
  assert.equal(records[0].schedule.status, 'confirmed');
  assert.equal(records[0].schedule.hours, '周一至周五 09:00-17:00');
  assert.deepEqual(records[0].schedule.corrections, [
    { attachmentId: 'att-2', supersedes: 'att-1', revision: 2 },
  ]);
});

test('公告与附件时间互相矛盾时标为尚待核实且不展示任何时间', async () => {
  const { records } = await collect({
    source: sourceWith({
      id: 'a',
      label: '游泳馆开放公告',
      state: 'active',
      revision: 1,
      hours: '周一至周五 09:00-17:00',
      attachments: [
        { id: 'att-1', revision: 1, content: '附件：周六日 10:00-16:00', hours: '周六日 10:00-16:00' },
      ],
    }),
  });
  assert.equal(records[0].schedule.status, 'pending-verification');
  assert.equal(records[0].schedule.hours, null);
  assert.ok(records[0].schedule.issues.includes('channel-mismatch'));
  assert.equal(records[0].announcedHours, undefined);
  assert.equal(records[0].attachments[0].hours, undefined);
});

test('附件下载失败时标为尚待核实，已确认的旧时间不再继续展示', async () => {
  const store = new RecordStore();
  const item = {
    id: 'a',
    label: '游泳馆开放公告',
    state: 'active',
    revision: 1,
    hours: '周一至周五 09:00-17:00',
    attachments: [
      { id: 'att-1', revision: 1, content: '附件：周一至周五 09:00-17:00', hours: '周一至周五 09:00-17:00' },
    ],
  };
  const first = await collect({ source: sourceWith(item), store });
  assert.equal(first.records[0].schedule.status, 'confirmed');

  const second = await collect({
    source: sourceWith({ ...item, attachments: [{ id: 'att-1', revision: 1, content: null }] }),
    store,
  });
  assert.equal(second.records[0].schedule.status, 'pending-verification');
  assert.equal(second.records[0].schedule.hours, null);
  assert.ok(second.records[0].schedule.issues.includes('attachment-download-failed'));
  assert.equal(store.list()[0].schedule.hours, null);
});

test('公告标题未变但附件内容被运营方替换时标为尚待核实', async () => {
  const store = new RecordStore();
  const makeItem = (content, hours) => ({
    id: 'a',
    label: '游泳馆开放公告',
    state: 'active',
    revision: 1,
    hours: '周一至周五 09:00-17:00',
    attachments: [{ id: 'att-1', revision: 1, content, hours }],
  });
  const first = await collect({ source: sourceWith(makeItem('原始附件', '周一至周五 09:00-17:00')), store });
  assert.equal(first.records[0].schedule.status, 'confirmed');

  const second = await collect({ source: sourceWith(makeItem('被运营方替换的附件', '周六 10:00-12:00')), store });
  assert.equal(second.records[0].schedule.status, 'pending-verification');
  assert.equal(second.records[0].schedule.hours, null);
  assert.ok(second.records[0].schedule.issues.includes('attachment-content-replaced'));
});

test('公告修订号未变但公告时间被改动时标为尚待核实', async () => {
  const store = new RecordStore();
  const makeItem = (hours) => ({
    id: 'a',
    label: '游泳馆开放公告',
    state: 'active',
    revision: 1,
    hours,
  });
  const first = await collect({ source: sourceWith(makeItem('周一至周五 09:00-17:00')), store });
  assert.equal(first.records[0].schedule.status, 'confirmed');

  const second = await collect({ source: sourceWith(makeItem('每天 08:00-20:00')), store });
  assert.equal(second.records[0].schedule.status, 'pending-verification');
  assert.equal(second.records[0].schedule.hours, null);
  assert.ok(second.records[0].schedule.issues.includes('announcement-hours-replaced'));
});

test('提升修订号并声明更正关系的附件替换被接受', async () => {
  const store = new RecordStore();
  const first = await collect({
    source: sourceWith({
      id: 'a',
      label: '游泳馆开放公告',
      state: 'active',
      revision: 1,
      hours: '周一至周五 09:00-17:00',
      attachments: [{ id: 'att-1', revision: 1, content: '原始附件', hours: '周一至周五 09:00-17:00' }],
    }),
    store,
  });
  assert.equal(first.records[0].schedule.status, 'confirmed');

  const second = await collect({
    source: sourceWith({
      id: 'a',
      label: '游泳馆开放公告',
      state: 'active',
      revision: 2,
      hours: '周一至周五 10:00-18:00',
      attachments: [
        { id: 'att-2', revision: 2, supersedes: 'att-1', content: '更正附件', hours: '周一至周五 10:00-18:00' },
      ],
    }),
    store,
  });
  assert.equal(second.records[0].schedule.status, 'confirmed');
  assert.equal(second.records[0].schedule.hours, '周一至周五 10:00-18:00');
  assert.deepEqual(second.records[0].schedule.corrections, [
    { attachmentId: 'att-2', supersedes: 'att-1', revision: 2 },
  ]);
});

test('同一附件提升修订号并声明更正旧修订时被接受', async () => {
  const store = new RecordStore();
  const makeItem = (revision, content, hours) => ({
    id: 'a',
    label: '游泳馆开放公告',
    state: 'active',
    revision,
    hours,
    attachments: [
      revision === 1
        ? { id: 'att-1', revision: 1, content, hours }
        : { id: 'att-1', revision, supersedes: 'att-1', content, hours },
    ],
  });
  await collect({ source: sourceWith(makeItem(1, '原始附件', '周一至周五 09:00-17:00')), store });
  const second = await collect({ source: sourceWith(makeItem(2, '修订后的附件', '周一至周五 10:00-18:00')), store });
  assert.equal(second.records[0].schedule.status, 'confirmed');
  assert.equal(second.records[0].schedule.hours, '周一至周五 10:00-18:00');
});

test('没有任何渠道提供开放时间时标为尚待核实', async () => {
  const { records } = await collect({
    source: sourceWith({ id: 'a', label: '游泳馆开放公告', state: 'pending', revision: 1 }),
  });
  assert.equal(records[0].schedule.status, 'pending-verification');
  assert.equal(records[0].schedule.hours, null);
  assert.deepEqual(records[0].schedule.issues, ['schedule-unavailable']);
});
