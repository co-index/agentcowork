import { useEffect, useState } from 'react';
import { FlatList, Text } from 'react-native';
import { http } from '../api/http';
import { formatTime } from '../utils/time';

interface Order {
  id: string;
  paid_cents: number;
  created_at: string;
}

// "今日订单": the user's orders placed today.
export function TodayOrdersScreen() {
  const [orders, setOrders] = useState<Order[]>([]);
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    void http.get<Order[]>(`/orders?date=${today}`).then(setOrders);
  }, []);
  return (
    <FlatList
      data={orders}
      keyExtractor={(o) => o.id}
      renderItem={({ item }) => <Text>{item.id} {formatTime(item.created_at)}</Text>}
    />
  );
}
