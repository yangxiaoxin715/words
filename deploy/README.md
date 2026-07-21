# 部署清单

## 获取服务器公网 IP

在阿里云控制台查看公网 IPv4：

- 轻量应用服务器：控制台搜索“轻量应用服务器” -> 进入实例列表 -> 点击实例名称 -> 查看“公网 IP”。
- ECS 云服务器：控制台搜索“云服务器 ECS” -> 实例与镜像 -> 实例 -> 找到对应实例 -> 查看“公网 IP 地址”或“弹性公网 IP”。

只需要公网 IPv4，格式类似：

```text
123.123.123.123
```

不要发送服务器登录密码。

当前服务器公网 IP：

```text
118.178.253.190
```

## 域名解析

已添加：

```text
A  @    118.178.253.190
A  www  118.178.253.190
```

公共 DNS 查询已确认：

```text
wordflash.cn      -> 118.178.253.190
www.wordflash.cn  -> 118.178.253.190
```

## 上传和安装

把项目上传到服务器：

```text
/opt/word-hunter-web
```

然后在服务器中执行：

```bash
cd /opt/word-hunter-web
sudo bash deploy/install-ubuntu.sh
```

脚本会完成：

- 安装 Python、Nginx 等依赖
- 创建生产数据库和音频目录
- 生成管理口令配置文件
- 创建 systemd 服务
- 创建 Nginx 站点配置
- 启动网站服务

## 服务器目录

建议：

```text
/opt/word-hunter-web
/data/word-hunter/word_hunter.db
/data/word-hunter/audio-library
/data/word-hunter/audio-cache
/etc/word-hunter/word-hunter.env
```

## 必改配置

复制 `.env.example` 到服务器：

```text
/etc/word-hunter/word-hunter.env
```

把 `WORD_HUNTER_ADMIN_KEY` 改成足够长的随机口令。

## 服务

复制：

```text
deploy/word-hunter.service.example
```

到：

```text
/etc/systemd/system/word-hunter.service
```

确认 `WorkingDirectory`、`ExecStart`、`User` 与服务器实际路径一致。

## Nginx

复制：

```text
deploy/nginx.conf.example
```

到 nginx 站点配置目录，把 `example.com` 换成正式域名。

## 上线前检查

```bash
python -m unittest discover -s tests
node --check public/app.js
curl http://127.0.0.1:8000/api/health
```

## 数据备份

至少备份：

```text
/data/word-hunter/word_hunter.db
/data/word-hunter/audio-library
```
