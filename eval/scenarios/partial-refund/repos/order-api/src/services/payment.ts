/**
 * PayCo payment gateway client.
 *
 * Refund rules from the PayCo contract (2024 version):
 * - partial refunds are supported, at most 5 refund requests per transaction
 * - the sum of all refunds must not exceed the paid amount
 * - refunds are only accepted within 365 days of payment
 * - `refundNo` must be unique per transaction; re-sending the same refundNo is idempotent
 * - the result arrives asynchronously on POST /payco/notify (usually seconds, up to 2 hours)
 */
export const payco = {
  async refund(txnId: string, amountCents: number, refundNo: string): Promise<void> {
    await fetch(`${process.env.PAYCO_URL}/v2/refunds`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ txn_id: txnId, amount: amountCents, refund_no: refundNo }),
    });
  },
};
