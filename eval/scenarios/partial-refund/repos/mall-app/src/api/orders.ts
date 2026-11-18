// Mirrors order-api's GET /orders/:id. Amounts are in cents.
export type RefundStatus = 'none' | 'refunding' | 'refunded';

export interface OrderItem {
  id: string;
  title: string;
  unit_price_cents: number;
  quantity: number;
}

export interface Order {
  id: string;
  items: OrderItem[];
  paid_cents: number;
  status: string;
  refund_status: RefundStatus;
}

export const getOrder = (id: string): Promise<Order> => http.get(`/orders/${id}`);

export const applyAfterSale = (orderId: string, reason: string) =>
  http.post('/aftersale/requests', { order_id: orderId, reason });

declare const http: { get<T>(url: string): Promise<T>; post<T>(url: string, body: unknown): Promise<T> };
