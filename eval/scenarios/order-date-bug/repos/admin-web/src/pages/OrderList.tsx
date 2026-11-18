import { DatePicker, Table } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useEffect, useState } from 'react';
import { listOrders, type Order } from '../api/orders';

export function OrderList() {
  const [day, setDay] = useState<Dayjs>(dayjs());
  const [rows, setRows] = useState<Order[]>([]);

  useEffect(() => {
    // The picked calendar day in the browser's local time, e.g. "2026-11-16".
    void listOrders({ date: day.format('YYYY-MM-DD') }).then(setRows);
  }, [day]);

  return (
    <>
      <DatePicker value={day} onChange={(d) => d && setDay(d)} />
      <Table
        rowKey="id"
        dataSource={rows}
        columns={[
          { title: '订单号', dataIndex: 'id' },
          { title: '下单时间', dataIndex: 'created_at', render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm') },
          { title: '状态', dataIndex: 'status' },
        ]}
      />
    </>
  );
}
