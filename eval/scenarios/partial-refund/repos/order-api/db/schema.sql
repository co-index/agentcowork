CREATE TABLE orders (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  subtotal_cents  INTEGER NOT NULL,      -- sum of item price * quantity
  coupon_discount_cents INTEGER NOT NULL DEFAULT 0,
  shipping_fee_cents    INTEGER NOT NULL DEFAULT 0,
  paid_cents      INTEGER NOT NULL,      -- subtotal - coupon + shipping
  status          TEXT NOT NULL,         -- pending_payment | paid | shipped | completed | closed
  refund_status   TEXT NOT NULL DEFAULT 'none',  -- none | refunding | refunded
  payment_txn_id  TEXT,
  paid_at         TIMESTAMPTZ
);

CREATE TABLE order_items (
  id               TEXT PRIMARY KEY,
  order_id         TEXT NOT NULL REFERENCES orders(id),
  sku              TEXT NOT NULL,
  title            TEXT NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  quantity         INTEGER NOT NULL
);

CREATE TABLE aftersale_requests (
  id          TEXT PRIMARY KEY,
  order_id    TEXT NOT NULL REFERENCES orders(id),
  type        TEXT NOT NULL,            -- only 'full_refund' today
  reason      TEXT NOT NULL,
  status      TEXT NOT NULL,            -- pending_review | approved | rejected
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
