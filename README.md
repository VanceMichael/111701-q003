# 社区设施开放公告采集服务

这是一个用于社区设施开放公告的本地数据采集与归档服务。当前版本从仓库自带的合成来源记录读取一页数据，经过字段规整与开放时间核对后写入进程内目录；来源内容和规整后的记录保留独立边界，便于在不访问外部系统的情况下复现采集过程。

## 运行

需要 Node.js 20 或更高版本，不需要安装第三方依赖。

```sh
npm test
npm run build
node src/pipeline.mjs
```

测试使用项目内的合成记录；执行不需要网络、凭据或外部服务。

## 公告与附件的更正关系

来源记录可以携带 `hours`（公告网页上展示的开放时间）和 `attachments`（附件列表）。附件字段：

- `id`：附件标识；
- `revision`：附件修订号；
- `supersedes`：可选，声明本附件更正的对象——另一个附件的 `id`、`"announcement"`（表示更正公告正文里的开放时间），或指向自身 `id` 表示更正同一附件的旧修订；
- `content`：下载到的附件正文，用于计算内容散列；下载失败时为 `null`；
- `hours`：附件中给出的开放时间。

每条记录的 `schedule.corrections` 会列出附件声明的更正关系，公告和附件之间的更正链条可以据此对外体现。

## 开放时间核实规则

管线会把公告与附件两个渠道核对后才生成 `schedule`：

- 仅当 `schedule.status` 为 `confirmed`（已确认）时，`schedule.hours` 才是可向居民展示的开放时间；
- 出现以下任一情况时，状态为 `pending-verification`（尚待核实），`schedule.hours` 一律为 `null`，未经确认的开放安排不会留在公开记录里继续展示：
  - `attachment-download-failed`：附件下载失败；
  - `attachment-content-replaced`：公告标题未变，同一附件的内容却被替换，且未声明更正关系；
  - `announcement-hours-replaced`：公告修订号未变，但公告里的开放时间被改动；
  - `channel-mismatch`：公告与附件给出的开放时间互相矛盾，且附件未声明更正公告；
  - `schedule-unavailable`：没有任何渠道给出开放时间。
- 附件被正确更正（提升修订号并声明 `supersedes`）时，以未被取代的最新附件为准，不算冲突。
