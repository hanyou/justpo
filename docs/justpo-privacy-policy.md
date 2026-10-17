# JustPO · 隐私政策 / Privacy Policy（草稿）

> 状态：草稿，待 han 定稿。依据 PRD §9（合规红线）与 dev-kickoff 数据实践：scopes 仅 `read_products` / `read_inventory` / `write_inventory` / `read_locations`（不读订单、不读客户数据）；卸载默认删数据、卸载前一键导出；GDPR 三 webhook 真实现；邮件经 Resend 发送；计费走 Shopify Billing。
> 生效日期、开发者名称、支持邮箱三处为占位符，定稿时替换。**这不是法律意见**，标准模板+按实际数据实践填写；如后续数据实践变化（例如新增 scope），须同步更新本政策。
> 托管建议：放到你自己的域名/Workers 站点一个公开路径（如 `https://justpo.example.com/privacy`），把 URL 填进 Partner Dashboard。

---

## EN

**Effective date:** [YYYY-MM-DD]

**JustPO: Simple Purchase Orders** ("JustPO", "we") is an embedded Shopify app that helps merchants create purchase orders, email them to suppliers, and receive goods by barcode scanning.

### 1. What we collect

When you install JustPO on your Shopify store, we receive and store:

- **Shop information**: shop domain, shop email, store timezone, home currency, locale — provided by Shopify during installation.
- **Purchase order data you create in the app**: suppliers (name, contact person, email, phone, currency note), purchase orders and line items (SKUs, quantities, costs in your store's home currency), receiving records, and low-stock thresholds you set.
- **Billing status**: your current plan (Starter/Pro) and trial state, provided by Shopify Billing. We never see or store your payment card details — all charges go through Shopify.

### 2. What we do NOT collect

- We do **not** access your orders or your customers' personal data. JustPO requests only the minimum API scopes it needs: `read_products`, `read_inventory`, `write_inventory`, `read_locations`.
- We do not sell, rent, or share your data with third parties for marketing.

### 3. How we use your data

- To run the app's core functions: creating POs, emailing PDF purchase orders to your suppliers, writing received quantities back to your primary location's inventory, and sending low-stock alerts.
- Supplier emails you enter are used solely to deliver the purchase orders you send.

### 4. Service providers

- **Cloudflare** (Workers, D1 database, R2 storage): hosts the app and stores your PO data.
- **Resend**: delivers the PO emails you send to suppliers.
- **Shopify**: app platform, authentication, and billing.

### 5. Data retention and deletion

- **Uninstall = delete.** When you uninstall JustPO, we delete your store's data from our systems (handled via Shopify's `app/uninstalled` webhook). We do not keep a "grace period" copy.
- Before uninstalling, you can export your PO and supplier data from inside the app (one-click export).

### 6. Your rights (GDPR / privacy laws)

You may request access to, correction of, or deletion of your data at any time by emailing [SUPPORT_EMAIL]. We respond to Shopify's mandatory privacy webhooks (`customers/data_request`, `customers/redact`, `shop/redact`).

### 7. Security

Data is transmitted over HTTPS. Access to production data is limited to the developer for support and maintenance.

### 8. Changes

If we change this policy, we will update the effective date above and, for material changes, notify installed merchants through the app.

### 9. Contact

[DEVELOPER NAME] · [SUPPORT_EMAIL]

---

## 中文

**生效日期：**[YYYY-MM-DD]

**JustPO: Simple Purchase Orders**（"JustPO"、"我们"）是一款嵌入式 Shopify 应用，帮助商家创建采购单、一键邮件发给供应商、扫码收货回写库存。

### 1. 我们收集什么

安装 JustPO 后，我们会接收并存储：

- **店铺信息**：店铺域名、店铺邮箱、店铺时区、本位币、语言——由 Shopify 在安装时提供。
- **你在 App 内创建的采购数据**：供应商（名称、联系人、邮箱、电话、币种备注）、采购单及行项目（SKU、数量、以店铺本位币计的成本）、收货记录、你设置的低库存阈值。
- **计费状态**：当前套餐（Starter/Pro）与试用状态，由 Shopify Billing 提供。我们看不到也不存储你的银行卡信息——所有扣费都走 Shopify。

### 2. 我们不收集什么

- **不碰订单、不碰客户个人数据。** JustPO 只申请完成其功能所需的最小 API 权限：`read_products`、`read_inventory`、`write_inventory`、`read_locations`。
- 不会出售、出租你的数据，也不会为营销目的分享给第三方。

### 3. 数据用来做什么

- 运行 App 核心功能：建 PO、把带 PDF 的采购单邮件发给你的供应商、把收货数量回写到主仓库存、发送低库存提醒。
- 你填写的供应商邮箱仅用于投递你主动发送的采购单。

### 4. 服务提供方

- **Cloudflare**（Workers、D1 数据库、R2 存储）：托管应用并存储你的采购数据。
- **Resend**：投递你发给供应商的 PO 邮件。
- **Shopify**：应用平台、身份验证与计费。

### 5. 数据保留与删除

- **卸载即删除。** 卸载 JustPO 后，我们会删除你店铺在我们系统中的数据（经 Shopify 的 `app/uninstalled` webhook 处理），不设"保留期"。
- 卸载前可在 App 内一键导出你的采购单与供应商数据做备份。

### 6. 你的权利（GDPR / 隐私法规）

你可随时发邮件到 [SUPPORT_EMAIL] 要求查看、更正或删除你的数据。我们会响应 Shopify 强制隐私 webhook（`customers/data_request`、`customers/redact`、`shop/redact`）。

### 7. 安全

数据全程经 HTTPS 传输。生产数据的访问仅限开发者本人，用于支持与维护。

### 8. 政策变更

本政策变更时我们会更新上方生效日期；重大变更会通过 App 内通知已安装商家。

### 9. 联系我们

[开发者名称] · [支持邮箱]
