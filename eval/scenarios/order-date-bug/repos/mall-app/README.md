# mall-app

商城用户端 App（React Native）。

## 发版约束
- 双周发版火车，应用商店审核 3～5 天，新版本到用户手里约 2～3 周
- 不支持强制升级。线上约 30% 用户仍在 3.4 及更早版本
- 每个请求都带 `X-App-Version` 头（见 `src/api/http.ts`）

## 历史
- 3.2（2026-08）新增「今日订单」页 `src/screens/TodayOrdersScreen.tsx`
