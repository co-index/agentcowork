import { Router } from 'express';
import { findOrder, updateOrder } from '../repo/orders';
import { payco } from '../services/payment';

export const refunds = Router();

const REFUNDABLE = new Set(['paid', 'shipped', 'completed']);

// Admin only. Full refund of the whole paid amount; there is no partial refund today.
refunds.post('/orders/:id/refund', async (req, res) => {
  if (!req.user.isAdmin) return res.sendStatus(403);
  const order = await findOrder(req.params.id);
  if (!order) return res.sendStatus(404);
  if (!REFUNDABLE.has(order.status) || order.refund_status !== 'none') {
    return res.status(409).json({ error: 'NOT_REFUNDABLE' });
  }
  await updateOrder(order.id, { refund_status: 'refunding' });
  await payco.refund(order.payment_txn_id!, order.paid_cents, `RF-${order.id}`);
  // refund_status becomes 'refunded' when PayCo calls /payco/notify (see payment.ts)
  res.status(202).json({ refund_status: 'refunding' });
});
