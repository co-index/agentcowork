import { version } from '../../package.json';

export const http = {
  get: <T,>(url: string): Promise<T> =>
    fetch(`https://api.example.com${url}`, { headers: { 'X-App-Version': version } }).then((r) => r.json()),
};
