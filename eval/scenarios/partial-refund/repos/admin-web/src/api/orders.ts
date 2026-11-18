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
  items: OrderItem[];
  subtotal_cents: number;
  coupon_discount_cents: number;
  shipping_fee_cents: number;
  paid_cents: number;
  status: string;
  refund_status: RefundStatus;
}

export const getOrder = (id: string): Promise<Order> => fetch(`/api/orders/${id}`).then((r) => r.json());

export const refundOrder = (id: string) =>
  fetch(`/api/orders/${id}/refund`, { method: 'POST' }).then((r) => {
    if (!r.ok) throw new Error(`refund failed: ${r.status}`);
    return r.json();
  });
