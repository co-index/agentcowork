import { Button, Text, View } from 'react-native';
import type { Order } from '../api/orders';

// Since 3.5 unknown values fall back to "退款处理中". Versions <= 3.4 used an exhaustive
// switch with assertNever here and crash on unknown refund_status values (INCIDENT-212).
function refundLabel(status: string): string {
  switch (status) {
    case 'none':
      return '';
    case 'refunding':
      return '退款中';
    case 'refunded':
      return '已退款';
    default:
      return '退款处理中';
  }
}

export function OrderDetailScreen({ order, onAfterSale }: { order: Order; onAfterSale: () => void }) {
  return (
    <View>
      {order.items.map((it) => (
        <Text key={it.id}>{it.title} × {it.quantity}</Text>
      ))}
      <Text>实付 ¥{(order.paid_cents / 100).toFixed(2)} {refundLabel(order.refund_status)}</Text>
      {order.refund_status === 'none' && <Button title="申请售后" onPress={onAfterSale} />}
    </View>
  );
}
