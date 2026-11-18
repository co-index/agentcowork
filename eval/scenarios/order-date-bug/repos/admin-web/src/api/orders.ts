export interface Order {
  id: string;
  user_id: string;
  paid_cents: number;
  status: string;
  created_at: string;
}

export const listOrders = (q: { date?: string; status?: string }): Promise<Order[]> => {
  const params = new URLSearchParams();
  if (q.date) params.set('date', q.date);
  if (q.status) params.set('status', q.status);
  return fetch(`/api/orders?${params}`).then((r) => r.json());
};
