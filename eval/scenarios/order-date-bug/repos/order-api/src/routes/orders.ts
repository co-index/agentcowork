import { Router } from 'express';
import { listOrders } from '../repo/orders';

export const orders = Router();

// admin-web: order list filtered by day; mall-app: "今日订单" (user's own orders of a day).
orders.get('/orders', async (req, res) => {
  const { date, status } = req.query as { date?: string; status?: string };
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ code: 'BAD_DATE' });
  res.json(await listOrders({ date, status, userId: req.user.isAdmin ? undefined : req.user.id }));
});
