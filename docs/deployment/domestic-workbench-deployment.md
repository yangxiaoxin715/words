# 2000词交付工作台国内部署说明

更新时间：2026-07-04

## 定位

这个站点定位为私有学员交付记录工具，不是公开注册平台，也不是社交社区。

适合前期部署方式：

- 国内云服务器 ECS。
- Node.js + SQLite 单机部署。
- 个人备案先跑小规模交付。
- 访问码发给已报名学员和老师，不开放自助注册。

## 数据边界

系统记录学习交付数据：

- 学习画像。
- 闪卡练习结果。
- 7 天打卡清单。
- 查词查句记录。
- 剧情猜想。
- 老师笔记。
- 下一集草稿。

系统不主动采集：

- 身份证号。
- 人脸信息。
- 精确定位。
- 家庭住址。
- 公开社交关系。

## 备案和合规注意

前期个人备案时，页面表达应保持为学习交付工具，不写成开放平台、社区、课程交易市场或 AI 内容发布平台。

建议：

- 首页只保留授权学员入口和学习数据说明。
- 不开放注册。
- 不开放评论、动态、广场等 UGC 功能。
- 不在站内做公开售卖和支付闭环。
- AI 生成内容只在老师后台作为草稿，人工审核后再交付。

后期如果注册公司，可以再切换为公司备案，并补齐正式服务协议、隐私政策、数据删除流程和运营主体信息。

## 环境变量

生产环境至少设置：

```bash
PORT=5057
WORKBENCH_DB=/data/word-hunter-workbench/workbench.sqlite
WORKBENCH_COOKIE_SECRET=replace-with-a-long-random-secret
```

注意：`WORKBENCH_COOKIE_SECRET` 不能使用默认值。更换后，旧登录态会失效。

## 启动流程

```bash
cd workbench
npm install --omit=dev
node src/seed.js
npm run dev
```

生产环境建议用 `systemd` 或进程管理工具守护 Node 进程，并用 Nginx 反向代理 HTTPS 域名。

## 数据备份

SQLite 数据库是当前阶段的学习数据真源。至少每天备份：

- `workbench.sqlite`
- `workbench.sqlite-wal`
- `workbench.sqlite-shm`

备份前可以短暂停止服务，或者使用 SQLite 在线备份命令。不要只备份代码仓库。

## 后续升级

当学员规模变大后，再考虑：

- SQLite 迁移到 MySQL/PostgreSQL。
- 访问码改为一次性邀请链接或手机号登录。
- 管理员权限分级。
- AI provider 从 mock adapter 切换为真实服务端 API。
- 操作日志和数据导出。
