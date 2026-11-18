import { Router } from 'express';
import { findOrder, listOrders } from '../repo/orders';

export const orders = Router();

// Used by admin-web (order list) and mall-app (my orders). Keep the shape stable.
orders.get('/orders', async (req, res) => {
  res.json(await listOrders({ userId: req.user.isAdmin ? undefined : req.user.id }));
});

// Used by both clients; mall-app renders refund_status directly.
orders.get('/orders/:id', async (req, res) => {
  const order = await findOrder(req.params.id);
  if (!order || (!req.user.isAdmin && order.user_id !== req.user.id)) return res.sendStatus(404);
  res.json(order);
});
