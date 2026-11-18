export interface Order {
  id: string;
  user_id: string;
  paid_cents: number;
  status: 'pending_payment' | 'paid' | 'shipped' | 'completed' | 'closed';
  created_at: string; // ISO 8601, from TIMESTAMPTZ
}
