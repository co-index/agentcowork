# order-api

商城订单服务（Express + PostgreSQL）。被管理后台 admin-web 和用户 App mall-app 共用。

- `GET /orders`、`GET /orders/:id`：后台和 App 都在用，**响应结构不能做破坏性修改**
- 退款目前只支持整单退款：`POST /orders/:id/refund`（后台直接退）和售后申请流程（App 申请 → 客服审核）
- 支付渠道：PayCo，见 `src/services/payment.ts`
