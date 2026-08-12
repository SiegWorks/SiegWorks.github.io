import {
  retrieveCheckoutSession,
  StripeApiError
} from "./stripe-api-service.js";

import {
  StripeOrderRepository
} from "../repositories/stripe-order-repository.js";

import {
  LicenseRepository
} from "../repositories/license-repository.js";

import {
  decryptLicenseKeyForDisplay
} from "../utils/crypto.js";

const RESULT_REFRESH_SECONDS = 3;
const SESSION_ID_MAX_LENGTH = 255;

export async function processStripePurchaseResult(
  request,
  env
) {
  const url = new URL(request.url);
  const checkoutSessionId =
    url.searchParams.get("session_id")?.trim() ?? "";

  if (!isValidCheckoutSessionId(checkoutSessionId)) {
    return createResultPage({
      title: "決済結果を確認できません",
      heading: "決済結果を確認できません",
      message:
        "決済情報が不足しています。購入時の画面から、もう一度お試しください。",
      status: 400
    });
  }

  if (!env.DB) {
    return createSystemErrorPage();
  }

  if (!isConfigured(env.STRIPE_SECRET_KEY)) {
    return createSystemErrorPage();
  }

  try {
    const session = await retrieveCheckoutSession(
      checkoutSessionId,
      env.STRIPE_SECRET_KEY
    );

    if (
      session.id !== checkoutSessionId ||
      session.mode !== "payment"
    ) {
      return createResultPage({
        title: "決済結果を確認できません",
        heading: "決済結果を確認できません",
        message:
          "この決済情報はVoiconの購入結果として確認できませんでした。",
        status: 400
      });
    }

    if (session.payment_status !== "paid") {
      return createResultPage({
        title: "決済は完了していません",
        heading: "決済は完了していません",
        message:
          "Stripe上で支払いの完了を確認できませんでした。支払い画面をご確認ください。",
        status: 409
      });
    }

    const orderRepository =
      new StripeOrderRepository(env.DB);

    const order =
      await orderRepository.findByCheckoutSessionId(
        checkoutSessionId
      );

    if (order === null) {
      return createPendingPage();
    }

    if (!doesSessionMatchOrder(session, order)) {
      return createResultPage({
        title: "決済結果を確認できません",
        heading: "決済結果を確認できません",
        message:
          "決済情報と注文情報の照合に失敗しました。しばらくしてから再度お試しください。",
        status: 409
      });
    }

    if (order.processing_status === "processing") {
      return createPendingPage();
    }

    if (order.processing_status === "failed") {
      return createResultPage({
        title: "ライセンス処理を完了できませんでした",
        heading: "ライセンス処理を完了できませんでした",
        message:
          "決済は確認できましたが、ライセンス処理で問題が発生しました。購入時のメールアドレスを添えてSiegWorksへお問い合わせください。",
        status: 500
      });
    }

    if (
      order.processing_status !== "completed" ||
      !Number.isInteger(Number(order.license_id))
    ) {
      return createPendingPage();
    }

    const licenseRepository =
      new LicenseRepository(env.DB);

    const license = await licenseRepository.findById(
      Number(order.license_id)
    );

    if (license === null) {
      return createSystemErrorPage();
    }

    const productPresentation = getProductPresentation(license.edition);

    if (order.fulfillment_action === "extended") {
      return createResultPage({
        title: `${productPresentation.licenseName}を延長しました`,
        heading: `${productPresentation.licenseName}を延長しました`,
        message:
          `既存の${productPresentation.licenseName}の利用期限を延長しました。現在お使いのライセンスキーを引き続きご利用ください。ライセンスキーが分からない場合は、購入時のメールアドレスを添えてSiegWorksサポートへお問い合わせください。`,
        details: [
          ["ライセンス種別", productPresentation.licenseName],
          ["追加日数", `${Number(order.license_days)}日`],
          ["新しい有効期限", formatJapaneseDateTime(license.expires_at)]
        ],
        instructionsHeading: productPresentation.instructionsHeading,
        instructions: productPresentation.extensionInstructions,
        brandName: productPresentation.brandName
      });
    }

    if (order.fulfillment_action !== "issued") {
      return createSystemErrorPage();
    }

    const keyAvailable =
      isConfigured(order.license_key_ciphertext) &&
      isConfigured(order.license_key_iv) &&
      isFutureIsoDate(order.license_key_expires_at);

    if (!keyAvailable) {
      return createResultPage({
        title: "ライセンスを発行しました",
        heading: "ライセンスを発行しました",
        message:
          "ライセンスキーの表示期限が終了しています。購入時のメールアドレスを添えてSiegWorksへ再発行をご依頼ください。",
        details: [
          ["ライセンス期間", `${Number(order.license_days)}日`],
          ["有効期限", formatJapaneseDateTime(license.expires_at)]
        ]
      });
    }

    if (!isConfigured(env.LICENSE_HMAC_KEY)) {
      return createSystemErrorPage();
    }

    const licenseKey = await decryptLicenseKeyForDisplay(
      order.license_key_ciphertext,
      order.license_key_iv,
      env.LICENSE_HMAC_KEY
    );

    return createResultPage({
      title: `${productPresentation.licenseName}を発行しました`,
      heading: `${productPresentation.licenseName}を発行しました`,
      message: productPresentation.registrationMessage,
      licenseKey,
      importantMessage:
        "この画面を閉じる前にライセンスキーをコピーし、安全な場所へ保存してください。キー表示期限内であれば、このページを再度開いて確認できます。",
      instructionsHeading: productPresentation.instructionsHeading,
      instructions: productPresentation.registrationInstructions,
      details: [
        ["ライセンス種別", productPresentation.licenseName],
        ["ライセンス期間", `${Number(order.license_days)}日`],
        ["有効期限", formatJapaneseDateTime(license.expires_at)],
        [
          "キー表示期限",
          formatJapaneseDateTime(order.license_key_expires_at)
        ]
      ],
      brandName: productPresentation.brandName
    });
  } catch (error) {
    console.error(
      "[Stripe] Purchase result page failed.",
      error
    );

    if (
      error instanceof StripeApiError &&
      error.statusCode === 404
    ) {
      return createResultPage({
        title: "決済結果を確認できません",
        heading: "決済結果を確認できません",
        message:
          "指定された決済情報が見つかりませんでした。",
        status: 404
      });
    }

    return createSystemErrorPage();
  }
}

function getProductPresentation(edition) {
  switch ((edition ?? "").trim().toLowerCase()) {
    case "ed_dcs_localizer":
      return {
        licenseName: "DCS Localizerバンドルライセンス",
        brandName: "SiegWorks / DCS Localizer",
        instructionsHeading: "VoiconおよびDCS Localizerへの登録手順",
        registrationMessage:
          "下記のライセンスキーをコピーし、VoiconとDCS Localizerの両方へ同じメールアドレスとライセンスキーを登録してください。",
        registrationInstructions: [
          "［ライセンスキーをコピー］を押します。",
          "Voiconを起動し、ライセンス登録画面で購入時のメールアドレスとライセンスキーを入力して［オンライン認証］を押します。",
          "DCS Localizerを起動し、ライセンス登録画面で同じメールアドレスとライセンスキーを入力して［オンライン認証］を押します。"
        ],
        extensionInstructions: [
          "Voiconを起動し、［ヘルプ］→［ライセンス］から［オンライン認証］を押して新しい有効期限を取得します。",
          "DCS Localizerを起動し、ライセンス画面から［オンライン認証］を押して新しい有効期限を取得します。"
        ]
      };
    case "ed_voicon":
    default:
      return {
        licenseName: "Voiconライセンス",
        brandName: "SiegWorks / Voicon",
        instructionsHeading: "Voiconへの登録手順",
        registrationMessage:
          "下記のライセンスキーをコピーし、Voiconへ登録してください。",
        registrationInstructions: [
          "［ライセンスキーをコピー］を押します。",
          "Voiconを起動し、ライセンス登録画面を開きます。",
          "購入時のメールアドレスとコピーしたライセンスキーを入力します。",
          "［オンライン認証］を押して登録を完了します。"
        ],
        extensionInstructions: [
          "Voiconを起動します。",
          "［ヘルプ］→［ライセンス］を開きます。",
          "［オンライン認証］を押して、新しい有効期限を取得します。"
        ]
      };
  }
}

function createPendingPage() {
  return createResultPage({
    title: "ライセンスを準備しています",
    heading: "ライセンスを準備しています",
    message:
      "決済は完了しています。ライセンス発行処理を行っていますので、このまま数秒お待ちください。",
    status: 202,
    refreshSeconds: RESULT_REFRESH_SECONDS
  });
}

function createSystemErrorPage() {
  return createResultPage({
    title: "処理を完了できませんでした",
    heading: "処理を完了できませんでした",
    message:
      "一時的な問題が発生しました。しばらくしてから、このページを再読み込みしてください。解消しない場合はSiegWorksへお問い合わせください。",
    status: 500
  });
}

function createResultPage({
  title,
  heading,
  message,
  details = [],
  licenseKey = null,
  importantMessage = null,
  instructions = [],
  instructionsHeading = "ライセンスの登録手順",
  brandName = "SiegWorks",
  status = 200,
  refreshSeconds = null
}) {
  const nonce = crypto.randomUUID().replaceAll("-", "");

  const refreshTag =
    Number.isInteger(refreshSeconds) && refreshSeconds > 0
      ? `<meta http-equiv="refresh" content="${refreshSeconds}">`
      : "";

  const detailHtml = details.length > 0
    ? `<dl class="details">${details.map(
        ([label, value]) =>
          `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`
      ).join("")}</dl>`
    : "";

  const keyHtml = licenseKey === null
    ? ""
    : `
      <section class="key-panel" aria-labelledby="license-key-heading">
        <h2 id="license-key-heading">ライセンスキー</h2>
        <code id="license-key">${escapeHtml(licenseKey)}</code>
        <button id="copy-button" type="button">ライセンスキーをコピー</button>
        <p id="copy-result" class="copy-result" role="status" aria-live="polite"></p>
      </section>
    `;

  const importantHtml = importantMessage === null
    ? ""
    : `<div class="important" role="note">${escapeHtml(importantMessage)}</div>`;

  const instructionHtml = instructions.length === 0
    ? ""
    : `
      <section class="instructions" aria-labelledby="instructions-heading">
        <h2 id="instructions-heading">${escapeHtml(instructionsHeading)}</h2>
        <ol>${instructions.map(
          (instruction) => `<li>${escapeHtml(instruction)}</li>`
        ).join("")}</ol>
      </section>
    `;

  const script = licenseKey === null
    ? ""
    : `
      <script nonce="${nonce}">
        const button = document.getElementById("copy-button");
        const key = document.getElementById("license-key");
        const result = document.getElementById("copy-result");
        button.addEventListener("click", async () => {
          try {
            await navigator.clipboard.writeText(key.textContent);
            result.textContent = "ライセンスキーをコピーしました。";
          } catch {
            result.textContent = "コピーできませんでした。キーを選択してコピーしてください。";
          }
        });
      </script>
    `;

  const html = `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${refreshTag}
  <title>${escapeHtml(title)} | SiegWorks</title>
  <style>
    :root { color-scheme: light; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #f5f7fb; color: #172033; }
    main { width: min(680px, calc(100% - 32px)); margin: 64px auto; }
    .card { background: #fff; border: 1px solid #dfe5ef; border-radius: 16px; padding: 32px; box-shadow: 0 12px 32px rgba(23, 32, 51, .08); }
    .brand { margin: 0 0 24px; font-weight: 700; letter-spacing: .04em; color: #4f46e5; }
    h1 { margin: 0 0 16px; font-size: clamp(1.55rem, 4vw, 2rem); }
    p { line-height: 1.75; }
    .details { margin: 28px 0 0; border-top: 1px solid #e5e9f0; }
    .details div { display: grid; grid-template-columns: 10rem 1fr; gap: 16px; padding: 14px 0; border-bottom: 1px solid #e5e9f0; }
    dt { font-weight: 600; }
    dd { margin: 0; overflow-wrap: anywhere; }
    .key-panel { margin-top: 28px; padding: 22px; border-radius: 12px; background: #f0f4ff; }
    .key-panel h2 { margin: 0 0 12px; font-size: 1rem; }
    code { display: block; padding: 16px; border: 1px solid #bdc9e8; border-radius: 8px; background: #fff; font-size: clamp(.95rem, 3vw, 1.2rem); font-weight: 700; letter-spacing: .06em; overflow-wrap: anywhere; user-select: all; }
    button { margin-top: 14px; border: 0; border-radius: 8px; padding: 11px 22px; background: #4f46e5; color: #fff; font: inherit; font-weight: 700; cursor: pointer; }
    button:hover { background: #4338ca; }
    .copy-result { min-height: 1.5em; margin: 10px 0 0; font-size: .92rem; }
    .important { margin-top: 20px; padding: 16px 18px; border: 1px solid #f0c36a; border-radius: 10px; background: #fff8e6; color: #624a16; line-height: 1.65; }
    .instructions { margin-top: 28px; padding-top: 4px; }
    .instructions h2 { margin: 0 0 12px; font-size: 1.1rem; }
    .instructions ol { margin: 0; padding-left: 1.5rem; }
    .instructions li { margin: 8px 0; line-height: 1.65; }
    .notice { margin-top: 28px; color: #566176; font-size: .9rem; }
    @media (max-width: 520px) {
      main { margin: 24px auto; }
      .card { padding: 24px 20px; }
      .details div { grid-template-columns: 1fr; gap: 4px; }
    }
  </style>
</head>
<body>
  <main>
    <article class="card">
      <p class="brand">${escapeHtml(brandName)}</p>
      <h1>${escapeHtml(heading)}</h1>
      <p>${escapeHtml(message)}</p>
      ${keyHtml}
      ${importantHtml}
      ${instructionHtml}
      ${detailHtml}
      <p class="notice">このページおよびライセンスキーを第三者と共有しないでください。</p>
    </article>
  </main>
  ${script}
</body>
</html>`;

  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      Pragma: "no-cache",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy":
        `default-src 'none'; style-src 'unsafe-inline'; ` +
        `script-src 'nonce-${nonce}'; ` +
        "base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    }
  });
}

function doesSessionMatchOrder(session, order) {
  const sessionEmail = extractSessionEmail(session);

  if (sessionEmail === null) {
    return false;
  }

  return (
    sessionEmail.toLowerCase() === order.normalized_email &&
    session.id === order.checkout_session_id
  );
}

function extractSessionEmail(session) {
  const values = [
    session.customer_details?.email,
    session.customer_email
  ];

  const found = values.find(
    (value) =>
      typeof value === "string" &&
      value.trim() !== ""
  );

  return found?.trim() ?? null;
}

function isValidCheckoutSessionId(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= SESSION_ID_MAX_LENGTH &&
    /^cs_[A-Za-z0-9_]+$/.test(value)
  );
}

function isConfigured(value) {
  return (
    typeof value === "string" &&
    value.trim() !== ""
  );
}

function isFutureIsoDate(value) {
  if (!isConfigured(value)) {
    return false;
  }

  const date = new Date(value);

  return (
    !Number.isNaN(date.getTime()) &&
    date.getTime() > Date.now()
  );
}

function formatJapaneseDateTime(value) {
  if (!isConfigured(value)) {
    return "未設定";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "未設定";
  }

  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
