# Resend 本地接入

验证日期：2026-09-11。

## 当前配置

- 发件人：`知棱 ZhiPrism <zhiprism@slate.space>`。
- Resend 域名 `slate.space` 已验证并允许发送邮件。
- 使用独立的 `ZhiPrism local` API key，权限为 Sending access，限定 `slate.space`。
- `RESEND_API_KEY` 与 `EMAIL_FROM` 已写入 `.env.local`。密钥不写入文档或版本控制；本地文件权限为 `0600`。
- 现有 `lib/auth/email.ts` 使用 Resend SDK；`POST /api/auth/email/send` 调用该发送函数，无需新增发信接口。

## 验证结果

- `/login` 返回 200。本地（非 `APP_PUBLIC_MODE`）仍会尝试通过 Resend 发信，但验证码同时随响应返回并自动填入页面，发信失败只记录警告；生产环境不返回验证码。
- 通过实际验证码接口发送至 `delivered+zhiprism-20260911@resend.dev`，返回 `200`、`ok: true`、有效期 600 秒，并设置绑定浏览器的 HttpOnly Cookie。
- Resend 控制台记录的发信状态为 `Delivered`，邮件 ID：`7704b2eb-6fe6-4dae-95db-19d4daaefb02`。
- 这是 [Resend 官方测试地址](https://resend.com/docs/dashboard/emails/send-test-emails) 的模拟投递验证，不代表已验证真实 Gmail 收件箱的到达情况。本次没有向真实用户邮箱发送测试邮件。

## 部署与维护

本次完成的是本地环境接入。部署时需在服务端配置 `RESEND_API_KEY` 和 `EMAIL_FROM`；不要将密钥放入 `NEXT_PUBLIC_*` 变量。

更换发件域名时，先在 Resend 验证域名，并调整对应密钥的域名权限。轮换密钥时，先更新环境变量并验证新密钥，再撤销旧密钥。
