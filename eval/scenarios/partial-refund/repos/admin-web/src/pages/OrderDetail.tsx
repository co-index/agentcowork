import { Button, Modal, Table, Tag } from 'antd';
import { useEffect, useState } from 'react';
import { getOrder, refundOrder, type Order } from '../api/orders';
import { formatCents } from '../utils/money';

const REFUND_TAG = {
  none: <Tag>未退款</Tag>,
  refunding: <Tag color="orange">退款中</Tag>,
  refunded: <Tag color="red">已退款</Tag>,
};

export function OrderDetail({ id }: { id: string }) {
  const [order, setOrder] = useState<Order>();
  useEffect(() => void getOrder(id).then(setOrder), [id]);
  if (!order) return null;

  const refundAll = () =>
    Modal.confirm({
      title: `确认整单退款 ${formatCents(order.paid_cents)}？`,
      onOk: () => refundOrder(order.id).then(() => getOrder(id).then(setOrder)),
    });

  return (
    <>
      <h2>订单 {order.id} {REFUND_TAG[order.refund_status]}</h2>
      <Table
        rowKey="id"
        dataSource={order.items}
        columns={[
          { title: '商品', dataIndex: 'title' },
          { title: '单价', dataIndex: 'unit_price_cents', render: formatCents },
          { title: '数量', dataIndex: 'quantity' },
        ]}
        pagination={false}
      />
      <p>优惠券 -{formatCents(order.coupon_discount_cents)}　运费 {formatCents(order.shipping_fee_cents)}　实付 {formatCents(order.paid_cents)}</p>
      <Button danger disabled={order.refund_status !== 'none'} onClick={refundAll}>
        整单退款
      </Button>
    </>
  );
}
