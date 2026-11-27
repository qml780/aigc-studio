import crypto from 'node:crypto';

export interface JimengResponse {
  code: number;
  message: string;
  request_id?: string;
  data?: {
    binary_data_base64?: string[];
    image_urls?: string[];
    task_id?: string;
    status?: string | number;
  };
}

const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const hmac = (key: string | Buffer, value: string): Buffer => crypto.createHmac('sha256', key).update(value).digest();

// Protocol: docs.volcengine.com/docs/jimeng-ai/dream-text-to-image30-interface-documentation
// Signing: docs.volcengine.com/docs/api-signature-call-guide/signature-method
export function signRequest(action: string, body: string, now = new Date()) {
  const ak = process.env.VOLCENGINE_AK || '';
  const sk = process.env.VOLCENGINE_SK || '';
  if (!ak || !sk) throw new Error('请配置 VOLCENGINE_AK 和 VOLCENGINE_SK');
  const host = process.env.VOLCENGINE_HOST || 'visual.volcengineapi.com';
  const region = process.env.VOLCENGINE_REGION || 'cn-north-1';
  const service = 'cv';
  const dateTime = now.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const date = dateTime.slice(0, 8);
  const query = `Action=${encodeURIComponent(action)}&Version=2022-08-31`;
  const canonicalHeaders = `content-type:application/json\nhost:${host}\nx-date:${dateTime}\n`;
  const signedHeaders = 'content-type;host;x-date';
  const canonical = ['POST', '/', query, canonicalHeaders, signedHeaders, hash(body)].join('\n');
  const scope = `${date}/${region}/${service}/request`;
  const stringToSign = ['HMAC-SHA256', dateTime, scope, hash(canonical)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(sk, date), region), service), 'request');
  const signature = hmac(signingKey, stringToSign).toString('hex');
  return {
    url: `https://${host}/?${query}`,
    headers: {
      'Content-Type': 'application/json',
      'X-Date': dateTime,
      Authorization: `HMAC-SHA256 Credential=${ak}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

async function request(action: string, body: object): Promise<JimengResponse> {
  const payload = JSON.stringify(body);
  const signed = signRequest(action, payload);
  // Submissions are not automatically retried: a timeout can still mean the provider accepted the job.
  const response = await fetch(signed.url, {
    method: 'POST', headers: signed.headers, body: payload, signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error(`即梦服务请求失败 (${response.status})`);
  return response.json();
}

export async function textToImage(params: { prompt: string; width: number; height: number; seed: number }) {
  return request('CVSync2AsyncSubmitTask', { req_key: 'jimeng_t2i_v30', ...params, use_pre_llm: false });
}

export async function dreamOGenerate(params: { prompt: string; imageBase64: string; width: number; height: number }) {
  return request('CVProcess', { req_key: 'i2i_dreamo', prompt: params.prompt, binary_data_base64: [params.imageBase64], width: params.width, height: params.height, return_url: true });
}

export async function getTaskResult(taskId: string) {
  // Base64 results are saved locally so history does not depend on expiring provider URLs.
  return request('CVSync2AsyncGetResult', { req_key: 'jimeng_t2i_v30', task_id: taskId, req_json: JSON.stringify({ return_url: false }) });
}
