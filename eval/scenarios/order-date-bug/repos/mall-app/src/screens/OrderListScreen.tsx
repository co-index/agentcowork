import { useEffect, useState } from 'react';
import { FlatList, Text } from 'react-native';
import { http } from '../api/http';
import { formatTime } from '../utils/time';

// "全部订单": all of the user's orders, newest first (no date filter).
export function OrderListScreen() {
  const [orders, setOrders] = useState<{ id: string; created_at: string }[]>([]);
  useEffect(() => void http.get<typeof orders>('/orders').then(setOrders), []);
  return (
    <FlatList
      data={orders}
      keyExtractor={(o) => o.id}
      renderItem={({ item }) => <Text>{item.id} {formatTime(item.created_at)}</Text>}
    />
  );
}
