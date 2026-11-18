import { Router } from 'express';
import { createRequest, findRequest, updateRequest } from '../repo/aftersale';

export const aftersale = Router();

// mall-app: "申请售后". Only whole-order refunds can be requested today.
aftersale.post('/aftersale/requests', async (req, res) => {
  const { order_id, reason } = req.body as { order_id: string; reason: string };
  const request = await createRequest({ order_id, reason, type: 'full_refund', status: 'pending_review' });
  res.status(201).json(request);
});

// admin-web: customer service approves or rejects. Approval triggers a full refund.
aftersale.patch('/aftersale/requests/:id', async (req, res) => {
  if (!req.user.isAdmin) return res.sendStatus(403);
  const request = await findRequest(req.params.id);
  if (!request || request.status !== 'pending_review') return res.sendStatus(409);
  await updateRequest(request.id, { status: req.body.approve ? 'approved' : 'rejected' });
  res.json({ ok: true });
});
