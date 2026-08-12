# エディション別ライセンス対応

## エディション

- Voicon: `ed_voicon`
- DCS Localizer: `ed_dcs_localizer`

同一メールアドレスでも、エディションが異なる場合は別ライセンスとして発行します。
同一メールアドレスかつ同一エディションの有効ライセンスがある場合のみ、既存ライセンスを30日延長します。

## Stripe商品

| 商品 | Product ID | Price ID | edition | 日数 |
|---|---|---|---|---:|
| Voicon 30日 | `prod_UsGP6npD27uDAZ` | `price_1TsVsqJxX08uzFkDDMnK6zIl` | `ed_voicon` | 30 |
| DCS Localizer 30日 | `prod_UxgFgAYujUhGqu` | `price_1TxktHJxX08uzFkDoecIfVAh` | `ed_dcs_localizer` | 30 |

## 適用手順

1. D1へ `migrations/0004_license_editions.sql` を適用します。
2. Workerをデプロイします。
3. Stripe Webhookで `checkout.session.completed` が有効になっていることを確認します。

`0004_license_editions.sql` は既存の `standard` / `voicon` を `ed_voicon`、
`dcs_localizer` を `ed_dcs_localizer` へ移行し、有効ライセンスの一意条件を
`normalized_email + edition` へ変更します。
