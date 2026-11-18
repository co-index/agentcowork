import { db, sql } from './db';
import type { Order } from '../models/order';

export interface OrderQuery {
  userId?: string;
  /** Calendar day "YYYY-MM-DD". */
  date?: string;
  status?: string;
}

/** Start and end (exclusive) of the requested calendar day. */
export function dayRange(date: string): [Date, Date] {
  // Parsed in the server's local time zone (the deployment sets TZ=Asia/Shanghai).
  const start = new Date(`${date}T00:00:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return [start, end];
}

export async function listOrders(q: OrderQuery): Promise<Order[]> {
  const where = [sql`true`];
  if (q.userId) where.push(sql`user_id = ${q.userId}`);
  if (q.status) where.push(sql`status = ${q.status}`);
  if (q.date) {
    const [start, end] = dayRange(q.date);
    where.push(sql`created_at >= ${start} AND created_at < ${end}`);
  }
  return db.query(sql`SELECT * FROM orders WHERE ${sql.join(where, ' AND ')} ORDER BY created_at DESC`);
}
