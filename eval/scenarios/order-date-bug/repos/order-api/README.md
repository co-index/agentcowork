# order-api

商城订单服务（Express + PostgreSQL），admin-web 和 mall-app 共用。

- `GET /orders?date=YYYY-MM-DD&status=`：按「下单日期」查订单。日期指业务日（北京时间）
- `GET /stats/daily?date=YYYY-MM-DD`：某天的订单数和成交额，运营日报在用
- 数据库时间字段统一 `TIMESTAMPTZ`
