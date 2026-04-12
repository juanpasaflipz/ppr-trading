import { useEffect, useRef, useState, useCallback } from 'react';

export function useWebSocket() {
  const wsRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [prices, setPrices] = useState({});
  const [orderBook, setOrderBook] = useState(null);
  const [lastKline, setLastKline] = useState(null);
  const reconnectTimer = useRef(null);
  const listenersRef = useRef(new Map());

  const connect = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = `${protocol}://${window.location.host}/ws/market`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);

        if (msg.type === 'prices') {
          setPrices(msg.data);
        } else if (msg.type === 'ticker') {
          setPrices(prev => ({ ...prev, [msg.data.symbol]: msg.data.price }));
          // Notify listeners
          for (const cb of listenersRef.current.values()) {
            cb(msg);
          }
        } else if (msg.type === 'kline') {
          setLastKline(msg.data);
          for (const cb of listenersRef.current.values()) cb(msg);
        } else if (msg.type === 'depth') {
          setOrderBook(msg.data);
          for (const cb of listenersRef.current.values()) cb(msg);
        }
      } catch { /* ignore */ }
    };

    ws.onclose = () => {
      setConnected(false);
      reconnectTimer.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => ws.close();
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (wsRef.current) wsRef.current.close();
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };
  }, [connect]);

  const send = useCallback((data) => {
    if (wsRef.current?.readyState === 1) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  const subscribe = useCallback((key, callback) => {
    listenersRef.current.set(key, callback);
    return () => listenersRef.current.delete(key);
  }, []);

  return { connected, prices, orderBook, lastKline, send, subscribe };
}
