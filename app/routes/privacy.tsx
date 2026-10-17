/**
 * Public legal pages (no Shopify auth — Partner Dashboard links point here).
 *
 * Content mirrors `goals/side-business-product-planning/files/justpo-privacy-policy.md`.
 * han fills the [bracket] placeholders once, redeploys, and pastes these URLs
 * into Partner Dashboard:  /privacy  and  /terms .
 */
import type { MetaFunction } from "@remix-run/cloudflare";

export const meta: MetaFunction = () => [
  { title: "Privacy Policy · JustPO: Simple Purchase Orders" },
];

function H({ children }: { children: React.ReactNode }) {
  return <h3 style={{ margin: "1.5em 0 0.5em" }}>{children}</h3>;
}

function P({ children }: { children: React.ReactNode }) {
  return <p style={{ margin: "0.5em 0", lineHeight: 1.7 }}>{children}</p>;
}

function Li({ children }: { children: React.ReactNode }) {
  return <li style={{ margin: "0.35em 0", lineHeight: 1.7 }}>{children}</li>;
}

const pageStyle: React.CSSProperties = {
  maxWidth: 780,
  margin: "0 auto",
  padding: "40px 24px 64px",
  fontFamily: "system-ui, -apple-system, sans-serif",
  color: "#1a1a1a",
};

export default function PrivacyPolicy() {
  return (
    <div style={pageStyle}>
      <h1 style={{ marginBottom: 4 }}>Privacy Policy / 隐私政策</h1>
      <p style={{ color: "#666" }}>
        <strong>JustPO: Simple Purchase Orders</strong> ·{" "}
        <a href="#en">English</a> · <a href="#zh">中文</a>
      </p>

      {/* ---------------- EN ---------------- */}
      <h2 id="en" style={{ marginTop: "2em" }}>EN</h2>
      <P><strong>Effective date:</strong> [YYYY-MM-DD]</P>
      <P>
        <strong>JustPO: Simple Purchase Orders</strong> (&quot;JustPO&quot;, &quot;we&quot;) is an embedded
        Shopify app that helps merchants create purchase orders, email them to suppliers, and receive goods
        by barcode scanning.
      </P>

      <H>1. What we collect</H>
      <P>When you install JustPO on your Shopify store, we receive and store:</P>
      <ul>
        <Li><strong>Shop information</strong>: shop domain, shop email, store timezone, home currency, locale — provided by Shopify during installation.</Li>
        <Li><strong>Purchase order data you create in the app</strong>: suppliers (name, contact person, email, phone, currency note), purchase orders and line items (SKUs, quantities, costs in your store&apos;s home currency), receiving records, and low-stock thresholds you set.</Li>
        <Li><strong>Billing status</strong>: your current plan (Starter/Pro) and trial state, provided by Shopify Billing. We never see or store your payment card details — all charges go through Shopify.</Li>
      </ul>

      <H>2. What we do NOT collect</H>
      <ul>
        <Li>We do <strong>not</strong> access your orders or your customers&apos; personal data. JustPO requests only the minimum API scopes it needs: <code>read_products</code>, <code>read_inventory</code>, <code>write_inventory</code>, <code>read_locations</code>.</Li>
        <Li>We do not sell, rent, or share your data with third parties for marketing.</Li>
      </ul>

      <H>3. How we use your data</H>
      <ul>
        <Li>To run the app&apos;s core functions: creating POs, emailing PDF purchase orders to your suppliers, writing received quantities back to your primary location&apos;s inventory, and sending low-stock alerts.</Li>
        <Li>Supplier emails you enter are used solely to deliver the purchase orders you send.</Li>
      </ul>

      <H>4. Service providers</H>
      <ul>
        <Li><strong>Cloudflare</strong> (Workers, D1 database, R2 storage): hosts the app and stores your PO data.</Li>
        <Li><strong>Resend</strong>: delivers the PO emails you send to suppliers.</Li>
        <Li><strong>Shopify</strong>: app platform, authentication, and billing.</Li>
      </ul>

      <H>5. Data retention and deletion</H>
      <ul>
        <Li><strong>Uninstall = delete.</strong> When you uninstall JustPO, we delete your store&apos;s data from our systems (handled via Shopify&apos;s <code>app/uninstalled</code> webhook). We do not keep a &quot;grace period&quot; copy.</Li>
        <Li>Before uninstalling, you can export your PO and supplier data from inside the app (one-click export).</Li>
      </ul>

      <H>6. Your rights (GDPR / privacy laws)</H>
      <P>
        You may request access to, correction of, or deletion of your data at any time by emailing{" "}
        [SUPPORT_EMAIL]. We respond to Shopify&apos;s mandatory privacy webhooks{" "}
        (<code>customers/data_request</code>, <code>customers/redact</code>, <code>shop/redact</code>).
      </P>

      <H>7. Security</H>
      <P>Data is transmitted over HTTPS. Access to production data is limited to the developer for support and maintenance.</P>

      <H>8. Changes</H>
      <P>If we change this policy, we will update the effective date above and, for material changes, notify installed merchants through the app.</P>

      <H>9. Contact</H>
      <P>[DEVELOPER NAME] · [SUPPORT_EMAIL]</P>

      {/* ---------------- ZH ---------------- */}
      <hr style={{ margin: "3em 0" }} />
      <h2 id="zh" style={{ marginTop: "2em" }}>中文</h2>
      <P><strong>生效日期：</strong>[YYYY-MM-DD]</P>
      <P>
        <strong>JustPO: Simple Purchase Orders</strong>（&quot;JustPO&quot;、&quot;我们&quot;）是一款嵌入式 Shopify
        应用，帮助商家创建采购单、一键邮件发给供应商、扫码收货回写库存。
      </P>

      <H>1. 我们收集什么</H>
      <P>安装 JustPO 后，我们会接收并存储：</P>
      <ul>
        <Li><strong>店铺信息</strong>：店铺域名、店铺邮箱、店铺时区、本位币、语言——由 Shopify 在安装时提供。</Li>
        <Li><strong>你在 App 内创建的采购数据</strong>：供应商（名称、联系人、邮箱、电话、币种备注）、采购单及行项目（SKU、数量、以店铺本位币计的成本）、收货记录、你设置的低库存阈值。</Li>
        <Li><strong>计费状态</strong>：当前套餐（Starter/Pro）与试用状态，由 Shopify Billing 提供。我们看不到也不存储你的银行卡信息——所有扣费都走 Shopify。</Li>
      </ul>

      <H>2. 我们不收集什么</H>
      <ul>
        <Li><strong>不碰订单、不碰客户个人数据。</strong>JustPO 只申请完成其功能所需的最小 API 权限：<code>read_products</code>、<code>read_inventory</code>、<code>write_inventory</code>、<code>read_locations</code>。</Li>
        <Li>不会出售、出租你的数据，也不会为营销目的分享给第三方。</Li>
      </ul>

      <H>3. 数据用来做什么</H>
      <ul>
        <Li>运行 App 核心功能：建 PO、把带 PDF 的采购单邮件发给你的供应商、把收货数量回写到主仓库存、发送低库存提醒。</Li>
        <Li>你填写的供应商邮箱仅用于投递你主动发送的采购单。</Li>
      </ul>

      <H>4. 服务提供方</H>
      <ul>
        <Li><strong>Cloudflare</strong>（Workers、D1 数据库、R2 存储）：托管应用并存储你的采购数据。</Li>
        <Li><strong>Resend</strong>：投递你发给供应商的 PO 邮件。</Li>
        <Li><strong>Shopify</strong>：应用平台、身份验证与计费。</Li>
      </ul>

      <H>5. 数据保留与删除</H>
      <ul>
        <Li><strong>卸载即删除。</strong>卸载 JustPO 后，我们会删除你店铺在我们系统中的数据（经 Shopify 的 <code>app/uninstalled</code> webhook 处理），不设&quot;保留期&quot;。</Li>
        <Li>卸载前可在 App 内一键导出你的采购单与供应商数据做备份。</Li>
      </ul>

      <H>6. 你的权利（GDPR / 隐私法规）</H>
      <P>
        你可随时发邮件到 [支持邮箱] 要求查看、更正或删除你的数据。我们会响应 Shopify 强制隐私 webhook
        （<code>customers/data_request</code>、<code>customers/redact</code>、<code>shop/redact</code>）。
      </P>

      <H>7. 安全</H>
      <P>数据全程经 HTTPS 传输。生产数据的访问仅限开发者本人，用于支持与维护。</P>

      <H>8. 政策变更</H>
      <P>本政策变更时我们会更新上方生效日期；重大变更会通过 App 内通知已安装商家。</P>

      <H>9. 联系我们</H>
      <P>[开发者名称] · [支持邮箱]</P>
    </div>
  );
}
