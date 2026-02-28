import React from 'react';

const PrivacyPolicy = () => {
  return (
    <div style={{
      maxWidth: '800px',
      margin: '0 auto',
      padding: '40px 20px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      color: '#e0e0e0',
      backgroundColor: '#0a0a0a',
      minHeight: '100vh',
      lineHeight: '1.8'
    }}>
      <h1 style={{ fontSize: '2rem', marginBottom: '10px', color: '#ffffff' }}>
        プライバシーポリシー
      </h1>
      <p style={{ color: '#888', marginBottom: '30px' }}>最終更新日: 2026年2月28日</p>

      <section style={{ marginBottom: '30px' }}>
        <h2 style={{ fontSize: '1.4rem', color: '#ffffff', marginBottom: '10px' }}>1. はじめに</h2>
        <p>
          AitherHub（以下「当社」）は、AitherHub LIVE Connector Chrome拡張機能（以下「本拡張機能」）および
          AitherHubウェブサービス（以下「本サービス」）をご利用いただくにあたり、
          お客様のプライバシーを尊重し、個人情報の保護に努めます。
          本プライバシーポリシーは、当社がどのような情報を収集し、どのように使用・保護するかについて説明します。
        </p>
      </section>

      <section style={{ marginBottom: '30px' }}>
        <h2 style={{ fontSize: '1.4rem', color: '#ffffff', marginBottom: '10px' }}>2. 収集する情報</h2>
        <p>本拡張機能および本サービスでは、以下の情報を収集します：</p>
        <ul style={{ paddingLeft: '20px', marginTop: '10px' }}>
          <li style={{ marginBottom: '8px' }}>
            <strong>TikTok Shopライブ配信データ：</strong>GMV（売上）、視聴者数、コメント率、フォロー率、
            シェア率、いいね率、LIVE CTR、表示GPM、注文率、商品クリック数、カート数、販売数などのライブ配信パフォーマンスメトリクス
          </li>
          <li style={{ marginBottom: '8px' }}>
            <strong>コメントデータ：</strong>ライブ配信中のコメント内容とユーザー名
          </li>
          <li style={{ marginBottom: '8px' }}>
            <strong>商品情報：</strong>商品名、価格、画像URL、クリック数、カート数、販売数
          </li>
          <li style={{ marginBottom: '8px' }}>
            <strong>認証情報：</strong>AitherHubサービスへのログインに使用する認証トークン
          </li>
        </ul>
      </section>

      <section style={{ marginBottom: '30px' }}>
        <h2 style={{ fontSize: '1.4rem', color: '#ffffff', marginBottom: '10px' }}>3. 情報の使用目的</h2>
        <p>収集した情報は、以下の目的でのみ使用します：</p>
        <ul style={{ paddingLeft: '20px', marginTop: '10px' }}>
          <li style={{ marginBottom: '8px' }}>AitherHubダッシュボードでのリアルタイムデータ表示</li>
          <li style={{ marginBottom: '8px' }}>ライブ配信パフォーマンスの分析とAI提案の提供</li>
          <li style={{ marginBottom: '8px' }}>ライブ配信履歴の保存と振り返り分析</li>
          <li style={{ marginBottom: '8px' }}>サービスの改善と新機能の開発</li>
        </ul>
      </section>

      <section style={{ marginBottom: '30px' }}>
        <h2 style={{ fontSize: '1.4rem', color: '#ffffff', marginBottom: '10px' }}>4. 情報の共有</h2>
        <p>
          当社は、お客様の情報を第三者に販売、貸与、または共有することはありません。
          ただし、以下の場合を除きます：
        </p>
        <ul style={{ paddingLeft: '20px', marginTop: '10px' }}>
          <li style={{ marginBottom: '8px' }}>お客様の明示的な同意がある場合</li>
          <li style={{ marginBottom: '8px' }}>法令に基づく開示要求がある場合</li>
          <li style={{ marginBottom: '8px' }}>サービス提供に必要なインフラパートナー（クラウドホスティング等）への委託</li>
        </ul>
      </section>

      <section style={{ marginBottom: '30px' }}>
        <h2 style={{ fontSize: '1.4rem', color: '#ffffff', marginBottom: '10px' }}>5. データの保存と保護</h2>
        <p>
          収集したデータは、セキュアなクラウドサーバーに保存され、暗号化された通信（HTTPS）を通じて送受信されます。
          認証トークンはChromeのローカルストレージに安全に保存されます。
          ライブ配信データは、サービス提供に必要な期間保存されます。
        </p>
      </section>

      <section style={{ marginBottom: '30px' }}>
        <h2 style={{ fontSize: '1.4rem', color: '#ffffff', marginBottom: '10px' }}>6. ユーザーの権利</h2>
        <p>お客様は以下の権利を有します：</p>
        <ul style={{ paddingLeft: '20px', marginTop: '10px' }}>
          <li style={{ marginBottom: '8px' }}>収集されたデータへのアクセスを要求する権利</li>
          <li style={{ marginBottom: '8px' }}>データの修正または削除を要求する権利</li>
          <li style={{ marginBottom: '8px' }}>データ収集への同意を撤回する権利</li>
          <li style={{ marginBottom: '8px' }}>拡張機能をいつでもアンインストールしてデータ収集を停止する権利</li>
        </ul>
      </section>

      <section style={{ marginBottom: '30px' }}>
        <h2 style={{ fontSize: '1.4rem', color: '#ffffff', marginBottom: '10px' }}>7. Cookieとトラッキング</h2>
        <p>
          本拡張機能は、Cookieやトラッキングピクセルを使用しません。
          データ収集はTikTok Shopのページ上でのみ行われ、他のウェブサイトでの閲覧活動を追跡することはありません。
        </p>
      </section>

      <section style={{ marginBottom: '30px' }}>
        <h2 style={{ fontSize: '1.4rem', color: '#ffffff', marginBottom: '10px' }}>8. ポリシーの変更</h2>
        <p>
          当社は、本プライバシーポリシーを随時更新することがあります。
          重要な変更がある場合は、本サービスを通じてお知らせします。
        </p>
      </section>

      <section style={{ marginBottom: '30px' }}>
        <h2 style={{ fontSize: '1.4rem', color: '#ffffff', marginBottom: '10px' }}>9. お問い合わせ</h2>
        <p>
          本プライバシーポリシーに関するご質問やお問い合わせは、以下までご連絡ください：
        </p>
        <p style={{ marginTop: '10px' }}>
          <strong>AitherHub</strong><br />
          メール: support@aitherhub.com
        </p>
      </section>
    </div>
  );
};

export default PrivacyPolicy;
