/**
 * Public legal pages (no Shopify auth — Partner Dashboard links point here).
 *
 * Content mirrors `goals/side-business-product-planning/files/justpo-terms-of-service.md`.
 * han fills the [bracket] placeholders once, redeploys, and pastes these URLs
 * into Partner Dashboard:  /privacy  and  /terms .
 */
import type { MetaFunction } from "@remix-run/cloudflare";

export const meta: MetaFunction = () => [
  { title: "Terms of Service · JustPO: Simple Purchase Orders" },
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

export default function TermsOfService() {
  return (
    <div style={pageStyle}>
      <h1 style={{ marginBottom: 4 }}>Terms of Service / 服务条款</h1>
      <p style={{ color: "#666" }}>
        <strong>JustPO: Simple Purchase Orders</strong> ·{" "}
        <a href="#en">English</a> · <a href="#zh">中文</a>
      </p>

      {/* ---------------- EN ---------------- */}
      <h2 id="en" style={{ marginTop: "2em" }}>EN</h2>
      <P><strong>Effective date:</strong> [YYYY-MM-DD]</P>
      <P>
        These Terms govern your use of <strong>JustPO: Simple Purchase Orders</strong> (&quot;JustPO&quot;,
        &quot;we&quot;), an embedded Shopify app. By installing JustPO, you agree to these Terms.
      </P>

      <H>1. The service</H>
      <P>
        JustPO provides simple purchase order management for Shopify merchants: create purchase orders, email
        them to suppliers (with PDF), receive goods by barcode scanning with automatic inventory writeback, and
        low-stock alerts. Interface available in English and 简体中文.
      </P>

      <H>2. Plans and billing</H>
      <ul>
        <Li><strong>Starter — $9/month</strong>: 1 store, 30 purchase orders per month, low-stock alerts.</Li>
        <Li><strong>Pro — $19/month</strong>: unlimited purchase orders, multiple stores, Stocky CSV import, priority support.</Li>
        <Li><strong>14-day free trial.</strong> All charges are billed through Shopify Billing; cancel anytime from your Shopify bill. We never handle your payment details directly.</Li>
        <Li><strong>Quota rule (Starter):</strong> only purchase orders in <code>sent</code> status or later count toward the monthly quota. Drafts don&apos;t count; cancelled or deleted POs don&apos;t refund quota.</Li>
        <Li>No free plan. Prices in USD.</Li>
      </ul>

      <H>3. Known limitations (P0)</H>
      <ul>
        <Li>Receiving writes back to a <strong>single stocked location</strong> (chosen deterministically per item). Multi-location allocation is not supported yet.</Li>
        <Li>Costs are recorded in your store&apos;s <strong>home currency</strong> only. Multi-currency conversion is not supported yet.</Li>
        <Li>JustPO intentionally does <strong>not</strong> offer demand forecasting, COGS/landed-cost writeback, multi-warehouse management, or AI features.</Li>
      </ul>

      <H>4. Acceptable use</H>
      <P>You agree to use JustPO only for lawful business purposes, not to abuse the email-sending feature (e.g., spam), and not to attempt to disrupt the service.</P>

      <H>5. Your data</H>
      <P>You retain ownership of your purchase order and supplier data. See our Privacy Policy for how data is stored, exported, and deleted on uninstall.</P>

      <H>6. Service availability</H>
      <P>We aim for reliable service but do not guarantee uninterrupted availability. Email delivery depends on third-party providers (Resend) and your suppliers&apos; mail servers; we cannot guarantee inbox placement.</P>

      <H>7. Limitation of liability</H>
      <P>To the maximum extent permitted by law, JustPO is provided &quot;as is&quot;. We are not liable for indirect or consequential damages, including but not limited to lost profits arising from inventory or ordering decisions made with the app.</P>

      <H>8. Termination</H>
      <P>You may stop using JustPO at any time by uninstalling it (your data is deleted per the Privacy Policy). We may suspend access for violations of these Terms.</P>

      <H>9. Changes</H>
      <P>We may update these Terms; material changes will be notified through the app. Continued use after the change constitutes acceptance.</P>

      <H>10. Governing law &amp; contact</H>
      <P>Governing law: [JURISDICTION]. Contact: [DEVELOPER NAME] · [SUPPORT_EMAIL]</P>

      {/* ---------------- ZH ---------------- */}
      <hr style={{ margin: "3em 0" }} />
      <h2 id="zh" style={{ marginTop: "2em" }}>中文</h2>
      <P><strong>生效日期：</strong>[YYYY-MM-DD]</P>
      <P>
        本条款管辖你对 <strong>JustPO: Simple Purchase Orders</strong>（&quot;JustPO&quot;、&quot;我们&quot;）这款嵌入式
        Shopify 应用的使用。安装 JustPO 即表示你同意本条款。
      </P>

      <H>1. 服务内容</H>
      <P>
        JustPO 为 Shopify 商家提供极简采购单管理：创建采购单、一键邮件发给供应商（带 PDF）、扫码收货自动回写库存、低库存提醒。界面支持英文与简体中文。
      </P>

      <H>2. 套餐与计费</H>
      <ul>
        <Li><strong>Starter — $9/月</strong>：1 个店铺，每月 30 张采购单，低库存提醒。</Li>
        <Li><strong>Pro — $19/月</strong>：采购单不限量，多店铺，Stocky CSV 导入，优先支持。</Li>
        <Li><strong>14 天免费试用。</strong>所有费用经 Shopify Billing 收取，可随时在 Shopify 账单中取消。我们不直接经手你的支付信息。</Li>
        <Li><strong>额度规则（Starter）：</strong>只有状态为&quot;已发送&quot;及之后的采购单计入月额度；草稿不计；取消/删除的 PO 不返还额度。</Li>
        <Li>无免费档。价格为美元。</Li>
      </ul>

      <H>3. 已知限制（当前版本）</H>
      <ul>
        <Li>收货仅回写到<strong>单个有货仓库</strong>（按商品确定性地选定），暂不支持多仓库分配。</Li>
        <Li>成本仅按店铺<strong>本位币</strong>记录，暂不支持多币种换算。</Li>
        <Li>JustPO 有意<strong>不做</strong>需求预测、COGS/到岸成本回写、多仓库管理及任何 AI 功能。</Li>
      </ul>

      <H>4. 可接受使用</H>
      <P>你同意仅将 JustPO 用于合法商业用途，不滥用邮件发送功能（如垃圾邮件），不尝试破坏服务。</P>

      <H>5. 你的数据</H>
      <P>你的采购单与供应商数据的所有权归你。数据的存储、导出与卸载删除见《隐私政策》。</P>

      <H>6. 服务可用性</H>
      <P>我们尽力保障服务稳定，但不保证不间断可用。邮件投递依赖第三方服务商（Resend）及供应商邮箱服务器，我们不保证邮件必达收件箱。</P>

      <H>7. 责任限制</H>
      <P>在法律允许的最大范围内，JustPO 按&quot;现状&quot;提供。对于因使用本应用做出的库存或采购决策导致的间接损失（包括利润损失），我们不承担责任。</P>

      <H>8. 终止</H>
      <P>你可随时卸载 JustPO 停止使用（数据按《隐私政策》删除）。违反本条款时我们可暂停你的访问权限。</P>

      <H>9. 条款变更</H>
      <P>我们可能更新本条款；重大变更会通过 App 内通知。变更后继续使用即视为接受。</P>

      <H>10. 管辖法律与联系方式</H>
      <P>管辖法律：[管辖地]。联系方式：[开发者名称] · [支持邮箱]</P>
    </div>
  );
}
