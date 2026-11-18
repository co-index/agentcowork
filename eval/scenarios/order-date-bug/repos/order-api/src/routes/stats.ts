import { Router } from 'express';
import { listOrders } from '../repo/orders';

export const stats = Router();

// Daily report for operations: number of paid orders and revenue of one day.
stats.get('/stats/daily', async (req, res) => {
  const date = String(req.query.date);
  const rows = await listOrders({ date, status: 'paid' });
  res.json({ date, orders: rows.length, revenue_cents: rows.reduce((s, o) => s + o.paid_cents, 0) });
});
