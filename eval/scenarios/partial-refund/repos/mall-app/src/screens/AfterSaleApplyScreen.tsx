import { useState } from 'react';
import { Button, TextInput, View } from 'react-native';
import { applyAfterSale } from '../api/orders';

// Today the user can only request a refund of the whole order, with a free-text reason.
export function AfterSaleApplyScreen({ orderId, onDone }: { orderId: string; onDone: () => void }) {
  const [reason, setReason] = useState('');
  return (
    <View>
      <TextInput placeholder="请描述问题" value={reason} onChangeText={setReason} />
      <Button title="申请整单退款" onPress={() => applyAfterSale(orderId, reason).then(onDone)} />
    </View>
  );
}
