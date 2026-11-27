export async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(result.error || '请求失败，请稍后重试');
  return result.data as T;
}
