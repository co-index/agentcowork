import { Button, Table } from 'antd';

// Customer service reviews after-sale requests from the app. Only whole-order refunds today.
export function AfterSaleList({ rows, onReview }: {
  rows: { id: string; order_id: string; reason: string; status: string }[];
  onReview: (id: string, approve: boolean) => void;
}) {
  return (
    <Table
      rowKey="id"
      dataSource={rows}
      columns={[
        { title: '订单', dataIndex: 'order_id' },
        { title: '原因', dataIndex: 'reason' },
        { title: '状态', dataIndex: 'status' },
        {
          title: '操作',
          render: (_, r) => r.status === 'pending_review' && (
            <>
              <Button onClick={() => onReview(r.id, true)}>同意退款</Button>
              <Button onClick={() => onReview(r.id, false)}>拒绝</Button>
            </>
          ),
        },
      ]}
    />
  );
}
