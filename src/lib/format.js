export function formatUSD(value, decimals = 2) {
  if (value === null || value === undefined) return '$0.00';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function formatCrypto(value, decimals = 6) {
  if (value === null || value === undefined) return '0';
  if (Math.abs(value) < 0.001) decimals = 8;
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function formatPercent(value, decimals = 2) {
  if (value === null || value === undefined) return '0.00%';
  return `${value >= 0 ? '+' : ''}${value.toFixed(decimals)}%`;
}

export function formatNumber(value, decimals = 2) {
  if (value === null || value === undefined) return '0';
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function formatDate(date) {
  if (!date) return '';
  const d = new Date(date);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDateShort(date) {
  if (!date) return '';
  return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function pnlColor(value) {
  if (value > 0) return 'text-emerald-400';
  if (value < 0) return 'text-red-400';
  return 'text-slate-400';
}

export function pnlBg(value) {
  if (value > 0) return 'bg-emerald-500/10 text-emerald-400';
  if (value < 0) return 'bg-red-500/10 text-red-400';
  return 'bg-slate-500/10 text-slate-400';
}

export function priceDecimals(price) {
  if (price > 1000) return 2;
  if (price > 1) return 4;
  if (price > 0.01) return 6;
  return 8;
}
