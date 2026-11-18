export type OrderStatus = 'pending_payment' | 'paid' | 'shipped' | 'completed' | 'closed';

// NOTE(INCIDENT-212): mall-app <= 3.4 decodes refund_status with a strict enum and crashes
// on values it does not know. Adding a new value here must be coordinated with the app team.
export type RefundStatus = 'none' | 'refunding' | 'refunded';

export interface OrderItem {
  id: string;
  sku: string;
  title: string;
  unit_price_cents: number;
  quantity: number;
}

export interface Order {
  id: string;
  user_id: string;
  items: OrderItem[];
  subtotal_cents: number;
  coupon_discount_cents: number;
  shipping_fee_cents: number;
  paid_cents: number;
  status: OrderStatus;
  refund_status: RefundStatus;
  payment_txn_id: string | null;
  paid_at: string | null;
}
